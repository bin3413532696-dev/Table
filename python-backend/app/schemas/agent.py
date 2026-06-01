from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

AgentRunStatus = Literal[
    "pending",
    "running",
    "waiting_confirmation",
    "completed",
    "failed",
    "cancelled",
]
AgentMessageRole = Literal["user", "assistant", "system", "tool"]
TimelineEventType = Literal[
    "llm_start",
    "llm_end",
    "tool_start",
    "tool_end",
    "confirmation",
    "interrupted",
]
TrimmedSessionTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TrimmedInputText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]
TrimmedModel = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
TrimmedSystemPrompt = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]


class AgentRunMessageDto(BaseModel):
    id: str
    role: AgentMessageRole
    content: str
    createdAt: int | None = None


class AgentRunToolExecutionDto(BaseModel):
    id: str
    toolName: str
    arguments: dict[str, object] = Field(default_factory=dict)
    status: str
    requiresConfirmation: bool | None = None
    result: dict[str, object] | None = None
    errorMessage: str | None = None
    createdAt: int | None = None


class TimelineEvent(BaseModel):
    type: TimelineEventType
    timestamp: str
    data: dict[str, object] = Field(default_factory=dict)


class AgentRunDto(BaseModel):
    id: str
    sessionId: str
    status: str
    inputText: str
    model: str
    createdAt: int
    updatedAt: int
    version: int


class AgentRunDetailDto(AgentRunDto):
    status: AgentRunStatus
    messages: list[AgentRunMessageDto] = Field(default_factory=list)
    executedToolCalls: list[AgentRunToolExecutionDto] = Field(default_factory=list)
    pendingToolCalls: list[AgentRunToolExecutionDto] = Field(default_factory=list)
    requiresConfirmation: bool = False
    finalText: str = ""
    error: str | None = None
    iterationCount: int = 0
    assistantTextChunks: list[str] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)


class AgentSessionDto(BaseModel):
    id: str
    title: str
    createdAt: int
    updatedAt: int
    runs: list[AgentRunDto] = Field(default_factory=list)


class AgentSessionDetailDto(AgentSessionDto):
    messages: list[AgentRunMessageDto] = Field(default_factory=list)


class AgentRuntimeProviderDto(BaseModel):
    id: str
    name: str
    apiFormat: Literal["anthropic", "openai", "gemini", "custom"]
    baseUrl: str
    hasApiKey: bool


class AgentRuntimeDetailsDto(BaseModel):
    connected: bool
    selectedModel: str
    availableModels: list[str] = Field(default_factory=list)
    provider: AgentRuntimeProviderDto | None = None


class AgentRuntimeStatusDto(BaseModel):
    ok: bool
    module: str
    stage: str
    runtime: AgentRuntimeDetailsDto


class AgentSessionListResponse(BaseModel):
    items: list[AgentSessionDto]
    total: int


class AgentRunListResponse(BaseModel):
    items: list[AgentRunDto]
    total: int
    source: str


class AgentDeleteResponse(BaseModel):
    id: str
    deleted: bool


class ListAgentSessionsQuery(BaseModel):
    limit: int = Field(default=20, gt=0, le=50)
    offset: int = Field(default=0, ge=0)


class CreateAgentSessionRequest(BaseModel):
    title: TrimmedSessionTitle = "新会话"


class UpdateAgentSessionRequest(BaseModel):
    title: TrimmedSessionTitle


class ListAgentRunsQuery(BaseModel):
    limit: int = Field(default=20, gt=0, le=50)
    offset: int = Field(default=0, ge=0)
    sessionId: UUID | None = None
    status: AgentRunStatus | None = None


class AgentInitialMessage(BaseModel):
    role: AgentMessageRole
    content: TrimmedInputText
    metadata: dict[str, object] | None = None


class CreateAgentRunRequest(BaseModel):
    inputText: TrimmedInputText
    model: TrimmedModel = "default"
    sessionId: UUID | None = None
    ragEnabled: bool = False
    systemPrompt: TrimmedSystemPrompt | None = None
    initialMessages: list[AgentInitialMessage] = Field(default_factory=list)


class UpdateAgentRunRequest(BaseModel):
    status: AgentRunStatus | None = None
    version: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdateAgentRunRequest":
        changed_fields = {name for name in self.model_fields_set if name != "version"}
        if not changed_fields:
            raise ValueError("At least one field must be provided")
        return self


class AgentPersonaDto(BaseModel):
    systemPrompt: TrimmedSystemPrompt = ""
