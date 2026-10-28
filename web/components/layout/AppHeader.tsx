"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Menu, User, X } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";

const NAV_ITEMS = [
  { href: "/", label: "ホーム" },
  { href: "/papers", label: "新着論文" },
  { href: "/search", label: "論文検索" },
  { href: "/pricing", label: "料金プラン" },
];

export function AppHeader() {
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading } = useAuthSession();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900"
          >
            <BookOpen className="h-5 w-5 text-blue-600" />
            <span>Arclia</span>
            <span className="hidden rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 sm:inline-block">
              arXiv日本語研究ダイジェスト
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="メインナビゲーション">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-700"
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
          {!isLoading && isAuthenticated ? (
            <Link
              href="/mypage"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <User className="h-4 w-4 text-slate-500" />
              <span>マイページ</span>
              {user?.plan === "pro" && (
                <span className="ml-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                  PRO
                </span>
              )}
            </Link>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(pathname || "/")}`}
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              ログイン
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          className="inline-flex items-center justify-center rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
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
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <div className="pt-2">
              {isAuthenticated ? (
                <Link
                  href="/mypage"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-md bg-slate-100 px-3 py-2 text-center text-sm font-medium text-slate-800"
                >
                  マイページ {user?.plan === "pro" ? "(PRO)" : ""}
                </Link>
              ) : (
                <Link
                  href={`/login?next=${encodeURIComponent(pathname || "/")}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white"
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
