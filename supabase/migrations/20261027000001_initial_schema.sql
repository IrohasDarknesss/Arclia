-- ============================================================================
-- Arclia (arXiv日本語研究ダイジェスト Webアプリ)
-- Initial Database Migration (T001 - T010 + Auxiliary Tables & RLS)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- T001: papers (論文)
-- ============================================================================
CREATE TABLE papers (
  id             BIGINT       GENERATED ALWAYS AS IDENTITY,
  arxiv_id       VARCHAR(32)  NOT NULL,
  title          TEXT         NOT NULL,
  abstract       TEXT         NOT NULL,
  authors        JSONB        NOT NULL,
  categories     TEXT[]       NOT NULL,
  submitted_at   TIMESTAMPTZ  NOT NULL,
  updated_at     TIMESTAMPTZ,
  latest_version INTEGER      NOT NULL,
  original_url   TEXT         NOT NULL,
  CONSTRAINT pk_papers PRIMARY KEY (id),
  CONSTRAINT uq_papers_arxiv_id UNIQUE (arxiv_id),
  CONSTRAINT ck_papers_arxiv_id_format CHECK (
    arxiv_id ~ '^([0-9]{4}\.[0-9]{4,5}|[a-z-]+(\.[A-Za-z-]+)?/[0-9]{7})$'
  ),
  CONSTRAINT ck_papers_authors_array CHECK (
    jsonb_typeof(authors) = 'array' AND jsonb_array_length(authors) >= 1
  ),
  CONSTRAINT ck_papers_categories_not_empty CHECK (
    cardinality(categories) >= 1
  ),
  CONSTRAINT ck_papers_updated_after_submitted CHECK (
    updated_at IS NULL OR updated_at >= submitted_at
  ),
  CONSTRAINT ck_papers_latest_version_positive CHECK (
    latest_version >= 1
  )
);

CREATE INDEX idx_papers_submitted_at
  ON papers (submitted_at DESC, id DESC);

CREATE INDEX idx_papers_updated_at
  ON papers (updated_at DESC, id DESC);

CREATE INDEX idx_papers_categories
  ON papers USING GIN (categories);

CREATE INDEX idx_papers_authors
  ON papers USING GIN (authors jsonb_path_ops);

CREATE INDEX idx_papers_fulltext
  ON papers USING GIN (to_tsvector('english', title || ' ' || abstract));

COMMENT ON TABLE  papers                IS 'T001 論文（arXiv の論文単位の基本情報）';
COMMENT ON COLUMN papers.id             IS '論文ID（内部識別子）';
COMMENT ON COLUMN papers.arxiv_id       IS 'arXiv ID（版番号を含まない識別子。例: 2501.12345）';
COMMENT ON COLUMN papers.title          IS '原題（英語）';
COMMENT ON COLUMN papers.abstract       IS 'Abstract（英語の要旨）';
COMMENT ON COLUMN papers.authors        IS '著者一覧（JSON配列。[{name, affiliation}, ...]）';
COMMENT ON COLUMN papers.categories     IS '分野一覧（先頭が主分野。例: {cs.AI,cs.LG}）';
COMMENT ON COLUMN papers.submitted_at   IS '初版公開日時（UTC）';
COMMENT ON COLUMN papers.updated_at     IS '最終更新日時（UTC）';
COMMENT ON COLUMN papers.latest_version IS '最新バージョン番号（1以上の整数）';
COMMENT ON COLUMN papers.original_url   IS 'arXiv 原文ページの URL';

ALTER TABLE papers ENABLE ROW LEVEL SECURITY;

