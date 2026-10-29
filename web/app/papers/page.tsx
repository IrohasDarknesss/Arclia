"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Filter,
  GitCompare,
  Layers,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";
import { apiFetch, ClientApiError } from "@/lib/api/client";
import {
  CATEGORY_LABELS_JA,
  DEFAULT_TARGET_CATEGORIES,
} from "@/lib/server/arxiv/categories";
import { formatBasisBadge, getTodayDateInputJst } from "@/lib/format/display";
import { PaperCard, PaperCardItem } from "@/components/common/PaperCard";
import { useAuthSession } from "@/hooks/useAuthSession";

interface PapersListResponse {
  items: PaperCardItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

interface CompareApiResponse {
  papers: Array<{
    arxivId: string;
    version: number;
    title: string;
    titleJa: string;
  }>;
  overview: string;
  perspectives: Array<{
    aspect: string;
    aspectLabel: string;
    summary: string;
    entries: Record<string, { text: string; basis: "fact" | "inference" }>;
  }>;
  modelId: string;
  generatedAt: string;
  usage: {
    used: number;
    limit: number;
    remaining: number;
    resetAt: string;
  };
}

const CATEGORY_CHIPS = [
  { key: "", label: "すべて" },
  { key: "cs.AI", label: "人工知能 (AI)" },
  { key: "cs.LG", label: "機械学習 (ML)" },
  { key: "cs.CV", label: "コンピュータビジョン (CV)" },
  { key: "cs.CL", label: "言語処理・NLP (CL)" },
  { key: "cs.RO", label: "ロボティクス (RO)" },
];

function PapersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAuthenticated } = useAuthSession();

  const currentCategory = searchParams.get("category") || "";
  const currentFrom = searchParams.get("from") || "";
  const currentTo = searchParams.get("to") || "";
  const currentSort =
    searchParams.get("sort") === "updated_at" ? "updated_at" : "submitted_at";
  const currentPage = Math.max(
    1,
    parseInt(searchParams.get("page") || "1", 10) || 1,
  );

  const [categoryInput, setCategoryInput] = useState(currentCategory);
  const [fromInput, setFromInput] = useState(currentFrom);
  const [toInput, setToInput] = useState(currentTo);
  const [sortInput, setSortInput] = useState<"submitted_at" | "updated_at">(
    currentSort,
  );
  const [filterError, setFilterError] = useState<string | null>(null);

  const [data, setData] = useState<PapersListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  // Paper Comparison state (F11)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareResult, setCompareResult] =
    useState<CompareApiResponse | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  useEffect(() => {
    setCategoryInput(currentCategory);
    setFromInput(currentFrom);
    setToInput(currentTo);
    setSortInput(currentSort);
  }, [currentCategory, currentFrom, currentTo, currentSort]);

  const fetchPapers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (currentCategory) qs.set("category", currentCategory);
      if (currentFrom) qs.set("from", currentFrom);
      if (currentTo) qs.set("to", currentTo);
      qs.set("sort", currentSort);
      qs.set("page", String(currentPage));
      qs.set("limit", "20");

      const res = await apiFetch<PapersListResponse>(
        `/api/papers?${qs.toString()}`,
      );
      setData(res);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "新着論文一覧の取得に失敗しました。",
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentCategory, currentFrom, currentTo, currentSort, currentPage]);

  useEffect(() => {
    fetchPapers();
  }, [fetchPapers]);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    const todayStr = getTodayDateInputJst();

    if (fromInput && fromInput > todayStr) {
      setFilterError("開始日（from）に未来の日付は指定できません。");
      return;
    }
    if (toInput && toInput > todayStr) {
      setFilterError("終了日（to）に未来の日付は指定できません。");
      return;
    }
    if (fromInput && toInput && fromInput > toInput) {
      setFilterError("開始日（from）は終了日（to）以前の日付を指定してください。");
      return;
    }

    setFilterError(null);
    const qs = new URLSearchParams();
    if (categoryInput) qs.set("category", categoryInput);
    if (fromInput) qs.set("from", fromInput);
    if (toInput) qs.set("to", toInput);
    if (sortInput !== "submitted_at") qs.set("sort", sortInput);
    qs.set("page", "1");
    router.push(`/papers?${qs.toString()}`);
  };

  const handleSelectCategoryChip = (catKey: string) => {
    setCategoryInput(catKey);
    const qs = new URLSearchParams(searchParams.toString());
    if (catKey) {
      qs.set("category", catKey);
    } else {
      qs.delete("category");
    }
    qs.set("page", "1");
    router.push(`/papers?${qs.toString()}`);
  };

  const handleClearFilter = () => {
    setFilterError(null);
    setCategoryInput("");
    setFromInput("");
    setToInput("");
    setSortInput("submitted_at");
    router.push("/papers");
  };

  const handlePageChange = (nextPage: number) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("page", String(nextPage));
    router.push(`/papers?${qs.toString()}`);
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncToast(null);
    try {
      const res = await apiFetch<{
        fetchedCount: number;
        insertedPapers: number;
        insertedVersions: number;
      }>("/api/papers/sync", {
        method: "POST",
        body: JSON.stringify({ category: currentCategory || "cs.AI" }),
      });
      setSyncToast(
        `✅ arXiv最新同期完了: ${res.insertedPapers}件の新しい論文をDBに取り込みました`,
      );
      await fetchPapers();
    } catch (err) {
      setSyncToast(
        `⚠️ 同期エラー: ${err instanceof Error ? err.message : "同期に失敗しました"}`,
      );
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncToast(null), 5000);
    }
  };

  const toggleSelectForCompare = (arxivId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(arxivId)) {
        return prev.filter((id) => id !== arxivId);
      }
      if (prev.length >= 5) {
        return prev;
      }
      return [...prev, arxivId];
    });
  };

  const handleRunCompare = async () => {
    if (selectedIds.length < 2 || selectedIds.length > 5) return;
    setCompareLoading(true);
    setCompareError(null);
    try {
      const res = await apiFetch<CompareApiResponse>("/api/papers/compare", {
        method: "POST",
        body: JSON.stringify({ arxivIds: selectedIds }),
      });
      setCompareResult(res);
    } catch (err) {
      if (err instanceof ClientApiError && err.code === "PRO_REQUIRED") {
        setCompareError(
          "複数論文の比較はProプラン限定機能です。料金プランページからアップグレードしてください。",
        );
      } else {
        setCompareError(
          err instanceof Error ? err.message : "論文比較の生成に失敗しました。",
        );
      }
    } finally {
      setCompareLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {syncToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 rounded-xl bg-slate-900/95 px-4 py-3 text-xs font-semibold text-white shadow-2xl backdrop-blur-md border border-slate-700 animate-in fade-in slide-in-from-bottom-3"
        >
          {syncToast}
        </div>
      )}

      {/* Header with Title and Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
              新着論文一覧
            </h1>
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700">
              JST毎日更新
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600 sm:text-sm">
            arXivに登録された最新研究を、Google Gemini無料枠（0円）による厳格な日本語要約付きで配信
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-blue-400 disabled:opacity-50"
            title="arXivから最新論文を即時フェッチしてDBを更新します"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-blue-600 ${isSyncing ? "animate-spin" : ""}`}
            />
            <span>{isSyncing ? "arXiv同期中..." : "arXiv最新同期"}</span>
          </button>
        </div>
      </div>

      {/* Fast Category Filter Chips */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {CATEGORY_CHIPS.map((chip) => {
          const isSelected = currentCategory === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => handleSelectCategoryChip(chip.key)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold transition-all shadow-sm ${
                isSelected
                  ? "bg-blue-600 text-white ring-2 ring-blue-500/30 shadow-blue-500/20"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
              }`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Modern Filter Card (P102) */}
      <form
        onSubmit={handleApplyFilter}
        className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-sm transition hover:shadow"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <Filter className="h-4 w-4 text-blue-600" />
            <span>詳細絞り込み（期間・並び順）</span>
          </div>
          {(categoryInput || fromInput || toInput || sortInput !== "submitted_at") && (
            <button
              type="button"
              onClick={handleClearFilter}
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              全条件をリセット
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label
              htmlFor="filter-category"
              className="block text-xs font-semibold text-slate-700"
            >
              分野 (Category)
            </label>
            <select
              id="filter-category"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">すべての対象分野</option>
              {DEFAULT_TARGET_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS_JA[cat] || cat} ({cat})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="filter-from"
              className="block text-xs font-semibold text-slate-700"
            >
              公開開始日 (JST)
            </label>
            <input
              id="filter-from"
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="filter-to"
              className="block text-xs font-semibold text-slate-700"
            >
              公開終了日 (JST)
            </label>
            <input
              id="filter-to"
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="filter-sort"
              className="block text-xs font-semibold text-slate-700"
            >
              並び順 (Sort)
            </label>
            <select
              id="filter-sort"
              value={sortInput}
              onChange={(e) =>
                setSortInput(e.target.value as "submitted_at" | "updated_at")
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="submitted_at">初版公開日が新しい順</option>
              <option value="updated_at">最終更新日が新しい順</option>
            </select>
          </div>
        </div>

        {filterError && (
          <p className="mt-3 text-xs font-medium text-red-600" role="alert">
            {filterError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-blue-700 transition"
          >
            条件を適用する
          </button>
        </div>
      </form>

      {/* Feature Guidance & Summary Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-gradient-to-r from-blue-50/60 via-indigo-50/40 to-slate-50 p-4 text-xs">
        <div className="flex items-center gap-2 text-slate-800">
          <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
          <span>
            <strong>オンデマンド即時要約</strong>: 未要約の論文カードも<strong>「今すぐ要約」</strong>ボタンを押すと約1.5秒でGemini 3.5 Flash（無料枠）による日本語要約がその場で生成されます。
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
            Gemini無料枠 0円稼働中
          </span>
        </div>
      </div>

      {/* Pro Comparison Toolbar (F11) */}
      {selectedIds.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-indigo-700" />
              <span className="text-xs font-bold text-indigo-950">
                {selectedIds.length}件の論文を選択中（最大5件）
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-xs font-medium text-indigo-700 hover:underline"
              >
                選択解除
              </button>
              <button
                type="button"
                disabled={selectedIds.length < 2 || compareLoading}
                onClick={handleRunCompare}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {compareLoading ? "論文横断比較を生成中..." : "論文横断比較を実行 (Pro)"}
              </button>
            </div>
          </div>

          {compareError && (
            <p className="mt-2 text-xs font-medium text-red-600">
              {compareError}
            </p>
          )}

          {compareResult && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900">
                論文横断比較（課題・手法・結果・限界）
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-700">
                {compareResult.overview}
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        観点
                      </th>
                      {compareResult.papers.map((p) => (
                        <th
                          key={p.arxivId}
                          className="px-3 py-2 text-left font-semibold text-slate-700"
                        >
                          {p.arxivId} (v{p.version})
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {compareResult.perspectives.map((persp) => (
                      <tr key={persp.aspect}>
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-800">
                          {persp.aspectLabel}
                        </td>
                        {compareResult.papers.map((p) => {
                          const cell = persp.entries[p.arxivId];
                          const badge = cell
                            ? formatBasisBadge(cell.basis)
                            : null;
                          return (
                            <td key={p.arxivId} className="px-3 py-2.5 align-top">
                              {cell ? (
                                <div>
                                  <span
                                    className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge?.className}`}
                                  >
                                    {badge?.label}
                                  </span>
                                  <p className="mt-1 text-slate-700 leading-relaxed">
                                    {cell.text}
                                  </p>
                                </div>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results List (P102) */}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500 shadow-sm">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-blue-600 mb-2" />
          論文一覧を読み込んでいます...
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={fetchPapers}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            再試行
          </button>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-600 shadow-sm">
          <p className="font-semibold text-slate-800">指定された条件に一致する論文はありませんでした。</p>
          <p className="mt-1 text-xs text-slate-500">条件をリセットするか、ヘッダーの「arXiv最新同期」で新着論文を取り込んでみてください。</p>
          <button
            type="button"
            onClick={handleClearFilter}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-blue-700"
          >
            条件をクリア
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-medium">
              全 <strong className="text-slate-900">{data.pagination.total}</strong> 件中{" "}
              {(data.pagination.page - 1) * data.pagination.limit + 1}〜
              {(data.pagination.page - 1) * data.pagination.limit +
                data.items.length}{" "}
              件を表示
            </span>
            {isAuthenticated && user?.plan === "pro" && (
              <span className="text-indigo-600 font-medium">チェックボックスで2〜5件選択して横断比較可能</span>
            )}
          </div>

          <div className="space-y-4">
            {data.items.map((paper) => (
              <PaperCard
                key={paper.arxivId}
                paper={paper}
                actionSlot={
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(paper.arxivId)}
                      onChange={() => toggleSelectForCompare(paper.arxivId)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>比較</span>
                  </label>
                }
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-slate-200 pt-6">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition"
            >
              ← 前のページ
            </button>
            <span className="text-xs font-semibold text-slate-700">
              ページ {currentPage}
            </span>
            <button
              type="button"
              disabled={!data.pagination.hasNext}
              onClick={() => handlePageChange(currentPage + 1)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 transition"
            >
              次のページ →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function PapersPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-blue-600 mb-2" />
          読み込み中...
        </div>
      }
    >
      <PapersPageContent />
    </Suspense>
  );
}
