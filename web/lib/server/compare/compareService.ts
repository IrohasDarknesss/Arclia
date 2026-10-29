import { ApiError } from "@/lib/server/http/errors";

export interface ComparePaperContext {
  arxivId: string;
  version: number;
  title: string;
  titleJa: string;
  abstract: string;
  categories: string[];
  submittedAt: string;
  updatedAt: string | null;
  sourceScope: "abstract_only" | "full_text";
  summaryType: "standard" | "deep";
  summaryJson: Record<string, unknown>;
}

export interface ComparisonCell {
  text: string;
  basis: "fact" | "inference";
}

export interface ComparisonPerspective {
  aspect: "problem" | "method" | "results" | "limitations";
  aspectLabel: string;
  summary: string;
  entries: Record<string, ComparisonCell>;
}

const REQUIRED_ASPECTS: Array<{
  aspect: "problem" | "method" | "results" | "limitations";
  label: string;
}> = [
  { aspect: "problem", label: "課題" },
  { aspect: "method", label: "手法" },
  { aspect: "results", label: "結果" },
  { aspect: "limitations", label: "限界" },
];

export async function generatePapersComparison(
  papers: ComparePaperContext[],
): Promise<{
  overview: string;
  perspectives: ComparisonPerspective[];
  modelId: string;
  generatedAt: string;
}> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const apiKey = process.env.LLM_API_KEY || geminiKey;
  const baseUrl = (
    process.env.LLM_API_BASE_URL ||
    (geminiKey && !process.env.LLM_API_KEY
      ? "https://generativelanguage.googleapis.com/v1beta/openai"
      : "https://api.openai.com/v1")
  ).replace(/\/$/, "");
  const model =
    process.env.LLM_MODEL_AUXILIARY ||
    (geminiKey && !process.env.LLM_API_KEY ? "gemini-3.8-flash" : "gpt-4o-mini");
  const timeoutMs =
    parseInt(process.env.LLM_REQUEST_TIMEOUT_SECONDS || "120", 10) * 1000;

  if (!apiKey) {
    throw new ApiError(
      502,
      "LLM_UNAVAILABLE",
      "現在論文比較サービスを利用できません（LLM_API_KEY未設定）。",
    );
  }

  const arxivIds = papers.map((p) => p.arxivId);

  const systemPrompt = [
    "あなたは複数のarXiv論文を日本語で比較整理するリサーチアナリストです。",
    "与えられた各論文の検証済み要約とAbstractのみを根拠として、「課題(problem)」「手法(method)」「結果(results)」「限界(limitations)」の4観点で比較してください。",
    "出力は以下のJSON形式のみを返してください:",
    '{"overview": "全体比較の総括(1000文字以内)", "perspectives": [',
    '  {"aspect": "problem", "aspectLabel": "課題", "summary": "観点の比較まとめ(600文字以内)", "entries": {"<arxivId>": {"text": "各論文の記述(400文字以内)", "basis": "fact または inference"}}},',
    '  {"aspect": "method", "aspectLabel": "手法", ...},',
    '  {"aspect": "results", "aspectLabel": "結果", ...},',
    '  {"aspect": "limitations", "aspectLabel": "限界", ...}',
    "]}",
    `必須ルール: entries には比較対象の全arXiv ID (${arxivIds.join(", ")}) を必ず含めること。`,
  ].join("\n");

  const userPrompt = papers
    .map(
      (p, idx) =>
        `[Paper ${idx + 1}] arXiv:${p.arxivId} (v${p.version})\nTitle: ${p.title}\nTitle(JA): ${p.titleJa}\nAbstract: ${p.abstract}\nVerified Summary: ${JSON.stringify(p.summaryJson)}`,
    )
    .join("\n\n---\n\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let rawJson: {
    overview?: unknown;
    perspectives?: Array<{
      aspect?: unknown;
      aspectLabel?: unknown;
      summary?: unknown;
      entries?: Record<string, { text?: unknown; basis?: unknown }>;
    }>;
  };
  let actualModel = model;

  try {
    let contentStr = "";
    if (baseUrl.includes("generativelanguage.googleapis.com")) {
      const cleanModel = (model || "gemini-3.5-flash-lite").replace("models/", "");
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
                parts: [
                  {
                    text: `${systemPrompt}\n\nStrict JSON output:\n${userPrompt}`,
                  },
                ],
              },
            ],
            generationConfig: { response_mime_type: "application/json" },
          }),
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        throw new ApiError(
          502,
          "LLM_UNAVAILABLE",
          `Gemini 比較生成エラー (${res.status})`,
        );
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      actualModel = cleanModel;
      contentStr = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    } else {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new ApiError(
          502,
          "LLM_UNAVAILABLE",
          "論文比較の生成中に外部サービスエラーが発生しました。",
        );
      }

      const body = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };
      actualModel = body.model || model;
      contentStr = body.choices?.[0]?.message?.content || "";
    }
    rawJson = JSON.parse(contentStr);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      502,
      "LLM_UNAVAILABLE",
      "論文比較の生成に失敗しました。時間をおいて再度お試しください。",
    );
  } finally {
    clearTimeout(timer);
  }

  const overview =
    typeof rawJson.overview === "string" ? rawJson.overview.trim() : "";
  if (
    !overview ||
    overview.length > 1000 ||
    !Array.isArray(rawJson.perspectives) ||
    rawJson.perspectives.length !== 4
  ) {
    throw new ApiError(
      502,
      "LLM_INVALID_RESPONSE",
      "論文比較応答の形式検証に失敗しました。",
    );
  }

  const perspectives: ComparisonPerspective[] = [];
  for (let i = 0; i < REQUIRED_ASPECTS.length; i++) {
    const expected = REQUIRED_ASPECTS[i];
    const pObj = rawJson.perspectives.find((p) => p.aspect === expected.aspect);
    if (!pObj) {
      throw new ApiError(
        502,
        "LLM_INVALID_RESPONSE",
        `比較観点 '${expected.aspect}' が欠落しています。`,
      );
    }

    const summary =
      typeof pObj.summary === "string" ? pObj.summary.trim() : "";
    if (!summary || summary.length > 600 || !pObj.entries || typeof pObj.entries !== "object") {
      throw new ApiError(
        502,
        "LLM_INVALID_RESPONSE",
        `比較観点 '${expected.aspect}' の内容が不正です。`,
      );
    }

    const entries: Record<string, ComparisonCell> = {};
    for (const id of arxivIds) {
      const cell = pObj.entries[id];
      const text =
        cell && typeof cell.text === "string" ? cell.text.trim() : "";
      const basis =
        cell && (cell.basis === "fact" || cell.basis === "inference")
          ? cell.basis
          : null;
      if (!text || text.length > 400 || !basis) {
        throw new ApiError(
          502,
          "LLM_INVALID_RESPONSE",
          `比較観点 '${expected.aspect}' における論文 ${id} の記述が不正です。`,
        );
      }
      entries[id] = { text, basis };
    }

    perspectives.push({
      aspect: expected.aspect,
      aspectLabel: expected.label,
      summary,
      entries,
    });
  }

  return {
    overview,
    perspectives,
    modelId: actualModel,
    generatedAt: new Date().toISOString(),
  };
}
