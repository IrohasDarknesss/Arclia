"""5-aspect grounding and numerical verification checker for generated summaries (ARC004, BT.B003)."""

from __future__ import annotations

import re
from typing import Any, Callable

from worker.summary.schema import extract_claim_objects

# Standard English stop words / common tokens and domain acronyms excluded from proper-noun matching
_COMMON_ENGLISH_WORDS = frozenset(
    {
        "A",
        "AN",
        "AND",
        "ARE",
        "AS",
        "AT",
        "BY",
        "FOR",
        "FROM",
        "IN",
        "INTO",
        "IS",
        "IT",
        "OF",
        "ON",
        "OR",
        "THAT",
        "THE",
        "THIS",
        "TO",
        "VIA",
        "WITH",
        "AI",
        "ML",
        "NLP",
        "LLM",
        "LLMS",
        "PDF",
        "URL",
        "API",
        "CPU",
        "GPU",
        "TPU",
        "JIT",
        "SOTA",
        "UI",
        "UX",
        "OS",
        "ID",
        "REST",
        "HTTP",
        "HTTPS",
        "JSON",
        "SQL",
        "RGB",
        "RGBD",
        "FPS",
        "2D",
        "3D",
        "4D",
        "CNN",
        "RNN",
        "GNN",
        "GAN",
        "VAE",
        "RL",
        "OOD",
        "IOU",
        "MAP",
        "AUC",
        "ROC",
        "BLEU",
        "ROUGE",
    }
)

# Regex for numbers in claims (excludes c01-style claim IDs beforehand)
_NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_])(\d+(?:\.\d+)?)\s*(%|倍|件|個|層|時間|日|年|k|M|B)?")
# Regex for Latin proper nouns / acronyms / model names (2+ chars, contains uppercase or digit)
_PROPER_NOUN_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9\-_.]{1,}\b")


_ENGLISH_NUMBER_WORDS = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
    "first": "1",
    "second": "2",
    "third": "3",
    "fourth": "4",
    "fifth": "5",
    "hundred": "100",
    "thousand": "1000",
}


def _extract_source_numbers(source_text: str) -> set[str]:
    """Extract normalized numeric literals and spelled-out number words from the English source text."""
    nums: set[str] = set()
    for match in re.finditer(r"\b\d+(?:,\d{3})*(?:\.\d+)?\b", source_text):
        raw = match.group(0).replace(",", "")
        nums.add(raw)
        try:
            val = float(raw)
            nums.add(f"{val:g}")
        except ValueError:
            pass
    # Also extract English number words (e.g. "nine" -> "9", "first" -> "1")
    lower_text = source_text.lower()
    for word, digit in _ENGLISH_NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", lower_text):
            nums.add(digit)
    return nums


def _check_1_citations(
    claims: list[dict[str, Any]],
    citations: list[dict[str, Any]],
    source_scope: str,
) -> list[str]:
    """Check 1: 1-to-1 correspondence between claims and summary_citations."""
    reasons: list[str] = []
    claim_ids = {c["claim_id"] for c in claims if "claim_id" in c}
    cit_map: dict[str, dict[str, Any]] = {}
    for cit in citations:
        cid = cit.get("claim_id")
        if not cid:
            reasons.append("citation_check: citation with empty claim_id")
            continue
        if cid in cit_map:
            reasons.append(f"citation_check: duplicate citation for claim_id '{cid}'")
        cit_map[cid] = cit

    missing = sorted(claim_ids - set(cit_map.keys()))
    extra = sorted(set(cit_map.keys()) - claim_ids)
    if missing:
        reasons.append(f"citation_check: missing citations for {missing}")
    if extra:
        reasons.append(f"citation_check: extra citations for {extra}")

    for cid, cit in cit_map.items():
        surl = cit.get("source_url") or ""
        ssec = cit.get("source_section")
        spage = cit.get("source_page")
        if not surl.startswith(("http://", "https://")):
            reasons.append(f"citation_check: invalid source_url for {cid}")
        if source_scope == "abstract_only":
            if ssec != "Abstract":
                reasons.append(
                    f"citation_check: abstract_only summary must have source_section='Abstract' for {cid} (got {ssec!r})"
                )
            if spage is not None:
                reasons.append(
                    f"citation_check: abstract_only summary must have source_page=NULL for {cid} (got {spage!r})"
                )
        elif source_scope == "full_text":
            if not ssec or not str(ssec).strip():
                reasons.append(
                    f"citation_check: full_text summary requires non-empty source_section for {cid}"
                )
    return reasons


