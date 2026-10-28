"""Embedding generation client for B008 (IF04, BT.B008)."""

from __future__ import annotations

import hashlib
import math
from typing import Any

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore

from worker.config import get_config

EMBEDDING_DIMENSIONS = 1536


class EmbeddingValidationError(RuntimeError):
    """Raised when the returned embedding vector fails dimension or finiteness checks."""


def compute_embedding_input_hash(title: str, abstract: str) -> tuple[str, str]:
    """Return `(input_text, sha256_hex_hash)` for `Title: ...\n\nAbstract: ...` (BT.B008 §4)."""
    input_text = f"Title: {title.strip()}\n\nAbstract: {abstract.strip()}"
    digest = hashlib.sha256(input_text.encode("utf-8")).hexdigest()
    return input_text, digest


def validate_embedding_vector(vec: Any) -> list[float]:
    """Verify that the vector has exactly 1536 finite numbers and is not all zeros (BT.B008 §4)."""
    if not isinstance(vec, list) or len(vec) != EMBEDDING_DIMENSIONS:
        raise EmbeddingValidationError(
            f"Expected {EMBEDDING_DIMENSIONS}-dimensional vector, got {len(vec) if isinstance(vec, list) else type(vec).__name__}"
        )
    floats: list[float] = []
    has_non_zero = False
    for val in vec:
        if not isinstance(val, (int, float)) or not math.isfinite(float(val)):
            raise EmbeddingValidationError("Embedding contains non-finite value")
        fval = float(val)
        if fval != 0.0:
            has_non_zero = True
        floats.append(fval)
    if not has_non_zero:
        raise EmbeddingValidationError("Embedding vector is all zeros")
    return floats


def fetch_embedding(input_text: str) -> tuple[list[float], str]:
    """Call `/embeddings` endpoint and return `(vector_1536, model_id)` (BT.B008 IF04)."""
    cfg = get_config()
    if not cfg.llm_api_key:
        raise RuntimeError("LLM_API_KEY is not configured")

    url = f"{cfg.llm_api_base_url.rstrip('/')}/embeddings"
    headers = {
        "Authorization": f"Bearer {cfg.llm_api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": cfg.llm_model_embedding,
        "input": input_text,
    }
    with httpx.Client(timeout=float(cfg.llm_request_timeout_seconds)) as client:
        resp = client.post(url, headers=headers, json=body)
        resp.raise_for_status()
        data = resp.json()

    model_id = str(data.get("model") or cfg.llm_model_embedding)
    raw_vec = data["data"][0]["embedding"]
    validated = validate_embedding_vector(raw_vec)
    return validated, model_id
