# Arclia — arXiv日本語研究ダイジェスト Webアプリ

arXivの最新研究論文（AI・機械学習・自然言語処理・コンピュータビジョン・ロボティクス・情報検索・統計的機械学習など）を収集し、**30秒要点 (`short`) / 3分要約 (`standard`) / 10分解説 (`deep`)** の3段階の構造化日本語要約と、主張ごとの原文根拠箇所（節・ページ・参照URL）を提供する研究ダイジェストWebアプリケーションです。

---

## ディレクトリ構成

```
arxiv-digest-web/
├── .env.example                                  # 環境変数設定例（基本設計書 §9 全41項目）
├── supabase/
│   ├── migrations/
│   │   └── 20261027000001_initial_schema.sql     # T001〜T010 + 補助5テーブル・トリガー・RLS定義
│   └── seed.sql                                  # 開発・動作確認用サンプルデータ
├── web/                                          # Next.js (App Router + TypeScript + Tailwind CSS + KaTeX)
│   ├── app/
│   │   ├── page.tsx                              # P101 ホーム
│   │   ├── papers/page.tsx                       # P102 新着論文一覧（+ Pro論文比較 F11）
│   │   ├── search/page.tsx                       # P103 論文検索（+ B006オンデマンド同期）
│   │   ├── papers/[arxivId]/page.tsx             # P104 論文詳細・日本語要約（+ Pro AI質問応答 F09 / GitHub連携 F14）
│   │   ├── papers/[arxivId]/appendix/page.tsx    # P105 論文補足・数式解説・参考文献
│   │   ├── mypage/page.tsx                       # P106 マイページ（興味トピック・ブックマーク・履歴・通知・退会）
│   │   ├── pricing/page.tsx                      # P107 料金プラン・購読申込（Stripe連携 F12）
│   │   ├── login/page.tsx                        # Supabase Auth ログイン・新規登録
│   │   ├── terms/page.tsx                        # 利用規約・arXiv免責表示
│   │   └── api/                                  # 全20エンドポイント（F01〜F18）
│   ├── components/                               # 共通レイアウト・論文カード・KaTeX数式描画
│   ├── hooks/                                    # 認証セッション・未保存変更ガード
│   └── lib/                                      # DB接続・Redis・Stripe・LLM・ライセンスゲート・推薦スコア計算
├── worker/                                       # Python 非同期ジョブワーカー・定期バッチ・運用CLI
│   ├── main.py                                   # キュー購読ワーカーループ & スケジュール起動エントリ
│   ├── jobs/                                     # B001〜B009, B011, F15保持期間削除バッチ
│   ├── ops/                                      # B010 失敗ジョブ再処理CLI / F19 コスト・運用メトリクスCLI
│   ├── summary/                                  # ARC001 版間再利用 / ARC003 スキーマ検証 / ARC004 5観点検証
│   ├── license/                                  # ARC005 ライセンスゲート
│   └── tests/                                    # ユニットテスト (pytest)
└── docs/                                         # 基本設計書・詳細設計書一式
```

---

## セットアップ手順

### 1. 環境変数の設定

`.env.example` をコピーして `.env`（および `web/.env.local`）を作成し、接続先を設定します。

```bash
cp .env.example .env
cp .env.example web/.env.local
```

### 2. データベースマイグレーション

PostgreSQL（Supabase）に対して `supabase/migrations/20261027000001_initial_schema.sql` を適用します。

```bash
psql "$DATABASE_URL" -f supabase/migrations/20261027000001_initial_schema.sql
psql "$DATABASE_URL" -f supabase/seed.sql
```

### 3. Next.js Webアプリ（フロントエンド & API）の起動

```bash
cd web
npm install
npm run dev
```

本番ビルドおよび型チェック:

```bash
cd web
npm run typecheck
npm run build
```

### 4. Python ワーカー & 運用CLIの実行

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r worker/requirements.txt

# ワーカーループの起動（全キュー購読）
python -m worker.main

# 定期バッチの単発起動（cron等から呼び出し）
python -m worker.main --schedule collect_metadata      # B001 arXivメタデータ収集
python -m worker.main --schedule analyze_full_text     # B005 本文PDF解析候補登録
python -m worker.main --schedule link_github           # B009 GitHub関連付け候補登録
python -m worker.main --schedule digest_delivery       # B007 日次メールダイジェスト配信
python -m worker.main --schedule view_events_retention # F15 閲覧イベント180日保持削除

# B010 失敗ジョブ一覧表示・再処理CLI
python -m worker.ops.reprocess_failed --list
python -m worker.ops.reprocess_failed --job-type summarize_abstract --all-failed --execute

# F19 コスト・運用メトリクスレポートCLI
python -m worker.ops.metrics_report --from 2026-10-20 --to 2026-10-27 --format table
```

---

## ライセンス・免責事項

- Thank you to arXiv for use of its open access interoperability.
- This service is not affiliated with, endorsed by, or sponsored by arXiv or Cornell University.
