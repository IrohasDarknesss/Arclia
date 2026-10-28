"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RefreshCw, Search, Sparkles, TrendingUp } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { apiFetch } from "@/lib/api/client";
import {
  CATEGORY_LABELS_JA,
  DEFAULT_TARGET_CATEGORIES,
} from "@/lib/server/arxiv/categories";
import { PaperCard, PaperCardItem } from "@/components/common/PaperCard";

interface RecommendationsResponse {
  items: PaperCardItem[];
  hasInterests: boolean;
}

interface LatestPapersResponse {
  items: PaperCardItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

interface TrendsResponse {
  period: string;
  categoryCounts: Array<{
    category: string;
    label: string;
    paperCount: number;
    growthRate: number | null;
  }>;
  hotPapers: PaperCardItem[];
}

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthSession();

  const [searchInput, setSearchInput] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  // Recommendations state
  const [recData, setRecData] = useState<RecommendationsResponse | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  // Latest papers state
  const [latestItems, setLatestItems] = useState<PaperCardItem[]>([]);
  const [latestLoading, setLatestLoading] = useState(true);
  const [latestError, setLatestError] = useState<string | null>(null);

  // Trends state (F13)
  const [trendsData, setTrendsData] = useState<TrendsResponse | null>(null);

  const loadRecommendations = useCallback(async () => {
    if (!isAuthenticated) {
      setRecData(null);
      return;
    }
    setRecLoading(true);
    setRecError(null);
    try {
      const res = await apiFetch<RecommendationsResponse>(
        "/api/recommendations?limit=5",
      );
      setRecData(res);
    } catch (err) {
      setRecError(
        err instanceof Error ? err.message : "おすすめ論文の取得に失敗しました。",
      );
    } finally {
      setRecLoading(false);
    }
  }, [isAuthenticated]);

  const loadLatestPapers = useCallback(async () => {
    setLatestLoading(true);
    setLatestError(null);
    try {
      const res = await apiFetch<LatestPapersResponse>(
        "/api/papers?sort=submitted_at&page=1&limit=10",
      );
      setLatestItems(res.items);
    } catch (err) {
      setLatestError(
        err instanceof Error ? err.message : "新着論文の取得に失敗しました。",
      );
    } finally {
      setLatestLoading(false);
    }
  }, []);

  const loadTrends = useCallback(async () => {
    try {
      const res = await apiFetch<TrendsResponse>("/api/trends?period=7d&limit=5");
      setTrendsData(res);
    } catch {
      // Optional supplementary section
    }
  }, []);

  useEffect(() => {
    loadLatestPapers();
    loadTrends();
  }, [loadLatestPapers, loadTrends]);

  useEffect(() => {
    if (!authLoading) {
      loadRecommendations();
    }
  }, [authLoading, loadRecommendations]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing) return;
    const trimmed = searchInput.trim();
    if (!trimmed) {
      setSearchError("検索キーワードまたはarXiv IDを入力してください。");
      return;
    }
    if (trimmed.length > 200) {
      setSearchError("検索キーワードは200文字以内で入力してください。");
      return;
    }
    if (/[\x00-\x1F\x7F]/.test(trimmed)) {
      setSearchError("検索キーワードに使用できない制御文字が含まれています。");
      return;
    }
    setSearchError(null);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="space-y-12">
      {/* Hero Section (P101) */}
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-blue-50/40 to-slate-100 p-6 shadow-sm sm:p-10">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
            <Sparkles className="h-3.5 w-3.5" />
            根拠箇所・数値検証付きの構造化日本語ダイジェスト
          </span>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            arXivの最新研究を、日本語で素早く正確に把握する
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 sm:text-base">
            30秒要点・3分要約・10分解説の3段階と、主張ごとの原文根拠（Abstract /
            節・ページ）を明示。論文の記述とAIの推測を明確に区別して表示します。
          </p>

