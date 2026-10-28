import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import {
  decodeRouteArxivId,
  parseArxivIdAndVersion,
} from "@/lib/server/arxiv/id";
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

    const typeParam = searchParams.get("type")?.trim() || "standard";
    if (
      typeParam !== "short" &&
      typeParam !== "standard" &&
      typeParam !== "deep"
    ) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "typeはshort, standard, deepのいずれかを指定してください。",
      );
    }

    // Verify paper & target version exist
    const verRes = await dbQuery<{
      paper_version_id: number;
      version: number;
      latest_version: number;
      arxiv_id: string;
    }>(
      `
      SELECT pv.id AS paper_version_id,
             pv.version,
             p.latest_version,
             p.arxiv_id
      FROM papers p
      JOIN paper_versions pv
        ON pv.paper_id = p.id
       AND pv.version = COALESCE($2::int, p.latest_version)
      WHERE p.arxiv_id = $1
      `,
      [arxivId, requestedVersion],
    );

    if (verRes.rows.length === 0) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        `指定された論文または版（${arxivId}）は見つかりませんでした。`,
      );
    }

    const pv = verRes.rows[0];

    // DA003: Fetch latest passed summary of requested type
    const sumRes = await dbQuery<{
      id: number;
      summary_type: "short" | "standard" | "deep";
      language: string;
      json_content: Record<string, unknown>;
      model_id: string;
      generated_at: Date;
      source_scope: "abstract_only" | "full_text";
    }>(
      `
      SELECT id,
             summary_type,
             language,
             json_content,
             model_id,
             generated_at,
             source_scope
      FROM summaries
      WHERE paper_version_id = $1
        AND summary_type = $2
        AND language = 'ja'
        AND validation_status = 'passed'
      ORDER BY generated_at DESC, id DESC
      LIMIT 1
      `,
      [pv.paper_version_id, typeParam],
    );

    if (sumRes.rows.length === 0) {
      return jsonSuccess({
        arxivId: pv.arxiv_id,
        version: Number(pv.version),
        latestVersion: Number(pv.latest_version),
        summaryType: typeParam,
        status: "not_ready",
        summary: null,
        citations: [],
      });
    }

    const s = sumRes.rows[0];

    // Fetch summary_citations for this passed summary
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
      [s.id],
    );

    return jsonSuccess({
      arxivId: pv.arxiv_id,
      version: Number(pv.version),
      latestVersion: Number(pv.latest_version),
      summaryType: s.summary_type,
      status: "ready",
      summary: {
        summaryType: s.summary_type,
        language: s.language,
        sourceScope: s.source_scope,
        modelId: s.model_id,
        generatedAt: new Date(s.generated_at).toISOString(),
        content: s.json_content,
      },
      citations: citRes.rows.map((c) => ({
        claimId: c.claim_id,
        sourceSection: c.source_section,
        sourcePage: c.source_page !== null ? Number(c.source_page) : null,
        sourceUrl: c.source_url,
      })),
    });
  });
}
