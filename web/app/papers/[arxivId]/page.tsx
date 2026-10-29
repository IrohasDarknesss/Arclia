"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Bookmark,
  BookOpen,
  ExternalLink,
  FileText,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Share2,
  Sparkles,
} from "lucide-react";
import { apiFetch, ClientApiError } from "@/lib/api/client";
import { useAuthSession } from "@/hooks/useAuthSession";
import {
  formatBasisBadge,
  formatCategoryLabel,
  formatDateTimeJst,
  formatSummaryScopeBadge,
} from "@/lib/format/display";
import { MathText } from "@/components/common/MathText";

type SummaryType = "short" | "standard" | "deep";

interface ClaimItem {
  claim_id: string;
  text: string;
  basis: "fact" | "inference";
}

interface CitationItem {
  claimId: string;
  sourceSection: string | null;
  sourcePage: number | null;
  sourceUrl: string;
}

interface PaperDetailResponse {
  arxivId: string;
  title: string;
  titleJa: string | null;
  abstract: string;
  authors: Array<{ name: string; affiliation?: string | null }>;
  categories: string[];
  submittedAt: string;
  updatedAt: string | null;
  version: number;
  latestVersion: number;
  availableVersions: Array<{ version: number; contentStatus: string }>;
  contentStatus: "abstract_only" | "full_text";
  licenseType: string | null;
  fullTextAllowed: boolean;
  originalUrl: string;
  pdfUrl: string;
  availableSummaryTypes: SummaryType[];
  isBookmarked: boolean;
  github: {
    repoFullName: string;
    repoUrl: string;
    repoLicense: string | null;
    defaultBranch: string | null;
    commitSha: string | null;
    matchEvidence: string | null;
    codeExplanation: {
      overview: string;
      key_paths: Array<{ path: string; role: string }>;
      quickstart: string | null;
    } | null;
  } | null;
}

interface SummaryApiResponse {
  arxivId: string;
  version: number;
  latestVersion: number;
  summaryType: SummaryType;
  status: "ready" | "not_ready";
  summary: {
    summaryType: SummaryType;
    language: string;
    sourceScope: "abstract_only" | "full_text";
    modelId: string;
    generatedAt: string;
    content: Record<string, unknown>;
  } | null;
  citations: CitationItem[];
}

interface ChatResponseData {
  answer: string;
  statements: Array<{
    text: string;
    basis: "fact" | "inference";
    claimIds: string[];
  }>;
  citations: CitationItem[];
  modelId: string;
  generatedAt: string;
  usage: {
    used: number;
    limit: number;
    remaining: number;
    resetAt: string;
  };
}

