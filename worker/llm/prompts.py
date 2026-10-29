"""Prompt templates for summary generation, grounding check, and GitHub explanation (ARC003, ARC004, B002, B003, B005, B009)."""

from __future__ import annotations

from typing import Any


def build_summary_prompt(
    summary_type: str,
    arxiv_id: str,
    version: int,
    title: str,
    abstract: str,
    full_text: str | None = None,
    rejection_reasons: list[str] | None = None,
) -> tuple[str, str]:
    """Build (system_prompt, user_prompt) for generating a structured Japanese summary and citations."""
    source_url = (
        f"https://arxiv.org/pdf/{arxiv_id}v{version}.pdf"
        if summary_type == "deep"
        else f"https://arxiv.org/abs/{arxiv_id}v{version}"
    )
    source_scope = "full_text" if summary_type == "deep" else "abstract_only"

    system_prompt = (
        "あなたはarXivの科学技術論文を日本語で正確に構造化要約する専門エディターです。\n"
        "出力は必ず1つの有効なJSONオブジェクト（キー `json_content` と `citations` を持つ）のみを返してください。\n"
        "絶対ルール:\n"
        "1. 原文に書かれている事実・数値は `basis: \"fact\"` とし、原文の数値を1桁たりとも変えずにそのまま記載すること。\n"
        "2. 原文に直接書かれていない応用例や限界の補足推測は必ず `basis: \"inference\"` とし、新規の具体的な数値を捏造しないこと。\n"
        "3. すべての主張オブジェクトは一意の `claim_id`（`c01`, `c02`, ...）を持ち、`citations` 配列に1対1で対応させること。\n"
        f"4. `source_scope` は `{source_scope}`、参照URLの基本値は `{source_url}` とすること。"
    )

    citations_hint = (
        f'citations の必須構造 (source_page は null にすること): [{{"claim_id": "c01", "source_url": "{source_url}", "source_section": "Abstract", "source_page": null}}]'
    )

    if summary_type == "short":
        schema_hint = (
            "json_content の必須構造:\n"
            '{"schema_version": 1, "summary_type": "short", "title_ja": "...", '
            '"thesis": {"claim_id": "c01", "text": "...", "basis": "fact"}, '
            '"key_points": [{"claim_id": "c02", "text": "...", "basis": "fact"}, {"claim_id": "c03", "text": "...", "basis": "fact"}] (2〜4件)}'
        )
    elif summary_type == "standard":
        schema_hint = (
            "json_content の必須構造:\n"
            '{"schema_version": 1, "summary_type": "standard", "title_ja": "...", '
            '"thesis": {"claim_id": "c01", "text": "...", "basis": "fact"}, '
            '"problem": [1〜3件], "method": [1〜4件], "results": [1〜4件], '
            '"limitations": [1〜3件], "applications": [1〜3件]}'
        )
    else:
        schema_hint = (
            "json_content の必須構造:\n"
            '{"schema_version": 1, "summary_type": "deep", "title_ja": "...", '
            '"thesis": {"claim_id": "c01", "text": "...", "basis": "fact"}, '
            '"problem": [1〜4件], "method": [2〜6件], "results": [2〜6件], '
            '"limitations": [1〜4件], "applications": [1〜4件], '
            '"background_and_related_work": [1〜4件], "reproducibility": [1〜4件], '
            '"key_formulas": [{"formula_id": "f01", "latex": "...", "meaning_ja": "...", '
            '"variables": [{"symbol": "...", "meaning_ja": "..."}], "source_section": "...", "source_page": 1}], '
            '"references": [{"ref_id": "r01", "title": "...", "authors": "...", "year": 2024, "role_ja": "...", "url": null}]}'
        )

    user_parts = [
        f"arXiv ID: {arxiv_id} (v{version})",
        f"Title: {title}",
        f"Abstract:\n{abstract}",
    ]
    if full_text and summary_type == "deep":
        user_parts.append(f"Full Text (parsed pages):\n{full_text[:60000]}")
    if rejection_reasons:
        user_parts.append(
            "前回の生成で以下の検証不合格理由が検出されました。これらをすべて修正して再生成してください:\n- "
            + "\n- ".join(rejection_reasons)
        )
    user_parts.append(schema_hint)
    user_parts.append(citations_hint)

    return system_prompt, "\n\n".join(user_parts)


def build_entailment_prompt(
    claims: list[dict[str, Any]],
    source_text: str,
    source_scope: str,
) -> tuple[str, str]:
    """Build (system_prompt, user_prompt) for Check 4 (LLM entailment / assertion check in ARC004)."""
    system_prompt = (
        "あなたは論文要約の事実検証（Grounding Validator）を行う審査器です。\n"
        "与えられた原文（Source Text）と主張一覧（Claims）を照合し、\n"
        "- `basis == \"fact\"` なのに原文から裏付けられない断定・飛躍があるもの\n"
        "- `basis == \"inference\"` なのに原文と矛盾する、または根拠のない数値を断定しているもの\n"
        "を検出してください。\n"
        '出力は必ず `{"violations": [{"claim_id": "c01", "reason": "..."}]}` のJSON形式で返してください。問題がなければ `{"violations": []}` を返してください。'
    )
    user_prompt = (
        f"Source Scope: {source_scope}\n\n"
        f"Source Text:\n{source_text[:40000]}\n\n"
        f"Claims:\n{claims}"
    )
    return system_prompt, user_prompt


def build_github_explanation_prompt(
    title: str,
    abstract: str,
    repo_full_name: str,
    tree_paths: list[str],
    readme_excerpt: str,
) -> tuple[str, str]:
    """Build (system_prompt, user_prompt) for B009 GitHub code explanation."""
    system_prompt = (
        "あなたは機械学習・情報科学論文の公式実装リポジトリを解説するエンジニアです。\n"
        "論文のタイトル・Abstract・ファイル構成・README抜粋をもとに、日本語で以下のJSONオブジェクトを出力してください:\n"
        '{"overview": "リポジトリの概要（400文字以内）", '
        '"key_paths": [{"path": "実在するパス", "role": "役割の説明（200文字以内）"}] (1〜5件), '
        '"quickstart": "実行・再現手順の要約（400文字以内、不明な場合はnull）"}\n'
        "注意: `key_paths[].path` には必ず与えられた Tree Paths に実在するパスのみを指定してください。"
    )
    user_prompt = (
        f"Paper Title: {title}\n"
        f"Abstract: {abstract}\n"
        f"Repository: {repo_full_name}\n"
        f"Tree Paths (up to 200):\n" + "\n".join(tree_paths[:200]) + "\n\n"
        f"README Excerpt:\n{readme_excerpt[:8000]}"
    )
    return system_prompt, user_prompt
