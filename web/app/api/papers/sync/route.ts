import { NextRequest } from "next/server";
import { dbQuery, withTransaction } from "@/lib/server/db";
import { handleApiRoute, jsonSuccess } from "@/lib/server/http/errors";
import { DEFAULT_TARGET_CATEGORIES } from "@/lib/server/arxiv/categories";

export async function POST(req: NextRequest) {
  return handleApiRoute(async () => {
    // 1. Query arXiv Atom API for latest papers across target AI categories
    const catQuery = DEFAULT_TARGET_CATEGORIES.map((c) => `cat:${c}`).join(" OR ");
    const arxivUrl = `https://export.arxiv.org/api/query?search_query=(${encodeURIComponent(
      catQuery,
    )})&sortBy=submittedDate&sortOrder=descending&start=0&max_results=30`;

    const res = await fetch(arxivUrl, {
      headers: { "User-Agent": "ArcliaDigestApp/1.0 (mailto:admin@example.com)" },
    });

    if (!res.ok) {
      throw new Error(`arXiv API responded with status ${res.status}`);
    }

    const xmlText = await res.text();

    // Lightweight XML entry extraction
    const entryBlocks = xmlText.split("<entry>").slice(1);
    let newCount = 0;
    let updatedCount = 0;

    for (const block of entryBlocks) {
      const idMatch = block.match(/<id>http:\/\/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5}|[a-z\-]+(?:\.[A-Za-z\-]+)?\/[0-9]{7})(?:v([0-9]+))?<\/id>/);
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const summaryMatch = block.match(/<summary>([\s\S]*?)<\/summary>/);
      const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/);
      const updatedMatch = block.match(/<updated>([\s\S]*?)<\/updated>/);

      if (!idMatch || !titleMatch || !summaryMatch) continue;

      const arxivId = idMatch[1];
      const version = idMatch[2] ? parseInt(idMatch[2], 10) : 1;
      const title = titleMatch[1].replace(/\s+/g, " ").trim();
      const abstract = summaryMatch[1].replace(/\s+/g, " ").trim();
      const submittedAt = publishedMatch ? publishedMatch[1].trim() : new Date().toISOString();
      const updatedAt = updatedMatch ? updatedMatch[1].trim() : submittedAt;

      // Extract categories
      const catMatches = [...block.matchAll(/term="([^"]+)"/g)].map((m) => m[1]);
      const categories = catMatches.length > 0 ? catMatches : ["cs.AI"];

      // Extract author names
      const authorMatches = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)];
      const authors = authorMatches.map((m) => ({ name: m[1].trim(), affiliation: null }));
      const safeAuthors = authors.length > 0 ? authors : [{ name: "Unknown", affiliation: null }];

      await withTransaction(async (client) => {
        // Upsert into papers
        const paperRes = await client.query<{ id: number; inserted: boolean }>(
          `
          INSERT INTO papers (
            arxiv_id, title, abstract, authors, categories, submitted_at, updated_at, latest_version, original_url
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (arxiv_id) DO UPDATE
          SET title = EXCLUDED.title,
              abstract = EXCLUDED.abstract,
              authors = EXCLUDED.authors,
              categories = EXCLUDED.categories,
              updated_at = EXCLUDED.updated_at,
              latest_version = GREATEST(papers.latest_version, EXCLUDED.latest_version)
          RETURNING id, (xmax = 0) AS inserted
          `,
          [
            arxivId,
            title,
            abstract,
            JSON.stringify(safeAuthors),
            categories,
            submittedAt,
            updatedAt,
            version,
            `https://arxiv.org/abs/${arxivId}`,
          ],
        );

        const paperId = paperRes.rows[0].id;
        const isNewPaper = paperRes.rows[0].inserted;

        // Upsert into paper_versions
        const pvRes = await client.query<{ id: number; inserted: boolean }>(
          `
          INSERT INTO paper_versions (
            paper_id, version, metadata_snapshot, content_status, license_type
          )
          VALUES (
            $1, $2, $3, 'abstract_only', 'http://arxiv.org/licenses/nonexclusive-distrib/1.0/'
          )
          ON CONFLICT (paper_id, version) DO NOTHING
          RETURNING id, true AS inserted
          `,
          [
            paperId,
            version,
            JSON.stringify({
              title,
              abstract,
              authors: safeAuthors,
              categories,
              submitted_at: submittedAt,
              updated_at: updatedAt,
              fetched_at: new Date().toISOString(),
            }),
          ],
        );

        if (pvRes.rows.length > 0) {
          const pvId = pvRes.rows[0].id;
          await client.query(
            `
            INSERT INTO jobs (paper_version_id, job_type, status, attempts)
            VALUES ($1, 'summarize_abstract', 'pending', 0)
            ON CONFLICT DO NOTHING
            `,
            [pvId],
          );
          if (isNewPaper) {
            newCount++;
          } else {
            updatedCount++;
          }
        }
      });
    }

    const countRes = await dbQuery<{ total: number }>("SELECT COUNT(*)::int AS total FROM papers;");
    const totalPapers = countRes.rows[0]?.total || 0;

    return jsonSuccess({
      newCount,
      updatedCount,
      totalPapers,
      syncedAt: new Date().toISOString(),
    });
  });
}