export default function PaperDetailPage() {
  const params = useParams<{ arxivId: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isAuthenticated } = useAuthSession();

  const rawArxivId = decodeURIComponent(params.arxivId || "");
  const versionParam = searchParams.get("version") || null;

  const [detail, setDetail] = useState<PaperDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<SummaryType>("standard");
  const [summaryData, setSummaryData] = useState<SummaryApiResponse | null>(
    null,
  );
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [bookmarkPending, setBookmarkPending] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Pro AI Q&A state (F09)
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatResult, setChatResult] = useState<ChatResponseData | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loadPaperDetail = useCallback(async () => {
    setDetailLoading(true);
    setDetailError(null);
    setNotFound(false);
    try {
      const qs = versionParam ? `?version=${encodeURIComponent(versionParam)}` : "";
      const res = await apiFetch<PaperDetailResponse>(
        `/api/papers/${encodeURIComponent(rawArxivId)}${qs}`,
      );
      setDetail(res);
      if (res.availableSummaryTypes.includes("standard")) {
        setActiveTab("standard");
      } else if (res.availableSummaryTypes.includes("short")) {
        setActiveTab("short");
      }
    } catch (err) {
      if (err instanceof ClientApiError && err.statusCode === 404) {
        setNotFound(true);
      } else {
        setDetailError(
          err instanceof Error ? err.message : "論文詳細の取得に失敗しました。",
        );
      }
    } finally {
      setDetailLoading(false);
    }
  }, [rawArxivId, versionParam]);

  const loadSummary = useCallback(
    async (tab: SummaryType) => {
      if (!detail) return;
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const qs = new URLSearchParams({ type: tab, version: String(detail.version) });
        const res = await apiFetch<SummaryApiResponse>(
          `/api/papers/${encodeURIComponent(detail.arxivId)}/summary?${qs.toString()}`,
        );
        setSummaryData(res);
      } catch (err) {
        setSummaryError(
          err instanceof Error ? err.message : "要約の取得に失敗しました。",
        );
      } finally {
        setSummaryLoading(false);
      }
    },
    [detail],
  );

  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [generateSummaryError, setGenerateSummaryError] = useState<string | null>(null);

  const handleGenerateSummaryOnDemand = async (targetType: "short" | "standard" = "standard") => {
    if (!detail) return;
    setIsGeneratingSummary(true);
    setGenerateSummaryError(null);
    try {
      const res = await apiFetch<SummaryApiResponse>(
        `/api/papers/${encodeURIComponent(detail.arxivId)}/summary`,
        {
          method: "POST",
          body: JSON.stringify({
            type: targetType,
            version: detail.version,
          }),
        },
      );
      setSummaryData(res);
      showToast("✨ 日本語要約の生成が完了しました！");
      await loadPaperDetail();
    } catch (err) {
      setGenerateSummaryError(
        err instanceof Error ? err.message : "要約の自動生成に失敗しました。",
      );
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  useEffect(() => {
    loadPaperDetail();
  }, [loadPaperDetail]);

  useEffect(() => {
    if (detail) {
      loadSummary(activeTab);
    }
  }, [detail, activeTab, loadSummary]);

  const handleToggleBookmark = async () => {
    if (!detail) return;
    if (!isAuthenticated) {
      router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    if (bookmarkPending) return;

    setBookmarkPending(true);
    try {
      if (detail.isBookmarked) {
        await apiFetch<void>(
          `/api/bookmarks/${encodeURIComponent(detail.arxivId)}`,
          { method: "DELETE" },
        );
        setDetail({ ...detail, isBookmarked: false });
        showToast("ブックマークを解除しました。");
      } else {
        await apiFetch(`/api/bookmarks`, {
          method: "POST",
          body: JSON.stringify({ arxivId: detail.arxivId }),
        });
        setDetail({ ...detail, isBookmarked: true });
        showToast("ブックマークに保存しました。");
      }
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : "ブックマークの更新に失敗しました。",
      );
    } finally {
      setBookmarkPending(false);
    }
  };

  const handleShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("ページのURLをクリップボードにコピーしました。");
    } catch {
      showToast("URLのコピーに失敗しました。");
    }
  };

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    const trimmed = chatQuestion.trim();
    if (!trimmed) return;

    setChatLoading(true);
    setChatError(null);
    try {
      const res = await apiFetch<ChatResponseData>(
        `/api/papers/${encodeURIComponent(detail.arxivId)}/chat`,
        {
          method: "POST",
          body: JSON.stringify({
            question: trimmed,
            version: detail.version,
          }),
        },
      );
      setChatResult(res);
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : "AI質問応答に失敗しました。",
      );
    } finally {
      setChatLoading(false);
    }
  };

  if (detailLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        論文詳細を読み込んでいます...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">
          指定された論文が見つかりませんでした
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          arXiv ID ({rawArxivId}) が正しいかご確認のうえ、検索ページからお探しください。
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            href="/search"
            className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            論文検索へ
          </Link>
          <Link
            href="/papers"
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            新着論文一覧へ
          </Link>
        </div>
      </div>
    );
  }

  if (detailError || !detail) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p>{detailError || "論文詳細の取得に失敗しました。"}</p>
        <button
          type="button"
          onClick={loadPaperDetail}
          className="mt-3 inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          再試行
        </button>
      </div>
    );
  }

  const citationMap = new Map<string, CitationItem>();
  for (const cit of summaryData?.citations || []) {
    citationMap.set(cit.claimId, cit);
  }

  const renderClaimList = (items: unknown) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    return (
      <ul className="space-y-3">
        {(items as ClaimItem[]).map((claim) => {
          const badge = formatBasisBadge(claim.basis);
          const cit = citationMap.get(claim.claim_id);
          return (
            <li
              key={claim.claim_id}
              className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
                >
                  {badge.label}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  [{claim.claim_id}]
                </span>
                {cit && (
                  <a
                    href={cit.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[11px] font-medium text-blue-600 shadow-sm ring-1 ring-slate-200 hover:underline"
                  >
                    <span>
                      根拠: {cit.sourceSection || "Abstract"}
                      {cit.sourcePage ? ` (p.${cit.sourcePage})` : ""}
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-800">
                <MathText text={claim.text} />
              </p>
            </li>
          );
        })}
      </ul>
    );
  };

  const sumContent = summaryData?.summary?.content || null;
  const thesisClaim =
    sumContent && typeof sumContent.thesis === "object"
      ? (sumContent.thesis as ClaimItem)
      : null;

  return (
    <div className="space-y-8">
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-lg"
        >
          {toastMessage}
        </div>
      )}

      {/* Paper Meta Header (P104) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {detail.categories.map((cat, idx) => (
            <span
              key={cat}
              className={`rounded px-2.5 py-0.5 text-xs font-semibold ${
                idx === 0
                  ? "bg-blue-50 text-blue-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {idx === 0 ? formatCategoryLabel(cat) : cat}
            </span>
          ))}
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700">
            arXiv:{detail.arxivId} (v{detail.version})
          </span>
          {detail.version < detail.latestVersion && (
            <Link
              href={`/papers/${encodeURIComponent(detail.arxivId)}`}
              className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:underline"
            >
              最新版 (v{detail.latestVersion}) を見る
            </Link>
          )}
          <span
            className={`rounded border px-2 py-0.5 text-xs font-medium ${
              detail.contentStatus === "full_text"
                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-slate-300 bg-slate-100 text-slate-700"
            }`}
          >
            {formatSummaryScopeBadge(detail.contentStatus)}
          </span>
        </div>

        <h1 className="mt-3 text-xl font-extrabold leading-snug text-slate-900 sm:text-2xl">
          {detail.titleJa || detail.title}
        </h1>
        {detail.titleJa && (
          <p className="mt-1.5 text-sm font-medium text-slate-600">
            {detail.title}
          </p>
        )}

        <div className="mt-3 text-xs text-slate-600">
          <p className="font-medium text-slate-700">
            著者:{" "}
            {detail.authors
              .map((a) =>
                a.affiliation ? `${a.name} (${a.affiliation})` : a.name,
              )
              .join(", ")}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-slate-500">
            <span>初版公開: {formatDateTimeJst(detail.submittedAt)}</span>
            {detail.updatedAt && (
              <span>最終更新: {formatDateTimeJst(detail.updatedAt)}</span>
            )}
            {summaryData?.summary?.generatedAt && (
              <span>
                要約生成: {formatDateTimeJst(summaryData.summary.generatedAt)}
              </span>
            )}
          </div>
        </div>

        {/* Paper Actions (P104) */}
        <div className="mt-5 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={bookmarkPending}
            onClick={handleToggleBookmark}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3.5 py-2 text-xs font-semibold transition-colors ${
              detail.isBookmarked
                ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>
              {detail.isBookmarked ? "ブックマーク済み" : "ブックマークに保存"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleShareUrl}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>共有URLをコピー</span>
          </button>

          <Link
            href={`/papers/${encodeURIComponent(detail.arxivId)}/appendix?version=${detail.version}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>数式・参考文献・補足ページへ</span>
          </Link>

          <a
            href={detail.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <span>arXiv原文ページ</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>

          <a
            href={detail.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>PDF (v{detail.version})</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Summary Depth Tabs & Structured Summary (P104) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div
          role="tablist"
          aria-label="要約の深さ切り替え"
          className="flex flex-wrap gap-2 border-b border-slate-200 pb-3"
        >
          {(
            [
              { key: "short", label: "30秒要点 (short)" },
              { key: "standard", label: "3分要約 (standard)" },
              { key: "deep", label: "10分解説 (deep / 本文解析)" },
            ] as const
          ).map((tab) => {
            const isSelected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-md px-4 py-2 text-xs font-bold transition-colors ${
                  isSelected
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5" role="tabpanel">
          {summaryLoading ? (
            <div className="py-8 text-center text-sm text-slate-500">
              日本語要約を読み込んでいます...
            </div>
          ) : summaryError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <p>{summaryError}</p>
              <button
                type="button"
                onClick={() => loadSummary(activeTab)}
                className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                再試行
              </button>
            </div>
          ) : !summaryData ||
            summaryData.status === "not_ready" ||
            !sumContent ? (
            activeTab === "deep" && !detail.fullTextAllowed ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 text-sm text-slate-800">
                <p className="font-semibold">
                  この論文はライセンス条件により本文解析（10分解説）の対象外です。
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  下の英語AbstractおよびarXiv原文ページをご参照ください。
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-blue-200/80 bg-gradient-to-br from-blue-50/70 via-indigo-50/30 to-white p-6 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 shadow-sm">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h3 className="mt-3 text-base font-bold text-slate-900">
                  この論文の日本語要約（{activeTab === "short" ? "30秒要点" : "3分要約"}）はまだ未生成です
                </h3>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 leading-relaxed">
                  Google Gemini 3.5 Flash-Lite（無料枠）で、根拠箇所（Abstract）と数値を厳格検証した構造化日本語要約を約1.5秒で即時生成できます。
                </p>

                {generateSummaryError && (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    {generateSummaryError}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleGenerateSummaryOnDemand(activeTab === "deep" ? "standard" : activeTab)}
                    disabled={isGeneratingSummary}
                    className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow hover:from-blue-700 hover:to-indigo-700 transition disabled:opacity-50"
                  >
                    {isGeneratingSummary ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>AI構造化要約を生成中（約1.5秒）...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>今すぐ日本語要約を生成する（無料・約1.5秒）</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-6">
              {/* Thesis / Core Conclusion */}
              {thesisClaim && (
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    結論・中心主張 (Thesis)
                  </h2>
                  <div className="mt-2">{renderClaimList([thesisClaim])}</div>
                </div>
              )}

              {activeTab === "short" ? (
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    要点 (Key Points)
                  </h2>
                  <div className="mt-2">
                    {renderClaimList(sumContent.key_points)}
                  </div>
                </div>
              ) : (
                <>
                  {Array.isArray(sumContent.problem) && (
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        課題・研究背景 (Problem)
                      </h2>
                      <div className="mt-2">
                        {renderClaimList(sumContent.problem)}
                      </div>
                    </div>
                  )}
                  {Array.isArray(sumContent.background_and_related_work) && (
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        背景・関連研究との位置づけ (Background & Related Work)
                      </h2>
                      <div className="mt-2">
                        {renderClaimList(
                          sumContent.background_and_related_work,
                        )}
                      </div>
                    </div>
                  )}
                  {Array.isArray(sumContent.method) && (
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        提案手法・アプローチ (Method)
                      </h2>
                      <div className="mt-2">
                        {renderClaimList(sumContent.method)}
                      </div>
                    </div>
                  )}
                  {Array.isArray(sumContent.results) && (
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        実験結果・主要な知見 (Results)
                      </h2>
                      <div className="mt-2">
                        {renderClaimList(sumContent.results)}
                      </div>
                    </div>
                  )}
                  {Array.isArray(sumContent.limitations) && (
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        限界・今後の課題 (Limitations)
                      </h2>
                      <div className="mt-2">
                        {renderClaimList(sumContent.limitations)}
                      </div>
                    </div>
                  )}
                  {Array.isArray(sumContent.applications) && (
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        応用可能性・実務への示唆 (Applications)
                      </h2>
                      <div className="mt-2">
                        {renderClaimList(sumContent.applications)}
                      </div>
                    </div>
                  )}
                  {Array.isArray(sumContent.reproducibility) && (
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        再現性・実装条件 (Reproducibility)
                      </h2>
                      <div className="mt-2">
                        {renderClaimList(sumContent.reproducibility)}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Summary Generation Info (P104 / ARC009) */}
              {summaryData.summary && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                    <span>
                      生成根拠範囲:{" "}
                      <strong>
                        {formatSummaryScopeBadge(
                          summaryData.summary.sourceScope,
                        )}
                      </strong>
                    </span>
                    <span>
                      使用モデル: <code>{summaryData.summary.modelId}</code>
                    </span>
                    <span>
                      生成日時:{" "}
                      {formatDateTimeJst(summaryData.summary.generatedAt)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Original English Abstract (Fallback / Reference) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">
          原文 Abstract (英語)
        </h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
          <MathText text={detail.abstract} />
        </p>
      </section>

      {/* GitHub Repository Link Section (F14) */}
      {detail.github && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-slate-800" />
              <h2 className="text-base font-bold text-slate-900">
                関連GitHubリポジトリ: {detail.github.repoFullName}
              </h2>
            </div>
            <a
              href={detail.github.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              <span>GitHubで開く</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
            <span>ライセンス: {detail.github.repoLicense || "不明"}</span>
            {detail.github.matchEvidence && (
              <span>特定根拠: {detail.github.matchEvidence}</span>
            )}
          </div>
          {detail.github.codeExplanation && (
            <div className="mt-4 space-y-3 rounded-lg bg-slate-50 p-4 text-xs text-slate-700">
              <p className="text-sm font-medium text-slate-800">
                {detail.github.codeExplanation.overview}
              </p>
              {detail.github.codeExplanation.key_paths?.length > 0 && (
                <div>
                  <p className="font-semibold text-slate-800">主要ファイル・ディレクトリ:</p>
                  <ul className="mt-1 space-y-1">
                    {detail.github.codeExplanation.key_paths.map((kp) => (
                      <li key={kp.path}>
                        <code className="rounded bg-white px-1.5 py-0.5 font-mono text-slate-900">
                          {kp.path}
                        </code>{" "}
                        — {kp.role}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.github.codeExplanation.quickstart && (
                <div>
                  <p className="font-semibold text-slate-800">実行・再現手順の要約:</p>
                  <p className="mt-0.5">{detail.github.codeExplanation.quickstart}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Pro AI Chat / Q&A Section (F09) */}
      <section className="rounded-xl border border-blue-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">
            この論文に対するAI質問応答 (Proプラン機能)
          </h2>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          検証済み要約と原文根拠の範囲内で質問に回答し、文ごとに「論文の記述」と「AIによる補足推測」を区別して表示します。
        </p>

        {!isAuthenticated ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-4 text-xs text-slate-700">
            <Link
              href={`/login?next=${encodeURIComponent(pathname || "/")}`}
              className="font-semibold text-blue-600 hover:underline"
            >
              ログイン
            </Link>{" "}
            してProプランに登録すると、論文に対するAI質問応答をご利用いただけます。
          </div>
        ) : user?.plan !== "pro" ? (
          <div className="mt-4 rounded-lg bg-blue-50/70 p-4 text-xs text-slate-700">
            AI質問応答はProプラン限定機能です。{" "}
            <Link
              href="/pricing"
              className="font-semibold text-blue-600 hover:underline"
            >
              料金プランページからアップグレード
            </Link>
          </div>
        ) : (
          <form onSubmit={handleAskQuestion} className="mt-4 space-y-3">
            <textarea
              rows={2}
              value={chatQuestion}
              onChange={(e) => setChatQuestion(e.target.value)}
              maxLength={500}
              placeholder="この論文の手法・実験設定・限界などについて質問を入力してください（500文字以内）..."
              className="w-full rounded-md border border-slate-300 p-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {chatQuestion.length}/500文字
              </span>
              <button
                type="submit"
                disabled={chatLoading || !chatQuestion.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {chatLoading ? "回答を生成中..." : "質問する"}
              </button>
            </div>
          </form>
        )}

        {chatError && (
          <p className="mt-3 text-xs font-medium text-red-600" role="alert">
            {chatError}
          </p>
        )}

        {chatResult && (
          <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="space-y-2">
              {chatResult.statements.map((st, idx) => {
                const badge = formatBasisBadge(st.basis);
                return (
                  <div
                    key={idx}
                    className="rounded border border-slate-200 bg-white p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      {st.claimIds.length > 0 && (
                        <span className="font-mono text-[10px] text-slate-500">
                          参照主張: {st.claimIds.join(", ")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-slate-800">
                      <MathText text={st.text} />
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              今月の残り利用可能回数: {chatResult.usage.remaining}/
              {chatResult.usage.limit}回（次回リセット:{" "}
              {formatDateTimeJst(chatResult.usage.resetAt)}）
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
