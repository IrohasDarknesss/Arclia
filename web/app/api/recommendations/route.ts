import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { requireAuthenticatedUser } from "@/lib/server/auth";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";
import {
  RecommendationCandidateRow,
  scoreAndSelectRecommendations,
} from "@/lib/server/recommendations/scoring";

export async function GET(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit")?.trim() || "10";

    if (!/^[1-9][0-9]*$/.test(limitParam)) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "limitは1以上の整数で指定してください。",
      );
    }
    const limit = parseInt(limitParam, 10);
    if (limit > 50) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "limitは50以下で指定してください。",
      );
    }

    // BE.F08 DA001: Load user interests
    const intRes = await dbQuery<{ topic: string; weight: string | number }>(
      `
      SELECT topic, weight
      FROM user_interests
      WHERE user_id = $1::uuid
      ORDER BY weight DESC, topic ASC
      `,
      [user.id],
    );

    if (intRes.rows.length === 0) {
      return jsonSuccess({
        items: [],
        hasInterests: false,
      });
    }

    const interests = intRes.rows.map((r) => ({
      topic: r.topic,
      weight: Number(r.weight),
    }));

    // BE.F08 DA002: Load recent candidate papers (last 30 days) excluding already viewed papers
    const candRes = await dbQuery<{
      paper_id: number;
      arxiv_id: string;
      title: string;
      abstract: string;
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
      SELECT p.id AS paper_id,
             p.arxiv_id,
             p.title,
             p.abstract,
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
      WHERE p.submitted_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
        AND NOT EXISTS (
          SELECT 1
          FROM view_events ve
          WHERE ve.user_id = $1::uuid
            AND ve.paper_id = p.id
        )
      ORDER BY p.submitted_at DESC, p.id DESC
      LIMIT 200
      `,
      [user.id],
    );

    const candidates: RecommendationCandidateRow[] = candRes.rows.map((r) => ({
      paperId: Number(r.paper_id),
      arxivId: r.arxiv_id,
      title: r.title,
      abstract: r.abstract,
      authors: Array.isArray(r.authors) ? r.authors : [],
      categories: Array.isArray(r.categories) ? r.categories : [],
      submittedAt: new Date(r.submitted_at).toISOString(),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      latestVersion: Number(r.latest_version),
      titleJa: r.title_ja || null,
      thesisText: r.thesis_text || null,
      sourceScope: r.source_scope || null,
      summaryGeneratedAt: r.summary_generated_at
        ? new Date(r.summary_generated_at).toISOString()
        : null,
    }));

    const items = scoreAndSelectRecommendations(interests, candidates, limit);

    return jsonSuccess({
      items,
      hasInterests: true,
    });
  });
}
