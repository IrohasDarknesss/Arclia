import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import {
  CATEGORY_LABELS_JA,
  getAllowedCategories,
  isAllowedCategory,
} from "@/lib/server/arxiv/categories";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const { searchParams } = new URL(req.url);
    const periodParam = searchParams.get("period")?.trim() || "7d";
    const categoryParam = searchParams.get("category")?.trim() || null;
    const limitParam = searchParams.get("limit")?.trim() || "10";

    if (periodParam !== "7d" && periodParam !== "30d") {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "periodは7dまたは30dを指定してください。",
      );
    }

    if (categoryParam && !isAllowedCategory(categoryParam)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        `指定された分野（${categoryParam}）は対象外です。`,
      );
    }

    if (!/^[1-9][0-9]*$/.test(limitParam)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "limitは1以上の整数で指定してください。",
      );
    }
    const limit = parseInt(limitParam, 10);
    if (limit > 20) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "limitは20以下で指定してください。",
      );
    }

    const days = periodParam === "30d" ? 30 : 7;
    const allowedCats = getAllowedCategories();

    // BE.F13 DA001: Category counts and growth rates vs previous period
    const catRes = await dbQuery<{
      category: string;
      paper_count: number;
      previous_paper_count: number;
    }>(
      `
      SELECT cat AS category,
             COUNT(*) FILTER (
               WHERE p.submitted_at >= CURRENT_TIMESTAMP - make_interval(days => $2)
             )::int AS paper_count,
             COUNT(*) FILTER (
               WHERE p.submitted_at >= CURRENT_TIMESTAMP - make_interval(days => $2 * 2)
                 AND p.submitted_at <  CURRENT_TIMESTAMP - make_interval(days => $2)
             )::int AS previous_paper_count
      FROM unnest($1::text[]) AS cat
      LEFT JOIN papers p
             ON p.categories @> ARRAY[cat]
            AND p.submitted_at >= CURRENT_TIMESTAMP - make_interval(days => $2 * 2)
      GROUP BY cat
      ORDER BY paper_count DESC, cat ASC
      `,
      [allowedCats, days],
    );

    const categoryCounts = catRes.rows.map((r) => {
      const curr = Number(r.paper_count);
      const prev = Number(r.previous_paper_count);
      const growthRate =
        prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null;
      return {
        category: r.category,
        label: CATEGORY_LABELS_JA[r.category] || r.category,
        paperCount: curr,
        previousPaperCount: prev,
        growthRate,
      };
    });

    // BE.F13 DA002: Hot papers ranked by (bookmarkCount * 3 + viewCount) in period
    const hotRes = await dbQuery<{
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
      bookmark_count: number;
      view_count: number;
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
             s.generated_at AS summary_generated_at,
             COALESCE(bm.bookmark_count, 0)::int AS bookmark_count,
             COALESCE(vw.view_count, 0)::int AS view_count
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
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS bookmark_count
        FROM bookmarks b
        WHERE b.paper_id = p.id
          AND b.created_at >= CURRENT_TIMESTAMP - make_interval(days => $1)
      ) bm ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS view_count
        FROM view_events ve
        WHERE ve.paper_id = p.id
          AND ve.viewed_at >= CURRENT_TIMESTAMP - make_interval(days => $1)
      ) vw ON true
      WHERE p.submitted_at >= CURRENT_TIMESTAMP - make_interval(days => $1)
        AND ($2::text IS NULL OR p.categories @> ARRAY[$2::text])
      ORDER BY (COALESCE(bm.bookmark_count, 0) * 3 + COALESCE(vw.view_count, 0)) DESC,
               p.submitted_at DESC,
               p.id DESC
      LIMIT $3
      `,
      [days, categoryParam, limit],
    );

    const hotPapers = hotRes.rows.map((r) => {
      const bmCount = Number(r.bookmark_count);
      const vwCount = Number(r.view_count);
      return {
        arxivId: r.arxiv_id,
        title: r.title,
        titleJa: r.title_ja || null,
        authors: Array.isArray(r.authors) ? r.authors : [],
        categories: Array.isArray(r.categories) ? r.categories : [],
        submittedAt: new Date(r.submitted_at).toISOString(),
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        latestVersion: Number(r.latest_version),
        shortSummary:
          r.thesis_text && r.source_scope && r.summary_generated_at
            ? {
                thesis: r.thesis_text,
                sourceScope: r.source_scope,
                generatedAt: new Date(r.summary_generated_at).toISOString(),
              }
            : null,
        bookmarkCount: bmCount,
        viewCount: vwCount,
        trendScore: bmCount * 3 + vwCount,
      };
    });

    return jsonSuccess({
      period: periodParam,
      category: categoryParam,
      categoryCounts,
      hotPapers,
    });
  });
}
