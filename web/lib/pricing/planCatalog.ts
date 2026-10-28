export const PRO_PRICE_MONTHLY_YEN = 980;

export interface PlanFeatureItem {
  label: string;
  included: boolean;
  note?: string;
}

export const FREE_PLAN_FEATURES: PlanFeatureItem[] = [
  { label: "新着論文一覧・分野別ブラウジング・自由検索", included: true },
  {
    label: "3段階の構造化日本語要約（30秒要点 / 3分要約 / 10分解説）",
    included: true,
  },
  { label: "主張ごとの根拠箇所（節・ページ・原文リンク）表示", included: true },
  { label: "数式・参考文献ガイド（補足ページ）", included: true },
  {
    label: "興味トピック設定・パーソナライズ推薦・ブックマーク保存",
    included: true,
  },
  { label: "日次メールダイジェスト通知", included: true },
  { label: "論文に対するAI質問応答（論文内Q&A）", included: false },
  { label: "複数論文（2〜5件）の横断比較テーブル生成", included: false },
];

export const PRO_PLAN_FEATURES: PlanFeatureItem[] = [
  { label: "無料プラン（Free）のすべての機能", included: true },
  {
    label: "論文に対するAI質問応答（月100回まで・根拠箇所明示）",
    included: true,
  },
  {
    label: "複数論文（2〜5件）の横断比較（課題・手法・結果・限界の4観点・月100回まで）",
    included: true,
  },
];

export const PRICING_NOTES: string[] = [
  "有料プラン（Pro）はStripeによる月次定期課金（サブスクリプション）です。",
  "Pro機能（AI質問応答・論文比較）はそれぞれ月間100回までご利用いただけます。利用回数は毎月1日 00:00 (JST) にリセットされます。",
  "解約手続きはいつでも行えます。解約予約後も現在の請求期間の末日まではPro機能を引き続きご利用いただけます。",
  "論文の本文解析（10分解説・数式解説）は、元論文のライセンスが改変・再配布を許諾しているもの（CC BY / CC BY-SA / CC0）に限り提供されます。",
];
