from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

FinanceType = Literal["income", "expense"]
TrimmedCategory = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
TrimmedDescription = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
TrimmedModel = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]
DateInput = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{4}-\d{2}-\d{2}$")]


def validate_date_string(value: str) -> str:
    date.fromisoformat(value)
    return value


class CreateFinanceRecordRequest(BaseModel):
    type: FinanceType
    amount: Annotated[float, Field(ge=0, le=999999999.99)]
    category: TrimmedCategory
    description: TrimmedDescription
    date: DateInput | None = None
    recordDate: DateInput | None = None
    model: TrimmedModel | None = None

    @model_validator(mode="after")
    def ensure_record_date(self) -> "CreateFinanceRecordRequest":
        if not (self.date or self.recordDate):
            raise ValueError("date or recordDate is required")
        if self.date:
            validate_date_string(self.date)
        if self.recordDate:
            validate_date_string(self.recordDate)
        return self


class UpdateFinanceRecordRequest(BaseModel):
    type: FinanceType | None = None
    amount: Annotated[float | None, Field(ge=0, le=999999999.99)] = None
    category: TrimmedCategory | None = None
    description: TrimmedDescription | None = None
    date: DateInput | None = None
    recordDate: DateInput | None = None
    model: TrimmedModel | None = None
    version: int

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdateFinanceRecordRequest":
        changed_fields = {name for name in self.model_fields_set if name != "version"}
        if not changed_fields:
            raise ValueError("At least one field must be provided")
        if self.date:
            validate_date_string(self.date)
        if self.recordDate:
            validate_date_string(self.recordDate)
        return self


class FinanceRecordResponse(BaseModel):
    id: str
    type: FinanceType
    amount: float
    description: str
    category: str
    date: str
    model: str | None = None
    createdAt: int
    updatedAt: int
    version: int


class FinanceRecordEnvelope(BaseModel):
    data: FinanceRecordResponse
    source: str


class FinanceRecordListEnvelope(BaseModel):
    items: list[FinanceRecordResponse]
    total: int
    source: str
