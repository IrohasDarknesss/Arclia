import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import {
  decodeRouteArxivId,
  parseArxivIdAndVersion,
} from "@/lib/server/arxiv/id";
import { isFullTextLicenseAllowed } from "@/lib/server/papers/licenseGate";
import {
  ApiError,
  handleApiRoute,
  jsonSuccess,
} from "@/lib/server/http/errors";

export async function GET(
  req: NextRequest,
  context: { params: { arxivId: string } },
) {
  return handleApiRoute(async () => {
    const { searchParams } = new URL(req.url);
    const rawId = decodeRouteArxivId(context.params.arxivId);
    const { arxivId, version: requestedVersion } = parseArxivIdAndVersion(
      rawId,
      searchParams.get("version"),
    );

    // DA004: Load paper, target version, and passed deep summary (if any)
    const res = await dbQuery<{
      arxiv_id: string;
      title: string;
      authors: Array<{ name: string; affiliation: string | null }>;
      categories: string[];
      submitted_at: Date;
      updated_at: Date | null;
      latest_version: number;
      original_url: string;
      paper_version_id: number;
      version: number;
      content_status: "abstract_only" | "full_text";
      license_type: string | null;
      deep_json_content: Record<string, unknown> | null;
      deep_model_id: string | null;
      deep_generated_at: Date | null;
      std_title_ja: string | null;
    }>(
      `
      SELECT p.arxiv_id,
             p.title,
             p.authors,
             p.categories,
             p.submitted_at,
             p.updated_at,
             p.latest_version,
             p.original_url,
             pv.id AS paper_version_id,
             pv.version,
             pv.content_status,
             pv.license_type,
             deep_s.json_content AS deep_json_content,
             deep_s.model_id AS deep_model_id,
             deep_s.generated_at AS deep_generated_at,
             std_s.json_content->>'title_ja' AS std_title_ja
      FROM papers p
      JOIN paper_versions pv
        ON pv.paper_id = p.id
       AND pv.version = COALESCE($2::int, p.latest_version)
      LEFT JOIN LATERAL (
        SELECT json_content, model_id, generated_at
        FROM summaries
        WHERE paper_version_id = pv.id
          AND summary_type = 'deep'
          AND language = 'ja'
          AND validation_status = 'passed'
        ORDER BY generated_at DESC, id DESC
        LIMIT 1
      ) deep_s ON true
      LEFT JOIN LATERAL (
        SELECT json_content
        FROM summaries
        WHERE paper_version_id = pv.id
          AND summary_type IN ('standard', 'short')
          AND language = 'ja'
          AND validation_status = 'passed'
        ORDER BY generated_at DESC, id DESC
        LIMIT 1
      ) std_s ON true
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
    const allowed = isFullTextLicenseAllowed(row.license_type);
    const deepJson = row.deep_json_content || null;

    let fullTextStatus: "ready" | "not_analyzed" | "license_restricted" =
      "not_analyzed";
    if (!allowed) {
      fullTextStatus = "license_restricted";
    } else if (deepJson) {
      fullTextStatus = "ready";
    }

    const keyFormulas =
      allowed && deepJson && Array.isArray(deepJson.key_formulas)
        ? deepJson.key_formulas
        : [];
    const references =
      allowed && deepJson && Array.isArray(deepJson.references)
        ? deepJson.references
        : [];
    const titleJa =
      (deepJson && typeof deepJson.title_ja === "string"
        ? deepJson.title_ja
        : null) ||
      row.std_title_ja ||
      null;

    return jsonSuccess({
      arxivId: row.arxiv_id,
      title: row.title,
      titleJa,
      authors: Array.isArray(row.authors) ? row.authors : [],
      categories: Array.isArray(row.categories) ? row.categories : [],
      submittedAt: new Date(row.submitted_at).toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      version: Number(row.version),
      latestVersion: Number(row.latest_version),
      originalUrl: row.original_url,
      pdfUrl: `https://arxiv.org/pdf/${row.arxiv_id}v${row.version}.pdf`,
      contentStatus: row.content_status,
      licenseType: row.license_type,
      fullTextAllowed: allowed,
      fullTextStatus,
      modelId: allowed ? row.deep_model_id : null,
      generatedAt:
        allowed && row.deep_generated_at
          ? new Date(row.deep_generated_at).toISOString()
          : null,
      keyFormulas,
      references,
      fullTextTranslation: {
        available: false,
        reason: allowed
          ? "本文の逐語的な全文翻訳は提供していません。構造化解説・主要数式・参考文献ガイドをご参照ください。"
          : "この論文のライセンス条件により、本文の派生物（全文翻訳・本文解析）は表示できません。arXiv原文ページをご参照ください。",
      },
    });
  });
}
