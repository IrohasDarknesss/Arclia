"""B009: GitHub repository linking and code explanation job (`link_github`, BT.B009, BE.F14)."""

from __future__ import annotations

import json
import logging
from typing import Any

from worker.config import get_config
from worker.db import get_connection, transaction
from worker.integrations.github_client import (
    GitHubClient,
    extract_github_candidates_from_abstract,
)
from worker.llm.client import LlmClient
from worker.repositories.job_repository import JobRepository

logger = logging.getLogger(__name__)


def _validate_code_explanation(
    explanation: dict[str, Any], valid_tree_paths: set[str]
) -> dict[str, Any]:
    overview = str(explanation.get("overview") or "").strip()
    if not overview or len(overview) > 400:
        raise ValueError("code_explanation.overview must be 1..400 characters")

    raw_paths = explanation.get("key_paths")
    if not isinstance(raw_paths, list) or not (1 <= len(raw_paths) <= 5):
        raise ValueError("code_explanation.key_paths must have 1..5 items")

    validated_paths: list[dict[str, str]] = []
    for item in raw_paths:
        if not isinstance(item, dict):
            raise ValueError("key_paths item must be an object")
        p = str(item.get("path") or "").strip()
        role = str(item.get("role") or "").strip()
        if not p or not role or len(role) > 200:
            raise ValueError("key_paths item requires path and role (<=200 chars)")
        if valid_tree_paths and p not in valid_tree_paths:
            raise ValueError(f"key_paths path '{p}' does not exist in repository tree")
        validated_paths.append({"path": p, "role": role})

    quickstart = explanation.get("quickstart")
    if quickstart is not None:
        quickstart = str(quickstart).strip()[:400] or None

    return {
        "overview": overview,
        "key_paths": validated_paths,
        "quickstart": quickstart,
    }


