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

    // BE.F17 DA001: Load paper_versions row
    const pvRes = await dbQuery<{
      paper_version_id: number;
      version: number;
      latest_version: number;
      content_status: "abstract_only" | "full_text";
      license_type: string | null;
      arxiv_id: string;
    }>(
      `
      SELECT pv.id AS paper_version_id,
             pv.version,
             p.latest_version,
             pv.content_status,
             pv.license_type,
             p.arxiv_id
      FROM papers p
      JOIN paper_versions pv
        ON pv.paper_id = p.id
       AND pv.version = COALESCE($2::int, p.latest_version)
      WHERE p.arxiv_id = $1
      `,
      [arxivId, requestedVersion],
    );

    if (pvRes.rows.length === 0) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        `指定された論文または版（${arxivId}）は見つかりませんでした。`,
      );
    }

    const pv = pvRes.rows[0];

    // BE.F17 DA002: Load latest job status per job_type for this version
    const jobsRes = await dbQuery<{
      job_type: string;
      status: "pending" | "running" | "succeeded" | "failed";
      attempts: number;
    }>(
      `
      SELECT DISTINCT ON (job_type)
             job_type,
             status,
             attempts
      FROM jobs
      WHERE paper_version_id = $1
        AND job_type IN (
          'summarize_abstract',
          'validate_summary',
          'publish_summary',
          'analyze_full_text'
        )
      ORDER BY job_type, id DESC
      `,
      [pv.paper_version_id],
    );

    // BE.F17 DA003: Load latest summary status per summary_type for this version
    const sumRes = await dbQuery<{
      summary_type: "short" | "standard" | "deep";
      validation_status: "pending" | "passed" | "failed";
      source_scope: "abstract_only" | "full_text";
      generated_at: Date;
    }>(
      `
      SELECT DISTINCT ON (summary_type)
             summary_type,
             validation_status,
             source_scope,
             generated_at
      FROM summaries
      WHERE paper_version_id = $1
        AND language = 'ja'
      ORDER BY summary_type,
               CASE WHEN validation_status = 'passed' THEN 0 ELSE 1 END,
               generated_at DESC,
               id DESC
      `,
      [pv.paper_version_id],
    );

    const jobMap = new Map(jobsRes.rows.map((j) => [j.job_type, j]));
    const sumMap = new Map(sumRes.rows.map((s) => [s.summary_type, s]));
    const fullTextAllowed = isFullTextLicenseAllowed(pv.license_type);

    function deriveTypeStatus(
      stype: "short" | "standard" | "deep",
    ): "ready" | "processing" | "failed" | "not_applicable" | "not_started" {
      const s = sumMap.get(stype);
      if (s && s.validation_status === "passed") {
        return "ready";
      }
      if (stype === "deep" && !fullTextAllowed) {
        return "not_applicable";
      }

      const relevantJobs =
        stype === "deep"
          ? [jobMap.get("analyze_full_text"), jobMap.get("validate_summary")]
          : [
              jobMap.get("summarize_abstract"),
              jobMap.get("validate_summary"),
              jobMap.get("publish_summary"),
            ];

      if (
        relevantJobs.some(
          (j) => j && (j.status === "pending" || j.status === "running"),
        ) ||
        (s && s.validation_status === "pending")
      ) {
        return "processing";
      }

      if (
        relevantJobs.some((j) => j && j.status === "failed") ||
        (s && s.validation_status === "failed")
      ) {
        return "failed";
      }

      return "not_started";
    }

    const shortState = deriveTypeStatus("short");
    const standardState = deriveTypeStatus("standard");
    const deepState = deriveTypeStatus("deep");

    const overallStatus =
      shortState === "ready" || standardState === "ready"
        ? "ready"
        : shortState === "processing" || standardState === "processing"
          ? "processing"
          : shortState === "failed" && standardState === "failed"
            ? "failed"
            : "processing";

    return jsonSuccess({
      arxivId: pv.arxiv_id,
      version: Number(pv.version),
      latestVersion: Number(pv.latest_version),
      contentStatus: pv.content_status,
      fullTextAllowed,
      overallStatus,
      summaries: {
        short: shortState,
        standard: standardState,
        deep: deepState,
      },
    });
  });
}
