import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";
import { isAllowedCategory } from "@/lib/server/arxiv/categories";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseValidDate(dateStr: string, paramName: string): Date {
  if (!DATE_RE.test(dateStr)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${paramName}はYYYY-MM-DD形式で指定してください。`,
    );
  }
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() + 1 !== m ||
    dt.getUTCDate() !== d
  ) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `${paramName}に存在しない日付が指定されています。`,
    );
  }
  return dt;
}

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const { searchParams } = new URL(req.url);
    const categoryParam = searchParams.get("category")?.trim() || null;
    const fromParam = searchParams.get("from")?.trim() || null;
    const toParam = searchParams.get("to")?.trim() || null;
    const sortParam = searchParams.get("sort")?.trim() || "submitted_at";
    const pageParam = searchParams.get("page")?.trim() || "1";
    const limitParam = searchParams.get("limit")?.trim() || "20";

    if (categoryParam && !isAllowedCategory(categoryParam)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `指定された分野（${categoryParam}）は対象外です。`,
      );
    }

    if (sortParam !== "submitted_at" && sortParam !== "updated_at") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "sortはsubmitted_atまたはupdated_atを指定してください。",
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

    let fromUtcIso: string | null = null;
    let toExclusiveUtcIso: string | null = null;
    let fromDateObj: Date | null = null;
    let toDateObj: Date | null = null;

    if (fromParam) {
      fromDateObj = parseValidDate(fromParam, "from");
      // JST 00:00:00 -> UTC -9 hours
      fromUtcIso = new Date(fromDateObj.getTime() - 9 * 3600 * 1000).toISOString();
    }
    if (toParam) {
      toDateObj = parseValidDate(toParam, "to");
      // Next day JST 00:00:00 -> +24h - 9h = +15h from UTC midnight
      toExclusiveUtcIso = new Date(
        toDateObj.getTime() + 15 * 3600 * 1000,
      ).toISOString();
    }

    if (fromDateObj && toDateObj && fromDateObj.getTime() > toDateObj.getTime()) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "開始日（from）は終了日（to）以前の日付を指定してください。",
      );
    }

    const dateCol = sortParam === "updated_at" ? "p.updated_at" : "p.submitted_at";
    const offset = (page - 1) * limit;

    // DA002: Total count
    const countRes = await dbQuery<{ total_count: number }>(
      `
      SELECT COUNT(*)::int AS total_count
      FROM papers p
      WHERE ($1::text IS NULL OR p.categories @> ARRAY[$1::text])
        AND ($2::timestamptz IS NULL OR ${dateCol} >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR ${dateCol} < $3::timestamptz)
      `,
      [categoryParam, fromUtcIso, toExclusiveUtcIso],
    );
    const total = countRes.rows[0]?.total_count ?? 0;

    // DA001: Paginated paper list with passed short summary on latest_version
    const listRes = await dbQuery<{
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
    }>(
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
      WHERE ($1::text IS NULL OR p.categories @> ARRAY[$1::text])
        AND ($2::timestamptz IS NULL OR ${dateCol} >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR ${dateCol} < $3::timestamptz)
      ORDER BY ${dateCol} DESC, p.id DESC
      LIMIT $4 OFFSET $5
      `,
      [categoryParam, fromUtcIso, toExclusiveUtcIso, limit, offset],
    );

    const items = listRes.rows.map((row) => ({
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
    });
  });
}
