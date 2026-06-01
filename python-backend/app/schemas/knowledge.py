from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, model_validator

TrimmedTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
NoteContent = Annotated[str, StringConstraints(max_length=50000)]
TagValue = Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)]
PresetTagName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
PresetTagColor = Annotated[str, StringConstraints(strip_whitespace=True, max_length=7)]


class CreateNoteRequest(BaseModel):
    title: TrimmedTitle
    content: NoteContent = ""
    tags: list[TagValue] = Field(default_factory=list, max_length=20)


class UpdateNoteRequest(BaseModel):
    title: TrimmedTitle | None = None
    content: NoteContent | None = None
    tags: list[TagValue] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdateNoteRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        return self


class NoteSearchQuery(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    tags: str | list[TagValue] | None = None
    limit: int = Field(default=20, gt=0, le=50)
    offset: int = Field(default=0, ge=0, le=100000)


class CreatePresetTagRequest(BaseModel):
    name: PresetTagName
    color: PresetTagColor = "#6B7280"


class UpdatePresetTagRequest(BaseModel):
    name: PresetTagName | None = None
    color: PresetTagColor | None = None
    sortOrder: int | None = Field(default=None, ge=0, le=9999)

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdatePresetTagRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        return self


class NoteResponse(BaseModel):
    id: str
    title: str
    content: str
    tags: list[str]
    createdAt: int
    updatedAt: int


class NoteSearchHitResponse(BaseModel):
    id: str
    title: str
    content: str
    tags: list[str]
    score: float
    updatedAt: int


class PresetTagResponse(BaseModel):
    id: str
    name: str
    color: str
    sortOrder: int


class KnowledgeMetadataResponse(BaseModel):
    noteCount: int
    presetTagCount: int


class NoteEnvelope(BaseModel):
    data: NoteResponse
    source: str


class NoteListEnvelope(BaseModel):
    items: list[NoteResponse]
    total: int
    source: str


class SearchResultListEnvelope(BaseModel):
    items: list[NoteSearchHitResponse]
    total: int
    source: str


class TagListEnvelope(BaseModel):
    items: list[str]
    total: int
    source: str


class PresetTagEnvelope(BaseModel):
    data: PresetTagResponse
    source: str


class PresetTagListEnvelope(BaseModel):
    items: list[PresetTagResponse]
    total: int
    source: str


class KnowledgeMetadataEnvelope(BaseModel):
    data: KnowledgeMetadataResponse
    source: str
