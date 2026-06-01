from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.finance import FinanceRecordResponse
from app.schemas.knowledge import NoteResponse, PresetTagResponse
from app.schemas.task import TaskResponse

ResetScope = Literal["all", "tasks", "finance", "knowledge"]


class ImportedKnowledgePayload(BaseModel):
    notes: list[dict[str, Any]] | None = Field(default=None, max_length=10000)
    presetTags: list[dict[str, Any]] | None = Field(default=None, max_length=1000)


class ImportBusinessSnapshotRequest(BaseModel):
    version: int | None = Field(default=None, ge=1)
    tasks: list[dict[str, Any]] | None = Field(default=None, max_length=10000)
    finance: list[dict[str, Any]] | None = Field(default=None, max_length=10000)
    knowledge: ImportedKnowledgePayload | None = None


class ResetWorkspaceRequest(BaseModel):
    scope: ResetScope = "all"


class BusinessSnapshotKnowledgeResponse(BaseModel):
    notes: list[NoteResponse]
    presetTags: list[PresetTagResponse]


class BusinessSnapshotResponse(BaseModel):
    version: int
    exportedAt: str
    tasks: list[TaskResponse]
    finance: list[FinanceRecordResponse]
    knowledge: BusinessSnapshotKnowledgeResponse


class ImportBusinessSnapshotResponse(BaseModel):
    success: bool
    importedAt: str
    backup: BusinessSnapshotResponse
    tasks: int
    finance: int
    notes: int
    presetTags: int


class ResetWorkspaceResponse(BaseModel):
    success: bool
    scope: ResetScope
    resetAt: str
