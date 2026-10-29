"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, Loader2, Sparkles } from "lucide-react";
import {
  formatAuthorsSummary,
  formatCategoryLabel,
  formatDateTimeJst,
  formatSummaryScopeBadge,
} from "@/lib/format/display";

export interface PaperCardItem {
  arxivId: string;
  title: string;
  titleJa: string | null;
  authors: Array<{ name: string; affiliation?: string | null }>;
  categories: string[];
  submittedAt: string;
  updatedAt?: string | null;
  latestVersion: number;
  shortSummary: {
    thesis: string;
    sourceScope: "abstract_only" | "full_text";
    generatedAt: string;
  } | null;
  matchedTopics?: string[];
  bookmarkedAt?: string;
  viewedAt?: string;
}

interface PaperCardProps {
  paper: PaperCardItem;
  actionSlot?: React.ReactNode;
}

function getCategoryColor(cat: string): string {
  if (cat.startsWith("cs.AI")) return "bg-blue-50 text-blue-700 border-blue-200";
  if (cat.startsWith("cs.LG") || cat.startsWith("stat.ML")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (cat.startsWith("cs.CV")) return "bg-purple-50 text-purple-700 border-purple-200";
  if (cat.startsWith("cs.CL")) return "bg-cyan-50 text-cyan-700 border-cyan-200";
  if (cat.startsWith("cs.RO")) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export function PaperCard({ paper, actionSlot }: PaperCardProps) {
  const [titleJa, setTitleJa] = useState(paper.titleJa);
  const [shortSummary, setShortSummary] = useState(paper.shortSummary);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);

  const primaryCategory = paper.categories[0] || "";
  const secondaryCategories = paper.categories.slice(1, 4);
  const detailHref = `/papers/${encodeURIComponent(paper.arxivId)}`;

  const handleQuickSummarize = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsSummarizing(true);
    setSummarizeError(null);
    try {
      const res = await fetch(`/api/papers/${encodeURIComponent(paper.arxivId)}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "short" }),
      });
      const data = await res.json();
      if (data.status === "success" && data.data?.summary?.content) {
        const content = data.data.summary.content;
        if (content.title_ja) setTitleJa(content.title_ja);
        if (content.thesis?.text) {
          setShortSummary({
            thesis: content.thesis.text,
            sourceScope: data.data.summary.sourceScope || "abstract_only",
            generatedAt: data.data.summary.generatedAt || new Date().toISOString(),
          });
        }
      } else {
        setSummarizeError(data.error?.message || "要約生成に失敗しました");
      }
    } catch {
      setSummarizeError("通信エラーが発生しました");
    } finally {
      setIsSummarizing(false);
    }
  };

  return (
    <article className="group relative rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md">
      {/* Header bar: Categories & Status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {primaryCategory && (
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getCategoryColor(
                primaryCategory,
              )}`}
            >
              {formatCategoryLabel(primaryCategory)}
            </span>
          )}
          {secondaryCategories.map((cat) => (
            <span
              key={cat}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600"
            >
              {cat}
            </span>
          ))}

          <a
            href={`https://arxiv.org/abs/${paper.arxivId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-600 hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900"
            title="arXiv原文ページを開く"
          >
            <span>arXiv:{paper.arxivId}</span>
            <span className="text-[10px] text-slate-400">v{paper.latestVersion}</span>
            <ArrowUpRight className="h-3 w-3 text-slate-400" />
          </a>

          {shortSummary ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              <span>要約済み</span>
              <span className="text-[10px] opacity-75">
                ({formatSummaryScopeBadge(shortSummary.sourceScope)})
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              <Clock className="h-3 w-3 text-amber-500" />
              <span>要約準備中</span>
            </span>
          )}
        </div>

        {actionSlot && <div className="flex items-center gap-2">{actionSlot}</div>}
      </div>

      {/* Title */}
      <h3 className="mt-3 text-base font-bold leading-snug text-slate-900 transition-colors group-hover:text-indigo-600 sm:text-lg">
        <Link href={detailHref} className="hover:underline">
          {titleJa || paper.title}
        </Link>
      </h3>

      {titleJa && (
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">
          {paper.title}
        </p>
      )}

      {/* Meta info */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>著者: {formatAuthorsSummary(paper.authors)}</span>
        <span>公開: {formatDateTimeJst(paper.submittedAt)}</span>
        {paper.updatedAt && paper.updatedAt !== paper.submittedAt && (
          <span>更新: {formatDateTimeJst(paper.updatedAt)}</span>
        )}
        {paper.bookmarkedAt && (
          <span className="text-indigo-600">★ 保存日時: {formatDateTimeJst(paper.bookmarkedAt)}</span>
        )}
      </div>

      {paper.matchedTopics && paper.matchedTopics.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-medium text-slate-500">関心トピック:</span>
          {paper.matchedTopics.map((t) => (
            <span
              key={t}
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Summary Box */}
      <div className="mt-3.5 rounded-lg border border-slate-200/80 bg-slate-50/80 p-3.5 text-sm leading-relaxed text-slate-800 transition-all">
        {shortSummary ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span className="inline-flex items-center gap-1 text-indigo-600">
                <Sparkles className="h-3 w-3" />
                30秒要約（論文の核心）
              </span>
              <Link href={detailHref} className="text-indigo-600 hover:underline">
                3分要約・根拠を見る →
              </Link>
            </div>
            <p className="text-sm font-medium text-slate-800">{shortSummary.thesis}</p>
          </div>
        ) : (
          <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
            <p className="text-xs text-slate-500">
              日本語要約は現在キュー待機中です。詳細ページを開くか、ボタンを押すとその場でAI要約します。
            </p>
            <button
              type="button"
              onClick={handleQuickSummarize}
              disabled={isSummarizing}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:from-indigo-700 hover:to-blue-700 hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSummarizing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>AI要約中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>今すぐ要約</span>
                </>
              )}
            </button>
          </div>
        )}
        {summarizeError && (
          <p className="mt-1.5 text-xs text-red-600">{summarizeError}</p>
        )}
      </div>
    </article>
  );
}
