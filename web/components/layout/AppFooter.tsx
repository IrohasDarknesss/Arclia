import React from "react";
import Link from "next/link";

export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50 text-slate-600">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              Arclia — arXiv日本語研究ダイジェスト
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Thank you to arXiv for use of its open access interoperability.
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              This service is not affiliated with, endorsed by, or sponsored by
              arXiv or Cornell University.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
            <Link href="/papers" className="hover:text-slate-900 hover:underline">
              新着論文
            </Link>
            <Link href="/search" className="hover:text-slate-900 hover:underline">
              論文検索
            </Link>
            <Link href="/pricing" className="hover:text-slate-900 hover:underline">
              料金プラン
            </Link>
            <Link href="/terms" className="hover:text-slate-900 hover:underline">
              利用規約
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
