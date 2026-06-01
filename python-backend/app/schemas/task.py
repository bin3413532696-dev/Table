from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, model_validator

TaskPriority = Literal["low", "medium", "high"]
TrimmedTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TrimmedDueDate = Annotated[str, StringConstraints(strip_whitespace=True, max_length=30)]
TrimmedNotes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]


class CreateTaskRequest(BaseModel):
    title: TrimmedTitle
    completed: bool | None = None
    priority: TaskPriority = "medium"
    dueDate: TrimmedDueDate | None = None
    notes: TrimmedNotes | None = None


class UpdateTaskRequest(BaseModel):
    title: TrimmedTitle | None = None
    priority: TaskPriority | None = None
    dueDate: TrimmedDueDate | None = None
    notes: TrimmedNotes | None = None
    completed: bool | None = None
    version: int

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdateTaskRequest":
        changed_fields = {name for name in self.model_fields_set if name != "version"}
        if not changed_fields:
            raise ValueError("At least one field must be provided")
        return self


class TaskResponse(BaseModel):
    id: str
    title: str
    completed: bool
    priority: TaskPriority
    dueDate: str | None = None
    notes: str | None = None
    createdAt: int
    updatedAt: int
    version: int


class TaskEnvelope(BaseModel):
    data: TaskResponse
    source: str


class TaskListEnvelope(BaseModel):
    items: list[TaskResponse]
    total: int
    source: str