def _check_2_numbers(
    claims: list[dict[str, Any]],
    source_text: str,
) -> list[str]:
    """Check 2: Every number in a `basis='fact'` claim must appear in the source text."""
    reasons: list[str] = []
    source_nums = _extract_source_numbers(source_text)
    source_lower = source_text.lower()

    for claim in claims:
        if claim.get("basis") != "fact":
            continue
        cid = claim.get("claim_id", "?")
        text = claim.get("text", "")
        # Strip LaTeX inline markers or known model token suffixes like 16B / 128k if present directly in source
        for match in _NUMBER_RE.finditer(text):
            num_str = match.group(1)
            unit = match.group(2) or ""
            # Check direct match or combined token match (e.g. "128k", "16B", "4.0")
            combined = f"{num_str}{unit}".lower()
            if num_str in source_nums or combined in source_lower:
                continue
            try:
                normalized = f"{float(num_str):g}"
                if normalized in source_nums:
                    continue
            except ValueError:
                pass
            reasons.append(
                f"number_check: number '{num_str}{unit}' in fact claim {cid} not found in source text"
            )
    return reasons


def _check_3_proper_nouns(
    claims: list[dict[str, Any]],
    source_text: str,
) -> list[str]:
    """Check 3: Proper nouns / acronyms / dataset names in `basis='fact'` claims must exist in source text."""
    reasons: list[str] = []
    source_lower = source_text.lower()

    for claim in claims:
        if claim.get("basis") != "fact":
            continue
        cid = claim.get("claim_id", "")
        text = claim.get("text", "")
        for match in _PROPER_NOUN_RE.finditer(text):
            token = match.group(0).strip(".-_")
            if len(token) < 2:
                continue
            # Only inspect tokens that look like proper nouns / acronyms / model names (have uppercase or digit)
            if not any(ch.isupper() or ch.isdigit() for ch in token):
                continue
            if token.upper() in _COMMON_ENGLISH_WORDS:
                continue
            # Ignore pure numbers+unit tokens already checked by _check_2_numbers (e.g. 128k, 16B)
            if re.match(r"^\d+(?:\.\d+)?[kKmMbBGBTB]+$", token):
                continue
            if token.lower() not in source_lower:
                reasons.append(
                    f"proper_noun_check: term '{token}' in fact claim {cid} not found in source text"
                )
    return reasons


def _check_5_source_scope(
    summary_type: str,
    source_scope: str,
    citations: list[dict[str, Any]],
    page_count: int | None = None,
) -> list[str]:
    """Check 5: Consistency between summary_type, source_scope, and PDF page bounds."""
    reasons: list[str] = []
    if summary_type in ("short", "standard") and source_scope != "abstract_only":
        reasons.append(
            f"scope_check: {summary_type} summary must have source_scope='abstract_only' (got '{source_scope}')"
        )
    if summary_type == "deep" and source_scope != "full_text":
        reasons.append(
            f"scope_check: deep summary must have source_scope='full_text' (got '{source_scope}')"
        )

    if source_scope == "full_text" and page_count is not None and page_count >= 1:
        for cit in citations:
            cid = cit.get("claim_id", "?")
            spage = cit.get("source_page")
            if spage is not None and (spage < 1 or spage > page_count):
                reasons.append(
                    f"scope_check: citation for {cid} has source_page={spage} outside 1..{page_count}"
                )
    return reasons


def check_grounding(
    summary_type: str,
    source_scope: str,
    json_content: dict[str, Any],
    citations: list[dict[str, Any]],
    source_text: str,
    page_count: int | None = None,
    llm_entailment_checker: Callable[[list[dict[str, Any]], str, str], list[str]] | None = None,
) -> list[str]:
    """Run all 5 grounding validation checks (ARC004, BT.B003).

    1. Citation correspondence (`_check_1_citations`)
    2. Numerical consistency (`_check_2_numbers`)
    3. Proper noun / dataset / model name consistency (`_check_3_proper_nouns`)
    4. Assertion / entailment check via LLM (`llm_entailment_checker`)
    5. Source scope & page range consistency (`_check_5_source_scope`)

    Returns list of failure reasons (empty list means `passed`).
    """
    claims = extract_claim_objects(json_content)
    reasons: list[str] = []

    reasons.extend(_check_1_citations(claims, citations, source_scope))
    reasons.extend(_check_2_numbers(claims, source_text))
    reasons.extend(_check_3_proper_nouns(claims, source_text))
    reasons.extend(_check_5_source_scope(summary_type, source_scope, citations, page_count))

    # Run Check 4 (LLM entailment) only if rule-based checks 1, 2, 3, 5 passed (saves LLM cost on obvious failures)
    if not reasons and llm_entailment_checker is not None:
        entailment_reasons = llm_entailment_checker(claims, source_text, source_scope)
        reasons.extend(entailment_reasons)

    return reasons
