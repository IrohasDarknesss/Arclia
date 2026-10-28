import { ApiError } from "@/lib/server/http/errors";

export interface ChatStatement {
  text: string;
  basis: "fact" | "inference";
  claimIds: string[];
}

export interface ChatContextCitation {
  claimId: string;
  sourceSection: string | null;
  sourcePage: number | null;
  sourceUrl: string;
}

export interface ChatLlmResult {
  answer: string;
  statements: ChatStatement[];
  referencedCitations: ChatContextCitation[];
  modelId: string;
  generatedAt: string;
}

export async function generateGroundedPaperChatAnswer(params: {
  question: string;
  arxivId: string;
  version: number;
  title: string;
  abstract: string;
  summaryJson: Record<string, unknown>;
  citations: ChatContextCitation[];
}): Promise<ChatLlmResult> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = (
    process.env.LLM_API_BASE_URL || "https://api.openai.com/v1"
  ).replace(/\/$/, "");
  const model = process.env.LLM_MODEL_AUXILIARY || "gpt-4o-mini";
  const timeoutMs =
    parseInt(process.env.LLM_REQUEST_TIMEOUT_SECONDS || "120", 10) * 1000;

  if (!apiKey) {
    throw new ApiError(
      502,
      "LLM_UNAVAILABLE",
      "現在AI質問応答サービスを利用できません（LLM_API_KEY未設定）。",
    );
  }

  const validClaimMap = new Map<string, ChatContextCitation>();
  for (const cit of params.citations) {
    validClaimMap.set(cit.claimId, cit);
  }

  const systemPrompt = [
    "あなたはarXiv論文の質問応答アシスタントです。",
    "与えられた原題・Abstract・検証済み日本語要約（および主張ID claim_id 一覧）のみを根拠として質問に日本語で回答してください。",
    "出力は以下のJSONオブジェクト形式のみを返してください:",
    '{"answer": "回答全体のテキスト(2000文字以内)", "statements": [{"text": "文ごとの内容(500文字以内)", "basis": "fact または inference", "claim_ids": ["c01"]}]}',
    "ルール:",
    "1. 論文の記述に基づく事実は basis='fact' とし、対応する claim_ids（1件以上）を指定すること。",
    "2. 論文に直接書かれていない補足・推測・未記載である旨の説明は basis='inference' とすること。",
    "3. claim_ids には与えられた Valid Claim IDs に存在するIDのみを指定すること。",
  ].join("\n");

  const userPrompt = [
    `arXiv ID: ${params.arxivId} (v${params.version})`,
    `Title: ${params.title}`,
    `Abstract: ${params.abstract}`,
    `Valid Claim IDs: ${Array.from(validClaimMap.keys()).join(", ")}`,
    `Verified Summary JSON: ${JSON.stringify(params.summaryJson)}`,
    `User Question: ${params.question}`,
  ].join("\n\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let rawJson: {
    answer?: unknown;
    statements?: Array<{
      text?: unknown;
      basis?: unknown;
      claim_ids?: unknown;
    }>;
  };
  let actualModel = model;

  try {
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
        "AI応答の生成中に外部サービスエラーが発生しました。",
      );
    }

    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    actualModel = body.model || model;
    const contentStr = body.choices?.[0]?.message?.content || "";
    rawJson = JSON.parse(contentStr);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      502,
      "LLM_UNAVAILABLE",
      "AI応答の生成に失敗しました。時間をおいて再度お試しください。",
    );
  } finally {
    clearTimeout(timer);
  }

  // Validate LLM response structure (BE.F09 FN04)
  const answer =
    typeof rawJson.answer === "string" ? rawJson.answer.trim() : "";
  if (!answer || answer.length > 2000 || !Array.isArray(rawJson.statements)) {
    throw new ApiError(
      502,
      "LLM_INVALID_RESPONSE",
      "AI応答の形式検証に失敗しました。",
    );
  }

  if (rawJson.statements.length < 1 || rawJson.statements.length > 10) {
    throw new ApiError(
      502,
      "LLM_INVALID_RESPONSE",
      "AI応答の文数が許容範囲外です。",
    );
  }

  const statements: ChatStatement[] = [];
  const referencedSet = new Set<string>();

  for (const st of rawJson.statements) {
    const text = typeof st.text === "string" ? st.text.trim() : "";
    const basis = st.basis === "fact" || st.basis === "inference" ? st.basis : null;
    const rawIds = Array.isArray(st.claim_ids) ? st.claim_ids : [];

    if (!text || text.length > 500 || !basis) {
      throw new ApiError(
        502,
        "LLM_INVALID_RESPONSE",
        "AI応答の文要素が不正です。",
      );
    }

    const claimIds: string[] = [];
    for (const cid of rawIds) {
      if (typeof cid !== "string" || !validClaimMap.has(cid)) {
        throw new ApiError(
          502,
          "LLM_INVALID_RESPONSE",
          "AI応答が未知の根拠IDを参照しました。",
        );
      }
      if (!claimIds.includes(cid)) {
        claimIds.push(cid);
      }
      referencedSet.add(cid);
    }

    if (basis === "fact" && claimIds.length === 0 && validClaimMap.size > 0) {
      throw new ApiError(
        502,
        "LLM_INVALID_RESPONSE",
        "事実文(fact)に根拠IDが含まれていません。",
      );
    }

    statements.push({ text, basis, claimIds });
  }

  const referencedCitations: ChatContextCitation[] = [];
  for (const cid of referencedSet) {
    const cit = validClaimMap.get(cid);
    if (cit) referencedCitations.push(cit);
  }

  return {
    answer,
    statements,
    referencedCitations,
    modelId: actualModel,
    generatedAt: new Date().toISOString(),
  };
}