CREATE POLICY papers_select_public
  ON papers
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================================
-- T002: paper_versions (論文バージョン)
-- ============================================================================
CREATE TABLE paper_versions (
  id                BIGINT      GENERATED ALWAYS AS IDENTITY,
  paper_id          BIGINT      NOT NULL,
  version           INTEGER     NOT NULL,
  metadata_snapshot JSONB       NOT NULL,
  content_status    VARCHAR(32) NOT NULL DEFAULT 'abstract_only',
  license_type      VARCHAR(64),
  CONSTRAINT pk_paper_versions PRIMARY KEY (id),
  CONSTRAINT fk_paper_versions_paper_id FOREIGN KEY (paper_id)
    REFERENCES papers (id) ON DELETE RESTRICT,
  CONSTRAINT uq_paper_versions_paper_version UNIQUE (paper_id, version),
  CONSTRAINT ck_paper_versions_version_positive CHECK (version >= 1),
  CONSTRAINT ck_paper_versions_snapshot_object CHECK (
    jsonb_typeof(metadata_snapshot) = 'object'
  ),
  CONSTRAINT ck_paper_versions_content_status CHECK (
    content_status IN ('abstract_only', 'full_text')
  ),
  CONSTRAINT ck_paper_versions_full_text_requires_license CHECK (
    content_status = 'abstract_only' OR license_type IS NOT NULL
  )
);

CREATE INDEX idx_paper_versions_fetched_at
  ON paper_versions ((metadata_snapshot->>'fetched_at'));

COMMENT ON TABLE  paper_versions                   IS 'T002 論文バージョン（arXiv の v1/v2 等の版ごとの記録）';
COMMENT ON COLUMN paper_versions.id                IS '論文バージョンID（内部識別子）';
COMMENT ON COLUMN paper_versions.paper_id          IS '論文ID（papers.id への外部キー）';
COMMENT ON COLUMN paper_versions.version           IS 'バージョン番号（1以上の整数。v1 は 1）';
COMMENT ON COLUMN paper_versions.metadata_snapshot IS 'メタデータのスナップショット（その版時点の原題・Abstract・著者・分野・日時）';
COMMENT ON COLUMN paper_versions.content_status    IS '本文の取得状態（abstract_only: Abstractのみ / full_text: 本文解析済み）';
COMMENT ON COLUMN paper_versions.license_type      IS 'その版のライセンス種別（不明な場合は NULL。その際は再利用不可として扱う）';

ALTER TABLE paper_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY paper_versions_select_public
  ON paper_versions
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================================
-- T003: summaries (要約)
-- ============================================================================
CREATE TABLE summaries (
  id                BIGINT       GENERATED ALWAYS AS IDENTITY,
  paper_version_id  BIGINT       NOT NULL,
  summary_type      VARCHAR(16)  NOT NULL,
  language          VARCHAR(8)   NOT NULL DEFAULT 'ja',
  json_content      JSONB        NOT NULL,
  model_id          VARCHAR(128) NOT NULL,
  generated_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_scope      VARCHAR(32)  NOT NULL,
  validation_status VARCHAR(32)  NOT NULL DEFAULT 'pending',
  CONSTRAINT pk_summaries PRIMARY KEY (id),
  CONSTRAINT fk_summaries_paper_version_id FOREIGN KEY (paper_version_id)
    REFERENCES paper_versions (id) ON DELETE RESTRICT,
  CONSTRAINT ck_summaries_summary_type CHECK (
    summary_type IN ('short', 'standard', 'deep')
  ),
  CONSTRAINT ck_summaries_language CHECK (
    language IN ('ja')
  ),
  CONSTRAINT ck_summaries_json_content_object CHECK (
    jsonb_typeof(json_content) = 'object'
  ),
  CONSTRAINT ck_summaries_model_id_not_empty CHECK (
    btrim(model_id) <> ''
  ),
  CONSTRAINT ck_summaries_source_scope CHECK (
    source_scope IN ('abstract_only', 'full_text')
  ),
  CONSTRAINT ck_summaries_validation_status CHECK (
    validation_status IN ('pending', 'passed', 'failed')
  ),
  CONSTRAINT ck_summaries_deep_requires_full_text CHECK (
    summary_type <> 'deep' OR source_scope = 'full_text'
  )
);

