"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Info, RefreshCw, Sparkles, X } from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { apiFetch } from "@/lib/api/client";
import {
  FREE_PLAN_FEATURES,
  PRICING_NOTES,
  PRO_PLAN_FEATURES,
  PRO_PRICE_MONTHLY_YEN,
} from "@/lib/pricing/planCatalog";
import {
  formatDateTimeJst,
  formatPriceYen,
  formatSubscriptionStatusLabel,
} from "@/lib/format/display";

interface SubscriptionApiResponse {
  plan: "free" | "pro";
  subscription: {
    stripeSubscriptionId: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}

function PricingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutCanceled = searchParams.get("checkout") === "canceled";

  const { isAuthenticated, isLoading: authLoading } = useAuthSession();

  const [subData, setSubData] = useState<SubscriptionApiResponse | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  const [checkoutPending, setCheckoutPending] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loadSubscription = useCallback(async () => {
    if (!isAuthenticated) {
      setSubData(null);
      return;
    }
    setSubLoading(true);
    setSubError(null);
    try {
      const res = await apiFetch<SubscriptionApiResponse>(
        "/api/billing/subscription",
      );
      setSubData(res);
    } catch (err) {
      setSubError(
        err instanceof Error
          ? err.message
          : "契約状態の読み込みに失敗しました。",
      );
    } finally {
      setSubLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authLoading) {
      loadSubscription();
    }
  }, [authLoading, loadSubscription]);

  const handleSubscribeClick = async () => {
    if (!isAuthenticated) {
      router.push("/login?next=/pricing");
      return;
    }
    if (checkoutPending) return;

    setCheckoutPending(true);
    try {
      const res = await apiFetch<{ checkoutUrl: string }>(
        "/api/billing/checkout",
        { method: "POST" },
      );
      window.location.assign(res.checkoutUrl);
    } catch (err) {
      setCheckoutPending(false);
      showToast(
        err instanceof Error
          ? err.message
          : "決済ページの準備に失敗しました。",
      );
    }
  };

