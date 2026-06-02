import uuid
from decimal import Decimal
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    display_name: Mapped[str] = mapped_column("display_name", String)
    status: Mapped[str] = mapped_column(String, default="active")
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )


class UserSetting(Base):
    __tablename__ = "user_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), unique=True, index=True)
    theme: Mapped[str] = mapped_column(String, default="light")
    profile_json: Mapped[dict] = mapped_column("profile_json", JSONB, default=dict)
    notification_json: Mapped[dict] = mapped_column("notification_json", JSONB, default=dict)
    security_pin_hash: Mapped[str | None] = mapped_column("security_pin_hash", String, nullable=True)
    agent_preferences_json: Mapped[dict] = mapped_column("agent_preferences_json", JSONB, default=dict)
    provider_config_hash: Mapped[str | None] = mapped_column("provider_config_hash", String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        default=func.now(),
        server_default=func.now(),
    )
    version: Mapped[int] = mapped_column(Integer, default=1)


class ApiProvider(Base):
    __tablename__ = "api_providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    name: Mapped[str] = mapped_column(String)
    api_format: Mapped[str] = mapped_column("api_format", String)
    base_url: Mapped[str] = mapped_column("base_url", String)
    api_key_encrypted: Mapped[str | None] = mapped_column("api_key_encrypted", String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    embedding_model: Mapped[str | None] = mapped_column("embedding_model", String, nullable=True)
    reranker_model: Mapped[str | None] = mapped_column("reranker_model", String, nullable=True)
    headers_json: Mapped[dict] = mapped_column("headers_json", JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column("is_active", Boolean, default=False)
    source: Mapped[str] = mapped_column(String, default="manual")
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    version: Mapped[int] = mapped_column(Integer, default=1)


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    title: Mapped[str] = mapped_column(String, default="新会话")
    memory_summary: Mapped[str] = mapped_column("memory_summary", Text, default="")
    memory_preferences_json: Mapped[list[str]] = mapped_column("memory_preferences_json", JSONB, default=list)
    memory_facts_json: Mapped[list[str]] = mapped_column("memory_facts_json", JSONB, default=list)
    memory_goals_json: Mapped[list[dict]] = mapped_column("memory_goals_json", JSONB, default=list)
    memory_todos_json: Mapped[list[dict]] = mapped_column("memory_todos_json", JSONB, default=list)
    memory_rules_json: Mapped[list[str]] = mapped_column("memory_rules_json", JSONB, default=list)
    memory_status: Mapped[str] = mapped_column("memory_status", String, default="idle")
    memory_updated_at: Mapped[datetime | None] = mapped_column("memory_updated_at", DateTime(timezone=True), nullable=True)
    memory_disabled: Mapped[bool] = mapped_column("memory_disabled", Boolean, default=False)
    memory_run_count: Mapped[int] = mapped_column("memory_run_count", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    session_id: Mapped[uuid.UUID] = mapped_column("session_id", UUID(as_uuid=True), index=True)
    status: Mapped[str] = mapped_column(String)
    input_text: Mapped[str] = mapped_column("input_text", Text)
    model: Mapped[str] = mapped_column(String)
    messages_json: Mapped[list[dict] | None] = mapped_column("messages_json", JSONB, default=list)
    executed_tool_calls_json: Mapped[list[dict] | None] = mapped_column("executed_tool_calls_json", JSONB, default=list)
    pending_tool_calls_json: Mapped[list[dict] | None] = mapped_column("pending_tool_calls_json", JSONB, default=list)
    assistant_text_chunks_json: Mapped[list[str] | None] = mapped_column(
        "assistant_text_chunks_json",
        JSONB,
        default=list,
    )
    timeline_json: Mapped[list[dict] | None] = mapped_column("timeline_json", JSONB, default=list)
    final_text: Mapped[str] = mapped_column("final_text", Text, default="")
    error_text: Mapped[str | None] = mapped_column("error_text", Text, nullable=True)
    iteration_count: Mapped[int] = mapped_column("iteration_count", Integer, default=0)
    requires_confirmation: Mapped[bool] = mapped_column("requires_confirmation", Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    version: Mapped[int] = mapped_column(Integer, default=1)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    title: Mapped[str] = mapped_column(String(200))
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    due_date: Mapped[date | None] = mapped_column("due_date", Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    version: Mapped[int] = mapped_column(Integer, default=1)


class FinanceRecord(Base):
    __tablename__ = "finance_records"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    type: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    category: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500))
    record_date: Mapped[date] = mapped_column("record_date", Date)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    version: Mapped[int] = mapped_column(Integer, default=1)


class KnowledgeNote(Base):
    __tablename__ = "knowledge_notes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, default="")
    tags_json: Mapped[list[str]] = mapped_column("tags_json", JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )


class KnowledgePresetTag(Base):
    __tablename__ = "knowledge_preset_tags"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(7), default="#6B7280")
    sort_order: Mapped[int] = mapped_column("sort_order", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    title: Mapped[str] = mapped_column(String(500))
    summary: Mapped[str | None] = mapped_column(String, default="")
    content: Mapped[str | None] = mapped_column(Text, default="")
    source: Mapped[str | None] = mapped_column(String, nullable=True)
    file_type: Mapped[str | None] = mapped_column("file_type", String, nullable=True)
    file_size: Mapped[int | None] = mapped_column("file_size", Integer, default=0)
    status: Mapped[str | None] = mapped_column(String, default="pending")
    tags_json: Mapped[list[str] | None] = mapped_column("tags_json", JSONB, default=list)
    content_hash: Mapped[str | None] = mapped_column("content_hash", String, nullable=True)
    version: Mapped[int | None] = mapped_column(Integer, default=1)
    publish_date: Mapped[date | None] = mapped_column("publish_date", Date, nullable=True)
    source_dept: Mapped[str | None] = mapped_column("source_dept", String, nullable=True)
    security_level: Mapped[str | None] = mapped_column("security_level", String, nullable=True)
    business_category: Mapped[str | None] = mapped_column("business_category", String, nullable=True)
    doc_language: Mapped[str | None] = mapped_column("doc_language", String, nullable=True)
    parse_quality: Mapped[str | None] = mapped_column("parse_quality", String, nullable=True)
    has_ocr: Mapped[bool] = mapped_column("has_ocr", Boolean, default=False)
    original_metadata: Mapped[dict | None] = mapped_column("original_metadata", JSONB, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    document_id: Mapped[uuid.UUID] = mapped_column("document_id", UUID(as_uuid=True), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column("content_hash", String)
    chunk_index: Mapped[int | None] = mapped_column("chunk_index", Integer, default=0)
    start_pos: Mapped[int | None] = mapped_column("start_pos", Integer, default=0)
    end_pos: Mapped[int | None] = mapped_column("end_pos", Integer, default=0)
    embedding_model: Mapped[str | None] = mapped_column("embedding_model", String, nullable=True)
    heading_chain: Mapped[str | None] = mapped_column("heading_chain", String, nullable=True)
    heading_level: Mapped[int | None] = mapped_column("heading_level", Integer, nullable=True)
    embedding_dimensions: Mapped[int | None] = mapped_column("embedding_dimensions", Integer, nullable=True)
    embedding_version: Mapped[int | None] = mapped_column("embedding_version", Integer, nullable=True)
    chunk_type: Mapped[str] = mapped_column("chunk_type", String, default="small")
    parent_id: Mapped[uuid.UUID | None] = mapped_column("parent_id", UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        "updated_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )


class KnowledgeIndexJob(Base):
    __tablename__ = "knowledge_index_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column("document_id", UUID(as_uuid=True), nullable=True)
    job_type: Mapped[str] = mapped_column("job_type", String)
    status: Mapped[str | None] = mapped_column(String, default="pending")
    progress: Mapped[int | None] = mapped_column(Integer, default=0)
    error_json: Mapped[dict | None] = mapped_column("error_json", JSONB, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column("started_at", DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column("completed_at", DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )


class KnowledgeEmbeddingCache(Base):
    __tablename__ = "knowledge_embedding_cache"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column("user_id", UUID(as_uuid=True), index=True)
    content_hash: Mapped[str] = mapped_column("content_hash", String)
    embedding_model: Mapped[str] = mapped_column("embedding_model", String)
    created_at: Mapped[datetime | None] = mapped_column(
        "created_at",
        DateTime(timezone=True),
        server_default=func.now(),
    )
    expires_at: Mapped[datetime | None] = mapped_column("expires_at", DateTime(timezone=True), nullable=True)
