import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ensureUserRow, requireAuthenticatedUser } from "@/lib/server/auth";
import { validateBaseArxivId } from "@/lib/server/arxiv/id";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    await ensureUserRow(user.id);

    const { searchParams } = new URL(req.url);
    const pageParam = searchParams.get("page")?.trim() || "1";
    const limitParam = searchParams.get("limit")?.trim() || "20";

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

    const offset = (page - 1) * limit;

    // BE.F07 DA005: Total bookmark count
    const countRes = await dbQuery<{ total_count: number }>(
      `
      SELECT COUNT(*)::int AS total_count
      FROM bookmarks
      WHERE user_id = $1::uuid
      `,
      [user.id],
    );
    const total = countRes.rows[0]?.total_count ?? 0;

    // BE.F07 DA004: Paginated bookmarks ordered by created_at DESC
    const listRes = await dbQuery<{
      arxiv_id: string;
      title: string;
      authors: Array<{ name: string; affiliation: string | null }>;
      categories: string[];
      submitted_at: Date;
      updated_at: Date | null;
      latest_version: number;
      bookmarked_at: Date;
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
             b.created_at AS bookmarked_at,
             s.json_content->>'title_ja' AS title_ja,
             s.json_content->'thesis'->>'text' AS thesis_text,
             s.source_scope,
             s.generated_at AS summary_generated_at
      FROM bookmarks b
      JOIN papers p ON p.id = b.paper_id
      LEFT JOIN paper_versions pv
             ON pv.paper_id = p.id
            AND pv.version  = p.latest_version
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
      WHERE b.user_id = $1::uuid
      ORDER BY b.created_at DESC, b.paper_id DESC
      LIMIT $2 OFFSET $3
      `,
      [user.id, limit, offset],
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
      bookmarkedAt: new Date(row.bookmarked_at).toISOString(),
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

export async function POST(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    await ensureUserRow(user.id);

    let body: { arxivId?: unknown };
    try {
      body = (await req.json()) as { arxivId?: unknown };
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "リクエストボディのJSON形式が不正です。");
    }

    if (typeof body.arxivId !== "string") {
      throw new ApiError(400, "VALIDATION_ERROR", "arxivIdを指定してください。");
    }
    const arxivId = validateBaseArxivId(body.arxivId);

    // BE.F07 DA001: Resolve paper_id
    const paperRes = await dbQuery<{ id: number }>(
      `SELECT id FROM papers WHERE arxiv_id = $1`,
      [arxivId],
    );
    if (paperRes.rows.length === 0) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        `指定された論文（${arxivId}）は見つかりませんでした。`,
      );
    }
    const paperId = Number(paperRes.rows[0].id);

    // BE.F07 DA002: Idempotent bookmark insert
    const insRes = await dbQuery<{ created_at: Date }>(
      `
      INSERT INTO bookmarks (user_id, paper_id)
      VALUES ($1::uuid, $2)
      ON CONFLICT (user_id, paper_id) DO NOTHING
      RETURNING created_at
      `,
      [user.id, paperId],
    );

    if (insRes.rows.length > 0) {
      return jsonSuccess(
        {
          arxivId,
          bookmarkedAt: new Date(insRes.rows[0].created_at).toISOString(),
        },
        201,
      );
    }

    const existingRes = await dbQuery<{ created_at: Date }>(
      `
      SELECT created_at
      FROM bookmarks
      WHERE user_id = $1::uuid AND paper_id = $2
      `,
      [user.id, paperId],
    );

    return jsonSuccess(
      {
        arxivId,
        bookmarkedAt: existingRes.rows[0]
          ? new Date(existingRes.rows[0].created_at).toISOString()
          : new Date().toISOString(),
      },
      200,
    );
  });
}
