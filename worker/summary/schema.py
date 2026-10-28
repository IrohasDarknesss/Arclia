"""Structured summary JSON schema validation (ARC003, BT.B002, BT.B003, BT.B005)."""

from __future__ import annotations

import re
from typing import Any

CLAIM_ID_RE = re.compile(r"^c[0-9]{2,3}$")
URL_RE = re.compile(r"^https?://\S+$")
VALID_BASIS = {"fact", "inference"}


def _validate_claim(
    obj: Any,
    path: str,
    seen_claim_ids: set[str],
    errors: list[str],
) -> None:
    if not isinstance(obj, dict):
        errors.append(f"{path}: must be an object")
        return
    claim_id = obj.get("claim_id")
    text = obj.get("text")
    basis = obj.get("basis")

    if not isinstance(claim_id, str) or not CLAIM_ID_RE.match(claim_id):
        errors.append(f"{path}.claim_id: must match ^c[0-9]{{2,3}}$")
    elif claim_id in seen_claim_ids:
        errors.append(f"{path}.claim_id: duplicate claim_id '{claim_id}'")
    else:
        seen_claim_ids.add(claim_id)

    if not isinstance(text, str) or not text.strip():
        errors.append(f"{path}.text: must be a non-empty string")
    elif len(text) > 600:
        errors.append(f"{path}.text: exceeds 600 characters ({len(text)})")

    if basis not in VALID_BASIS:
        errors.append(f"{path}.basis: must be 'fact' or 'inference'")


def _validate_claim_array(
    arr: Any,
    path: str,
    min_len: int,
    max_len: int,
    seen_claim_ids: set[str],
    errors: list[str],
) -> None:
    if not isinstance(arr, list):
        errors.append(f"{path}: must be a list")
        return
    if not (min_len <= len(arr) <= max_len):
        errors.append(
            f"{path}: length must be between {min_len} and {max_len} (got {len(arr)})"
        )
    for idx, item in enumerate(arr):
        _validate_claim(item, f"{path}[{idx}]", seen_claim_ids, errors)


