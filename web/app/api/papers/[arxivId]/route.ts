import { NextRequest } from "next/server";
import { dbQuery } from "@/lib/server/db";
import { ensureUserRow, getOptionalUser } from "@/lib/server/auth";
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

    const user = await getOptionalUser(req);

    // DA001: Load paper, target version, bookmark status, and passed summaries
    const paperRes = await dbQuery<{
      paper_id: number;
      arxiv_id: string;
      title: string;
      abstract: string;
      authors: Array<{ name: string; affiliation: string | null }>;
      categories: string[];
      submitted_at: Date;
      updated_at: Date | null;
      latest_version: number;
      original_url: string;
      paper_version_id: number;
      version: number;
      metadata_snapshot: Record<string, unknown>;
      content_status: "abstract_only" | "full_text";
      license_type: string | null;
      is_bookmarked: boolean;
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
             p.original_url,
             pv.id AS paper_version_id,
             pv.version,
             pv.metadata_snapshot,
             pv.content_status,
             pv.license_type,
             CASE
               WHEN $3::uuid IS NULL THEN false
               ELSE EXISTS (
                 SELECT 1 FROM bookmarks b
                 WHERE b.user_id = $3::uuid AND b.paper_id = p.id
               )
             END AS is_bookmarked
      FROM papers p
      JOIN paper_versions pv
        ON pv.paper_id = p.id
       AND pv.version = COALESCE($2::int, p.latest_version)
      WHERE p.arxiv_id = $1
      `,
      [arxivId, requestedVersion, user?.id || null],
    );

    if (paperRes.rows.length === 0) {
      throw new ApiError(
        404,
        "NOT_FOUND",
        `指定された論文（${arxivId}）は見つかりませんでした。`,
      );
    }

    const row = paperRes.rows[0];

    // Load available versions for version badge / selector
    const verRes = await dbQuery<{ version: number; content_status: string }>(
      `
      SELECT version, content_status
      FROM paper_versions
      WHERE paper_id = $1
      ORDER BY version DESC
      `,
      [row.paper_id],
    );

    // Load passed summaries for this paper_version_id
    const sumRes = await dbQuery<{
      summary_type: "short" | "standard" | "deep";
      json_content: Record<string, unknown>;
    }>(
      `
      SELECT DISTINCT ON (summary_type)
             summary_type,
             json_content
      FROM summaries
      WHERE paper_version_id = $1
        AND language = 'ja'
        AND validation_status = 'passed'
      ORDER BY summary_type, generated_at DESC, id DESC
      `,
      [row.paper_version_id],
    );

    const availableTypes = sumRes.rows.map((s) => s.summary_type);
    const titleJaSource =
      sumRes.rows.find((s) => s.summary_type === "standard") ||
      sumRes.rows.find((s) => s.summary_type === "short") ||
      sumRes.rows.find((s) => s.summary_type === "deep");
    const titleJa =
      titleJaSource && typeof titleJaSource.json_content?.title_ja === "string"
        ? titleJaSource.json_content.title_ja
        : null;

    // DA002: If user is authenticated, record view_events (30-min dedup handled by DB trigger)
    if (user) {
      try {
        await ensureUserRow(user.id);
        await dbQuery(
          `INSERT INTO view_events (user_id, paper_id) VALUES ($1::uuid, $2)`,
          [user.id, row.paper_id],
        );
      } catch (viewErr) {
        console.warn("[papers detail] Failed to record view_event", viewErr);
      }
    }

    // DA005 (BE.F14): Load GitHub repository link if available
    const ghRes = await dbQuery<{
      link_status: string;
      repo_full_name: string | null;
      repo_url: string | null;
      repo_license: string | null;
      default_branch: string | null;
      commit_sha: string | null;
      match_method: string | null;
      match_evidence: string | null;
      code_explanation: Record<string, unknown> | null;
      model_id: string | null;
      generated_at: Date | null;
    }>(
      `
      SELECT link_status,
             repo_full_name,
             repo_url,
             repo_license,
             default_branch,
             commit_sha,
             match_method,
             match_evidence,
             code_explanation,
             model_id,
             generated_at
      FROM paper_github_links
      WHERE paper_id = $1
      `,
      [row.paper_id],
    );

    let github: Record<string, unknown> | null = null;
    if (ghRes.rows.length > 0 && ghRes.rows[0].link_status === "linked") {
      const g = ghRes.rows[0];
      github = {
        repoFullName: g.repo_full_name,
        repoUrl: g.repo_url,
        repoLicense: g.repo_license,
        defaultBranch: g.default_branch,
        commitSha: g.commit_sha,
        matchMethod: g.match_method,
        matchEvidence: g.match_evidence,
        codeExplanation: g.code_explanation || null,
        modelId: g.model_id || null,
        generatedAt: g.generated_at
          ? new Date(g.generated_at).toISOString()
          : null,
      };
    }

    const snap = row.metadata_snapshot || {};
    const displayTitle =
      typeof snap.title === "string" && snap.title ? snap.title : row.title;
    const displayAbstract =
      typeof snap.abstract === "string" && snap.abstract
        ? snap.abstract
        : row.abstract;
    const displayAuthors = Array.isArray(snap.authors)
      ? snap.authors
      : row.authors;
    const displayCategories = Array.isArray(snap.categories)
      ? snap.categories
      : row.categories;

    const fullTextAllowed = isFullTextLicenseAllowed(row.license_type);

    return jsonSuccess({
      arxivId: row.arxiv_id,
      title: displayTitle,
      titleJa,
      abstract: displayAbstract,
      authors: displayAuthors,
      categories: displayCategories,
      submittedAt: new Date(row.submitted_at).toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      version: Number(row.version),
      latestVersion: Number(row.latest_version),
      availableVersions: verRes.rows.map((v) => ({
        version: Number(v.version),
        contentStatus: v.content_status,
      })),
      contentStatus: row.content_status,
      licenseType: row.license_type,
      fullTextAllowed,
      originalUrl: row.original_url,
      pdfUrl: `https://arxiv.org/pdf/${row.arxiv_id}v${row.version}.pdf`,
      availableSummaryTypes: availableTypes,
      isBookmarked: Boolean(row.is_bookmarked),
      github,
    });
  });
}
