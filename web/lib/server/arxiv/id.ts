import { ApiError } from "@/lib/server/http/errors";

const ARXIV_ID_WITH_OPTIONAL_VERSION_RE =
  /^([0-9]{4}\.[0-9]{4,5}|[a-z-]+(?:\.[A-Za-z-]+)?\/[0-9]{7})(?:v([1-9][0-9]*))?$/;

const ARXIV_ID_BASE_RE =
  /^([0-9]{4}\.[0-9]{4,5}|[a-z-]+(?:\.[A-Za-z-]+)?\/[0-9]{7})$/;

export interface ParsedArxivId {
  arxivId: string;
  version: number | null;
}

export function decodeRouteArxivId(rawParam: string | string[]): string {
  const joined = Array.isArray(rawParam) ? rawParam.join("/") : rawParam;
  try {
    return decodeURIComponent(joined).trim();
  } catch {
    return joined.trim();
  }
}

export function parseArxivIdAndVersion(
  rawArxivId: string,
  versionQueryParam?: string | null,
): ParsedArxivId {
  const match = ARXIV_ID_WITH_OPTIONAL_VERSION_RE.exec(rawArxivId.trim());
  if (!match) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "arXiv IDの形式が正しくありません（例: 2401.12345）。",
    );
  }
  const baseId = match[1];
  const suffixVersion = match[2] ? parseInt(match[2], 10) : null;

  let queryVersion: number | null = null;
  if (versionQueryParam !== undefined && versionQueryParam !== null && versionQueryParam !== "") {
    if (!/^[1-9][0-9]*$/.test(versionQueryParam.trim())) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "versionは1以上の整数で指定してください。",
      );
    }
    queryVersion = parseInt(versionQueryParam.trim(), 10);
  }

  return {
    arxivId: baseId,
    version: queryVersion ?? suffixVersion,
  };
}

export function validateBaseArxivId(rawArxivId: string): string {
  const trimmed = rawArxivId.trim();
  if (!ARXIV_ID_BASE_RE.test(trimmed)) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "arXiv IDの形式が正しくありません（版番号vNを含めない形式で指定してください）。",
    );
  }
  return trimmed;
}
