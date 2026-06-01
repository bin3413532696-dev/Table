from app.schemas.finance import CreateFinanceRecordRequest, UpdateFinanceRecordRequest
from pydantic import ValidationError
import pytest


def test_create_finance_record_accepts_date_aliases() -> None:
    payload = CreateFinanceRecordRequest(
        type="expense",
        amount=12.5,
        category="  infra  ",
        description="  db  ",
        recordDate="2026-05-31",
    )
    assert payload.category == "infra"
    assert payload.description == "db"
    assert payload.recordDate == "2026-05-31"


def test_create_finance_record_requires_date_or_record_date() -> None:
    with pytest.raises(ValidationError):
        CreateFinanceRecordRequest(
            type="income",
            amount=12.5,
            category="ops",
            description="credit",
        )


def test_update_finance_record_requires_mutation_field() -> None:
    with pytest.raises(ValidationError):
        UpdateFinanceRecordRequest(version=1)
