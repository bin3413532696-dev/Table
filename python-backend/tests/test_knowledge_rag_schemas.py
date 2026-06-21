import pytest
from fastapi import Request
from pydantic import ValidationError

from app.api.routes.knowledge_rag import parse_document_list_query, parse_upload_tags
from app.schemas.knowledge_rag import DocumentListQuery, JobListQuery, TriggerIndexRequest, UpdateDocumentRequest


def make_request(query_string: bytes) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/knowledge-rag/documents",
        "query_string": query_string,
        "headers": [],
    }
    return Request(scope)


def test_document_list_query_accepts_filters() -> None:
    payload = DocumentListQuery(tags=["policy"], sourceDept=["ops"], limit=10)
    assert payload.tags == ["policy"]
    assert payload.sourceDept == ["ops"]
    assert payload.limit == 10


def test_parse_document_list_query_supports_comma_separated_filters() -> None:
    payload = parse_document_list_query(
        make_request(b"tags=policy,ops&sourceDept=legal,finance&businessCategory=a,b&limit=5")
    )
    assert payload.tags == ["policy", "ops"]
    assert payload.sourceDept == ["legal", "finance"]
    assert payload.businessCategory == ["a", "b"]
    assert payload.limit == 5


def test_parse_upload_tags_accepts_json_array() -> None:
    assert parse_upload_tags('["a", "b", 1]') == ["a", "b"]


def test_update_document_requires_mutation_field() -> None:
    with pytest.raises(ValidationError):
        UpdateDocumentRequest()


def test_job_list_query_defaults() -> None:
    payload = JobListQuery()
    assert payload.limit == 20
    assert payload.offset == 0


def test_trigger_index_defaults_force_false() -> None:
    payload = TriggerIndexRequest()
    assert payload.force is False
