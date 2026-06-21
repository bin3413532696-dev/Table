import pytest
from fastapi import Request
from pydantic import ValidationError

from app.api.routes.knowledge import parse_search_query
from app.api.routes.knowledge_rag import parse_document_list_query
from app.schemas.knowledge import (
    CreateNoteRequest,
    CreatePresetTagRequest,
    UpdateNoteRequest,
    UpdatePresetTagRequest,
)


def make_request(query_string: bytes) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/knowledge/search",
        "query_string": query_string,
        "headers": [],
    }
    return Request(scope)


def test_create_note_defaults_and_trimmed_values() -> None:
    payload = CreateNoteRequest(title="  Note  ", tags=["  a  ", "b"])
    assert payload.title == "Note"
    assert payload.content == ""
    assert payload.tags == ["a", "b"]


def test_update_note_requires_mutation_field() -> None:
    with pytest.raises(ValidationError):
        UpdateNoteRequest()


def test_create_preset_tag_defaults_color() -> None:
    payload = CreatePresetTagRequest(name="  arch  ")
    assert payload.name == "arch"
    assert payload.color == "#6B7280"


def test_update_preset_tag_requires_mutation_field() -> None:
    with pytest.raises(ValidationError):
        UpdatePresetTagRequest()


def test_parse_search_query_supports_comma_separated_tags() -> None:
    query = parse_search_query(make_request(b"query=test&tags=a,b&limit=10"))
    assert query.query == "test"
    assert query.tags == ["a", "b"]
    assert query.limit == 10


def test_parse_document_list_query_supports_repeated_and_csv_values() -> None:
    query = parse_document_list_query(
        make_request(b"tags=a,b&tags=c&sourceDept=ops,hr&businessCategory=risk&limit=15&offset=5")
    )
    assert query.tags == ["a", "b", "c"]
    assert query.sourceDept == ["ops", "hr"]
    assert query.businessCategory == ["risk"]
    assert query.limit == 15
    assert query.offset == 5
