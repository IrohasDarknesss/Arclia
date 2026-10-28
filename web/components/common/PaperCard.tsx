import React from "react";
import Link from "next/link";
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

export function PaperCard({ paper, actionSlot }: PaperCardProps) {
  const primaryCategory = paper.categories[0] || "";
  const secondaryCategories = paper.categories.slice(1, 4);
  const detailHref = `/papers/${encodeURIComponent(paper.arxivId)}`;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {primaryCategory && (
            <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
              {formatCategoryLabel(primaryCategory)}
            </span>
          )}
          {secondaryCategories.map((cat) => (
            <span
              key={cat}
              className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            >
              {cat}
            </span>
          ))}
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-600">
            arXiv:{paper.arxivId} (v{paper.latestVersion})
          </span>
          {paper.shortSummary && (
            <span
              className={`rounded border px-2 py-0.5 text-xs font-medium ${
                paper.shortSummary.sourceScope === "full_text"
                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                  : "border-slate-300 bg-slate-100 text-slate-700"
              }`}
            >
              {formatSummaryScopeBadge(paper.shortSummary.sourceScope)}
            </span>
          )}
        </div>

        {actionSlot && <div className="flex items-center gap-2">{actionSlot}</div>}
      </div>

      <h3 className="mt-2.5 text-base font-bold leading-snug text-slate-900 sm:text-lg">
        <Link href={detailHref} className="hover:text-blue-600 hover:underline">
          {paper.titleJa || paper.title}
        </Link>
      </h3>

      {paper.titleJa && (
        <p className="mt-1 text-xs text-slate-500">{paper.title}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>著者: {formatAuthorsSummary(paper.authors)}</span>
        <span>初版公開: {formatDateTimeJst(paper.submittedAt)}</span>
        {paper.updatedAt && paper.updatedAt !== paper.submittedAt && (
          <span>最終更新: {formatDateTimeJst(paper.updatedAt)}</span>
        )}
        {paper.bookmarkedAt && (
          <span>保存日時: {formatDateTimeJst(paper.bookmarkedAt)}</span>
        )}
        {paper.viewedAt && (
          <span>閲覧日時: {formatDateTimeJst(paper.viewedAt)}</span>
        )}
      </div>

      {paper.matchedTopics && paper.matchedTopics.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-medium text-slate-500">
            一致トピック:
          </span>
          {paper.matchedTopics.map((t) => (
            <span
              key={t}
              className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
        {paper.shortSummary ? (
          <p>{paper.shortSummary.thesis}</p>
        ) : (
          <p className="text-xs italic text-slate-500">
            日本語要約を準備中です（詳細ページで原題・Abstractをご確認いただけます）。
          </p>
        )}
      </div>
    </article>
  );
}
