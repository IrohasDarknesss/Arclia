import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ensureUserRow, requireAuthenticatedUser } from "@/lib/server/auth";
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

    // BE.F15 DA002: Distinct paper count in user's view history
    const countRes = await dbQuery<{ total_count: number }>(
      `
      SELECT COUNT(DISTINCT ve.paper_id)::int AS total_count
      FROM view_events ve
      WHERE ve.user_id = $1::uuid
      `,
      [user.id],
    );
    const total = countRes.rows[0]?.total_count ?? 0;

    // BE.F15 DA001: Deduplicated view history ordered by latest viewed_at DESC
    const listRes = await dbQuery<{
      arxiv_id: string;
      title: string;
      authors: Array<{ name: string; affiliation: string | null }>;
      categories: string[];
      submitted_at: Date;
      updated_at: Date | null;
      latest_version: number;
      viewed_at: Date;
      title_ja: string | null;
      thesis_text: string | null;
      source_scope: "abstract_only" | "full_text" | null;
      summary_generated_at: Date | null;
    }>(
      `
      WITH latest_views AS (
        SELECT DISTINCT ON (ve.paper_id)
               ve.paper_id,
               ve.viewed_at
        FROM view_events ve
        WHERE ve.user_id = $1::uuid
        ORDER BY ve.paper_id, ve.viewed_at DESC
      )
      SELECT p.arxiv_id,
             p.title,
             p.authors,
             p.categories,
             p.submitted_at,
             p.updated_at,
             p.latest_version,
             lv.viewed_at,
             s.json_content->>'title_ja' AS title_ja,
             s.json_content->'thesis'->>'text' AS thesis_text,
             s.source_scope,
             s.generated_at AS summary_generated_at
      FROM latest_views lv
      JOIN papers p ON p.id = lv.paper_id
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
      ORDER BY lv.viewed_at DESC, lv.paper_id DESC
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
      viewedAt: new Date(row.viewed_at).toISOString(),
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
