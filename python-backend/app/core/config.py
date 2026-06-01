from functools import lru_cache
from typing import Literal
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", SERVICE_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    server_host: str = Field(default="127.0.0.1", validation_alias=AliasChoices("PYTHON_SERVER_HOST", "SERVER_HOST"))
    server_port: int = Field(default=8788, validation_alias=AliasChoices("PYTHON_SERVER_PORT"))
    environment: str = Field(default="development", validation_alias=AliasChoices("PYTHON_ENV", "NODE_ENV"))
    database_url: str = Field(validation_alias="DATABASE_URL")
    allow_default_user_fallback: bool = Field(
        default=False,
        validation_alias="ALLOW_DEFAULT_USER_FALLBACK",
    )
    default_user_id: str = Field(
        default="00000000-0000-0000-0000-000000000001",
        validation_alias="DEFAULT_USER_ID",
    )
    trust_user_id_header: bool = Field(default=False, validation_alias="TRUST_USER_ID_HEADER")
    provider_secret_key: str = Field(
        default="table-dev-provider-secret-key-change-me",
        validation_alias="PROVIDER_SECRET_KEY",
    )
    default_provider_name: str = Field(default="GLM-5 Provider", validation_alias="DEFAULT_PROVIDER_NAME")
    default_provider_format: Literal["anthropic", "openai", "gemini", "custom"] = Field(
        default="openai",
        validation_alias="DEFAULT_PROVIDER_FORMAT",
    )
    default_provider_base_url: str = Field(default="", validation_alias="DEFAULT_PROVIDER_BASE_URL")
    default_provider_api_key: str = Field(default="", validation_alias="DEFAULT_PROVIDER_API_KEY")
    default_provider_model: str = Field(default="", validation_alias="DEFAULT_PROVIDER_MODEL")
    agent_timeout_ms: int = Field(default=300000, validation_alias="AGENT_TIMEOUT_MS")
    rag_upload_dir: str | None = Field(default=None, validation_alias="RAG_UPLOAD_DIR")
    embedding_model: str = Field(default="text-embedding-3-small", validation_alias="EMBEDDING_MODEL")
    embedding_dimensions: int = Field(default=1024, validation_alias="EMBEDDING_DIMENSIONS")
    embedding_api_key: str | None = Field(default=None, validation_alias="EMBEDDING_API_KEY")
    embedding_base_url: str | None = Field(default=None, validation_alias="EMBEDDING_BASE_URL")
    embedding_timeout_ms: int = Field(default=60000, validation_alias="EMBEDDING_TIMEOUT_MS")
    embedding_max_retries: int = Field(default=3, validation_alias="EMBEDDING_MAX_RETRIES")
    embedding_version: int = Field(default=1, validation_alias="EMBEDDING_VERSION")
    search_fusion_weight: float = Field(default=0.7, validation_alias="SEARCH_FUSION_WEIGHT")
    search_default_limit: int = Field(default=20, validation_alias="SEARCH_DEFAULT_LIMIT")
    search_min_threshold: float = Field(default=0.2, validation_alias="SEARCH_MIN_THRESHOLD")
    search_rrf_k: int = Field(default=60, validation_alias="SEARCH_RRF_K")
    reranker_enabled: bool = Field(default=False, validation_alias="RERANKER_ENABLED")
    reranker_top_n: int = Field(default=20, validation_alias="RERANKER_TOP_N")
    reranker_timeout_ms: int = Field(default=2000, validation_alias="RERANKER_TIMEOUT_MS")
    reranker_min_score: float = Field(default=0.3, validation_alias="RERANKER_MIN_SCORE")
    reranker_max_tokens: int = Field(default=400, validation_alias="RERANKER_MAX_TOKENS")
    reranker_enabled_by_default: bool = Field(default=True, validation_alias="RERANKER_ENABLED_BY_DEFAULT")
    reranker_candidate_min: int = Field(default=50, validation_alias="RERANKER_CANDIDATE_MIN")
    reranker_candidate_max: int = Field(default=100, validation_alias="RERANKER_CANDIDATE_MAX")
    mmr_enabled: bool = Field(default=False, validation_alias="MMR_ENABLED")
    mmr_lambda: float = Field(default=0.7, validation_alias="MMR_LAMBDA")
    mmr_enabled_by_default: bool = Field(default=False, validation_alias="MMR_ENABLED_BY_DEFAULT")
    query_preprocessor_enabled: bool = Field(default=False, validation_alias="QUERY_PREPROCESSOR_ENABLED")
    query_expansion_count: int = Field(default=3, validation_alias="QUERY_EXPANSION_COUNT")
    query_rewrite_enabled: bool = Field(default=True, validation_alias="QUERY_REWRITE_ENABLED")
    query_preprocessor_timeout_ms: int = Field(default=10000, validation_alias="QUERY_PREPROCESSOR_TIMEOUT_MS")
    query_preprocessor_enabled_by_default: bool = Field(
        default=False,
        validation_alias="QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT",
    )
    index_max_file_size_mb: int = Field(default=50, validation_alias="INDEX_MAX_FILE_SIZE_MB")
    ocr_service_url: str = Field(default="http://localhost:8001", validation_alias="OCR_SERVICE_URL")
    ocr_enabled: bool = Field(default=True, validation_alias="OCR_ENABLED")
    ocr_timeout_ms: int = Field(default=120000, validation_alias="OCR_TIMEOUT_MS")

    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url.startswith("postgresql+asyncpg://"):
            return self.database_url
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return self.database_url

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
