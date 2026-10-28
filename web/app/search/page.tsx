"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Search } from "lucide-react";
import { apiFetch } from "@/lib/api/client";
import {
  CATEGORY_LABELS_JA,
  DEFAULT_TARGET_CATEGORIES,
} from "@/lib/server/arxiv/categories";
import { PaperCard, PaperCardItem } from "@/components/common/PaperCard";

interface SearchApiResponse {
  items: PaperCardItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
  onDemandSync: {
    triggered: boolean;
    status: "completed" | "processing" | "failed";
  } | null;
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentQ = searchParams.get("q")?.trim() || "";
  const currentCategory = searchParams.get("category")?.trim() || "";
  const currentPage = Math.max(
    1,
    parseInt(searchParams.get("page") || "1", 10) || 1,
  );

  const [qInput, setQInput] = useState(currentQ);
  const [catInput, setCatInput] = useState(currentCategory);
  const [formError, setFormError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  const [data, setData] = useState<SearchApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setQInput(currentQ);
    setCatInput(currentCategory);
  }, [currentQ, currentCategory]);

  const executeSearch = useCallback(async () => {
    if (!currentQ && !currentCategory) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (currentQ) qs.set("q", currentQ);
      if (currentCategory) qs.set("category", currentCategory);
      qs.set("page", String(currentPage));
      qs.set("limit", "20");

      const res = await apiFetch<SearchApiResponse>(
        `/api/papers/search?${qs.toString()}`,
      );
      setData(res);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "検索処理に失敗しました。",
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentQ, currentCategory, currentPage]);

  useEffect(() => {
    executeSearch();
  }, [executeSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing) return;

    const trimmedQ = qInput.trim();
    const trimmedCat = catInput.trim();

    if (!trimmedQ && !trimmedCat) {
      setFormError("検索キーワードまたは分野のいずれかを指定してください。");
      return;
    }
    if (trimmedQ.length > 200) {
      setFormError("検索キーワードは200文字以内で入力してください。");
      return;
    }
    if (/[\x00-\x1F\x7F]/.test(trimmedQ)) {
      setFormError("検索キーワードに使用できない制御文字が含まれています。");
      return;
    }

    setFormError(null);
    const qs = new URLSearchParams();
    if (trimmedQ) qs.set("q", trimmedQ);
    if (trimmedCat) qs.set("category", trimmedCat);
    qs.set("page", "1");
    router.push(`/search?${qs.toString()}`);
  };

  const handlePageChange = (nextPage: number) => {
    const qs = new URLSearchParams(searchParams.toString());
    qs.set("page", String(nextPage));
    router.push(`/search?${qs.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">論文検索</h1>
        <p className="mt-1 text-sm text-slate-600">
          英語キーワード、著者名、arXiv ID、または分野から論文を検索できます。未登録の論文はarXivからオンデマンド取得を試みます。
        </p>
      </div>

      {/* Search Form (P103) */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label
              htmlFor="search-q"
              className="block text-xs font-semibold text-slate-700"
            >
              キーワード / 著者名 / arXiv ID
            </label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                id="search-q"
                type="text"
                value={qInput}
                onChange={(e) => {
                  setQInput(e.target.value);
                  if (formError) setFormError(null);
                }}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder="例: Mixture-of-Experts, Taro Yamada, 2501.12345"
                className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="search-category"
              className="block text-xs font-semibold text-slate-700"
            >
              分野（任意）
            </label>
            <select
              id="search-category"
              value={catInput}
              onChange={(e) => {
                setCatInput(e.target.value);
                if (formError) setFormError(null);
              }}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">すべての対象分野</option>
              {DEFAULT_TARGET_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS_JA[cat] || cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {formError && (
          <p className="mt-3 text-xs font-medium text-red-600" role="alert">
            {formError}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center rounded-md bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? "検索中..." : "検索する"}
          </button>
        </div>
      </form>

      {/* Search Results (P103) */}
      {!currentQ && !currentCategory ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          上のフォームから検索キーワードまたは分野を指定して検索してください。
        </div>
      ) : isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          検索しています（DBに未登録の場合はarXivへの問い合わせを最大5秒間待機します）...
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={executeSearch}
            className="mt-3 inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            再試行
          </button>
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-800">
            条件に一致する論文が見つかりませんでした。
          </p>
          {data.onDemandSync?.triggered &&
            data.onDemandSync.status === "processing" && (
              <p className="mt-2 text-xs text-blue-700">
                現在バックグラウンドでarXivからのオンデマンド同期を実行中です。数秒後に再読み込みをお試しください。
              </p>
            )}
          <button
            type="button"
            onClick={executeSearch}
            className="mt-4 inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            検索結果を更新
          </button>
        </div>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span>全 {data.pagination.total} 件の検索結果</span>
            {data.onDemandSync?.triggered &&
              data.onDemandSync.status === "completed" && (
                <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">
                  arXivからオンデマンド取得した論文を含みます（日本語要約は順次生成されます）
                </span>
              )}
          </div>

          <div className="space-y-4">
            {data.items.map((paper) => (
              <PaperCard key={paper.arxivId} paper={paper} />
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => handlePageChange(currentPage - 1)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← 前のページ
            </button>
            <span className="text-xs font-medium text-slate-600">
              ページ {currentPage}
            </span>
            <button
              type="button"
              disabled={!data.pagination.hasNext}
              onClick={() => handlePageChange(currentPage + 1)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              次のページ →
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          読み込み中...
        </div>
      }
    >
      <SearchPageContent />
    </Suspense>
  );
}
