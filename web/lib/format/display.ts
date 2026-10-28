import { CATEGORY_LABELS_JA } from "@/lib/server/arxiv/categories";

export function formatDateTimeJst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const jstMs = d.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}/${pad2(jst.getUTCMonth() + 1)}/${pad2(jst.getUTCDate())} ${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())} JST`;
}

export function formatDateJst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const jstMs = d.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}/${pad2(jst.getUTCMonth() + 1)}/${pad2(jst.getUTCDate())} JST`;
}

export function getTodayDateInputJst(now = new Date()): string {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const jst = new Date(jstMs);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad2(jst.getUTCMonth() + 1)}-${pad2(jst.getUTCDate())}`;
}

export function formatCategoryLabel(code: string): string {
  return CATEGORY_LABELS_JA[code] || code;
}

export function formatSummaryScopeBadge(
  scope: "abstract_only" | "full_text" | null | undefined,
): string {
  if (scope === "full_text") {
    return "本文解析済み";
  }
  return "Abstractベース";
}

export function formatAuthorsSummary(
  authors: Array<{ name: string; affiliation?: string | null }> | null | undefined,
  maxNames = 3,
): string {
  if (!authors || authors.length === 0) return "著者不明";
  const names = authors.slice(0, maxNames).map((a) => a.name);
  const rest = authors.length - names.length;
  return rest > 0 ? `${names.join(", ")} ほか${rest}名` : names.join(", ");
}

export function formatBasisBadge(basis: "fact" | "inference"): {
  label: string;
  className: string;
} {
  if (basis === "fact") {
    return {
      label: "論文の記述",
      className: "bg-emerald-50 text-emerald-800 border-emerald-200",
    };
  }
  return {
    label: "AIによる補足推測",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  };
}

export function formatPlanLabel(plan: "free" | "pro"): string {
  return plan === "pro" ? "Proプラン（有料）" : "無料プラン（Free）";
}

export function formatSubscriptionStatusLabel(
  status: string | null | undefined,
  cancelAtPeriodEnd = false,
): string {
  if (!status) return "契約なし";
  if (status === "active" && cancelAtPeriodEnd) {
    return "解約予約済み（期間末まで利用可）";
  }
  const map: Record<string, string> = {
    active: "契約中（有効）",
    trialing: "トライアル中",
    past_due: "お支払い確認中（past_due）",
    unpaid: "未払い（unpaid）",
    paused: "一時停止中",
    incomplete: "決済手続き未完了",
    incomplete_expired: "決済期限切れ",
    canceled: "解約済み",
  };
  return map[status] || status;
}

export function formatPriceYen(amountYen: number): string {
  return `¥${amountYen.toLocaleString("ja-JP")}`;
}
