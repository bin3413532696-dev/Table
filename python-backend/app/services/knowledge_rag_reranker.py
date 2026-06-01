from __future__ import annotations

from dataclasses import dataclass
from time import time
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.provider_crypto import decrypt_provider_secret
from app.repositories.providers import find_active_provider_for_user
from app.schemas.knowledge_rag import SearchResultResponse


@dataclass(frozen=True)
class RerankerRuntimeConfig:
    api_key: str
    base_url: str
    model: str
    timeout_ms: int
    headers: dict[str, str]
    max_tokens: int


@dataclass(frozen=True)
class RerankResult:
    results: list[SearchResultResponse]
    rerank_time_ms: int


def _to_string_record(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


async def resolve_reranker_runtime_config(
    session: AsyncSession,
    user_id: str,
    settings: Settings | None = None,
) -> RerankerRuntimeConfig | None:
    current = settings or get_settings()
    provider = await find_active_provider_for_user(session, user_id)
    if not provider:
        return None

    api_key = decrypt_provider_secret(provider.api_key_encrypted, current)
    base_url = (provider.base_url or "").strip().rstrip("/")
    model = (provider.reranker_model or "").strip()
    if not api_key or not base_url or not model:
        return None

    return RerankerRuntimeConfig(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_ms=current.reranker_timeout_ms,
        headers=_to_string_record(provider.headers_json),
        max_tokens=current.reranker_max_tokens,
    )


def estimate_tokens(text: str) -> int:
    chinese_chars = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    non_chinese_chars = len(text) - chinese_chars
    return int((chinese_chars * 1.5) + (non_chinese_chars * 0.25) + 0.9999)


def truncate_by_tokens(text: str, max_tokens: int) -> str:
    if estimate_tokens(text) <= max_tokens:
        return text

    truncated = text[: max_tokens]
    while truncated and estimate_tokens(truncated) > max_tokens:
        truncated = truncated[:-10]
    return truncated


class OpenAICompatibleRerankerClient:
    def __init__(self, runtime_config: RerankerRuntimeConfig) -> None:
        self._config = runtime_config

    async def rerank(self, *, query: str, documents: list[str], top_n: int) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self._config.timeout_ms / 1000) as client:
            response = await client.post(
                f"{self._config.base_url}/rerank",
                headers={
                    **self._config.headers,
                    "Authorization": f"Bearer {self._config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._config.model,
                    "query": query,
                    "documents": documents,
                    "top_n": min(top_n, len(documents)),
                    "return_documents": False,
                },
            )
            response.raise_for_status()
            payload = response.json()
        return [item for item in (payload.get("results") or []) if isinstance(item, dict)]


async def cross_encoder_rerank(
    session: AsyncSession,
    user_id: str,
    query: str,
    results: list[SearchResultResponse],
    *,
    top_n: int,
    settings: Settings | None = None,
) -> RerankResult:
    started_at = time()
    current = settings or get_settings()
    if not results:
        return RerankResult(results=[], rerank_time_ms=0)

    runtime_config = await resolve_reranker_runtime_config(session, user_id, current)
    if runtime_config is None:
        return RerankResult(
            results=results[:top_n],
            rerank_time_ms=max(int((time() - started_at) * 1000), 0),
        )

    try:
        documents = [truncate_by_tokens(result.content, runtime_config.max_tokens) for result in results]
        client = OpenAICompatibleRerankerClient(runtime_config)
        rerank_scores = await client.rerank(query=query, documents=documents, top_n=top_n)
        reranked_results = [
            results[int(item["index"])].model_copy(
                update={
                    "score": float(item.get("relevance_score") or 0.0),
                    "source": "reranked",
                }
            )
            for item in rerank_scores
            if isinstance(item.get("index"), int) and 0 <= int(item["index"]) < len(results)
        ]
        reranked_results.sort(key=lambda item: item.score, reverse=True)
        if not reranked_results:
            reranked_results = results[:top_n]
        else:
            reranked_results = reranked_results[:top_n]
        return RerankResult(
            results=reranked_results,
            rerank_time_ms=max(int((time() - started_at) * 1000), 0),
        )
    except Exception:
        return RerankResult(
            results=results[:top_n],
            rerank_time_ms=max(int((time() - started_at) * 1000), 0),
        )
