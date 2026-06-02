from __future__ import annotations

import json
import sys
from typing import Any, AsyncIterator

import httpx

from app.core.config import get_settings
from app.services.api_urls import build_v1_api_url
from app.services.agent.registry import (
    AgentProviderAdapterDefinition,
    get_provider_adapter,
    register_provider_adapter,
)

from app.services.agent._constants import (
    ANTHROPIC_API_VERSION,
    AgentModelRuntimeConfig,
    _content_to_text,
    _normalize_model,
    _to_string_record,
)


def _extract_stream_delta_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        return ""
    delta = first_choice.get("delta")
    if not isinstance(delta, dict):
        return ""
    return _content_to_text(delta.get("content"))


def _extract_anthropic_stream_delta_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    if payload.get("type") != "content_block_delta":
        return ""
    delta = payload.get("delta")
    if not isinstance(delta, dict):
        return ""
    if delta.get("type") != "text_delta":
        return ""
    text = delta.get("text")
    return text if isinstance(text, str) else ""


def _extract_gemini_stream_delta_text(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    first_candidate = candidates[0]
    if not isinstance(first_candidate, dict):
        return ""
    content = first_candidate.get("content")
    if not isinstance(content, dict):
        return ""
    parts = content.get("parts")
    return _content_to_text(parts)


def _split_system_messages(messages: list[dict[str, str]]) -> tuple[str, list[dict[str, str]]]:
    system_parts: list[str] = []
    provider_messages: list[dict[str, str]] = []
    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        if role == "system":
            if content.strip():
                system_parts.append(content)
            continue
        if role in {"user", "assistant"}:
            provider_messages.append({"role": role, "content": content})
    return "\n\n".join(system_parts), provider_messages


def _to_gemini_role(role: str) -> str:
    return "model" if role == "assistant" else "user"


def _build_gemini_stream_url(base_url: str, model: str) -> str:
    normalized_base_url = base_url.rstrip("/")
    if normalized_base_url.endswith(":streamGenerateContent"):
        separator = "&" if "?" in normalized_base_url else "?"
        return f"{normalized_base_url}{separator}alt=sse"
    if normalized_base_url.endswith("/models"):
        return f"{normalized_base_url}/{model}:streamGenerateContent?alt=sse"
    if normalized_base_url.endswith(f"/models/{model}"):
        return f"{normalized_base_url}:streamGenerateContent?alt=sse"
    if normalized_base_url.endswith("/v1beta") or normalized_base_url.endswith("/v1"):
        return f"{normalized_base_url}/models/{model}:streamGenerateContent?alt=sse"
    return f"{normalized_base_url}/v1beta/models/{model}:streamGenerateContent?alt=sse"


async def _iter_sse_events(response: httpx.Response) -> AsyncIterator[tuple[str | None, str]]:
    event_type: str | None = None
    data_lines: list[str] = []
    async for line in response.aiter_lines():
        stripped = line.strip()
        if not stripped:
            if data_lines:
                yield event_type, "\n".join(data_lines).strip()
            event_type = None
            data_lines = []
            continue
        if stripped.startswith(":"):
            continue
        if stripped.startswith("event:"):
            event_type = stripped[6:].strip() or None
            continue
        if stripped.startswith("data:"):
            data_lines.append(stripped[5:].strip())

    if data_lines:
        yield event_type, "\n".join(data_lines).strip()


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


async def _stream_openai_chat_completion(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    headers = {
        **runtime_config.headers,
        "Authorization": f"Bearer {runtime_config.api_key}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    request_body = {
        "model": runtime_config.model,
        "messages": messages,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=runtime_config.timeout_ms / 1000) as client:
        async with client.stream(
            "POST",
            build_v1_api_url(runtime_config.base_url, "/chat/completions"),
            headers=headers,
            json=request_body,
        ) as response:
            response.raise_for_status()
            async for _event_type, data in _iter_sse_events(response):
                if data == "[DONE]":
                    break

                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue
                text = _extract_stream_delta_text(payload)
                if text:
                    yield text


async def _stream_anthropic_messages(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    system_prompt, anthropic_messages = _split_system_messages(messages)
    headers = {
        **runtime_config.headers,
        "x-api-key": runtime_config.api_key,
        "anthropic-version": ANTHROPIC_API_VERSION,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    request_body: dict[str, Any] = {
        "model": runtime_config.model,
        "messages": anthropic_messages,
        "max_tokens": 4096,
        "stream": True,
    }
    if system_prompt:
        request_body["system"] = system_prompt

    async with httpx.AsyncClient(timeout=runtime_config.timeout_ms / 1000) as client:
        async with client.stream(
            "POST",
            build_v1_api_url(runtime_config.base_url, "/messages"),
            headers=headers,
            json=request_body,
        ) as response:
            response.raise_for_status()
            async for event_type, data in _iter_sse_events(response):
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue

                payload_type = payload.get("type") if isinstance(payload, dict) else None
                if event_type == "message_stop" or payload_type == "message_stop":
                    break

                text = _extract_anthropic_stream_delta_text(payload)
                if text:
                    yield text


async def _stream_gemini_generate_content(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    system_prompt, gemini_messages = _split_system_messages(messages)
    headers = {
        **runtime_config.headers,
        "x-goog-api-key": runtime_config.api_key,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }
    request_body: dict[str, Any] = {
        "contents": [
            {
                "role": _to_gemini_role(message["role"]),
                "parts": [{"text": message["content"]}],
            }
            for message in gemini_messages
        ],
        "generationConfig": {"maxOutputTokens": 4096},
    }
    if system_prompt:
        request_body["systemInstruction"] = {
            "parts": [{"text": system_prompt}],
        }

    emitted_text = ""
    async with httpx.AsyncClient(timeout=runtime_config.timeout_ms / 1000) as client:
        async with client.stream(
            "POST",
            _build_gemini_stream_url(runtime_config.base_url, runtime_config.model),
            headers=headers,
            json=request_body,
        ) as response:
            response.raise_for_status()
            async for _event_type, data in _iter_sse_events(response):
                if data == "[DONE]":
                    break
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue

                text = _extract_gemini_stream_delta_text(payload)
                if not text:
                    continue
                if text.startswith(emitted_text):
                    delta = text[len(emitted_text) :]
                    emitted_text = text
                else:
                    delta = text
                    emitted_text += delta
                if delta:
                    yield delta


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


def _resolve_stream_override(export_name: str, fallback: Any) -> Any:
    service_module = sys.modules.get("app.services.agent")
    if service_module is None:
        return fallback
    override = getattr(service_module, export_name, None)
    return override if callable(override) else fallback


async def _stream_exported_handler(
    export_name: str,
    fallback: Any,
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    stream_fn = _resolve_stream_override(export_name, fallback)
    async for token in stream_fn(runtime_config, messages=messages):
        yield token


async def _stream_registered_anthropic_messages(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    async for token in _stream_exported_handler(
        "_stream_anthropic_messages",
        _stream_anthropic_messages,
        runtime_config,
        messages=messages,
    ):
        yield token


async def _stream_registered_openai_chat_completion(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    async for token in _stream_exported_handler(
        "_stream_openai_chat_completion",
        _stream_openai_chat_completion,
        runtime_config,
        messages=messages,
    ):
        yield token


async def _stream_registered_gemini_generate_content(
    runtime_config: AgentModelRuntimeConfig,
    *,
    messages: list[dict[str, str]],
) -> AsyncIterator[str]:
    async for token in _stream_exported_handler(
        "_stream_gemini_generate_content",
        _stream_gemini_generate_content,
        runtime_config,
        messages=messages,
    ):
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
