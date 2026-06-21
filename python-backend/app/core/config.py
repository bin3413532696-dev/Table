from functools import lru_cache
from pathlib import Path
from typing import Literal

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
    server_port: int = Field(default=8787, validation_alias=AliasChoices("PYTHON_SERVER_PORT", "SERVER_PORT"))
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
    rag_quality_preflight_enabled: bool = Field(default=True, validation_alias="RAG_QUALITY_PREFLIGHT_ENABLED")
    rag_quality_preflight_max_pages: int = Field(default=3, validation_alias="RAG_QUALITY_PREFLIGHT_MAX_PAGES")
    rag_quality_min_valid_ratio: float = Field(default=0.80, validation_alias="RAG_QUALITY_MIN_VALID_RATIO")
    rag_quality_scan_detection_chars: int = Field(default=50, validation_alias="RAG_QUALITY_SCAN_DETECTION_CHARS")
    rag_pdf_text_fast_path_min_chars: int = Field(default=500, validation_alias="RAG_PDF_TEXT_FAST_PATH_MIN_CHARS")
    rag_pdf_parser: Literal["markitdown", "pypdf", "ocr"] = Field(
        default="markitdown",
        validation_alias="RAG_PDF_PARSER",
    )
    rag_pdf_markitdown_min_chars: int = Field(default=200, validation_alias="RAG_PDF_MARKITDOWN_MIN_CHARS")
    rag_pdf_extract_images_enabled: bool = Field(default=True, validation_alias="RAG_PDF_EXTRACT_IMAGES_ENABLED")
    rag_pdf_vector_graphics_min_size: int = Field(default=100, validation_alias="RAG_PDF_VECTOR_GRAPHICS_MIN_SIZE")
    rag_pdf_vector_graphics_min_paths: int = Field(default=5, validation_alias="RAG_PDF_VECTOR_GRAPHICS_MIN_PATHS")
    rag_vision_llm_enabled: bool = Field(default=True, validation_alias="RAG_VISION_LLM_ENABLED")
    rag_vision_llm_model: str = Field(default="gpt-4o", validation_alias="RAG_VISION_LLM_MODEL")
    rag_vision_llm_api_key: str | None = Field(default=None, validation_alias="RAG_VISION_LLM_API_KEY")
    rag_vision_llm_base_url: str | None = Field(default=None, validation_alias="RAG_VISION_LLM_BASE_URL")
    rag_vision_llm_timeout_ms: int = Field(default=30000, validation_alias="RAG_VISION_LLM_TIMEOUT_MS")
    rag_vision_llm_max_retries: int = Field(default=2, validation_alias="RAG_VISION_LLM_MAX_RETRIES")
    rag_vision_llm_max_images_per_doc: int = Field(default=50, validation_alias="RAG_VISION_LLM_MAX_IMAGES_PER_DOC")
    rag_vision_llm_max_concurrency: int = Field(default=3, validation_alias="RAG_VISION_LLM_MAX_CONCURRENCY")

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