CREATE INDEX idx_summaries_lookup
  ON summaries (paper_version_id, summary_type, language, generated_at DESC, id DESC);

CREATE INDEX idx_summaries_generated_at
  ON summaries (generated_at);

COMMENT ON TABLE  summaries                   IS 'T003 要約（版・深さごとの構造化日本語要約と検証状態）';
COMMENT ON COLUMN summaries.id                IS '要約ID（内部識別子）';
COMMENT ON COLUMN summaries.paper_version_id  IS '論文バージョンID（paper_versions.id への外部キー）';
COMMENT ON COLUMN summaries.summary_type      IS '要約の深さ（short: 30秒要点 / standard: 3分要約 / deep: 10分解説）';
COMMENT ON COLUMN summaries.language          IS '言語コード（現在は ja のみ）';
COMMENT ON COLUMN summaries.json_content      IS '構造化要約の本体（ARC003 で定義する共通 JSON 形式）';
COMMENT ON COLUMN summaries.model_id          IS '生成に使用した LLM のモデル識別子';
COMMENT ON COLUMN summaries.generated_at      IS '要約生成日時（UTC）';
COMMENT ON COLUMN summaries.source_scope      IS '生成根拠の範囲（abstract_only: Abstractベース / full_text: 本文含む）';
COMMENT ON COLUMN summaries.validation_status IS '検証状態（pending: 検証待ち / passed: 合格・公開可 / failed: 不合格・非公開）';

ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY summaries_select_passed
  ON summaries
  FOR SELECT
  TO anon, authenticated
  USING (validation_status = 'passed');

-- ============================================================================
-- T004: summary_citations (要約根拠)
-- ============================================================================
CREATE TABLE summary_citations (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY,
  summary_id     BIGINT      NOT NULL,
  claim_id       VARCHAR(64) NOT NULL,
  source_section TEXT,
  source_page    INTEGER,
  source_url     TEXT        NOT NULL,
  CONSTRAINT pk_summary_citations PRIMARY KEY (id),
  CONSTRAINT fk_summary_citations_summary_id FOREIGN KEY (summary_id)
    REFERENCES summaries (id) ON DELETE CASCADE,
  CONSTRAINT uq_summary_citations_summary_claim UNIQUE (summary_id, claim_id),
  CONSTRAINT ck_summary_citations_claim_id_not_empty CHECK (
    btrim(claim_id) <> ''
  ),
  CONSTRAINT ck_summary_citations_source_section_not_blank CHECK (
    source_section IS NULL OR btrim(source_section) <> ''
  ),
  CONSTRAINT ck_summary_citations_source_page_positive CHECK (
    source_page IS NULL OR source_page >= 1
  ),
  CONSTRAINT ck_summary_citations_source_url_scheme CHECK (
    source_url ~ '^https?://\S+$'
  )
);

COMMENT ON TABLE  summary_citations                IS 'T004 要約根拠（構造化要約の主張ごとに対応する原文の節・ページ・参照先URL）';
COMMENT ON COLUMN summary_citations.id             IS '要約根拠ID（内部識別子）';
COMMENT ON COLUMN summary_citations.summary_id     IS '要約ID（summaries.id への外部キー）';
COMMENT ON COLUMN summary_citations.claim_id       IS '主張識別子（summaries.json_content 内の主張に付けた識別子）';
COMMENT ON COLUMN summary_citations.source_section IS '原文の節（Abstractベースの場合は Abstract、不明な場合は NULL）';
COMMENT ON COLUMN summary_citations.source_page    IS '原文のページ番号（1以上の整数。Abstractベースまたは不明な場合は NULL）';
COMMENT ON COLUMN summary_citations.source_url     IS '参照先URL（arXiv 原文または PDF へのリンク）';

ALTER TABLE summary_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY summary_citations_select_passed
  ON summary_citations
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM summaries s
      WHERE s.id = summary_citations.summary_id
        AND s.validation_status = 'passed'
    )
  );

