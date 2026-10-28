import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { enqueueToRedisQueue } from "@/lib/server/redis";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";
import { isAllowedCategory } from "@/lib/server/arxiv/categories";

const ARXIV_ID_SEARCH_RE =
  /^([0-9]{4}\.[0-9]{4,5}|[a-z-]+(?:\.[A-Za-z-]+)?\/[0-9]{7})(?:v[1-9][0-9]*)?$/;

interface SearchRow {
  arxiv_id: string;
  title: string;
  authors: Array<{ name: string; affiliation: string | null }>;
  categories: string[];
  submitted_at: Date;
  updated_at: Date | null;
  latest_version: number;
  title_ja: string | null;
  thesis_text: string | null;
  source_scope: "abstract_only" | "full_text" | null;
  summary_generated_at: Date | null;
}

async function runSearchQueries(params: {
  exactArxivId: string | null;
  q: string | null;
  authorJsonFilter: string | null;
  category: string | null;
  limit: number;
  offset: number;
}): Promise<{ rows: SearchRow[]; total: number }> {
  const { exactArxivId, q, authorJsonFilter, category, limit, offset } = params;

  const whereClause = `
    WHERE (
      $1::text IS NOT NULL AND p.arxiv_id = $1::text
      OR (
        $1::text IS NULL
        AND (
          $2::text IS NULL
          OR to_tsvector('english', p.title || ' ' || p.abstract) @@ websearch_to_tsquery('english', $2::text)
          OR ($3::jsonb IS NOT NULL AND p.authors @> $3::jsonb)
        )
      )
    )
    AND ($4::text IS NULL OR p.categories @> ARRAY[$4::text])
  `;

  const countRes = await dbQuery<{ total_count: number }>(
    `SELECT COUNT(*)::int AS total_count FROM papers p ${whereClause}`,
    [exactArxivId, q, authorJsonFilter, category],
  );
  const total = countRes.rows[0]?.total_count ?? 0;

  const listRes = await dbQuery<SearchRow>(
    `
    SELECT p.arxiv_id,
           p.title,
           p.authors,
           p.categories,
           p.submitted_at,
           p.updated_at,
           p.latest_version,
           s.json_content->>'title_ja' AS title_ja,
           s.json_content->'thesis'->>'text' AS thesis_text,
           s.source_scope,
           s.generated_at AS summary_generated_at
    FROM papers p
    LEFT JOIN paper_versions pv
           ON pv.paper_id = p.id
          AND pv.version = p.latest_version
    LEFT JOIN LATERAL (
      SELECT json_content, source_scope, generated_at
      FROM summaries
      WHERE paper_version_id = pv.id
        AND summary_type = 'short'
        AND language = 'ja'
        AND validation_status = 'passed'
      ORDER BY generated_at DESC, id DESC
      LIMIT 1
    ) s ON true
    ${whereClause}
    ORDER BY
      CASE
        WHEN $2::text IS NOT NULL AND $1::text IS NULL
        THEN ts_rank_cd(to_tsvector('english', p.title || ' ' || p.abstract), websearch_to_tsquery('english', $2::text))
        ELSE 0
      END DESC,
      p.submitted_at DESC,
      p.id DESC
    LIMIT $5 OFFSET $6
    `,
    [exactArxivId, q, authorJsonFilter, category, limit, offset],
  );

  return { rows: listRes.rows, total };
}

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const { searchParams } = new URL(req.url);
    const rawQ = searchParams.get("q")?.trim() || null;
    const rawCat = searchParams.get("category")?.trim() || null;
    const pageParam = searchParams.get("page")?.trim() || "1";
    const limitParam = searchParams.get("limit")?.trim() || "20";

    if (!rawQ && !rawCat) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "検索キーワード（q）または分野（category）のいずれかを指定してください。",
      );
    }

    if (rawQ) {
      if (rawQ.length > 200) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "検索キーワードは200文字以内で入力してください。",
        );
      }
      if (/[\x00-\x1F\x7F]/.test(rawQ)) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "検索キーワードに使用できない制御文字が含まれています。",
        );
      }
    }

    if (rawCat && !isAllowedCategory(rawCat)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `指定された分野（${rawCat}）は対象外です。`,
      );
    }

    if (!/^[1-9][0-9]*$/.test(pageParam) || !/^[1-9][0-9]*$/.test(limitParam)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "pageおよびlimitは1以上の整数で指定してください。",
      );
    }

    const page = parseInt(pageParam, 10);
    const limit = parseInt(limitParam, 10);
    if (page > 100 || limit > 50) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "pageは100以下、limitは50以下で指定してください。",
      );
    }

    const idMatch = rawQ ? ARXIV_ID_SEARCH_RE.exec(rawQ) : null;
    const exactArxivId = idMatch ? idMatch[1] : null;
    const authorJsonFilter =
      rawQ && !exactArxivId ? JSON.stringify([{ name: rawQ }]) : null;
    const offset = (page - 1) * limit;

    let { rows, total } = await runSearchQueries({
      exactArxivId,
      q: rawQ,
      authorJsonFilter,
      category: rawCat,
      limit,
      offset,
    });

    let onDemandSync: {
      triggered: boolean;
      status: "completed" | "processing" | "failed";
    } | null = null;

    // BF04: When page === 1 and 0 results in DB, trigger B006 on-demand sync and poll up to ON_DEMAND_SYNC_WAIT_SECONDS
    if (total === 0 && page === 1) {
      const activeRes = await dbQuery<{ id: number; status: string }>(
        `
        SELECT id, status
        FROM jobs
        WHERE job_type = 'sync_on_demand'
          AND status IN ('pending', 'running')
        ORDER BY id DESC
        LIMIT 1
        `,
      );

      let syncJobId: number;
      if (activeRes.rows.length > 0) {
        syncJobId = Number(activeRes.rows[0].id);
      } else {
        const insertRes = await dbQuery<{ id: number }>(
          `
          INSERT INTO jobs (paper_version_id, job_type, status, attempts)
          VALUES (NULL, 'sync_on_demand', 'pending', 0)
          RETURNING id
          `,
        );
        syncJobId = Number(insertRes.rows[0].id);
        await enqueueToRedisQueue("sync_on_demand", "run_sync_on_demand", syncJobId, {
          jobId: syncJobId,
          q: rawQ,
          category: rawCat,
          requestedAt: new Date().toISOString(),
        });
      }

      const waitSeconds = Math.max(
        1,
        parseInt(process.env.ON_DEMAND_SYNC_WAIT_SECONDS || "5", 10),
      );
      const deadline = Date.now() + waitSeconds * 1000;
      let finalStatus: "completed" | "processing" | "failed" = "processing";

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        const stRes = await dbQuery<{ status: string }>(
          `SELECT status FROM jobs WHERE id = $1`,
          [syncJobId],
        );
        const st = stRes.rows[0]?.status;
        if (st === "succeeded") {
          finalStatus = "completed";
          break;
        }
        if (st === "failed") {
          finalStatus = "failed";
          break;
        }
      }

      onDemandSync = {
        triggered: true,
        status: finalStatus,
      };

      if (finalStatus === "completed") {
        const refreshed = await runSearchQueries({
          exactArxivId,
          q: rawQ,
          authorJsonFilter,
          category: rawCat,
          limit,
          offset,
        });
        rows = refreshed.rows;
        total = refreshed.total;
      }
    }

    const items = rows.map((row) => ({
      arxivId: row.arxiv_id,
      title: row.title,
      titleJa: row.title_ja || null,
      authors: Array.isArray(row.authors) ? row.authors : [],
      categories: Array.isArray(row.categories) ? row.categories : [],
      submittedAt: new Date(row.submitted_at).toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      latestVersion: Number(row.latest_version),
      shortSummary:
        row.thesis_text && row.source_scope && row.summary_generated_at
          ? {
              thesis: row.thesis_text,
              sourceScope: row.source_scope,
              generatedAt: new Date(row.summary_generated_at).toISOString(),
            }
          : null,
    }));

    return jsonSuccess({
      items,
      pagination: {
        page,
        limit,
        total,
        hasNext: offset + items.length < total,
      },
      onDemandSync,
    });
  });
}
