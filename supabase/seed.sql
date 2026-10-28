-- ============================================================================
-- Arclia Seed Data (Development / Local Testing)
-- ============================================================================

INSERT INTO papers (
  arxiv_id,
  title,
  abstract,
  authors,
  categories,
  submitted_at,
  updated_at,
  latest_version,
  original_url
)
VALUES
(
  '2501.12345',
  'Sparse Mixture-of-Experts for Long-Context Reasoning in Large Language Models',
  'We propose a sparse Mixture-of-Experts (MoE) architecture tailored for long-context reasoning up to 128k tokens. By combining dynamic token routing with hierarchical key-value compression, our 16B active parameter model achieves 91.4% accuracy on GSM8K and reduces memory footprint by 42.0% compared to dense baselines.',
  '[{"name": "Taro Yamada", "affiliation": "University of Tokyo"}, {"name": "Hanako Sato", "affiliation": "RIKEN AIP"}]'::jsonb,
  ARRAY['cs.CL', 'cs.AI', 'cs.LG'],
  '2026-10-25T14:00:00Z',
  '2026-10-26T09:30:00Z',
  2,
  'https://arxiv.org/abs/2501.12345'
),
(
  '2501.23456',
  'Diffusion Policy Optimization with Continuous Reward Alignment for Bimanual Manipulation',
  'We introduce a continuous reward alignment framework for diffusion-based visuomotor policies in bimanual robotic manipulation. Across 12 benchmark tasks, our method improves success rate by 18.5% while requiring 3x fewer demonstration trajectories.',
  '[{"name": "Kenji Takahashi", "affiliation": "Kyoto University"}]'::jsonb,
  ARRAY['cs.RO', 'cs.LG'],
  '2026-10-26T11:15:00Z',
  '2026-10-26T11:15:00Z',
  1,
  'https://arxiv.org/abs/2501.23456'
)
ON CONFLICT (arxiv_id) DO NOTHING;

INSERT INTO paper_versions (
  paper_id,
  version,
  metadata_snapshot,
  content_status,
  license_type
)
SELECT
  p.id,
  p.latest_version,
  jsonb_build_object(
    'title', p.title,
    'abstract', p.abstract,
    'authors', p.authors,
    'categories', to_jsonb(p.categories),
    'submitted_at', to_char(p.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updated_at', to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'fetched_at', '2026-10-27T01:05:00Z'
  ),
  CASE WHEN p.arxiv_id = '2501.12345' THEN 'full_text' ELSE 'abstract_only' END,
  CASE WHEN p.arxiv_id = '2501.12345' THEN 'http://creativecommons.org/licenses/by/4.0/' ELSE 'http://arxiv.org/licenses/nonexclusive-distrib/1.0/' END
FROM papers p
ON CONFLICT (paper_id, version) DO NOTHING;

INSERT INTO summaries (
  paper_version_id,
  summary_type,
  language,
  json_content,
  model_id,
  generated_at,
  source_scope,
  validation_status
)
SELECT
  pv.id,
  'short',
  'ja',
  '{
    "schema_version": 1,
    "summary_type": "short",
    "title_ja": "大規模言語モデルにおける長文脈推論のためのスパースMixture-of-Experts",
    "thesis": {
      "claim_id": "c01",
      "text": "動的トークンルーティングと階層的KV圧縮を組み合わせたスパースMoEにより、128kトークン長文脈推論においてメモリ使用量を42.0%削減しつつGSM8Kで91.4%の精度を達成した。",
      "basis": "fact"
    },
    "key_points": [
      {
        "claim_id": "c02",
        "text": "128kトークンまでの長文脈推論に特化したスパースMoEアーキテクチャを提案。",
        "basis": "fact"
      },
      {
        "claim_id": "c03",
        "text": "16BアクティブパラメータモデルでGSM8K 91.4%を達成し、密モデル比でメモリ使用量を42.0%削減。",
        "basis": "fact"
      }
    ]
  }'::jsonb,
  'gpt-4o-mini',
  '2026-10-27T01:10:00Z',
  'abstract_only',
  'passed'
FROM paper_versions pv
JOIN papers p ON p.id = pv.paper_id
WHERE p.arxiv_id = '2501.12345' AND pv.version = 2;

INSERT INTO summaries (
  paper_version_id,
  summary_type,
  language,
  json_content,
  model_id,
  generated_at,
  source_scope,
  validation_status
)
SELECT
  pv.id,
  'standard',
  'ja',
  '{
    "schema_version": 1,
    "summary_type": "standard",
    "title_ja": "大規模言語モデルにおける長文脈推論のためのスパースMixture-of-Experts",
    "thesis": {
      "claim_id": "c01",
      "text": "動的トークンルーティングと階層的KV圧縮を統合したスパースMoEアーキテクチャにより、長文脈推論のメモリ効率と精度を両立した。",
      "basis": "fact"
    },
    "problem": [
      {
        "claim_id": "c02",
        "text": "最大128kトークンの長文脈推論では従来の密モデル（dense baselines）においてメモリ消費がボトルネックとなっていた。",
        "basis": "fact"
      }
    ],
    "method": [
      {
        "claim_id": "c03",
        "text": "動的トークンルーティングと階層的キー・バリュー（KV）圧縮を組み合わせた16BアクティブパラメータのスパースMoEを構築。",
        "basis": "fact"
      }
    ],
    "results": [
      {
        "claim_id": "c04",
        "text": "GSM8Kベンチマークで91.4%の精度を達成し、密モデルベースラインと比較してメモリフットプリントを42.0%削減した。",
        "basis": "fact"
      }
    ],
    "limitations": [
      {
        "claim_id": "c05",
        "text": "Abstractの範囲では128kトークンを超える領域や学習コストの詳細なトレードオフは言及されていない。",
        "basis": "inference"
      }
    ],
    "applications": [
      {
        "claim_id": "c06",
        "text": "長文ドキュメント解析や大規模コードベース推論における省メモリ推論基盤への応用が見込まれる。",
        "basis": "inference"
      }
    ]
  }'::jsonb,
  'gpt-4o-mini',
  '2026-10-27T01:10:30Z',
  'abstract_only',
  'passed'
FROM paper_versions pv
JOIN papers p ON p.id = pv.paper_id
WHERE p.arxiv_id = '2501.12345' AND pv.version = 2;

INSERT INTO summary_citations (summary_id, claim_id, source_section, source_page, source_url)
SELECT
  s.id,
  c.claim_id,
  'Abstract',
  NULL,
  'https://arxiv.org/abs/2501.12345v2'
FROM summaries s
CROSS JOIN (VALUES ('c01'), ('c02'), ('c03'), ('c04'), ('c05'), ('c06')) AS c(claim_id)
WHERE s.summary_type = 'standard'
ON CONFLICT (summary_id, claim_id) DO NOTHING;

INSERT INTO summary_citations (summary_id, claim_id, source_section, source_page, source_url)
SELECT
  s.id,
  c.claim_id,
  'Abstract',
  NULL,
  'https://arxiv.org/abs/2501.12345v2'
FROM summaries s
CROSS JOIN (VALUES ('c01'), ('c02'), ('c03')) AS c(claim_id)
WHERE s.summary_type = 'short'
ON CONFLICT (summary_id, claim_id) DO NOTHING;
