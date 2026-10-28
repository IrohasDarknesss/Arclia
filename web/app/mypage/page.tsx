"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Bookmark,
  CheckCircle2,
  Clock,
  Plus,
  RefreshCw,
  Trash2,
  User,
} from "lucide-react";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api/client";
import {
  CATEGORY_LABELS_JA,
  DEFAULT_TARGET_CATEGORIES,
} from "@/lib/server/arxiv/categories";
import {
  formatDateTimeJst,
  formatPlanLabel,
  formatSubscriptionStatusLabel,
} from "@/lib/format/display";
import { PaperCard, PaperCardItem } from "@/components/common/PaperCard";

interface InterestItem {
  topic: string;
  weight: number;
}

interface PaginatedPapersResponse {
  items: PaperCardItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
  };
}

interface NotificationSettingsResponse {
  digestEnabled: boolean;
  updatedAt: string | null;
}

function MyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutParam = searchParams.get("checkout");

  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    refreshProfile,
    signOut,
  } = useAuthSession();

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. Interests state (F06)
  const [savedInterests, setSavedInterests] = useState<InterestItem[]>([]);
  const [draftInterests, setDraftInterests] = useState<InterestItem[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
  const [interestsLoading, setInterestsLoading] = useState(true);
  const [interestsSaving, setInterestsSaving] = useState(false);
  const [interestsError, setInterestsError] = useState<string | null>(null);

  // 2. Bookmarks state (F07)
  const [bookmarksData, setBookmarksData] =
    useState<PaginatedPapersResponse | null>(null);
  const [bookmarksPage, setBookmarksPage] = useState(1);
  const [bookmarksLoading, setBookmarksLoading] = useState(true);
  const [bookmarksError, setBookmarksError] = useState<string | null>(null);

  // 3. View History state (F15)
  const [historyData, setHistoryData] =
    useState<PaginatedPapersResponse | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // 4. Notification Settings state (F10)
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  // 5. Account Deletion modal state (F16)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const isInterestsDirty = useMemo(() => {
    if (savedInterests.length !== draftInterests.length) return true;
    const norm = (arr: InterestItem[]) =>
      [...arr]
        .map((x) => `${x.topic}:${x.weight}`)
        .sort()
        .join("|");
    return norm(savedInterests) !== norm(draftInterests);
  }, [savedInterests, draftInterests]);

  useUnsavedChangesGuard(isInterestsDirty);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace("/login?next=/mypage");
    }
  }, [authLoading, isAuthenticated, router]);

  const loadInterests = useCallback(async () => {
    setInterestsLoading(true);
    setInterestsError(null);
    try {
      const res = await apiFetch<{ interests: InterestItem[] }>(
        "/api/me/interests",
      );
      setSavedInterests(res.interests);
      setDraftInterests(res.interests);
    } catch (err) {
      setInterestsError(
        err instanceof Error
          ? err.message
          : "興味トピックの読み込みに失敗しました。",
      );
    } finally {
      setInterestsLoading(false);
    }
  }, []);

  const loadBookmarks = useCallback(async (page = 1) => {
    setBookmarksLoading(true);
    setBookmarksError(null);
    try {
      const res = await apiFetch<PaginatedPapersResponse>(
        `/api/bookmarks?page=${page}&limit=20`,
      );
      setBookmarksData(res);
      setBookmarksPage(page);
    } catch (err) {
      setBookmarksError(
        err instanceof Error
          ? err.message
          : "ブックマーク一覧の読み込みに失敗しました。",
      );
    } finally {
      setBookmarksLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (page = 1) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await apiFetch<PaginatedPapersResponse>(
        `/api/me/history?page=${page}&limit=20`,
      );
      setHistoryData(res);
      setHistoryPage(page);
    } catch (err) {
      setHistoryError(
        err instanceof Error
          ? err.message
          : "閲覧履歴の読み込みに失敗しました。",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadNotificationSettings = useCallback(async () => {
    setNotifLoading(true);
    setNotifError(null);
    try {
      const res = await apiFetch<NotificationSettingsResponse>(
        "/api/me/notification-settings",
      );
      setDigestEnabled(res.digestEnabled);
    } catch (err) {
      setNotifError(
        err instanceof Error
          ? err.message
          : "通知設定の読み込みに失敗しました。",
      );
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadInterests();
      loadBookmarks(1);
      loadHistory(1);
      loadNotificationSettings();
    }
  }, [
    isAuthenticated,
    loadInterests,
    loadBookmarks,
    loadHistory,
    loadNotificationSettings,
  ]);

  const handleToggleCategoryTopic = (cat: string) => {
    setDraftInterests((prev) => {
      if (prev.some((i) => i.topic === cat)) {
        return prev.filter((i) => i.topic !== cat);
      }
      if (prev.length >= 20) {
        setInterestsError("興味トピックは最大20件まで登録できます。");
        return prev;
      }
      setInterestsError(null);
      return [...prev, { topic: cat, weight: 1.0 }];
    });
  };

  const handleAddKeywordTopic = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newKeyword.trim();
    if (!trimmed) return;
    if (trimmed.length > 128) {
      setInterestsError("キーワードは128文字以内で入力してください。");
      return;
    }
    if (draftInterests.some((i) => i.topic === trimmed)) {
      setInterestsError(`「${trimmed}」はすでに追加されています。`);
      return;
    }
    if (draftInterests.length >= 20) {
      setInterestsError("興味トピックは最大20件まで登録できます。");
      return;
    }
    setInterestsError(null);
    setDraftInterests([...draftInterests, { topic: trimmed, weight: 1.0 }]);
    setNewKeyword("");
  };

  const handleRemoveTopic = (topic: string) => {
    setDraftInterests((prev) => prev.filter((i) => i.topic !== topic));
  };

  const handleSaveInterests = async () => {
    setInterestsSaving(true);
    setInterestsError(null);
    try {
      const res = await apiFetch<{ interests: InterestItem[] }>(
        "/api/me/interests",
        {
          method: "PUT",
          body: JSON.stringify({ interests: draftInterests }),
        },
      );
      setSavedInterests(res.interests);
      setDraftInterests(res.interests);
      showToast("興味トピック設定を保存しました。");
    } catch (err) {
      setInterestsError(
        err instanceof Error
          ? err.message
          : "興味トピックの保存に失敗しました。",
      );
    } finally {
      setInterestsSaving(false);
    }
  };

  const handleRemoveBookmark = async (arxivId: string) => {
    try {
      await apiFetch<void>(`/api/bookmarks/${encodeURIComponent(arxivId)}`, {
        method: "DELETE",
      });
      showToast("ブックマークを解除しました。");
      loadBookmarks(bookmarksPage);
    } catch (err) {
      showToast(
        err instanceof Error
          ? err.message
          : "ブックマークの解除に失敗しました。",
      );
    }
  };

  const handleToggleDigest = async (nextVal: boolean) => {
    setNotifSaving(true);
    setNotifError(null);
    try {
      const res = await apiFetch<NotificationSettingsResponse>(
        "/api/me/notification-settings",
        {
          method: "PUT",
          body: JSON.stringify({ digestEnabled: nextVal }),
        },
      );
      setDigestEnabled(res.digestEnabled);
      showToast(
        res.digestEnabled
          ? "新着ダイジェスト配信をONにしました。"
          : "新着ダイジェスト配信をOFFにしました。",
      );
    } catch (err) {
      setNotifError(
        err instanceof Error ? err.message : "通知設定の更新に失敗しました。",
      );
    } finally {
      setNotifSaving(false);
    }
  };

  const handleConfirmWithdraw = async () => {
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await apiFetch<void>("/api/me", { method: "DELETE" });
      await signOut();
      router.replace("/");
    } catch (err) {
      setWithdrawError(
        err instanceof Error ? err.message : "退会処理に失敗しました。",
      );
      setWithdrawing(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        マイページを読み込んでいます...
      </div>
    );
  }

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

      {/* Checkout Complete Notice (P106) */}
      {checkoutParam === "success" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>
              Stripeでの決済手続きが完了しました。契約状態の反映まで数秒かかる場合があります。
            </span>
          </div>
          <button
            type="button"
            onClick={refreshProfile}
            className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            最新の契約状態を再取得
          </button>
        </div>
      )}

      {/* Account Summary Section (P106) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                アカウント・プラン情報
              </h1>
              <p className="text-xs text-slate-500">
                メールアドレス: {user.email || "未設定"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              await signOut();
              router.push("/");
            }}
            className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            ログアウト
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">現在のプラン</p>
            <p className="mt-0.5 text-sm font-bold text-slate-900">
              {formatPlanLabel(user.plan)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">定期課金ステータス</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-800">
              {formatSubscriptionStatusLabel(user.subscription?.status)}
            </p>
          </div>
          <div className="flex items-center sm:justify-end">
            <Link
              href="/pricing"
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              {user.plan === "pro"
                ? "契約内容・解約の確認へ"
                : "Proプランへアップグレード"}
            </Link>
          </div>
        </div>
      </section>

      {/* Interest Settings Section (P106 / F06) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              興味トピック設定 ({draftInterests.length}/20件)
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              選択した分野コードおよびキーワードをもとに、ホーム画面の推薦と日次ダイジェストをパーソナライズします。
            </p>
          </div>
          {isInterestsDirty && (
            <span className="rounded bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              未保存の変更があります
            </span>
          )}
        </div>

        {interestsLoading ? (
          <div className="py-6 text-center text-xs text-slate-500">
            興味トピックを読み込んでいます...
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-700">
                主要分野から選択:
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DEFAULT_TARGET_CATEGORIES.map((cat) => {
                  const selected = draftInterests.some((i) => i.topic === cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleToggleCategoryTopic(cat)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {CATEGORY_LABELS_JA[cat] || cat}
                    </button>
                  );
                })}
              </div>
            </div>

            <form
              onSubmit={handleAddKeywordTopic}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                maxLength={128}
                placeholder="自由キーワードを追加 (例: Diffusion, RAG, Multimodal)..."
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
                キーワード追加
              </button>
            </form>

            {draftInterests.length > 0 && (
              <div className="flex flex-wrap gap-2 rounded-lg bg-slate-50 p-3">
                {draftInterests.map((item) => (
                  <span
                    key={item.topic}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-800"
                  >
                    <span>{CATEGORY_LABELS_JA[item.topic] || item.topic}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTopic(item.topic)}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`${item.topic}を削除`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {interestsError && (
              <p className="text-xs font-medium text-red-600" role="alert">
                {interestsError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              {isInterestsDirty && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftInterests(savedInterests);
                    setInterestsError(null);
                  }}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  変更を破棄
                </button>
              )}
              <button
                type="button"
                disabled={!isInterestsDirty || interestsSaving}
                onClick={handleSaveInterests}
                className="rounded-md bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {interestsSaving ? "保存中..." : "興味トピックを保存"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Notification Settings Section (P106 / F10) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-5 w-5 text-blue-600" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                新着ダイジェスト配信設定
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                興味トピックに一致する新着論文（最大5件）を毎朝メールでお届けします。
              </p>
            </div>
          </div>

          {!notifLoading && (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={digestEnabled}
                disabled={notifSaving}
                onChange={(e) => handleToggleDigest(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs font-semibold text-slate-800">
                {digestEnabled ? "配信ON" : "配信OFF"}
              </span>
            </label>
          )}
        </div>
        {notifError && (
          <p className="mt-2 text-xs font-medium text-red-600">{notifError}</p>
        )}
      </section>

      {/* Bookmarks List Section (P106 / F07) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Bookmark className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">
            保存したブックマーク一覧{" "}
            {bookmarksData ? `(${bookmarksData.pagination.total}件)` : ""}
          </h2>
        </div>

        <div className="mt-4">
          {bookmarksLoading ? (
            <p className="py-6 text-center text-xs text-slate-500">
              ブックマークを読み込んでいます...
            </p>
          ) : bookmarksError ? (
            <div className="rounded border border-red-200 bg-red-50 p-4 text-xs text-red-700">
              <p>{bookmarksError}</p>
              <button
                type="button"
                onClick={() => loadBookmarks(bookmarksPage)}
                className="mt-2 rounded border border-red-300 bg-white px-3 py-1 font-semibold"
              >
                再試行
              </button>
            </div>
          ) : !bookmarksData || bookmarksData.items.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              保存されているブックマークはありません。
            </p>
          ) : (
            <div className="space-y-4">
              {bookmarksData.items.map((paper) => (
                <PaperCard
                  key={paper.arxivId}
                  paper={paper}
                  actionSlot={
                    <button
                      type="button"
                      onClick={() => handleRemoveBookmark(paper.arxivId)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>解除</span>
                    </button>
                  }
                />
              ))}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={bookmarksPage <= 1}
                  onClick={() => loadBookmarks(bookmarksPage - 1)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  ← 前へ
                </button>
                <span className="text-xs text-slate-500">
                  ページ {bookmarksPage}
                </span>
                <button
                  type="button"
                  disabled={!bookmarksData.pagination.hasNext}
                  onClick={() => loadBookmarks(bookmarksPage + 1)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  次へ →
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* View History Section (P106 / F15) */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-bold text-slate-900">
            最近の閲覧履歴{" "}
            {historyData ? `(${historyData.pagination.total}件)` : ""}
          </h2>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          閲覧履歴は最大180日間保持されます。
        </p>

        <div className="mt-4">
          {historyLoading ? (
            <p className="py-6 text-center text-xs text-slate-500">
              閲覧履歴を読み込んでいます...
            </p>
          ) : historyError ? (
            <div className="rounded border border-red-200 bg-red-50 p-4 text-xs text-red-700">
              <p>{historyError}</p>
              <button
                type="button"
                onClick={() => loadHistory(historyPage)}
                className="mt-2 rounded border border-red-300 bg-white px-3 py-1 font-semibold"
              >
                再試行
              </button>
            </div>
          ) : !historyData || historyData.items.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              閲覧履歴はまだありません。
            </p>
          ) : (
            <div className="space-y-4">
              {historyData.items.map((paper) => (
                <PaperCard key={paper.arxivId} paper={paper} />
              ))}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={historyPage <= 1}
                  onClick={() => loadHistory(historyPage - 1)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  ← 前へ
                </button>
                <span className="text-xs text-slate-500">
                  ページ {historyPage}
                </span>
                <button
                  type="button"
                  disabled={!historyData.pagination.hasNext}
                  onClick={() => loadHistory(historyPage + 1)}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  次へ →
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Account Deletion Section (P106 / F16 / ARC010) */}
      <section className="rounded-xl border border-red-200 bg-red-50/40 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-red-900">
              アカウント削除（退会）
            </h2>
            <p className="mt-1 text-xs text-red-800">
              退会すると、興味トピック・ブックマーク・閲覧履歴・通知設定・定期課金契約がすべて即座に削除されます。この操作は元に戻せません。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setWithdrawModalOpen(true)}
            className="rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            退会手続きへ
          </button>
        </div>
      </section>

      {/* Withdraw Confirm Modal Dialog (P106) */}
      {withdrawModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="withdraw-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              <h3 id="withdraw-dialog-title" className="text-base font-bold">
                本当に退会（アカウント削除）しますか？
              </h3>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              退会を実行すると、有効なProプラン契約がある場合は即時に解約され、保存したブックマーク・興味トピック・閲覧履歴を含む全データが完全に消去されます。
            </p>
            {withdrawError && (
              <p className="mt-2 text-xs font-medium text-red-600">
                {withdrawError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={withdrawing}
                onClick={() => setWithdrawModalOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={withdrawing}
                onClick={handleConfirmWithdraw}
                className="rounded-md bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {withdrawing ? "削除中..." : "アカウントを完全に削除する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          読み込み中...
        </div>
      }
    >
      <MyPageContent />
    </Suspense>
  );
}
