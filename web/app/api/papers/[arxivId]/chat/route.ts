import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { requireAuthenticatedUser } from "@/lib/server/auth";
import {
  decodeRouteArxivId,
  parseArxivIdAndVersion,
} from "@/lib/server/arxiv/id";
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
  ChatContextCitation,
  generateGroundedPaperChatAnswer,
} from "@/lib/server/chat/chatService";

export async function POST(
  req: NextRequest,
  context: { params: { arxivId: string } },
) {
  return handleApiRoute(async () => {
    const user = await requireAuthenticatedUser(req);
    const rawId = decodeRouteArxivId(context.params.arxivId);

    let body: { question?: unknown; version?: unknown };
    try {
      body = (await req.json()) as { question?: unknown; version?: unknown };
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "リクエストボディのJSON形式が不正です。");
    }

    const question =
      typeof body.question === "string" ? body.question.trim() : "";
    if (!question || question.length > 500) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "質問（question）は1文字以上500文字以内で入力してください。",
      );
    }

    const versionStr =
      body.version !== undefined && body.version !== null
        ? String(body.version)
        : null;
    const { arxivId, version: requestedVersion } = parseArxivIdAndVersion(
      rawId,
      versionStr,
    );

    // Reserve Pro quota for 'ai_chat' (BE.F18)
    const reservation = await reserveFeatureUsage(user.id, "ai_chat");

    try {
      // BE.F09 DA001: Load paper, target version, and best passed summary (deep > standard > short)
      const res = await dbQuery<{
        arxiv_id: string;
        title: string;
        abstract: string;
        version: number;
        summary_id: number | null;
        summary_type: "short" | "standard" | "deep" | null;
        source_scope: "abstract_only" | "full_text" | null;
        json_content: Record<string, unknown> | null;
      }>(
        `
        SELECT p.arxiv_id,
               p.title,
               p.abstract,
               pv.version,
               s.id AS summary_id,
               s.summary_type,
               s.source_scope,
               s.json_content
        FROM papers p
        JOIN paper_versions pv
          ON pv.paper_id = p.id
         AND pv.version = COALESCE($2::int, p.latest_version)
        LEFT JOIN LATERAL (
          SELECT id, summary_type, source_scope, json_content
          FROM summaries
          WHERE paper_version_id = pv.id
            AND language = 'ja'
            AND validation_status = 'passed'
          ORDER BY CASE summary_type
                     WHEN 'deep' THEN 0
                     WHEN 'standard' THEN 1
                     ELSE 2
                   END,
                   generated_at DESC,
                   id DESC
          LIMIT 1
        ) s ON true
        WHERE p.arxiv_id = $1
        `,
        [arxivId, requestedVersion],
      );

      if (res.rows.length === 0) {
        throw new ApiError(
          404,
          "NOT_FOUND",
          `指定された論文または版（${arxivId}）は見つかりませんでした。`,
        );
      }

      const row = res.rows[0];
      if (!row.summary_id || !row.json_content || !row.source_scope) {
        throw new ApiError(
          409,
          "SUMMARY_NOT_READY",
          "この論文の検証済み日本語要約がまだ準備できていないため、AI質問応答を利用できません。",
        );
      }

      // BE.F09 DA002: Load summary_citations for the selected summary
      const citRes = await dbQuery<{
        claim_id: string;
        source_section: string | null;
        source_page: number | null;
        source_url: string;
      }>(
        `
        SELECT claim_id, source_section, source_page, source_url
        FROM summary_citations
        WHERE summary_id = $1
        ORDER BY claim_id
        `,
        [row.summary_id],
      );

      const citations: ChatContextCitation[] = citRes.rows.map((c) => ({
        claimId: c.claim_id,
        sourceSection: c.source_section,
        sourcePage: c.source_page !== null ? Number(c.source_page) : null,
        sourceUrl: c.source_url,
      }));

      const llmResult = await generateGroundedPaperChatAnswer({
        question,
        arxivId: row.arxiv_id,
        version: Number(row.version),
        title: row.title,
        abstract: row.abstract,
        summaryJson: row.json_content,
        citations,
      });

      return jsonSuccess({
        arxivId: row.arxiv_id,
        version: Number(row.version),
        sourceScope: row.source_scope,
        answer: llmResult.answer,
        statements: llmResult.statements,
        citations: llmResult.referencedCitations,
        modelId: llmResult.modelId,
        generatedAt: llmResult.generatedAt,
        usage: {
          feature: "ai_chat",
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
