"""OpenAI-compatible LLM client for structured summary generation, entailment verification, and GitHub explanation (IF04)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from worker.config import get_config
from worker.llm.prompts import (
    build_entailment_prompt,
    build_github_explanation_prompt,
    build_summary_prompt,
)


class LlmClientError(RuntimeError):
    """Raised when the LLM API call or JSON parsing fails."""


class LlmClient:
    def __init__(self) -> None:
        self._cfg = get_config()

    def _model_for_summary_type(self, summary_type: str) -> str:
        if summary_type == "short":
            return self._cfg.llm_model_summary_short
        if summary_type == "standard":
            return self._cfg.llm_model_summary_standard
        if summary_type == "deep":
            return self._cfg.llm_model_summary_deep
        return self._cfg.llm_model_summary_standard

    def _chat_json(
        self,
        model: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> tuple[dict[str, Any], str]:
        if not self._cfg.llm_api_key:
            raise LlmClientError("LLM_API_KEY is not configured")

        if "generativelanguage.googleapis.com" in self._cfg.llm_api_base_url:
            clean_model = model.replace("models/", "")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent"
            headers = {
                "x-goog-api-key": self._cfg.llm_api_key,
                "Content-Type": "application/json",
            }
            body = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": f"{system_prompt}\n\nStrict JSON output required adhering to schema:\n{user_prompt}"
                            }
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": temperature,
                    "response_mime_type": "application/json",
                },
            }
            with httpx.Client(timeout=float(self._cfg.llm_request_timeout_seconds)) as client:
                resp = client.post(url, headers=headers, json=body)
                resp.raise_for_status()
                data = resp.json()

            actual_model = clean_model
            try:
                content_str = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(content_str)
            except Exception as exc:
                raise LlmClientError(f"Failed to parse JSON response from Gemini: {exc}") from exc

            if not isinstance(parsed, dict):
                raise LlmClientError("Gemini response root must be a JSON object")
            return parsed, str(actual_model)

        url = f"{self._cfg.llm_api_base_url.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self._cfg.llm_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        with httpx.Client(timeout=float(self._cfg.llm_request_timeout_seconds)) as client:
            resp = client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

        actual_model = data.get("model") or model
        try:
            content_str = data["choices"][0]["message"]["content"]
            parsed = json.loads(content_str)
        except Exception as exc:
            raise LlmClientError(f"Failed to parse JSON response from LLM: {exc}") from exc

        if not isinstance(parsed, dict):
            raise LlmClientError("LLM response root must be a JSON object")
        return parsed, str(actual_model)

    def generate_summary(
        self,
        summary_type: str,
        arxiv_id: str,
        version: int,
        title: str,
        abstract: str,
        full_text: str | None = None,
        rejection_reasons: list[str] | None = None,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
        """Generate `(json_content, citations, model_id)` for `short`, `standard`, or `deep` summary."""
        model = self._model_for_summary_type(summary_type)
        sys_prompt, usr_prompt = build_summary_prompt(
            summary_type=summary_type,
            arxiv_id=arxiv_id,
            version=version,
            title=title,
            abstract=abstract,
            full_text=full_text,
            rejection_reasons=rejection_reasons,
        )
        parsed, actual_model = self._chat_json(model, sys_prompt, usr_prompt)
        json_content = parsed.get("json_content")
        citations = parsed.get("citations")
        if not isinstance(json_content, dict) or not isinstance(citations, list):
            raise LlmClientError(
                "LLM response must include 'json_content' object and 'citations' array"
            )

        default_source_url = (
            f"https://arxiv.org/pdf/{arxiv_id}v{version}.pdf"
            if summary_type == "deep"
            else f"https://arxiv.org/abs/{arxiv_id}v{version}"
        )
        for cit in citations:
            if isinstance(cit, dict):
                surl = cit.get("source_url")
                if not surl or not isinstance(surl, str) or not surl.startswith("http"):
                    cit["source_url"] = default_source_url
                if summary_type != "deep":
                    cit["source_page"] = None
                    if not cit.get("source_section"):
                        cit["source_section"] = "Abstract"

        return json_content, citations, actual_model

    def check_entailment(
        self,
        claims: list[dict[str, Any]],
        source_text: str,
        source_scope: str,
    ) -> list[str]:
        """Run Check 4 (assertion/entailment verification) using `LLM_MODEL_VALIDATOR`."""
        if not self._cfg.llm_api_key:
            return []
        sys_prompt, usr_prompt = build_entailment_prompt(claims, source_text, source_scope)
        parsed, _ = self._chat_json(
            self._cfg.llm_model_validator,
            sys_prompt,
            usr_prompt,
            temperature=0.0,
        )
        violations = parsed.get("violations") or []
        reasons: list[str] = []
        if isinstance(violations, list):
            for v in violations:
                if isinstance(v, dict):
                    cid = v.get("claim_id", "?")
                    reason = v.get("reason", "entailment violation")
                    reasons.append(f"assertion_check: {cid}: {reason}")
        return reasons

    def generate_code_explanation(
        self,
        title: str,
        abstract: str,
        repo_full_name: str,
        tree_paths: list[str],
        readme_excerpt: str,
    ) -> tuple[dict[str, Any], str]:
        """Generate `(code_explanation, model_id)` for B009 GitHub repository linking."""
        sys_prompt, usr_prompt = build_github_explanation_prompt(
            title=title,
            abstract=abstract,
            repo_full_name=repo_full_name,
            tree_paths=tree_paths,
            readme_excerpt=readme_excerpt,
        )
        return self._chat_json(
            self._cfg.llm_model_auxiliary,
            sys_prompt,
            usr_prompt,
            temperature=0.2,
        )
