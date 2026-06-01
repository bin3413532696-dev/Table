from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

ProviderFormat = Literal["anthropic", "openai", "gemini", "custom"]
ProviderSource = Literal["bootstrap", "manual"]


class ProviderResponse(BaseModel):
    id: str
    name: str
    apiFormat: ProviderFormat
    baseUrl: str
    apiKey: str
    model: str | None = None
    embeddingModel: str | None = None
    rerankerModel: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    isActive: bool
    hasApiKey: bool
    apiKeyPreview: str
    source: ProviderSource
    createdAt: str
    updatedAt: str
    version: int


class CreateProviderRequest(BaseModel):
    id: UUID | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    apiFormat: ProviderFormat
    baseUrl: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
    apiKey: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)] = ""
    model: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    embeddingModel: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    rerankerModel: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    headers: dict[str, str] = Field(default_factory=dict)
    isActive: bool = False
    source: ProviderSource = "manual"


class UpdateProviderRequest(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None = None
    apiFormat: ProviderFormat | None = None
    baseUrl: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)] | None = None
    apiKey: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)] | None = None
    model: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    embeddingModel: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    rerankerModel: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    headers: dict[str, str] | None = None
    isActive: bool | None = None
    version: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdateProviderRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        return self


class ProviderListData(BaseModel):
    items: list[ProviderResponse]
    total: int


class ProviderListEnvelope(BaseModel):
    data: ProviderListData


class ProviderDataEnvelope(BaseModel):
    provider: ProviderResponse | None


class ProviderEnvelope(BaseModel):
    data: ProviderDataEnvelope


class ProviderDeleteData(BaseModel):
    id: str
    deleted: bool


class ProviderDeleteEnvelope(BaseModel):
    data: ProviderDeleteData
