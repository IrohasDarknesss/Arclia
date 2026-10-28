"""Job routing table mapping job_type to queue, task, and argument policy (BT.B010 §4)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class JobRoute:
    job_type: str
    batch_id: str
    queue: str
    task: str
    needs_args: bool
    on_missing_args: str  # 'none' | 'allow_empty' | 'skip_reprocess' | 'drop_entry'
    retry_delays_seconds: tuple[int, int]


ROUTE_TABLE: dict[str, JobRoute] = {
    "collect_metadata": JobRoute(
        job_type="collect_metadata",
        batch_id="B001",
        queue="default",
        task="run_collect_metadata",
        needs_args=True,
        on_missing_args="allow_empty",
        retry_delays_seconds=(300, 900),
    ),
    "summarize_abstract": JobRoute(
        job_type="summarize_abstract",
        batch_id="B002",
        queue="summarize",
        task="run",
        needs_args=False,
        on_missing_args="none",
        retry_delays_seconds=(60, 300),
    ),
    "validate_summary": JobRoute(
        job_type="validate_summary",
        batch_id="B003",
        queue="default",
        task="run",
        needs_args=False,
        on_missing_args="none",
        retry_delays_seconds=(60, 300),
    ),
    "publish_summary": JobRoute(
        job_type="publish_summary",
        batch_id="B004",
        queue="default",
        task="run",
        needs_args=False,
        on_missing_args="none",
        retry_delays_seconds=(60, 300),
    ),
    "analyze_full_text": JobRoute(
        job_type="analyze_full_text",
        batch_id="B005",
        queue="fulltext",
        task="run",
        needs_args=False,
        on_missing_args="none",
        retry_delays_seconds=(300, 900),
    ),
    "sync_on_demand": JobRoute(
        job_type="sync_on_demand",
        batch_id="B006",
        queue="sync_on_demand",
        task="run_sync_on_demand",
        needs_args=True,
        on_missing_args="skip_reprocess",
        retry_delays_seconds=(60, 300),
    ),
    "generate_embedding": JobRoute(
        job_type="generate_embedding",
        batch_id="B008",
        queue="embedding",
        task="run",
        needs_args=False,
        on_missing_args="none",
        retry_delays_seconds=(60, 300),
    ),
    "link_github": JobRoute(
        job_type="link_github",
        batch_id="B009",
        queue="github",
        task="run",
        needs_args=False,
        on_missing_args="none",
        retry_delays_seconds=(300, 900),
    ),
    "update_search_index": JobRoute(
        job_type="update_search_index",
        batch_id="B011",
        queue="default",
        task="run",
        needs_args=False,
        on_missing_args="none",
        retry_delays_seconds=(60, 300),
    ),
    "digest_delivery": JobRoute(
        job_type="digest_delivery",
        batch_id="B007",
        queue="notification",
        task="run_digest_delivery",
        needs_args=True,
        on_missing_args="drop_entry",
        retry_delays_seconds=(300, 900),
    ),
}


def resolve_route(job_type: str) -> JobRoute:
    """Return the JobRoute for a given job_type or raise ValueError if unknown (BT.B010 §4)."""
    route = ROUTE_TABLE.get(job_type)
    if route is None:
        raise ValueError(f"Unknown job_type: '{job_type}'")
    return route
