"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Check, Loader2, Menu, RefreshCw, Sparkles, User, X } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";

const NAV_ITEMS = [
  { href: "/", label: "ホーム" },
  { href: "/papers", label: "新着論文" },
  { href: "/search", label: "論文検索・比較" },
  { href: "/pricing", label: "料金プラン" },
];

export function AppHeader() {
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading } = useAuthSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleSyncLatest = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/papers/sync", { method: "POST" });
      const data = await res.json();
      if (data.status === "success") {
        setSyncMessage(`同期完了: 計${data.data?.totalPapers || 0}本`);
        setTimeout(() => {
          setSyncMessage(null);
          window.location.reload();
        }, 1200);
      } else {
        setSyncMessage("同期失敗");
        setTimeout(() => setSyncMessage(null), 2500);
      }
    } catch {
      setSyncMessage("通信エラー");
      setTimeout(() => setSyncMessage(null), 2500);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 group"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-sm shadow-indigo-500/20 transition-transform group-hover:scale-105">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-900 bg-clip-text text-xl font-extrabold tracking-tight text-transparent">
                Arclia
              </span>
              <span className="hidden -mt-1 text-[10px] font-medium text-slate-500 sm:inline-block">
                arXiv日本語研究ダイジェスト
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1.5 md:flex" aria-label="メインナビゲーション">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700 shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {/* Quick arXiv Sync button */}
          <button
            type="button"
            onClick={handleSyncLatest}
            disabled={isSyncing}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-100 disabled:opacity-60"
            title="arXivから最新論文を同期取得"
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
            ) : syncMessage ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
            )}
            <span>{syncMessage || (isSyncing ? "同期中..." : "最新同期")}</span>
          </button>

          {!isLoading && isAuthenticated ? (
            <Link
              href="/mypage"
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <User className="h-4 w-4 text-slate-500" />
              <span>マイページ</span>
              {user?.plan === "pro" && (
                <span className="ml-1 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                  PRO
                </span>
              )}
            </Link>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(pathname || "/")}`}
              className="inline-flex items-center rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 hover:from-indigo-700 hover:to-blue-700"
            >
              ログイン
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
          aria-label="メニューを開く"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="pt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={handleSyncLatest}
                disabled={isSyncing}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-2 text-sm font-semibold text-slate-700"
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin text-indigo-600" : ""}`} />
                <span>{isSyncing ? "arXiv同期中..." : "arXivから最新同期"}</span>
              </button>
              {isAuthenticated ? (
                <Link
                  href="/mypage"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-lg bg-slate-100 px-3 py-2 text-center text-sm font-semibold text-slate-800"
                >
                  マイページ {user?.plan === "pro" ? "(PRO)" : ""}
                </Link>
              ) : (
                <Link
                  href={`/login?next=${encodeURIComponent(pathname || "/")}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-lg bg-indigo-600 px-3 py-2 text-center text-sm font-semibold text-white"
                >
                  ログイン
                </Link>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
