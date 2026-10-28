export const DEFAULT_TARGET_CATEGORIES = [
  "cs.AI",
  "cs.LG",
  "cs.CL",
  "cs.CV",
  "cs.NE",
  "cs.RO",
  "cs.IR",
  "stat.ML",
] as const;

export const CATEGORY_LABELS_JA: Record<string, string> = {
  "cs.AI": "人工知能 (cs.AI)",
  "cs.LG": "機械学習 (cs.LG)",
  "cs.CL": "自然言語処理 (cs.CL)",
  "cs.CV": "コンピュータビジョン (cs.CV)",
  "cs.NE": "ニューラル・進化的計算 (cs.NE)",
  "cs.RO": "ロボティクス (cs.RO)",
  "cs.IR": "情報検索 (cs.IR)",
  "stat.ML": "統計的機械学習 (stat.ML)",
};

export function getAllowedCategories(): string[] {
  const raw = process.env.ARXIV_TARGET_CATEGORIES;
  if (!raw) return [...DEFAULT_TARGET_CATEGORIES];
  const parsed = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_TARGET_CATEGORIES];
}

export function isAllowedCategory(category: string): boolean {
  return getAllowedCategories().includes(category);
}
