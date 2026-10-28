"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { apiFetch, ClientApiError } from "@/lib/api/client";
import {
  formatAuthorsSummary,
  formatCategoryLabel,
  formatDateTimeJst,
  formatSummaryScopeBadge,
} from "@/lib/format/display";
import { BlockLatex, MathText } from "@/components/common/MathText";

interface KeyFormulaItem {
  formula_id: string;
  latex: string;
  meaning_ja: string;
  variables: Array<{ symbol: string; meaning_ja: string }>;
  source_section: string;
  source_page?: number | null;
}

interface ReferenceItem {
  ref_id: string;
  title: string;
  authors: string;
  year?: number | null;
  role_ja: string;
  url?: string | null;
}

interface AppendixApiResponse {
  arxivId: string;
  title: string;
  titleJa: string | null;
  authors: Array<{ name: string; affiliation?: string | null }>;
  categories: string[];
  submittedAt: string;
  updatedAt: string | null;
  version: number;
  latestVersion: number;
  originalUrl: string;
  pdfUrl: string;
  contentStatus: "abstract_only" | "full_text";
  licenseType: string | null;
  fullTextAllowed: boolean;
  fullTextStatus: "ready" | "not_analyzed" | "license_restricted";
  modelId: string | null;
  generatedAt: string | null;
  keyFormulas: KeyFormulaItem[];
  references: ReferenceItem[];
  fullTextTranslation: {
    available: boolean;
    reason: string;
  };
}

export default function PaperAppendixPage() {
  const params = useParams<{ arxivId: string }>();
  const searchParams = useSearchParams();
  const rawArxivId = decodeURIComponent(params.arxivId || "");
  const versionParam = searchParams.get("version") || null;

  const [data, setData] = useState<AppendixApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAppendix = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const qs = versionParam ? `?version=${encodeURIComponent(versionParam)}` : "";
      const res = await apiFetch<AppendixApiResponse>(
        `/api/papers/${encodeURIComponent(rawArxivId)}/appendix${qs}`,
      );
      setData(res);
    } catch (err) {
      if (err instanceof ClientApiError && err.statusCode === 404) {
        setNotFound(true);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : "補足情報の読み込みに失敗しました。",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [rawArxivId, versionParam]);

  useEffect(() => {
    loadAppendix();
  }, [loadAppendix]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        論文補足・数式解説を読み込んでいます...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <h1 className="text-xl font-bold text-slate-900">
          指定された論文または版が見つかりませんでした
        </h1>
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

  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p>{error || "補足情報の取得に失敗しました。"}</p>
        <button
          type="button"
          onClick={loadAppendix}
          className="mt-3 inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          再試行
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/papers/${encodeURIComponent(data.arxivId)}?version=${data.version}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>論文要約ページ（P104）に戻る</span>
        </Link>
      </div>

      {/* Appendix Paper Header (P105) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {data.categories[0] && (
            <span className="rounded bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              {formatCategoryLabel(data.categories[0])}
            </span>
          )}
          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700">
            arXiv:{data.arxivId} (v{data.version})
          </span>
          <span className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {formatSummaryScopeBadge(data.contentStatus)}
          </span>
        </div>

        <h1 className="mt-3 text-xl font-extrabold text-slate-900 sm:text-2xl">
          {data.titleJa || data.title} — 論文補足・数式解説・参考文献
        </h1>
        {data.titleJa && (
          <p className="mt-1 text-xs text-slate-500">{data.title}</p>
        )}

        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          <span>著者: {formatAuthorsSummary(data.authors)}</span>
          <span>初版公開: {formatDateTimeJst(data.submittedAt)}</span>
          {data.generatedAt && (
            <span>補足生成: {formatDateTimeJst(data.generatedAt)}</span>
          )}
        </div>
      </section>

      {/* Source Links Section (P105) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">
          原文・PDF・ライセンス情報
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={data.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <span>arXiv原文ページを開く</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a
            href={data.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>arXiv PDF (v{data.version}) を開く</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          ライセンス表記: <code>{data.licenseType || "未記載（再利用不可扱い）"}</code>
        </p>
      </section>

      {/* Formula Explanation Section (P105) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">
          主要数式・記号の解説
        </h2>

        {data.fullTextStatus === "license_restricted" ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-xs text-slate-700">
            この論文のライセンス条件により、本文PDFから抽出した数式解説は提供していません。上のarXiv原文またはPDFリンクからご確認ください。
          </div>
        ) : data.keyFormulas.length === 0 ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            現在この版の本文数式解説は登録されていません（本文解析待ち、または該当する主要数式なし）。
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {data.keyFormulas.map((f) => (
              <div
                key={f.formula_id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-700">
                    [{f.formula_id}]
                  </span>
                  <span>
                    出典: {f.source_section}
                    {f.source_page ? ` (p.${f.source_page})` : ""}
                  </span>
                </div>
                <div className="mt-2">
                  <BlockLatex latex={f.latex} />
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-slate-800">
                  <MathText text={f.meaning_ja} />
                </p>
                {Array.isArray(f.variables) && f.variables.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <p className="text-xs font-semibold text-slate-600">
                      記号・変数の意味:
                    </p>
                    <ul className="mt-1 space-y-1 text-xs text-slate-700">
                      {f.variables.map((v, idx) => (
                        <li key={idx}>
                          <MathText text={`$${v.symbol}$`} className="font-semibold" />{" "}
                          : <MathText text={v.meaning_ja} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Reference List Section (P105) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">
          主要参考文献・関連論文ガイド
        </h2>

        {data.fullTextStatus === "license_restricted" ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-4 text-xs text-slate-700">
            ライセンス条件により本文から抽出した参考文献ガイドは表示できません。
          </div>
        ) : data.references.length === 0 ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            現在この版の主要参考文献ガイドは登録されていません。
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.references.map((ref) => (
              <li
                key={ref.ref_id}
                className="rounded-lg border border-slate-200 bg-slate-50/60 p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900">
                    [{ref.ref_id}] {ref.title}{" "}
                    {ref.year ? `(${ref.year})` : ""}
                  </p>
                  {ref.url && (
                    <a
                      href={ref.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                    >
                      <span>参照リンク</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">著者: {ref.authors}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-700">
                  本研究での位置づけ: {ref.role_ja}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Full Text Translation Policy Section (P105 / ARC005) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">
          全文翻訳・本文の取り扱いについて
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          {data.fullTextTranslation.reason}
        </p>
      </section>
    </div>
  );
}