-- ============================================================================
-- T005: users (ユーザー)
-- ============================================================================
CREATE TABLE users (
  user_id    UUID        NOT NULL,
  plan       VARCHAR(16) NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_users PRIMARY KEY (user_id),
  CONSTRAINT ck_users_plan CHECK (
    plan IN ('free', 'pro')
  )
);

COMMENT ON TABLE  users            IS 'T005 ユーザー（本サービス側の利用者レコードと契約プラン区分）';
COMMENT ON COLUMN users.user_id    IS 'ユーザーID（Supabase Auth の利用者ID と同じ UUID）';
COMMENT ON COLUMN users.plan       IS 'プラン区分（free: 無料 / pro: 有料 Pro）';
COMMENT ON COLUMN users.created_at IS '登録日時（UTC）';

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- T006: user_interests (興味トピック)
-- ============================================================================
CREATE TABLE user_interests (
  user_id UUID         NOT NULL,
  topic   VARCHAR(128) NOT NULL,
  weight  NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  CONSTRAINT pk_user_interests PRIMARY KEY (user_id, topic),
  CONSTRAINT fk_user_interests_user_id FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT ck_user_interests_topic_not_blank CHECK (
    btrim(topic) <> ''
  ),
  CONSTRAINT ck_user_interests_weight_positive CHECK (
    weight > 0
  )
);

CREATE INDEX idx_user_interests_topic
  ON user_interests (topic);

COMMENT ON TABLE  user_interests         IS 'T006 興味トピック（利用者が興味を持つ研究分野・キーワードと重み）';
COMMENT ON COLUMN user_interests.user_id IS 'ユーザーID（users.user_id への外部キー）';
COMMENT ON COLUMN user_interests.topic   IS '興味トピック（arXiv の分野コードまたはキーワード）';
COMMENT ON COLUMN user_interests.weight  IS '重み（推薦での優先度を表す正の数値。既定は 1.00）';

ALTER TABLE user_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_interests_select_own
  ON user_interests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY user_interests_insert_own
  ON user_interests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_interests_update_own
  ON user_interests
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_interests_delete_own
  ON user_interests
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- T007: bookmarks (ブックマーク)
-- ============================================================================
CREATE TABLE bookmarks (
  user_id    UUID        NOT NULL,
  paper_id   BIGINT      NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_bookmarks PRIMARY KEY (user_id, paper_id),
  CONSTRAINT fk_bookmarks_user_id FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_bookmarks_paper_id FOREIGN KEY (paper_id)
    REFERENCES papers (id) ON DELETE RESTRICT
);

CREATE INDEX idx_bookmarks_user_id_created_at
  ON bookmarks (user_id, created_at DESC);

CREATE INDEX idx_bookmarks_paper_id
  ON bookmarks (paper_id);

CREATE OR REPLACE FUNCTION fn_bookmarks_enforce_created_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bookmarks_created_at
  BEFORE INSERT ON bookmarks
  FOR EACH ROW
  EXECUTE FUNCTION fn_bookmarks_enforce_created_at();

COMMENT ON TABLE  bookmarks            IS 'T007 ブックマーク（利用者が保存した論文）';
COMMENT ON COLUMN bookmarks.user_id    IS 'ユーザーID（users.user_id への外部キー）';
COMMENT ON COLUMN bookmarks.paper_id   IS '論文ID（papers.id への外部キー）';
COMMENT ON COLUMN bookmarks.created_at IS '保存日時（UTC）';

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookmarks_select_own
  ON bookmarks
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY bookmarks_insert_own
  ON bookmarks
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY bookmarks_delete_own
  ON bookmarks
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- T008: view_events (閲覧イベント)
-- ============================================================================
CREATE TABLE view_events (
  user_id   UUID        NOT NULL,
  paper_id  BIGINT      NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_view_events PRIMARY KEY (user_id, paper_id, viewed_at),
  CONSTRAINT fk_view_events_user_id FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_view_events_paper_id FOREIGN KEY (paper_id)
    REFERENCES papers (id) ON DELETE RESTRICT
);