  const handleConfirmCancel = async () => {
    setCancelPending(true);
    try {
      const res = await apiFetch<SubscriptionApiResponse>(
        "/api/billing/subscription/cancel",
        { method: "POST" },
      );
      setSubData(res);
      setCancelModalOpen(false);
      showToast(
        "解約予約を受け付けました。現在の請求期間の末日までPro機能をご利用いただけます。",
      );
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "解約手続きに失敗しました。",
      );
    } finally {
      setCancelPending(false);
    }
  };

  const currentPlan = subData?.plan || "free";
  const sub = subData?.subscription || null;
  const hasBillingHoldingSub =
    sub &&
    ["trialing", "active", "past_due", "unpaid", "paused"].includes(sub.status);

  return (
    <div className="space-y-10">
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-3 text-xs font-medium text-white shadow-lg"
        >
          {toastMessage}
        </div>
      )}

      {checkoutPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="rounded-xl bg-white p-6 text-center shadow-xl">
            <p className="text-sm font-bold text-slate-900">
              Stripeの決済画面へ移動しています...
            </p>
            <p className="mt-1 text-xs text-slate-500">
              そのまま少々お待ちください。
            </p>
          </div>
        </div>
      )}

      <div className="text-center">
        <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
          料金プラン・Proプランのお申し込み
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          日々の新着論文チェックと3段階要約は無料でご利用いただけます。さらに深い分析にはProプランをご活用ください。
        </p>
      </div>

      {/* Billing Notice (P107) */}
      {checkoutCanceled && (
        <div className="mx-auto max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-900">
          決済手続きがキャンセルされました（課金は発生していません）。いつでも再度お申し込みいただけます。
        </div>
      )}

      {subError && (
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <p>{subError}</p>
          <button
            type="button"
            onClick={loadSubscription}
            className="mt-2 inline-flex items-center gap-1 rounded border border-red-300 bg-white px-3 py-1 font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            再試行
          </button>
        </div>
      )}

      {/* Plan Comparison Cards (P107) */}
      <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
        {/* Free Plan Card */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                無料プラン (Free)
              </h2>
              {isAuthenticated && currentPlan === "free" && (
                <span className="rounded bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                  現在のプラン
                </span>
              )}
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              {formatPriceYen(0)}
              <span className="text-xs font-normal text-slate-500"> / 月</span>
            </p>
            <p className="mt-2 text-xs text-slate-600">
              新着論文の日本語要約・根拠確認・推薦・ブックマークを無料で利用できます。
            </p>

            <ul className="mt-6 space-y-3 text-xs">
              {FREE_PLAN_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2">
                  {f.included ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                  )}
                  <span
                    className={
                      f.included ? "text-slate-700" : "text-slate-400"
                    }
                  >
                    {f.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8">
            <button
              type="button"
              disabled
              className="w-full rounded-lg border border-slate-200 bg-slate-100 py-2.5 text-xs font-semibold text-slate-500"
            >
              {isAuthenticated && currentPlan === "free"
                ? "現在ご利用中"
                : "基本プラン（無料）"}
            </button>
          </div>
        </section>

        {/* Pro Plan Card */}
        <section className="flex flex-col justify-between rounded-2xl border-2 border-blue-600 bg-white p-6 shadow-md">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-900">
                  Proプラン (有料)
                </h2>
              </div>
              {isAuthenticated && currentPlan === "pro" && (
                <span className="rounded bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  契約中
                </span>
              )}
            </div>
            <p className="mt-3 text-3xl font-extrabold text-slate-900">
              {formatPriceYen(PRO_PRICE_MONTHLY_YEN)}
              <span className="text-xs font-normal text-slate-500">
                {" "}
                / 月（税込）
              </span>
            </p>
            <p className="mt-2 text-xs text-slate-600">
              論文に対するAI質問応答と複数論文の横断比較で、サーベイや研究調査を加速します。
            </p>

            <ul className="mt-6 space-y-3 text-xs">
              {PRO_PLAN_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                  <span className="font-medium text-slate-800">{f.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8">
            {!isAuthenticated ? (
              <button
                type="button"
                onClick={handleSubscribeClick}
                className="w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                ログインしてProプランに申し込む
              </button>
            ) : subLoading ? (
              <button
                type="button"
                disabled
                className="w-full rounded-lg bg-slate-200 py-2.5 text-xs font-semibold text-slate-600"
              >
                契約状態を確認中...
              </button>
            ) : currentPlan === "pro" || hasBillingHoldingSub ? (
              <button
                type="button"
                disabled
                className="w-full rounded-lg bg-blue-100 py-2.5 text-xs font-semibold text-blue-800"
              >
                {sub?.cancelAtPeriodEnd
                  ? "解約予約済み（期間末まで利用可能）"
                  : "現在ご契約中"}
              </button>
            ) : (
              <button
                type="button"
                disabled={checkoutPending}
                onClick={handleSubscribeClick}
                className="w-full rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                Proプランに申し込む（Stripe決済へ）
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Subscription Management Section (P107) */}
      {isAuthenticated && sub && (
        <section className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">
            現在の定期課金契約の管理
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 text-xs sm:grid-cols-3">
            <div>
              <span className="text-slate-500">契約ステータス:</span>
              <p className="mt-0.5 font-semibold text-slate-900">
                {formatSubscriptionStatusLabel(
                  sub.status,
                  sub.cancelAtPeriodEnd,
                )}
              </p>
            </div>
            <div>
              <span className="text-slate-500">現在の請求期間終了日:</span>
              <p className="mt-0.5 font-semibold text-slate-900">
                {formatDateTimeJst(sub.currentPeriodEnd)}
              </p>
            </div>
            <div className="flex items-center sm:justify-end">
              {hasBillingHoldingSub && !sub.cancelAtPeriodEnd && (
                <button
                  type="button"
                  onClick={() => setCancelModalOpen(true)}
                  className="rounded-md border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  Proプランの解約を予約する
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Pricing Notes Section (P107) */}
      <section className="mx-auto max-w-4xl rounded-xl border border-slate-200 bg-slate-100/70 p-6">
        <div className="flex items-center gap-2 text-slate-800">
          <Info className="h-4 w-4 text-slate-600" />
          <h2 className="text-sm font-bold">ご利用・課金に関する注意事項</h2>
        </div>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-slate-600">
          {PRICING_NOTES.map((note, idx) => (
            <li key={idx}>{note}</li>
          ))}
        </ul>
      </section>

      {/* Cancel Confirm Dialog (P107) */}
      {cancelModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-sub-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3
              id="cancel-sub-title"
              className="text-base font-bold text-slate-900"
            >
              Proプランの解約を予約しますか？
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              解約予約を行っても、現在の請求期間の終了日（
              {formatDateTimeJst(sub?.currentPeriodEnd)}
              ）まではProプランの全機能を引き続きご利用いただけます。次回以降の請求は発生しません。
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={cancelPending}
                onClick={() => setCancelModalOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                戻る
              </button>
              <button
                type="button"
                disabled={cancelPending}
                onClick={handleConfirmCancel}
                className="rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelPending ? "処理中..." : "解約を予約する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          読み込み中...
        </div>
      }
    >
      <PricingPageContent />
    </Suspense>
  );
}
