"""Unit tests for Arclia Python worker core logic (ARC001, ARC003, ARC004, ARC005, B001-B011)."""

from __future__ import annotations

import unittest

from worker.integrations.arxiv_client import parse_arxiv_atom_feed
from worker.integrations.embedding_client import (
    EmbeddingValidationError,
    compute_embedding_input_hash,
    validate_embedding_vector,
)
from worker.integrations.github_client import extract_github_candidates_from_abstract
from worker.jobs.routes import resolve_route
from worker.license.gate import is_full_text_allowed
from worker.summary.checker import check_grounding
from worker.summary.reuse import can_reuse_abstract_summary
from worker.summary.schema import validate_schema


def test_license_gate_arc005() -> None:
    assert is_full_text_allowed("http://creativecommons.org/licenses/by/4.0/") is True
    assert is_full_text_allowed("https://creativecommons.org/licenses/by-sa/4.0/") is True
    assert is_full_text_allowed("http://creativecommons.org/publicdomain/zero/1.0/") is True
    assert is_full_text_allowed("CC BY 4.0") is True
    # Disallowed licenses (fail-safe)
    assert is_full_text_allowed(None) is False
    assert is_full_text_allowed("") is False
    assert (
        is_full_text_allowed("http://arxiv.org/licenses/nonexclusive-distrib/1.0/")
        is False
    )
    assert (
        is_full_text_allowed("http://creativecommons.org/licenses/by-nc-sa/4.0/")
        is False
    )


def test_summary_schema_and_grounding_arc003_arc004() -> None:
    source_text = (
        "Sparse Mixture-of-Experts for Long-Context Reasoning in Large Language Models.\n"
        "We propose a sparse Mixture-of-Experts (MoE) architecture tailored for long-context "
        "reasoning up to 128k tokens. Our 16B active parameter model achieves 91.4% accuracy on GSM8K "
        "and reduces memory footprint by 42.0%."
    )
    json_content = {
        "schema_version": 1,
        "summary_type": "short",
        "title_ja": "大規模言語モデルにおける長文脈推論のためのスパースMixture-of-Experts",
        "thesis": {
            "claim_id": "c01",
            "text": "16BパラメータのスパースMoEによりGSM8Kで91.4%の精度を達成しメモリを42.0%削減した。",
            "basis": "fact",
        },
        "key_points": [
            {
                "claim_id": "c02",
                "text": "128kトークンの長文脈推論に対応したMoEを提案。",
                "basis": "fact",
            },
            {
                "claim_id": "c03",
                "text": "長文ドキュメント解析への応用が期待される。",
                "basis": "inference",
            },
        ],
    }
    citations = [
        {
            "claim_id": "c01",
            "source_section": "Abstract",
            "source_page": None,
            "source_url": "https://arxiv.org/abs/2501.12345v1",
        },
        {
            "claim_id": "c02",
            "source_section": "Abstract",
            "source_page": None,
            "source_url": "https://arxiv.org/abs/2501.12345v1",
        },
        {
            "claim_id": "c03",
            "source_section": "Abstract",
            "source_page": None,
            "source_url": "https://arxiv.org/abs/2501.12345v1",
        },
    ]

    assert validate_schema("short", json_content, citations) == []
    assert (
        check_grounding(
            summary_type="short",
            source_scope="abstract_only",
            json_content=json_content,
            citations=citations,
            source_text=source_text,
        )
        == []
    )

    # Hallucinated number in a fact claim must be caught by Check 2
    bad_content = {
        **json_content,
        "thesis": {
            "claim_id": "c01",
            "text": "GSM8Kで99.9%の精度を達成した。",
            "basis": "fact",
        },
    }
    reasons = check_grounding(
        summary_type="short",
        source_scope="abstract_only",
        json_content=bad_content,
        citations=citations,
        source_text=source_text,
    )
    assert any("number_check" in r for r in reasons)


def test_abstract_reuse_arc001() -> None:
    assert can_reuse_abstract_summary("Hello   world\nnew line", "Hello world new line") is True
    assert can_reuse_abstract_summary("Hello world v1", "Hello world v2") is False


def test_github_url_extraction_and_routes() -> None:
    abstract = "Code is available at https://github.com/example-org/moe-reasoning.git and https://github.com/about."
    assert extract_github_candidates_from_abstract(abstract) == [
        "example-org/moe-reasoning"
    ]
    assert resolve_route("summarize_abstract").queue == "summarize"
    assert resolve_route("analyze_full_text").queue == "fulltext"
    assert resolve_route("generate_embedding").queue == "embedding"
    assert resolve_route("link_github").queue == "github"


def test_embedding_validation() -> None:
    _, h1 = compute_embedding_input_hash("Title A", "Abstract B")
    assert len(h1) == 64
    valid_vec = [0.01] * 1536
    assert len(validate_embedding_vector(valid_vec)) == 1536
    try:
        validate_embedding_vector([0.0] * 1536)
        raise AssertionError("Expected EmbeddingValidationError")
    except EmbeddingValidationError:
        pass


def test_arxiv_atom_parser() -> None:
    sample_xml = """<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom"
          xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
          xmlns:arxiv="http://arxiv.org/schemas/atom">
      <opensearch:totalResults>1</opensearch:totalResults>
      <entry>
        <id>http://arxiv.org/abs/2501.12345v2</id>
        <published>2026-10-25T14:00:00Z</published>
        <updated>2026-10-26T09:30:00Z</updated>
        <title>Test Title</title>
        <summary>Test Abstract</summary>
        <author><name>Taro Yamada</name></author>
        <arxiv:primary_category term="cs.CL"/>
        <category term="cs.CL"/>
        <category term="cs.AI"/>
        <arxiv:license>http://creativecommons.org/licenses/by/4.0/</arxiv:license>
      </entry>
    </feed>
    """
    entries, total = parse_arxiv_atom_feed(sample_xml)
    assert total == 1
    assert len(entries) == 1
    assert entries[0].arxiv_id == "2501.12345"
    assert entries[0].version == 2
    assert entries[0].categories == ["cs.CL", "cs.AI"]
    assert entries[0].license_type == "http://creativecommons.org/licenses/by/4.0/"


class WorkerUnitTestSuite(unittest.TestCase):
    def test_all(self) -> None:
        test_license_gate_arc005()
        test_summary_schema_and_grounding_arc003_arc004()
        test_abstract_reuse_arc001()
        test_github_url_extraction_and_routes()
        test_embedding_validation()
        test_arxiv_atom_parser()


if __name__ == "__main__":
    unittest.main()
