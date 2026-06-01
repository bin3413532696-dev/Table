from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from time import time
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.provider_crypto import decrypt_provider_secret
from app.repositories.providers import find_active_provider_for_user
from app.services.api_urls import build_v1_api_url


_QUERY_EMBEDDING_CACHE: dict[str, tuple[float, list[float]]] = {}


def format_vector_for_db(embedding: list[float]) -> str:
    return "[" + ",".join(str(value) for value in embedding) + "]"


def validate_embedding_dimensions(embedding: list[float], settings: Settings | None = None) -> None:
    current = settings or get_settings()
    if len(embedding) != current.embedding_dimensions:
        raise ValueError(
            f"Embedding dimension mismatch: expected {current.embedding_dimensions}, got {len(embedding)}"
        )


@dataclass(frozen=True)
class EmbeddingChunkInput:
    chunk_id: str
    content_hash: str
    content: str


@dataclass(frozen=True)
class EmbeddingRuntimeConfig:
    api_key: str
    base_url: str
    model: str
    dimensions: int
    timeout_ms: int
    max_retries: int
    headers: dict[str, str]


def _to_string_record(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


async def resolve_embedding_runtime_config(
    session: AsyncSession,
    user_id: str,
    settings: Settings | None = None,
) -> EmbeddingRuntimeConfig | None:
    current = settings or get_settings()
    if current.embedding_api_key:
        return EmbeddingRuntimeConfig(
            api_key=current.embedding_api_key,
            base_url=(current.embedding_base_url or "https://api.openai.com").rstrip("/"),
            model=current.embedding_model,
            dimensions=current.embedding_dimensions,
            timeout_ms=current.embedding_timeout_ms,
            max_retries=current.embedding_max_retries,
            headers={},
        )

    provider = await find_active_provider_for_user(session, user_id)
    if not provider or provider.api_format not in {"openai", "custom"}:
        return None

    api_key = decrypt_provider_secret(provider.api_key_encrypted, current)
    base_url = (provider.base_url or "").strip().rstrip("/")
    if not api_key or not base_url:
        return None

    return EmbeddingRuntimeConfig(
        api_key=api_key,
        base_url=base_url,
        model=(provider.embedding_model or current.embedding_model).strip(),
        dimensions=current.embedding_dimensions,
        timeout_ms=current.embedding_timeout_ms,
        max_retries=current.embedding_max_retries,
        headers=_to_string_record(provider.headers_json),
    )


async def embedding_provider_available(
    session: AsyncSession,
    user_id: str,
    settings: Settings | None = None,
) -> bool:
    runtime_config = await resolve_embedding_runtime_config(session, user_id, settings)
    return runtime_config is not None


def _query_cache_key(query: str, model: str) -> str:
    return f"{model}:{sha256(query.strip().lower().encode('utf-8')).hexdigest()}"


def get_cached_query_embedding(query: str, model: str) -> list[float] | None:
    key = _query_cache_key(query, model)
    cached = _QUERY_EMBEDDING_CACHE.get(key)
    if not cached:
        return None
    timestamp, embedding = cached
    if time() - timestamp > 3600:
        _QUERY_EMBEDDING_CACHE.pop(key, None)
        return None
    return embedding


def set_cached_query_embedding(query: str, model: str, embedding: list[float]) -> None:
    key = _query_cache_key(query, model)
    _QUERY_EMBEDDING_CACHE[key] = (time(), embedding)


class OpenAICompatibleEmbeddingClient:
    def __init__(self, runtime_config: EmbeddingRuntimeConfig) -> None:
        self._config = runtime_config

    async def embed(self, inputs: list[str]) -> list[list[float]]:
        payload: dict[str, Any] = {
            "model": self._config.model,
            "input": inputs,
        }
        if self._config.dimensions:
            payload["dimensions"] = self._config.dimensions

        last_error: Exception | None = None
        for attempt in range(self._config.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self._config.timeout_ms / 1000) as client:
                    response = await client.post(
                        build_v1_api_url(self._config.base_url, "/embeddings"),
                        headers={
                            **self._config.headers,
                            "Authorization": f"Bearer {self._config.api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                    )
                    response.raise_for_status()
                    data = response.json()
                    embeddings = [item["embedding"] for item in data.get("data", [])]
                    for embedding in embeddings:
                        if len(embedding) != self._config.dimensions:
                            raise ValueError(
                                f"Embedding dimension mismatch: expected {self._config.dimensions}, got {len(embedding)}"
                            )
                    return embeddings
            except Exception as exc:
                last_error = exc
                if attempt >= self._config.max_retries:
                    break
        raise RuntimeError(f"Embedding request failed: {last_error}") from last_error


async def _resolve_runtime_config_or_raise(
    *,
    session: AsyncSession | None,
    user_id: str | None,
    settings: Settings | None,
    runtime_config: EmbeddingRuntimeConfig | None,
) -> EmbeddingRuntimeConfig:
    if runtime_config is not None:
        return runtime_config
    if session is None or user_id is None:
        raise RuntimeError("Embedding runtime config requires session and user_id")
    resolved = await resolve_embedding_runtime_config(session, user_id, settings)
    if resolved is None:
        raise RuntimeError("Embedding provider is not configured")
    return resolved


async def embed_query(
    query: str,
    settings: Settings | None = None,
    *,
    session: AsyncSession | None = None,
    user_id: str | None = None,
    runtime_config: EmbeddingRuntimeConfig | None = None,
) -> list[float]:
    current = settings or get_settings()
    config = await _resolve_runtime_config_or_raise(
        session=session,
        user_id=user_id,
        settings=current,
        runtime_config=runtime_config,
    )
    cached = get_cached_query_embedding(query, config.model)
    if cached:
        return cached
    client = OpenAICompatibleEmbeddingClient(config)
    embedding = (await client.embed([query]))[0]
    validate_embedding_dimensions(embedding, current)
    set_cached_query_embedding(query, config.model, embedding)
    return embedding


async def embed_chunk_batch(
    chunks: list[EmbeddingChunkInput],
    settings: Settings | None = None,
    *,
    session: AsyncSession | None = None,
    user_id: str | None = None,
    runtime_config: EmbeddingRuntimeConfig | None = None,
) -> list[dict]:
    config = await _resolve_runtime_config_or_raise(
        session=session,
        user_id=user_id,
        settings=settings,
        runtime_config=runtime_config,
    )
    client = OpenAICompatibleEmbeddingClient(config)
    embeddings = await client.embed([chunk.content for chunk in chunks])
    return [
        {
            "chunkId": chunk.chunk_id,
            "contentHash": chunk.content_hash,
            "embedding": embedding,
            "embeddingModel": config.model,
        }
        for chunk, embedding in zip(chunks, embeddings, strict=False)
    ]
