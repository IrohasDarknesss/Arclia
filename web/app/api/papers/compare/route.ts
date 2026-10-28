import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { requireAuthenticatedUser } from "@/lib/server/auth";
import { validateBaseArxivId } from "@/lib/server/arxiv/id";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";
import {
  releaseFeatureUsage,
  reserveFeatureUsage,
} from "@/lib/server/usage/usageService";
import {
  ComparePaperContext,
  generatePapersComparison,
} from "@/lib/server/compare/compareService";

export async function POST(req: NextRequest) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);

    let body: { arxivIds?: unknown };
    try {
      body = (await req.json()) as { arxivIds?: unknown };
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "リクエストボディのJSON形式が不正です。");
    }

    if (!Array.isArray(body.arxivIds) || body.arxivIds.length < 2 || body.arxivIds.length > 5) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "比較する論文（arxivIds）は2件以上5件以下で指定してください。",
      );
    }

    const seen = new Set<string>();
    const arxivIds: string[] = [];
    for (const rawId of body.arxivIds) {
      if (typeof rawId !== "string") {
        throw new ApiError(400, "VALIDATION_ERROR", "arxivIdsには文字列の配列を指定してください。");
      }
      const validated = validateBaseArxivId(rawId);
      if (seen.has(validated)) {
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          `同じ論文ID（${validated}）が重複して指定されています。`,
        );
      }
      seen.add(validated);
      arxivIds.push(validated);
    }

    // Reserve Pro quota for 'paper_compare' (BE.F18)
    const reservation = await reserveFeatureUsage(user.id, "paper_compare");

    try {
      // DA001: Load target papers and their latest passed summary (deep preferred over standard)
      const res = await dbQuery<{
        arxiv_id: string;
        title: string;
        abstract: string;
        categories: string[];
        submitted_at: Date;
        updated_at: Date | null;
        latest_version: number;
        summary_type: "standard" | "deep" | null;
        source_scope: "abstract_only" | "full_text" | null;
        json_content: Record<string, unknown> | null;
      }>(
        `
        SELECT p.arxiv_id,
               p.title,
               p.abstract,
               p.categories,
               p.submitted_at,
               p.updated_at,
               p.latest_version,
               s.summary_type,
               s.source_scope,
               s.json_content
        FROM papers p
        JOIN paper_versions pv
          ON pv.paper_id = p.id
         AND pv.version = p.latest_version
        LEFT JOIN LATERAL (
          SELECT summary_type, source_scope, json_content
          FROM summaries
          WHERE paper_version_id = pv.id
            AND summary_type IN ('deep', 'standard')
            AND language = 'ja'
            AND validation_status = 'passed'
          ORDER BY CASE WHEN summary_type = 'deep' THEN 0 ELSE 1 END,
                   generated_at DESC,
                   id DESC
          LIMIT 1
        ) s ON true
        WHERE p.arxiv_id = ANY($1::text[])
        `,
        [arxivIds],
      );

      const rowMap = new Map(res.rows.map((r) => [r.arxiv_id, r]));
      const missingIds = arxivIds.filter((id) => !rowMap.has(id));
      if (missingIds.length > 0) {
        throw new ApiError(
          404,
          "NOT_FOUND",
          `指定された論文が見つかりません: ${missingIds.join(", ")}`,
          { missingArxivIds: missingIds },
        );
      }

      const notReadyIds = arxivIds.filter((id) => {
        const r = rowMap.get(id)!;
        return !r.json_content || !r.summary_type || !r.source_scope;
      });
      if (notReadyIds.length > 0) {
        throw new ApiError(
          409,
          "SUMMARY_NOT_READY",
          `検証済み要約が未公開の論文が含まれています: ${notReadyIds.join(", ")}`,
          { notReadyArxivIds: notReadyIds },
        );
      }

      const contexts: ComparePaperContext[] = arxivIds.map((id) => {
        const r = rowMap.get(id)!;
        const jc = r.json_content!;
        return {
          arxivId: r.arxiv_id,
          version: Number(r.latest_version),
          title: r.title,
          titleJa:
            typeof jc.title_ja === "string" && jc.title_ja
              ? jc.title_ja
              : r.title,
          abstract: r.abstract,
          categories: Array.isArray(r.categories) ? r.categories : [],
          submittedAt: new Date(r.submitted_at).toISOString(),
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
          sourceScope: r.source_scope!,
          summaryType: r.summary_type!,
          summaryJson: jc,
        };
      });

      const comparison = await generatePapersComparison(contexts);

      return jsonSuccess({
        papers: contexts.map((c) => ({
          arxivId: c.arxivId,
          version: c.version,
          title: c.title,
          titleJa: c.titleJa,
          categories: c.categories,
          submittedAt: c.submittedAt,
          updatedAt: c.updatedAt,
          sourceScope: c.sourceScope,
          summaryType: c.summaryType,
        })),
        overview: comparison.overview,
        perspectives: comparison.perspectives,
        modelId: comparison.modelId,
        generatedAt: comparison.generatedAt,
        usage: {
          feature: "paper_compare",
          used: reservation.used,
          limit: reservation.limit,
          remaining: reservation.remaining,
          resetAt: reservation.resetAt,
        },
      });
    } catch (err) {
      await releaseFeatureUsage(reservation.reservationId);
      throw err;
    }
  });
}
