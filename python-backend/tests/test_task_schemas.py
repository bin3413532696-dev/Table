from app.schemas.task import CreateTaskRequest, UpdateTaskRequest
from pydantic import ValidationError
import pytest


def test_create_task_request_trims_input() -> None:
    payload = CreateTaskRequest(title="  Hello  ", notes="  body  ")
    assert payload.title == "Hello"
    assert payload.notes == "body"


def test_update_task_request_requires_mutation_field() -> None:
    with pytest.raises(ValidationError):
        UpdateTaskRequest(version=1)
