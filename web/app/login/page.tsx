"use client";

import React, { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api/client";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const sb = getSupabaseBrowserClient();
    if (!sb) {
      setError(
        "Supabase環境変数（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）が設定されていません。",
      );
      return;
    }

    setLoading(true);
    try {
      if (mode === "signin") {
        const { error: signInErr } = await sb.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr) throw signInErr;
      } else {
        const { data, error: signUpErr } = await sb.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpErr) throw signUpErr;
        if (!data.session) {
          setInfoMessage(
            "確認メールを送信しました。メール内のリンクをクリックして登録を完了してください。",
          );
          setLoading(false);
          return;
        }
      }

      // Initialize user row in T005 `users` via POST /api/me (BE.F06)
      await apiFetch("/api/me", { method: "POST" });
      const safeNext = nextPath.startsWith("/") ? nextPath : "/";
      router.push(safeNext);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "認証処理に失敗しました。",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-bold text-slate-900">
          {mode === "signin" ? "ログイン" : "新規アカウント登録"}
        </h1>
        <p className="mt-1 text-xs text-slate-600">
          興味トピックの保存、パーソナライズ推薦、ブックマーク、Proプラン機能をご利用いただけます。
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="auth-email"
              className="block text-xs font-semibold text-slate-700"
            >
              メールアドレス
            </label>
            <input
              id="auth-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="block text-xs font-semibold text-slate-700"
            >
              パスワード（6文字以上）
            </label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && (
            <p className="text-xs font-medium text-red-600" role="alert">
              {error}
            </p>
          )}
          {infoMessage && (
            <p className="text-xs font-medium text-emerald-700" role="status">
              {infoMessage}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading
              ? "処理中..."
              : mode === "signin"
                ? "ログインする"
                : "アカウントを作成する"}
          </button>
        </form>

        <div className="mt-5 border-t border-slate-100 pt-4 text-center text-xs text-slate-600">
          {mode === "signin" ? (
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
              className="font-semibold text-blue-600 hover:underline"
            >
              アカウントをお持ちでない方は新規登録へ
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
              }}
              className="font-semibold text-blue-600 hover:underline"
            >
              すでにアカウントをお持ちの方はログインへ
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="py-10 text-center text-sm text-slate-500">
          読み込み中...
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
