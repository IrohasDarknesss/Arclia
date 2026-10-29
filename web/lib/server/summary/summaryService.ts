import { dbQuery, withTransaction } from "@/lib/server/db";
import { ApiError } from "@/lib/server/http/errors";

export async function generateAndSavePaperSummary(params: {
  paperVersionId: number;
  arxivId: string;
  version: number;
  title: string;
  abstract: string;
  summaryType: "short" | "standard";
}): Promise<{
  id: number;
  titleJa: string;
  thesis: string;
  jsonContent: Record<string, unknown>;
  citations: Array<{ claimId: string; sourceSection: string | null; sourcePage: number | null; sourceUrl: string }>;
}> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new ApiError(502, "LLM_UNAVAILABLE", "GEMINI_API_KEY が設定されていません。");
  }

  const cleanModel = (process.env.LLM_MODEL_SUMMARY_SHORT || "gemini-3.5-flash-lite").replace("models/", "");
  const defaultSourceUrl = `https://arxiv.org/abs/${params.arxivId}v${params.version}`;

  const systemPrompt = `あなたはarXiv論文を日本語で正確に構造化要約する専門エディターです。
与えられた原題とAbstractのみを根拠にして、必ず有効なJSONオブジェクト（キー: json_content と citations）のみを出力してください。
ルール:
1. 原文に書かれている事実・数値は basis='fact' とし、数値を捏造しないこと。
2. 主張オブジェクトは claim_id ('c01', 'c02', ...) を持つこと。
3. citations の source_url は必ず '${defaultSourceUrl}'、source_page は null にすること。`;

  const schemaHint = params.summaryType === "short"
    ? `json_content の構造:
{
  "schema_version": 1,
  "summary_type": "short",
  "title_ja": "魅力的な日本語論文タイトル",
  "thesis": { "claim_id": "c01", "text": "本研究の主たる主張や達成成果(150〜250字程度)", "basis": "fact" },
  "key_points": [
    { "claim_id": "c02", "text": "ポイント1", "basis": "fact" },
    { "claim_id": "c03", "text": "ポイント2", "basis": "fact" }
  ]
}
citations の構造:
[
  { "claim_id": "c01", "source_url": "${defaultSourceUrl}", "source_section": "Abstract", "source_page": null },
  { "claim_id": "c02", "source_url": "${defaultSourceUrl}", "source_section": "Abstract", "source_page": null },
  { "claim_id": "c03", "source_url": "${defaultSourceUrl}", "source_section": "Abstract", "source_page": null }
]`
    : `json_content の構造:
{
  "schema_version": 1,
  "summary_type": "standard",
  "title_ja": "魅力的な日本語論文タイトル",
  "thesis": { "claim_id": "c01", "text": "本研究の主たる主張や達成成果", "basis": "fact" },
  "problem": [{ "claim_id": "c02", "text": "解決したい課題", "basis": "fact" }],
  "method": [{ "claim_id": "c03", "text": "提案手法の核心", "basis": "fact" }],
  "results": [{ "claim_id": "c04", "text": "実験結果・性能", "basis": "fact" }],
  "limitations": [{ "claim_id": "c05", "text": "限界や制約", "basis": "inference" }],
  "applications": [{ "claim_id": "c06", "text": "実用展開・応用可能性", "basis": "inference" }]
}
citations の構造: 各 claim_id に対応する配列（source_url は "${defaultSourceUrl}", source_page は null）`;

  const userPrompt = `arXiv ID: ${params.arxivId} (v${params.version})
Title: ${params.title}
Abstract:
${params.abstract}

${schemaHint}`;

  let parsed: {
    json_content?: {
      title_ja?: string;
      thesis?: { text?: string };
      [key: string]: unknown;
    };
    citations?: Array<{
      claim_id: string;
      source_section?: string | null;
      source_page?: number | null;
      source_url?: string;
    }>;
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\nStrict JSON output:\n${userPrompt}` }],
            },
          ],
          generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.2,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      throw new Error(`Gemini HTTP error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const contentStr = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    try {
      parsed = JSON.parse(contentStr);
    } catch {
      const sanitized = contentStr.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
      parsed = JSON.parse(sanitized);
    }
  } finally {
    clearTimeout(timer);
  }

  const jsonContent = parsed.json_content || {};
  const titleJa = (jsonContent.title_ja as string) || params.title;
  const thesis = (jsonContent.thesis?.text as string) || "";
  const rawCitations = Array.isArray(parsed.citations) ? parsed.citations : [];

  const sanitizedCitations = rawCitations.map((c) => ({
    claimId: String(c.claim_id || "c01"),
    sourceSection: c.source_section || "Abstract",
    sourcePage: null,
    sourceUrl: c.source_url && c.source_url.startsWith("http") ? c.source_url : defaultSourceUrl,
  }));

  // Save to database
  const summaryId = await withTransaction(async (client) => {
    const insRes = await client.query<{ id: number }>(
      `
      INSERT INTO summaries (
        paper_version_id,
        summary_type,
        language,
        json_content,
        model_id,
        source_scope,
        validation_status
      )
      VALUES ($1, $2, 'ja', $3, $4, 'abstract_only', 'passed')
      RETURNING id
      `,
      [params.paperVersionId, params.summaryType, JSON.stringify(jsonContent), cleanModel],
    );
    const sid = insRes.rows[0].id;

    for (const cit of sanitizedCitations) {
      await client.query(
        `
        INSERT INTO summary_citations (
          summary_id,
          claim_id,
          source_section,
          source_page,
          source_url
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (summary_id, claim_id) DO NOTHING
        `,
        [sid, cit.claimId, cit.sourceSection, cit.sourcePage, cit.sourceUrl],
      );
    }

    // Mark any pending summarize_abstract job for this version as succeeded
    await client.query(
      `
      UPDATE jobs
      SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP
      WHERE paper_version_id = $1
        AND job_type = 'summarize_abstract'
        AND status = 'pending'
      `,
      [params.paperVersionId],
    );

    return sid;
  });

  return {
    id: summaryId,
    titleJa,
    thesis,
    jsonContent,
    citations: sanitizedCitations,
  };
}
