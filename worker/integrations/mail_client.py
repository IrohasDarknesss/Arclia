"""Supabase Auth Admin email resolver and transactional email sender for B007 (IF05, IF09, BT.B007)."""

from __future__ import annotations

from typing import Any

import httpx

from worker.config import get_config


def fetch_user_emails_from_auth(user_ids: list[str]) -> dict[str, str]:
    """Fetch confirmed user email addresses from Supabase Auth Admin API (`/auth/v1/admin/users`)."""
    if not user_ids:
        return {}
    cfg = get_config()
    if not cfg.supabase_service_role_key:
        return {}

    target_set = set(user_ids)
    emails: dict[str, str] = {}
    url = f"{cfg.supabase_url.rstrip('/')}/auth/v1/admin/users"
    headers = {
        "apikey": cfg.supabase_service_role_key,
        "Authorization": f"Bearer {cfg.supabase_service_role_key}",
    }

    with httpx.Client(timeout=20.0) as client:
        resp = client.get(url, headers=headers, params={"per_page": 1000})
        resp.raise_for_status()
        data = resp.json()

    users_list = data.get("users") if isinstance(data, dict) else []
    for u in users_list or []:
        if not isinstance(u, dict):
            continue
        uid = str(u.get("id") or "")
        email = u.get("email")
        confirmed = u.get("email_confirmed_at") or u.get("confirmed_at")
        if uid in target_set and email and confirmed:
            emails[uid] = str(email)
    return emails


def send_digest_email(
    to_email: str,
    delivery_date: str,
    papers: list[dict[str, Any]],
) -> None:
    """Send daily digest email via Resend-compatible HTTP API (IF09, BT.B007 FN04)."""
    cfg = get_config()
    if not cfg.mail_provider_api_key:
        raise RuntimeError("MAIL_PROVIDER_API_KEY is not configured")

    app_url = cfg.app_url.rstrip("/")
    lines = [
        f"Arclia 新着論文ダイジェスト ({delivery_date})",
        "",
        "設定された興味トピックに一致する新着論文をお届けします。",
        "",
    ]
    for idx, p in enumerate(papers, start=1):
        title_ja = p.get("title_ja") or p.get("title") or ""
        thesis = p.get("thesis_text") or ""
        arxiv_id = p.get("arxiv_id") or ""
        cat = (p.get("categories") or [""])[0]
        lines.append(f"{idx}. [{cat}] {title_ja}")
        if thesis:
            lines.append(f"   要点: {thesis}")
        lines.append(f"   詳細: {app_url}/papers/{arxiv_id}")
        lines.append("")

    lines.append("---")
    lines.append(f"配信設定の変更・停止（マイページ）: {app_url}/mypage")
    text_body = "\n".join(lines)

    headers = {
        "Authorization": f"Bearer {cfg.mail_provider_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "from": cfg.mail_from_address,
        "to": [to_email],
        "subject": f"【Arclia】新着論文ダイジェスト ({delivery_date} / {len(papers)}件)",
        "text": text_body,
    }
    with httpx.Client(timeout=10.0) as client:
        resp = client.post("https://api.resend.com/emails", headers=headers, json=payload)
        resp.raise_for_status()