          <form onSubmit={handleSearchSubmit} className="mt-6">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-3 h-5 w-5 text-slate-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    if (searchError) setSearchError(null);
                  }}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  placeholder="キーワード、著者名、または arXiv ID (例: 2501.12345) で検索..."
                  aria-label="論文検索キーワード"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-11 pr-4 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                検索する
              </button>
            </div>
            {searchError && (
              <p className="mt-2 text-xs font-medium text-red-600" role="alert">
                {searchError}
              </p>
            )}
          </form>

          <div className="mt-6">
            <p className="text-xs font-semibold text-slate-500">
              主要分野から新着論文を探す:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DEFAULT_TARGET_CATEGORIES.map((cat) => (
                <Link
                  key={cat}
                  href={`/papers?category=${encodeURIComponent(cat)}`}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                >
                  {CATEGORY_LABELS_JA[cat] || cat}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Recommendation Section / Guide (P101 / F08) */}
      <section aria-labelledby="heading-recommendations">
        <div className="flex items-center justify-between">
          <h2
            id="heading-recommendations"
            className="text-xl font-bold text-slate-900"
          >
            あなたへのおすすめ論文
          </h2>
          {isAuthenticated && (
            <Link
              href="/mypage"
              className="text-xs font-semibold text-blue-600 hover:underline"
            >
              興味トピックを編集 →
            </Link>
          )}
        </div>

        <div className="mt-4">
          {authLoading || recLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              おすすめ論文を読み込んでいます...
            </div>
          ) : !isAuthenticated ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-6">
              <p className="text-sm font-medium text-slate-800">
                ログインして興味トピックを設定すると、あなたの研究関心に合った新着論文を毎日推薦します。
              </p>
              <div className="mt-3">
                <Link
                  href="/login?next=/"
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  ログインして始める
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : recError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <p>{recError}</p>
              <button
                type="button"
                onClick={loadRecommendations}
                className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                再試行
              </button>
            </div>
          ) : recData && !recData.hasInterests ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-6">
              <p className="text-sm font-medium text-slate-800">
                まだ興味トピックが設定されていません。マイページで分野やキーワードを登録すると、ここにおすすめ論文が表示されます。
              </p>
              <div className="mt-3">
                <Link
                  href="/mypage"
                  className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  マイページで興味トピックを設定する
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : recData && recData.items.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
              直近30日間に興味トピックに一致する未読論文が見つかりませんでした。
            </div>
          ) : (
            <div className="space-y-4">
              {recData?.items.map((paper) => (
                <PaperCard key={paper.arxivId} paper={paper} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Trends Overview (F13) */}
      {trendsData && trendsData.categoryCounts.length > 0 && (
        <section aria-labelledby="heading-trends">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <h2 id="heading-trends" className="text-xl font-bold text-slate-900">
              直近7日間の分野別新着トレンド
            </h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {trendsData.categoryCounts.map((item) => (
              <Link
                key={item.category}
                href={`/papers?category=${encodeURIComponent(item.category)}`}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-300"
              >
                <p className="text-xs font-semibold text-slate-600">
                  {item.label}
                </p>
                <div className="mt-1.5 flex items-baseline justify-between">
                  <span className="text-xl font-bold text-slate-900">
                    {item.paperCount}件
                  </span>
                  {item.growthRate !== null && (
                    <span
                      className={`text-xs font-medium ${
                        item.growthRate >= 0
                          ? "text-emerald-600"
                          : "text-slate-500"
                      }`}
                    >
                      {item.growthRate >= 0 ? `+${item.growthRate}%` : `${item.growthRate}%`}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Latest Papers Section (P101) */}
      <section aria-labelledby="heading-latest">
        <div className="flex items-center justify-between">
          <h2 id="heading-latest" className="text-xl font-bold text-slate-900">
            新着論文ダイジェスト
          </h2>
          <Link
            href="/papers"
            className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline"
          >
            すべて見る
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-4">
          {latestLoading ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              新着論文を読み込んでいます...
            </div>
          ) : latestError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              <p>{latestError}</p>
              <button
                type="button"
                onClick={loadLatestPapers}
                className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                再試行
              </button>
            </div>
          ) : latestItems.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              まだ登録されている論文がありません。
            </div>
          ) : (
            <div className="space-y-4">
              {latestItems.map((paper) => (
                <PaperCard key={paper.arxivId} paper={paper} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
