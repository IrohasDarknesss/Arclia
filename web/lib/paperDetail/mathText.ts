import katex from "katex";

export interface MathSegment {
  type: "text" | "math-inline" | "math-block";
  raw: string;
  html?: string;
}

const MATH_TOKEN_RE = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;

export function parseMathSegments(text: string): MathSegment[] {
  if (!text) return [];
  const segments: MathSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MATH_TOKEN_RE)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        raw: text.slice(lastIndex, matchIndex),
      });
    }

    const token = match[0];
    const isBlock = token.startsWith("$$") && token.endsWith("$$");
    const expr = isBlock ? token.slice(2, -2).trim() : token.slice(1, -1).trim();

    try {
      const html = katex.renderToString(expr, {
        displayMode: isBlock,
        throwOnError: false,
        output: "htmlAndMathml",
      });
      segments.push({
        type: isBlock ? "math-block" : "math-inline",
        raw: token,
        html,
      });
    } catch {
      segments.push({
        type: "text",
        raw: token,
      });
    }

    lastIndex = matchIndex + token.length;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      raw: text.slice(lastIndex),
    });
  }

  return segments;
}

export function renderBlockLatexHtml(latex: string): {
  html: string | null;
  fallbackRaw: string;
} {
  const cleaned = (latex || "")
    .trim()
    .replace(/^\$\$/, "")
    .replace(/\$\$$/, "")
    .trim();
  if (!cleaned) {
    return { html: null, fallbackRaw: latex };
  }
  try {
    const html = katex.renderToString(cleaned, {
      displayMode: true,
      throwOnError: false,
      output: "htmlAndMathml",
    });
    return { html, fallbackRaw: cleaned };
  } catch {
    return { html: null, fallbackRaw: cleaned };
  }
}