CREATE INDEX idx_view_events_user_id_viewed_at
  ON view_events (user_id, viewed_at DESC);

CREATE INDEX idx_view_events_paper_id
  ON view_events (paper_id);

CREATE INDEX idx_view_events_viewed_at
  ON view_events (viewed_at);

CREATE OR REPLACE FUNCTION fn_view_events_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.viewed_at := CURRENT_TIMESTAMP;

  IF EXISTS (
    SELECT 1
    FROM view_events ve
    WHERE ve.user_id = NEW.user_id
      AND ve.paper_id = NEW.paper_id
      AND ve.viewed_at >= NEW.viewed_at - INTERVAL '30 minutes'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_view_events_before_insert
  BEFORE INSERT ON view_events
  FOR EACH ROW
  EXECUTE FUNCTION fn_view_events_before_insert();

COMMENT ON TABLE  view_events           IS 'T008 閲覧イベント（ログイン利用者が論文を閲覧した記録）';
COMMENT ON COLUMN view_events.user_id   IS 'ユーザーID（users.user_id への外部キー）';
COMMENT ON COLUMN view_events.paper_id  IS '論文ID（papers.id への外部キー）';
COMMENT ON COLUMN view_events.viewed_at IS '閲覧日時（UTC。トリガーでサーバ現在時刻に固定）';

ALTER TABLE view_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY view_events_select_own
  ON view_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY view_events_insert_own
  ON view_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- T009: jobs (ジョブ)
-- ============================================================================
CREATE TABLE jobs (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY,
  paper_version_id BIGINT,
  job_type         VARCHAR(32) NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'pending',
  attempts         INTEGER     NOT NULL DEFAULT 0,
  last_error       TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_jobs PRIMARY KEY (id),
  CONSTRAINT fk_jobs_paper_version_id FOREIGN KEY (paper_version_id)
    REFERENCES paper_versions (id) ON DELETE RESTRICT,
  CONSTRAINT ck_jobs_job_type CHECK (
    job_type IN (
      'collect_metadata',
      'summarize_abstract',
      'validate_summary',
      'publish_summary',
      'analyze_full_text',
      'sync_on_demand',
      'generate_embedding',
      'link_github',
      'update_search_index'
    )
  ),
  CONSTRAINT ck_jobs_status CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed')
  ),
  CONSTRAINT ck_jobs_attempts_non_negative CHECK (
    attempts >= 0
  ),
  CONSTRAINT ck_jobs_paper_version_required CHECK (
    (job_type IN ('collect_metadata', 'sync_on_demand'))
    OR (paper_version_id IS NOT NULL)
  ),
  CONSTRAINT ck_jobs_last_error_not_blank CHECK (
    last_error IS NULL OR btrim(last_error) <> ''
  )
);

CREATE UNIQUE INDEX uq_jobs_active_per_version
  ON jobs (paper_version_id, job_type)
  WHERE status IN ('pending', 'running')
    AND paper_version_id IS NOT NULL;

CREATE INDEX idx_jobs_paper_version_id
  ON jobs (paper_version_id, id DESC)
  WHERE paper_version_id IS NOT NULL;

CREATE INDEX idx_jobs_failed
  ON jobs (job_type, id)
  WHERE status = 'failed';

CREATE INDEX idx_jobs_active
  ON jobs (status, job_type, id)
  WHERE status IN ('pending', 'running');