def link_github(job: dict[str, Any]) -> None:
    """BT.B009 / BE.F14 FN01 `link_github`: Discover official GitHub repo, verify license, and generate code explanation."""
    job_id = int(job["id"])
    paper_version_id = int(job["paperVersionId"])
    job_repo = JobRepository()

    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pv.id AS paper_version_id,
                       pv.paper_id,
                       pv.version,
                       p.latest_version,
                       p.arxiv_id,
                       p.title,
                       p.abstract,
                       pgl.paper_version_id AS existing_linked_pv_id,
                       pgl.link_status AS existing_status,
                       pgl.code_explanation AS existing_explanation
                FROM paper_versions pv
                JOIN papers p ON p.id = pv.paper_id
                LEFT JOIN paper_github_links pgl ON pgl.paper_id = p.id
                WHERE pv.id = %s
                """,
                (paper_version_id,),
            )
            row = cur.fetchone()

    if not row:
        with transaction() as tx_conn:
            job_repo.mark_succeeded(tx_conn, job_id)
        return

    paper_id = int(row["paper_id"])
    version = int(row["version"])
    latest_version = int(row["latest_version"])

    # Skip if stale version or already linked with explanation for this version
    if version < latest_version or (
        row.get("existing_linked_pv_id") == paper_version_id
        and row.get("existing_status") == "linked"
        and row.get("existing_explanation") is not None
    ):
        with transaction() as tx_conn:
            job_repo.mark_succeeded(tx_conn, job_id)
        return

    arxiv_id = str(row["arxiv_id"])
    title = str(row["title"])
    abstract = str(row["abstract"])

    gh = GitHubClient()
    candidates = extract_github_candidates_from_abstract(abstract)
    match_method = "abstract_url" if candidates else "github_search"
    match_evidence: str | None = f"Abstract URL ({candidates[0]})" if candidates else None

    selected_repo: dict[str, Any] | None = None
    for cand in candidates:
        repo_meta = gh.get_repository(cand)
        if repo_meta and not repo_meta.get("private") and not repo_meta.get("fork"):
            selected_repo = repo_meta
            match_evidence = f"Abstract URL ({cand})"
            break

    if selected_repo is None:
        match_method = "github_search"
        search_items = gh.search_repositories_by_arxiv_id(arxiv_id)
        for item in search_items:
            full_name = item.get("full_name")
            if not full_name or item.get("private") or item.get("fork"):
                continue
            readme = gh.get_readme_excerpt(str(full_name))
            desc = str(item.get("description") or "")
            if arxiv_id in desc or arxiv_id in readme:
                selected_repo = gh.get_repository(str(full_name)) or item
                match_evidence = f"GitHub search matched {arxiv_id}"
                break

    if selected_repo is None:
        with transaction() as tx_conn:
            with tx_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO paper_github_links (
                        paper_id, paper_version_id, link_status, checked_at
                    )
                    VALUES (%s, %s, 'not_found', CURRENT_TIMESTAMP)
                    ON CONFLICT (paper_id) DO UPDATE
                    SET paper_version_id = EXCLUDED.paper_version_id,
                        link_status = 'not_found',
                        repo_full_name = NULL,
                        repo_url = NULL,
                        repo_license = NULL,
                        default_branch = NULL,
                        commit_sha = NULL,
                        match_method = NULL,
                        match_evidence = NULL,
                        code_explanation = NULL,
                        model_id = NULL,
                        checked_at = CURRENT_TIMESTAMP,
                        generated_at = NULL
                    """,
                    (paper_id, paper_version_id),
                )
            job_repo.mark_succeeded(tx_conn, job_id)
        return

    repo_full_name = str(selected_repo["full_name"])
    repo_url = str(selected_repo.get("html_url") or f"https://github.com/{repo_full_name}")
    default_branch = str(selected_repo.get("default_branch") or "main")
    license_obj = selected_repo.get("license")
    spdx_id: str | None = None
    if isinstance(license_obj, dict):
        raw_spdx = license_obj.get("spdx_id")
        if raw_spdx and str(raw_spdx) != "NOASSERTION":
            spdx_id = str(raw_spdx)

    commit_sha, tree_paths = gh.get_tree_paths(repo_full_name, default_branch)
    code_explanation: dict[str, Any] | None = None
    model_id: str | None = None

    # Only read README and generate LLM explanation when SPDX license is confirmed (ARC005)
    if spdx_id is not None and tree_paths:
        readme_excerpt = gh.get_readme_excerpt(repo_full_name)
        llm = LlmClient()
        try:
            raw_exp, actual_model = llm.generate_code_explanation(
                title=title,
                abstract=abstract,
                repo_full_name=repo_full_name,
                tree_paths=tree_paths,
                readme_excerpt=readme_excerpt,
            )
            code_explanation = _validate_code_explanation(raw_exp, set(tree_paths))
            model_id = actual_model
        except Exception as exp_exc:
            logger.warning(
                "GitHub code explanation generation skipped for %s: %s",
                repo_full_name,
                exp_exc,
            )

    with transaction() as tx_conn:
        with tx_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO paper_github_links (
                    paper_id, paper_version_id, link_status, repo_full_name, repo_url,
                    repo_license, default_branch, commit_sha, match_method, match_evidence,
                    code_explanation, model_id, checked_at, generated_at
                )
                VALUES (
                    %s, %s, 'linked', %s, %s,
                    %s, %s, %s, %s, %s,
                    %s::jsonb, %s, CURRENT_TIMESTAMP,
                    CASE WHEN %s::jsonb IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END
                )
                ON CONFLICT (paper_id) DO UPDATE
                SET paper_version_id = EXCLUDED.paper_version_id,
                    link_status = 'linked',
                    repo_full_name = EXCLUDED.repo_full_name,
                    repo_url = EXCLUDED.repo_url,
                    repo_license = EXCLUDED.repo_license,
                    default_branch = EXCLUDED.default_branch,
                    commit_sha = EXCLUDED.commit_sha,
                    match_method = EXCLUDED.match_method,
                    match_evidence = EXCLUDED.match_evidence,
                    code_explanation = EXCLUDED.code_explanation,
                    model_id = EXCLUDED.model_id,
                    checked_at = CURRENT_TIMESTAMP,
                    generated_at = EXCLUDED.generated_at
                """,
                (
                    paper_id,
                    paper_version_id,
                    repo_full_name,
                    repo_url,
                    spdx_id,
                    default_branch,
                    commit_sha,
                    match_method,
                    match_evidence,
                    json.dumps(code_explanation, ensure_ascii=False)
                    if code_explanation
                    else None,
                    model_id,
                    json.dumps(code_explanation, ensure_ascii=False)
                    if code_explanation
                    else None,
                ),
            )
        job_repo.mark_succeeded(tx_conn, job_id)


def enqueue_daily_github_candidates() -> int:
    """BT.B009 / BE.F14 FN05 `enqueue_daily_candidates`: Select up to 100 candidate papers and enqueue `link_github`."""
    cfg = get_config()
    limit = max(0, cfg.github_link_daily_limit)
    if limit == 0:
        return 0

    job_repo = JobRepository()
    with get_connection(autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pv.id AS paper_version_id
                FROM papers p
                JOIN paper_versions pv
                  ON pv.paper_id = p.id
                 AND pv.version = p.latest_version
                LEFT JOIN paper_github_links pgl ON pgl.paper_id = p.id
                LEFT JOIN bookmarks b ON b.paper_id = p.id
                LEFT JOIN view_events ve
                       ON ve.paper_id = p.id
                      AND ve.viewed_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
                WHERE EXISTS (
                    SELECT 1 FROM summaries s
                    WHERE s.paper_version_id = pv.id
                      AND s.validation_status = 'passed'
                )
                AND (
                    pgl.paper_id IS NULL
                    OR pgl.paper_version_id <> pv.id
                    OR (pgl.link_status = 'not_found' AND pgl.checked_at < CURRENT_TIMESTAMP - INTERVAL '30 days')
                )
                AND NOT EXISTS (
                    SELECT 1 FROM jobs j
                    WHERE j.paper_version_id = pv.id
                      AND j.job_type = 'link_github'
                      AND j.status IN ('pending', 'running')
                )
                GROUP BY pv.id, p.abstract, p.submitted_at
                ORDER BY (p.abstract ~* 'github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+') DESC,
                         (COUNT(DISTINCT b.user_id) * 3 + COUNT(ve.paper_id)) DESC,
                         p.submitted_at DESC,
                         pv.id DESC
                LIMIT %s
                """,
                (limit,),
            )
            candidates = [int(r["paper_version_id"]) for r in cur.fetchall()]

    enqueued = 0
    for pv_id in candidates:
        with transaction() as tx_conn:
            jid = job_repo.register_followup_job(tx_conn, pv_id, "link_github")
        if jid is not None and job_repo.enqueue(jid, "link_github", "github"):
            enqueued += 1
    logger.info("Enqueued %s daily link_github candidate jobs", enqueued)
    return enqueued
