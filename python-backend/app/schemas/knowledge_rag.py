from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator

DocumentStatus = Literal["pending", "processing", "indexed", "failed", "deleted"]
FileType = Literal["pdf", "md", "txt", "markdown"]
SecurityLevel = Literal["public", "internal", "confidential", "secret"]
JobStatus = Literal["pending", "running", "completed", "failed"]
JobType = Literal["full_index", "reindex"]
SearchMode = Literal["hybrid", "semantic", "keyword"]


class UpdateDocumentRequest(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)] | None = None
    summary: Annotated[str, StringConstraints(max_length=2000)] | None = None
    tags: list[Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)]] | None = Field(
        default=None,
        max_length=20,
    )
    status: DocumentStatus | None = None

    @model_validator(mode="after")
    def ensure_mutation_fields(self) -> "UpdateDocumentRequest":
        if not self.model_fields_set:
            raise ValueError("At least one field must be provided")
        return self


class TriggerIndexRequest(BaseModel):
    force: bool = False


class DocumentListQuery(BaseModel):
    status: DocumentStatus | None = None
    fileType: FileType | None = None
    tags: list[Annotated[str, StringConstraints(max_length=50)]] | None = Field(default=None, max_length=10)
    publishDateStart: str | None = None
    publishDateEnd: str | None = None
    sourceDept: list[Annotated[str, StringConstraints(max_length=50)]] | None = Field(default=None, max_length=10)
    securityLevel: SecurityLevel | None = None
    businessCategory: list[Annotated[str, StringConstraints(max_length=50)]] | None = Field(default=None, max_length=10)
    limit: int = Field(default=20, gt=0, le=100)
    offset: int = Field(default=0, ge=0)


class ChunkListQuery(BaseModel):
    documentId: str
    limit: int = Field(default=50, gt=0, le=100)
    offset: int = Field(default=0, ge=0)


class JobListQuery(BaseModel):
    status: JobStatus | None = None
    documentId: str | None = None
    limit: int = Field(default=20, gt=0, le=50)
    offset: int = Field(default=0, ge=0)


class HybridSearchRequest(BaseModel):
    query: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    tags: list[Annotated[str, StringConstraints(max_length=50)]] | None = Field(default=None, max_length=10)
    documentIds: list[str] | None = Field(default=None, max_length=20)
    mode: SearchMode = "hybrid"
    limit: int = Field(default=10, gt=0, le=50)
    threshold: float = Field(default=0.2, ge=0, le=1)
    fusionWeight: float = Field(default=0.7, ge=0, le=1)
    enableRerank: bool = False
    rerankerThreshold: float | None = Field(default=None, ge=0, le=1)
    useBm25: bool = False
    enableQueryPreprocess: bool = False
    enableExpansion: bool = False
    enableRewrite: bool = True
    enableMmr: bool = False
    mmrLambda: float | None = Field(default=None, ge=0, le=1)
    publishDateRange: dict[str, str | None] | None = None
    sourceDept: list[Annotated[str, StringConstraints(max_length=50)]] | None = Field(default=None, max_length=10)
    securityLevel: SecurityLevel | None = None
    businessCategory: list[Annotated[str, StringConstraints(max_length=50)]] | None = Field(default=None, max_length=10)


class OCRHealthResponse(BaseModel):
    enabled: bool
    available: bool
    serviceUrl: str


class BackfillEmbeddingsResponse(BaseModel):
    count: int


class KnowledgeDocumentResponse(BaseModel):
    id: str
    userId: str
    title: str
    summary: str
    content: str
    source: str | None
    fileType: str | None
    fileSize: int
    status: str
    tags: list[str]
    contentHash: str | None
    version: int
    publishDate: int | None
    sourceDept: str | None
    securityLevel: str | None
    businessCategory: str | None
    docLanguage: str | None
    parseQuality: str | None
    hasOcr: bool
    originalMetadata: dict | None = None
    createdAt: int
    updatedAt: int


class KnowledgeChunkResponse(BaseModel):
    id: str
    documentId: str
    userId: str
    content: str
    contentHash: str
    chunkIndex: int
    startPos: int
    endPos: int
    headingChain: str | None = None
    headingLevel: int | None = None
    embeddingDimensions: int | None = None
    embeddingVersion: int | None = None
    chunkType: str | None = None
    parentId: str | None = None
    hasEmbedding: bool
    embeddingModel: str | None
    createdAt: int
    updatedAt: int


class IndexJobResponse(BaseModel):
    id: str
    userId: str
    documentId: str | None
    jobType: str
    status: str
    progress: int
    error: dict | None
    startedAt: int | None
    completedAt: int | None
    createdAt: int


class RagStatsResponse(BaseModel):
    documentCount: int
    indexedDocumentCount: int
    chunkCount: int
    chunkWithEmbeddingCount: int
    cacheCount: int


class SearchResultResponse(BaseModel):
    id: str
    documentId: str
    documentTitle: str
    content: str
    parentChunkId: str | None = None
    parentContent: str | None = None
    chunkIndex: int
    score: float
    source: str
    sourceInfo: str | None
    publishDate: int | None = None
    sourceDept: str | None = None
    securityLevel: str | None = None
    businessCategory: str | None = None


class SearchResponse(BaseModel):
    results: list[SearchResultResponse]
    semanticCount: int
    keywordCount: int
    queryEmbeddingTimeMs: int
    searchTimeMs: int
    preprocessTimeMs: int | None = None
    mmrTimeMs: int | None = None
    rerankTimeMs: int | None = None


class DocumentListEnvelope(BaseModel):
    items: list[KnowledgeDocumentResponse]
    total: int


class ChunkListEnvelope(BaseModel):
    items: list[KnowledgeChunkResponse]
    total: int


class JobListEnvelope(BaseModel):
    items: list[IndexJobResponse]
    total: int
