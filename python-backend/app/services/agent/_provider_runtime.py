from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from app.core.config import get_settings
from app.services.agent._constants import AgentModelRuntimeConfig, _normalize_model, _to_string_record
from app.services.agent._provider_streaming import (
    _stream_anthropic_messages,
    _stream_gemini_generate_content,
    _stream_openai_chat_completion,
)
from app.services.agent.registry import (
    AgentProviderAdapterDefinition,
    get_provider_adapter,
    register_provider_adapter,
)


async def _resolve_default_runtime_config(
    provider: Any,
    *,
    requested_model: str,
    settings: Any | None = None,
) -> AgentModelRuntimeConfig:
    current = settings or get_settings()
    api_key = provider.api_key
    base_url = (provider.base_url or "").strip().rstrip("/")
    model = _normalize_model(requested_model, provider.model)
    if not api_key:
        raise RuntimeError("Agent provider API key is not configured.")
    if not base_url:
        raise RuntimeError("Agent provider base URL is not configured.")
    if not model or model == "default":
        raise RuntimeError("Agent provider model is not configured.")

    return AgentModelRuntimeConfig(
        api_format=provider.api_format,
        api_key=api_key,
        base_url=base_url,
        model=model,
        timeout_ms=current.agent_timeout_ms,
        headers=_to_string_record(provider.headers_json),
        provider_id=str(provider.id),
        provider_name=provider.name,
    )


async def _resolve_agent_runtime_config(
    provider: Any,
    *,
    requested_model: str,
    settings: Any | None = None,
) -> AgentModelRuntimeConfig:
    adapter = get_provider_adapter(str(provider.api_format))
    if not adapter:
        raise RuntimeError(f"Unsupported agent provider format: {provider.api_format}")
    return await adapter.resolve_runtime_config(
        provider,
        requested_model=requested_model,
        settings=settings,
    )
async def _stream_registered_anthropic_messages(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    async for token in _stream_anthropic_messages(runtime_config, messages=messages):
        yield token


async def _stream_registered_openai_chat_completion(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    async for token in _stream_openai_chat_completion(runtime_config, messages=messages):
        yield token


async def _stream_registered_gemini_generate_content(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    async for token in _stream_gemini_generate_content(runtime_config, messages=messages):
        yield token


async def _stream_provider_chat_completion(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    adapter = get_provider_adapter(runtime_config.api_format)
    if not adapter:
        raise RuntimeError(f"Unsupported agent provider format: {runtime_config.api_format}")
    async for token in adapter.stream_chat_completion(runtime_config, messages=messages):
        yield token


def _register_default_provider_adapters() -> None:
    register_provider_adapter(
        AgentProviderAdapterDefinition(
            api_format="anthropic",
            label="Anthropic Messages",
            resolve_runtime_config=_resolve_default_runtime_config,
            stream_chat_completion=_stream_registered_anthropic_messages,
        )
    )
    register_provider_adapter(
        AgentProviderAdapterDefinition(
            api_format="custom",
            label="Custom OpenAI-Compatible",
            resolve_runtime_config=_resolve_default_runtime_config,
            stream_chat_completion=_stream_registered_openai_chat_completion,
        )
    )
    register_provider_adapter(
        AgentProviderAdapterDefinition(
            api_format="gemini",
            label="Gemini generateContent",
            resolve_runtime_config=_resolve_default_runtime_config,
            stream_chat_completion=_stream_registered_gemini_generate_content,
        )
    )
    register_provider_adapter(
        AgentProviderAdapterDefinition(
            api_format="openai",
            label="OpenAI Chat Completions",
            resolve_runtime_config=_resolve_default_runtime_config,
            stream_chat_completion=_stream_registered_openai_chat_completion,
        )
    )


_register_default_provider_adapters()
