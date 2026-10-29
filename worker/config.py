"""Environment variable configuration for the Arclia worker (基本設計書_概要.md §9)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_dotenv() -> None:
    for env_path in [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent.parent / ".env",
        Path.home() / ".env",
    ]:
        if env_path.is_file():
            try:
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k and k not in os.environ:
                        os.environ[k] = v
            except Exception:
                pass
            break


_load_dotenv()


def _parse_bool(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _parse_csv(val: str | None, default: list[str]) -> list[str]:
    if not val:
        return list(default)
    items = [item.strip() for item in val.split(",") if item.strip()]
    return items if items else list(default)


DEFAULT_TARGET_CATEGORIES = [
    "cs.AI",
    "cs.LG",
    "cs.CL",
    "cs.CV",
    "cs.NE",
    "cs.RO",
    "cs.IR",
    "stat.ML",
]


@dataclass(frozen=True)
class WorkerConfig:
    # 1-6: DB, Cache, Auth
    database_url: str = field(
        default_factory=lambda: os.environ.get(
            "DATABASE_URL", "postgresql://127.0.0.1:5432/arclia"
        )
    )
    redis_url: str = field(
        default_factory=lambda: os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    )
    supabase_url: str = field(
        default_factory=lambda: os.environ.get(
            "NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321"
        )
    )
    supabase_service_role_key: str = field(
        default_factory=lambda: os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    )
    app_url: str = field(
        default_factory=lambda: os.environ.get(
            "NEXT_PUBLIC_APP_URL", "http://localhost:3000"
        )
    )

    # 7-12: arXiv API
    arxiv_api_base_url: str = field(
        default_factory=lambda: os.environ.get(
            "ARXIV_API_BASE_URL", "https://export.arxiv.org/api/query"
        )
    )
    arxiv_pdf_base_url: str = field(
        default_factory=lambda: os.environ.get(
            "ARXIV_PDF_BASE_URL", "https://arxiv.org/pdf"
        )
    )
    arxiv_user_agent: str = field(
        default_factory=lambda: os.environ.get(
            "ARXIV_USER_AGENT", "arxiv-digest-jp/0.1 (+mailto:contact@example.com)"
        )
    )
    arxiv_request_interval_seconds: int = field(
        default_factory=lambda: max(
            3, int(os.environ.get("ARXIV_REQUEST_INTERVAL_SECONDS", "3"))
        )
    )
    arxiv_target_categories: list[str] = field(
        default_factory=lambda: _parse_csv(
            os.environ.get("ARXIV_TARGET_CATEGORIES"), DEFAULT_TARGET_CATEGORIES
        )
    )
    arxiv_fetch_window_days: int = field(
        default_factory=lambda: int(os.environ.get("ARXIV_FETCH_WINDOW_DAYS", "3"))
    )

    # 13-22: LLM & Embedding
    llm_api_key: str = field(
        default_factory=lambda: os.environ.get("LLM_API_KEY")
        or os.environ.get("GEMINI_API_KEY", "")
    )
    llm_api_base_url: str = field(
        default_factory=lambda: os.environ.get("LLM_API_BASE_URL")
        or (
            "https://generativelanguage.googleapis.com/v1beta/openai/"
            if (not os.environ.get("LLM_API_KEY") and os.environ.get("GEMINI_API_KEY"))
            else "https://api.openai.com/v1"
        )
    )
    llm_model_summary_short: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL_SUMMARY_SHORT")
        or (
            "gemini-3.5-flash-lite"
            if (not os.environ.get("LLM_API_KEY") and os.environ.get("GEMINI_API_KEY"))
            else "gpt-4o-mini"
        )
    )
    llm_model_summary_standard: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL_SUMMARY_STANDARD")
        or (
            "gemini-3.5-flash-lite"
            if (not os.environ.get("LLM_API_KEY") and os.environ.get("GEMINI_API_KEY"))
            else "gpt-4o-mini"
        )
    )
    llm_model_summary_deep: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL_SUMMARY_DEEP")
        or (
            "gemini-3.5-flash-lite"
            if (not os.environ.get("LLM_API_KEY") and os.environ.get("GEMINI_API_KEY"))
            else "gpt-4o"
        )
    )
    llm_model_validator: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL_VALIDATOR")
        or (
            "gemini-3.5-flash-lite"
            if (not os.environ.get("LLM_API_KEY") and os.environ.get("GEMINI_API_KEY"))
            else "gpt-4o-mini"
        )
    )
    llm_model_auxiliary: str = field(
        default_factory=lambda: os.environ.get("LLM_MODEL_AUXILIARY")
        or (
            "gemini-3.5-flash-lite"
            if (not os.environ.get("LLM_API_KEY") and os.environ.get("GEMINI_API_KEY"))
            else "gpt-4o-mini"
        )
    )
    embedding_enabled: bool = field(
        default_factory=lambda: _parse_bool(
            os.environ.get("EMBEDDING_ENABLED"), default=False
        )
    )
    llm_model_embedding: str = field(
        default_factory=lambda: os.environ.get(
            "LLM_MODEL_EMBEDDING", "text-embedding-3-small"
        )
    )
    llm_request_timeout_seconds: int = field(
        default_factory=lambda: int(
            os.environ.get("LLM_REQUEST_TIMEOUT_SECONDS", "120")
        )
    )

    # 28-33: GitHub & Mail
    github_token: str = field(
        default_factory=lambda: os.environ.get("GITHUB_TOKEN", "")
    )
    github_api_base_url: str = field(
        default_factory=lambda: os.environ.get(
            "GITHUB_API_BASE_URL", "https://api.github.com"
        )
    )
    mail_provider_api_key: str = field(
        default_factory=lambda: os.environ.get("MAIL_PROVIDER_API_KEY", "")
    )
    mail_from_address: str = field(
        default_factory=lambda: os.environ.get(
            "MAIL_FROM_ADDRESS", "noreply@example.com"
        )
    )
    digest_send_hour_jst: int = field(
        default_factory=lambda: int(os.environ.get("DIGEST_SEND_HOUR_JST", "7"))
    )
    digest_max_papers_per_user: int = field(
        default_factory=lambda: int(os.environ.get("DIGEST_MAX_PAPERS_PER_USER", "5"))
    )

    # 34-38: Batch / Worker Control
    job_max_attempts: int = field(
        default_factory=lambda: int(os.environ.get("JOB_MAX_ATTEMPTS", "3"))
    )
    full_text_daily_limit: int = field(
        default_factory=lambda: int(os.environ.get("FULL_TEXT_DAILY_LIMIT", "50"))
    )
    on_demand_sync_wait_seconds: int = field(
        default_factory=lambda: int(os.environ.get("ON_DEMAND_SYNC_WAIT_SECONDS", "5"))
    )
    view_events_retention_days: int = field(
        default_factory=lambda: int(os.environ.get("VIEW_EVENTS_RETENTION_DAYS", "180"))
    )
    summarize_concurrency: int = field(
        default_factory=lambda: int(os.environ.get("SUMMARIZE_CONCURRENCY", "4"))
    )
    default_worker_concurrency: int = field(
        default_factory=lambda: int(os.environ.get("DEFAULT_WORKER_CONCURRENCY", "4"))
    )
    full_text_concurrency: int = field(
        default_factory=lambda: int(os.environ.get("FULL_TEXT_CONCURRENCY", "1"))
    )
    embedding_concurrency: int = field(
        default_factory=lambda: int(os.environ.get("EMBEDDING_CONCURRENCY", "2"))
    )
    github_link_concurrency: int = field(
        default_factory=lambda: int(os.environ.get("GITHUB_LINK_CONCURRENCY", "1"))
    )
    github_link_daily_limit: int = field(
        default_factory=lambda: int(os.environ.get("GITHUB_LINK_DAILY_LIMIT", "100"))
    )
    reprocess_max_per_run: int = field(
        default_factory=lambda: int(os.environ.get("REPROCESS_MAX_PER_RUN", "1000"))
    )

    # 39-41: Logging & Monitoring
    log_level: str = field(
        default_factory=lambda: os.environ.get("LOG_LEVEL", "INFO")
    )
    sentry_dsn: str = field(
        default_factory=lambda: os.environ.get("SENTRY_DSN", "")
    )


def get_config() -> WorkerConfig:
    return WorkerConfig()
