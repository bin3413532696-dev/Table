from __future__ import annotations

from dataclasses import dataclass
import re
from time import time
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.provider_crypto import decrypt_provider_secret
from app.repositories.providers import find_active_provider_for_user
from app.services.api_urls import build_v1_api_url


_CHINESE_STOPWORDS = {
    "的",
    "了",
    "在",
    "是",
    "我",
    "有",
    "和",
    "就",
    "不",
    "人",
    "都",
    "一",
    "一个",
    "上",
    "也",
    "很",
    "到",
    "说",
    "要",
    "去",
    "你",
    "会",
    "着",
    "没有",
    "看",
    "好",
    "自己",
    "这",
    "那",
    "什么",
    "怎么",
    "如何",
    "为什么",
    "吗",
    "呢",
    "啊",
    "吧",
    "可以",
    "能够",
    "应该",
    "需要",
    "想",
    "请",
    "谢谢",
    "您好",
    "你好",
}


@dataclass(frozen=True)
class QueryPreprocessResult:
    original_query: str
    expanded_queries: list[str]
    preprocess_time_ms: int


@dataclass(frozen=True)
class QueryExpansionRuntimeConfig:
    api_key: str
    base_url: str
    model: str
    timeout_ms: int
    headers: dict[str, str]


def _to_string_record(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


async def resolve_query_expansion_runtime_config(
    session: AsyncSession,
    user_id: str,
    settings: Settings | None = None,
) -> QueryExpansionRuntimeConfig | None:
    current = settings or get_settings()
    provider = await find_active_provider_for_user(session, user_id)
    if not provider or provider.api_format not in {"openai", "custom"}:
        return None

    api_key = decrypt_provider_secret(provider.api_key_encrypted, current)
    base_url = (provider.base_url or "").strip().rstrip("/")
    model = (provider.model or "").strip()
    if not api_key or not base_url or not model:
        return None

    return QueryExpansionRuntimeConfig(
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_ms=current.query_preprocessor_timeout_ms,
        headers=_to_string_record(provider.headers_json),
    )


def rewrite_query(query: str) -> str:
    tokens = [token.strip() for token in re.split(r"[\s,，。；：！？、]+", query) if token.strip()]
    filtered_tokens = [token for token in tokens if token.lower() not in _CHINESE_STOPWORDS and len(token) > 1]
    return " ".join(filtered_tokens).strip() or query.strip()


class OpenAICompatibleChatClient:
    def __init__(self, runtime_config: QueryExpansionRuntimeConfig) -> None:
        self._config = runtime_config

    async def complete(self, *, system_prompt: str, user_prompt: str) -> str:
        async with httpx.AsyncClient(timeout=self._config.timeout_ms / 1000) as client:
            response = await client.post(
                build_v1_api_url(self._config.base_url, "/chat/completions"),
                headers={
                    **self._config.headers,
                    "Authorization": f"Bearer {self._config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._config.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.2,
                },
            )
            response.raise_for_status()
            payload = response.json()
        choices = payload.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "".join(item.get("text", "") for item in content if isinstance(item, dict))
        return ""


def _normalize_queries(queries: list[str], original_query: str, limit: int) -> list[str]:
    normalized: list[str] = []
    for query in [original_query, *queries]:
        item = query.strip()
        if not item or item in normalized:
            continue
        normalized.append(item)
        if len(normalized) >= max(limit, 1):
            break
    return normalized or [original_query.strip()]


async def multi_query_expansion(
    session: AsyncSession,
    user_id: str,
    query: str,
    *,
    expand_count: int,
    settings: Settings | None = None,
    runtime_config: QueryExpansionRuntimeConfig | None = None,
) -> QueryPreprocessResult:
    started_at = time()
    current = settings or get_settings()
    config = runtime_config or await resolve_query_expansion_runtime_config(session, user_id, current)
    if config is None:
        return QueryPreprocessResult(
            original_query=query,
            expanded_queries=[query],
            preprocess_time_ms=max(int((time() - started_at) * 1000), 0),
        )

    system_prompt = (
        "你是一个搜索查询优化助手。"
        f"给定用户的原始查询，生成 {expand_count} 个语义相关但表述不同的查询变体。\n\n"
        "规则：\n"
        "1. 保持原始查询的核心意图\n"
        "2. 使用不同的词汇和表述方式\n"
        "3. 覆盖不同的搜索角度\n"
        "4. 每个查询独立一行，不要编号，不要解释"
    )
    user_prompt = f'原始查询："{{query}}"\n\n生成 {expand_count} 个扩展查询（每行一个）：'.format(query=query)

    try:
        client = OpenAICompatibleChatClient(config)
        content = await client.complete(system_prompt=system_prompt, user_prompt=user_prompt)
        expanded_queries = _normalize_queries(content.splitlines(), query, expand_count + 1)
    except Exception:
        expanded_queries = [query]

    return QueryPreprocessResult(
        original_query=query,
        expanded_queries=expanded_queries,
        preprocess_time_ms=max(int((time() - started_at) * 1000), 0),
    )


async def preprocess_query(
    session: AsyncSession,
    user_id: str,
    query: str,
    *,
    enable_expansion: bool = False,
    enable_rewrite: bool = True,
    settings: Settings | None = None,
) -> QueryPreprocessResult:
    started_at = time()
    current = settings or get_settings()
    processed_query = rewrite_query(query) if enable_rewrite else query.strip()

    if enable_expansion:
        expansion_result = await multi_query_expansion(
            session,
            user_id,
            processed_query,
            expand_count=current.query_expansion_count,
            settings=current,
        )
        expanded_queries = expansion_result.expanded_queries
    else:
        expanded_queries = [processed_query] if processed_query else [query.strip()]

    return QueryPreprocessResult(
        original_query=query,
        expanded_queries=_normalize_queries(expanded_queries, processed_query or query, current.query_expansion_count + 1),
        preprocess_time_ms=max(int((time() - started_at) * 1000), 0),
    )