def extract_claim_objects(json_content: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract all claim objects (`{claim_id, text, basis}`) from a structured summary JSON."""
    claims: list[dict[str, Any]] = []
    if not isinstance(json_content, dict):
        return claims

    thesis = json_content.get("thesis")
    if isinstance(thesis, dict) and "claim_id" in thesis:
        claims.append(thesis)

    summary_type = json_content.get("summary_type")
    if summary_type == "short":
        for item in json_content.get("key_points") or []:
            if isinstance(item, dict):
                claims.append(item)
    else:
        for field_name in (
            "problem",
            "method",
            "results",
            "limitations",
            "applications",
            "background_and_related_work",
            "reproducibility",
        ):
            for item in json_content.get(field_name) or []:
                if isinstance(item, dict):
                    claims.append(item)
    return claims


def validate_schema(
    summary_type: str,
    json_content: dict[str, Any],
    citations: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Validate `summaries.json_content` (and optional citations) against ARC003 schema.

    Returns a list of human-readable violation strings (empty list means valid).
    """
    errors: list[str] = []
    if not isinstance(json_content, dict):
        return ["json_content must be a JSON object"]

    if json_content.get("schema_version") != 1:
        errors.append("schema_version must be 1")

    if json_content.get("summary_type") != summary_type:
        errors.append(
            f"summary_type in json_content ('{json_content.get('summary_type')}') does not match '{summary_type}'"
        )

    title_ja = json_content.get("title_ja")
    if not isinstance(title_ja, str) or not title_ja.strip():
        errors.append("title_ja must be a non-empty string")
    elif len(title_ja) > 300:
        errors.append(f"title_ja exceeds 300 characters ({len(title_ja)})")

    seen_claim_ids: set[str] = set()
    _validate_claim(json_content.get("thesis"), "thesis", seen_claim_ids, errors)

    if summary_type == "short":
        _validate_claim_array(
            json_content.get("key_points"),
            "key_points",
            2,
            4,
            seen_claim_ids,
            errors,
        )
    elif summary_type == "standard":
        _validate_claim_array(
            json_content.get("problem"), "problem", 1, 3, seen_claim_ids, errors
        )
        _validate_claim_array(
            json_content.get("method"), "method", 1, 4, seen_claim_ids, errors
        )
        _validate_claim_array(
            json_content.get("results"), "results", 1, 4, seen_claim_ids, errors
        )
        _validate_claim_array(
            json_content.get("limitations"),
            "limitations",
            1,
            3,
            seen_claim_ids,
            errors,
        )
        _validate_claim_array(
            json_content.get("applications"),
            "applications",
            1,
            3,
            seen_claim_ids,
            errors,
        )
    elif summary_type == "deep":
        _validate_claim_array(
            json_content.get("problem"), "problem", 1, 4, seen_claim_ids, errors
        )
        _validate_claim_array(
            json_content.get("method"), "method", 2, 6, seen_claim_ids, errors
        )
        _validate_claim_array(
            json_content.get("results"), "results", 2, 6, seen_claim_ids, errors
        )
        _validate_claim_array(
            json_content.get("limitations"),
            "limitations",
            1,
            4,
            seen_claim_ids,
            errors,
        )
        _validate_claim_array(
            json_content.get("applications"),
            "applications",
            1,
            4,
            seen_claim_ids,
            errors,
        )
        _validate_claim_array(
            json_content.get("background_and_related_work"),
            "background_and_related_work",
            1,
            4,
            seen_claim_ids,
            errors,
        )
        _validate_claim_array(
            json_content.get("reproducibility"),
            "reproducibility",
            1,
            4,
            seen_claim_ids,
            errors,
        )

        # Optional appendix fields in deep summary: key_formulas & references
        key_formulas = json_content.get("key_formulas")
        if key_formulas is not None:
            if not isinstance(key_formulas, list) or len(key_formulas) > 5:
                errors.append("key_formulas must be a list of at most 5 items")
            else:
                for idx, formula in enumerate(key_formulas):
                    if not isinstance(formula, dict):
                        errors.append(f"key_formulas[{idx}] must be an object")
                        continue
                    for req_key in ("formula_id", "latex", "meaning_ja", "variables", "source_section"):
                        if req_key not in formula:
                            errors.append(f"key_formulas[{idx}].{req_key} is required")

        references = json_content.get("references")
        if references is not None:
            if not isinstance(references, list) or len(references) > 20:
                errors.append("references must be a list of at most 20 items")
            else:
                for idx, ref in enumerate(references):
                    if not isinstance(ref, dict):
                        errors.append(f"references[{idx}] must be an object")
                        continue
                    for req_key in ("ref_id", "title", "authors", "role_ja"):
                        if req_key not in ref:
                            errors.append(f"references[{idx}].{req_key} is required")
    else:
        errors.append(f"Unknown summary_type: '{summary_type}'")

    if citations is not None:
        if not isinstance(citations, list):
            errors.append("citations must be a list")
        else:
            seen_cit_claims: set[str] = set()
            for idx, cit in enumerate(citations):
                if not isinstance(cit, dict):
                    errors.append(f"citations[{idx}] must be an object")
                    continue
                cid = cit.get("claim_id")
                surl = cit.get("source_url")
                spage = cit.get("source_page")
                if not isinstance(cid, str) or not cid.strip():
                    errors.append(f"citations[{idx}].claim_id must be non-empty")
                elif cid in seen_cit_claims:
                    errors.append(f"citations[{idx}].claim_id '{cid}' is duplicated")
                else:
                    seen_cit_claims.add(cid)

                if not isinstance(surl, str) or not URL_RE.match(surl):
                    errors.append(f"citations[{idx}].source_url must be a valid http(s) URL")
                if spage is not None and (not isinstance(spage, int) or spage < 1):
                    errors.append(f"citations[{idx}].source_page must be null or integer >= 1")

            if seen_claim_ids and seen_cit_claims != seen_claim_ids:
                missing = sorted(seen_claim_ids - seen_cit_claims)
                extra = sorted(seen_cit_claims - seen_claim_ids)
                if missing:
                    errors.append(f"citations missing for claim_ids: {missing}")
                if extra:
                    errors.append(f"citations has unknown claim_ids: {extra}")

    return errors