COMMENT ON TABLE  jobs                  IS 'T009 ジョブ（バッチ・非同期処理の実行状態と試行回数・直近エラー）';
COMMENT ON COLUMN jobs.id               IS 'ジョブID（内部識別子）';
COMMENT ON COLUMN jobs.paper_version_id IS '論文バージョンID（paper_versions.id への外部キー。版に紐づかないジョブは NULL）';
COMMENT ON COLUMN jobs.job_type         IS 'ジョブ種別（collect_metadata / summarize_abstract / validate_summary / publish_summary / analyze_full_text / sync_on_demand / generate_embedding / link_github / update_search_index）';
COMMENT ON COLUMN jobs.status           IS '実行状態（pending: 待機 / running: 実行中 / succeeded: 成功 / failed: 失敗）';
COMMENT ON COLUMN jobs.attempts         IS '試行回数（失敗した実行の回数。0以上の整数）';
COMMENT ON COLUMN jobs.last_error       IS '直近エラー（最新の失敗理由の要約。秘密情報は含めない）';
COMMENT ON COLUMN jobs.updated_at       IS '最終更新日時（UTC）';

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- T010: subscriptions (サブスクリプション)
-- ============================================================================
CREATE TABLE subscriptions (
  id                     BIGINT      GENERATED ALWAYS AS IDENTITY,
  user_id                UUID        NOT NULL,
  stripe_customer_id     VARCHAR(64) NOT NULL,
  stripe_subscription_id VARCHAR(64) NOT NULL,
  status                 VARCHAR(32) NOT NULL,
  CONSTRAINT pk_subscriptions PRIMARY KEY (id),
  CONSTRAINT fk_subscriptions_user_id FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT uq_subscriptions_stripe_subscription_id
    UNIQUE (stripe_subscription_id),
  CONSTRAINT ck_subscriptions_customer_id_format CHECK (
    stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  ),
  CONSTRAINT ck_subscriptions_subscription_id_format CHECK (
    stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  CONSTRAINT ck_subscriptions_status CHECK (
    status IN (
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'unpaid',
      'canceled',
      'paused'
    )
  )
);

CREATE UNIQUE INDEX uq_subscriptions_user_billing
  ON subscriptions (user_id)
  WHERE status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused');

CREATE INDEX idx_subscriptions_user_id
  ON subscriptions (user_id, id DESC);

CREATE INDEX idx_subscriptions_stripe_customer_id
  ON subscriptions (stripe_customer_id);

COMMENT ON TABLE  subscriptions                        IS 'T010 サブスクリプション（利用者の有料プラン契約と Stripe 上の識別子・契約状態）';
COMMENT ON COLUMN subscriptions.id                     IS 'サブスクリプションID（内部識別子）';
COMMENT ON COLUMN subscriptions.user_id                IS 'ユーザーID（users.user_id への外部キー）';
COMMENT ON COLUMN subscriptions.stripe_customer_id     IS 'Stripe の顧客ID（cus_ で始まる識別子）';
COMMENT ON COLUMN subscriptions.stripe_subscription_id IS 'Stripe の定期課金契約ID（sub_ で始まる識別子）';
COMMENT ON COLUMN subscriptions.status                 IS '契約状態（active / trialing / past_due / unpaid / paused / incomplete / incomplete_expired / canceled）';

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select_own
  ON subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- Auxiliary Table 1: user_notification_settings (F10 / B007 通知設定)
-- ============================================================================
CREATE TABLE user_notification_settings (
  user_id        UUID        NOT NULL,
  digest_enabled BOOLEAN     NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_user_notification_settings PRIMARY KEY (user_id),
  CONSTRAINT fk_user_notification_settings_user_id FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE
);

ALTER TABLE user_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_notification_settings_select_own
  ON user_notification_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY user_notification_settings_upsert_own
  ON user_notification_settings
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- Auxiliary Table 2: digest_deliveries (F10 / B007 ダイジェスト配信履歴)
-- ============================================================================
CREATE TABLE digest_deliveries (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY,
  user_id       UUID        NOT NULL,
  delivery_date DATE        NOT NULL,
  delivered_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        VARCHAR(16) NOT NULL,
  paper_count   INTEGER     NOT NULL DEFAULT 0,
  error_reason  TEXT,
  CONSTRAINT pk_digest_deliveries PRIMARY KEY (id),
  CONSTRAINT fk_digest_deliveries_user_id FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT ck_digest_deliveries_status CHECK (
    status IN ('sent', 'skipped', 'failed')
  ),
  CONSTRAINT uq_digest_deliveries_user_date_status UNIQUE (user_id, delivery_date, status)
);

CREATE INDEX idx_digest_deliveries_delivered_at
  ON digest_deliveries (delivered_at);

ALTER TABLE digest_deliveries ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Auxiliary Table 3: paper_embeddings (B008 / F08 論文 Embedding)
-- ============================================================================
CREATE TABLE paper_embeddings (
  paper_id         BIGINT        NOT NULL,
  paper_version_id BIGINT        NOT NULL,
  version          INTEGER       NOT NULL,
  model_id         VARCHAR(128)  NOT NULL,
  input_hash       VARCHAR(64)   NOT NULL,
  embedding        vector(1536)  NOT NULL,
  generated_at     TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_paper_embeddings PRIMARY KEY (paper_id),
  CONSTRAINT fk_paper_embeddings_paper_id FOREIGN KEY (paper_id)
    REFERENCES papers (id) ON DELETE CASCADE,
  CONSTRAINT fk_paper_embeddings_paper_version_id FOREIGN KEY (paper_version_id)
    REFERENCES paper_versions (id) ON DELETE RESTRICT
);

ALTER TABLE paper_embeddings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Auxiliary Table 4: paper_github_links (F14 / B009 論文 GitHub 関連付け)
-- ============================================================================
CREATE TABLE paper_github_links (
  paper_id         BIGINT      NOT NULL,
  paper_version_id BIGINT      NOT NULL,
  link_status      VARCHAR(16) NOT NULL,
  repo_full_name   TEXT,
  repo_url         TEXT,
  repo_license     TEXT,
  default_branch   TEXT,
  commit_sha       TEXT,
  match_method     TEXT,
  match_evidence   TEXT,
  code_explanation JSONB,
  model_id         TEXT,
  checked_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  generated_at     TIMESTAMPTZ,
  CONSTRAINT pk_paper_github_links PRIMARY KEY (paper_id),
  CONSTRAINT fk_paper_github_links_paper_id FOREIGN KEY (paper_id)
    REFERENCES papers (id) ON DELETE CASCADE,
  CONSTRAINT fk_paper_github_links_paper_version_id FOREIGN KEY (paper_version_id)
    REFERENCES paper_versions (id) ON DELETE RESTRICT,
  CONSTRAINT ck_paper_github_links_status CHECK (
    link_status IN ('linked', 'not_found')
  )
);

ALTER TABLE paper_github_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY paper_github_links_select_public
  ON paper_github_links
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================================
-- Auxiliary Table 5: pro_feature_usages (F18 / F09 / F11 Pro機能月間利用回数記録)
-- ============================================================================
CREATE TABLE pro_feature_usages (
  id           UUID         NOT NULL DEFAULT gen_random_uuid(),
  user_id      UUID         NOT NULL,
  feature      VARCHAR(32) NOT NULL,
  period_start DATE        NOT NULL,
  reserved_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at  TIMESTAMPTZ,
  CONSTRAINT pk_pro_feature_usages PRIMARY KEY (id),
  CONSTRAINT fk_pro_feature_usages_user_id FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT ck_pro_feature_usages_feature CHECK (
    feature IN ('ai_chat', 'paper_compare')
  )
);

CREATE INDEX idx_pro_feature_usages_lookup
  ON pro_feature_usages (user_id, feature, period_start)
  WHERE released_at IS NULL;

ALTER TABLE pro_feature_usages ENABLE ROW LEVEL SECURITY;

CREATE POLICY pro_feature_usages_select_own
  ON pro_feature_usages
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
