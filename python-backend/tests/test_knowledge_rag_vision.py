import base64
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.services.knowledge_rag_vision import (
    VisionLLMRuntimeConfig,
    _extract_chat_content,
    describe_image,
    resolve_vision_llm_runtime_config,
)


def _runtime() -> VisionLLMRuntimeConfig:
    return VisionLLMRuntimeConfig(
        api_key="test-key",
        base_url="https://api.openai.com",
        model="gpt-4o",
        timeout_ms=30000,
        max_retries=1,
        headers={},
    )


def test_extract_chat_content_handles_string() -> None:
    payload = {"choices": [{"message": {"content": "hello"}}]}
    assert _extract_chat_content(payload) == "hello"


def test_extract_chat_content_handles_list_of_text_parts() -> None:
    payload = {
        "choices": [{"message": {"content": [
            {"type": "text", "text": "part1 "},
            {"type": "text", "text": "part2"},
        ]}}]
    }
    assert _extract_chat_content(payload) == "part1 part2"


def test_extract_chat_content_returns_empty_on_missing_choices() -> None:
    assert _extract_chat_content({}) == ""
    assert _extract_chat_content({"choices": []}) == ""
    assert _extract_chat_content({"choices": [{}]}) == ""


@pytest.mark.asyncio
async def test_describe_image_builds_data_url_request(monkeypatch) -> None:
    """验证 describe_image 把图片编码成 data URL，message 含 image_url。"""
    captured: dict = {}

    class _FakeResponse:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "arch diagram"}}]}

    class _FakeClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, url, headers=None, json=None):
            captured["url"] = url
            captured["headers"] = headers
            captured["body"] = json
            return _FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)

    image_bytes = b"\x89PNG\r\n\x1a\nfakedata"
    description = await describe_image(
        image_bytes, mime_type="image/png", runtime_config=_runtime(),
    )

    assert description == "arch diagram"
    assert captured["url"].endswith("/chat/completions")
    assert captured["headers"]["Authorization"] == "Bearer test-key"

    body = captured["body"]
    assert body["model"] == "gpt-4o"
    user_msg = body["messages"][0]
    content_parts = user_msg["content"]
    text_part = next(p for p in content_parts if p["type"] == "text")
    image_part = next(p for p in content_parts if p["type"] == "image_url")
    assert "技术文档" in text_part["text"]

    expected_b64 = base64.b64encode(image_bytes).decode("ascii")
    assert image_part["image_url"]["url"] == f"data:image/png;base64,{expected_b64}"


@pytest.mark.asyncio
async def test_describe_image_retries_on_failure(monkeypatch) -> None:
    attempts = {"count": 0}

    class _FakeResponse:
        def raise_for_status(self):
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise httpx.HTTPStatusError(
                    "500", request=MagicMock(), response=MagicMock(),
                )

        def json(self): return {"choices": [{"message": {"content": "ok"}}]}

    class _FakeClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, url, headers=None, json=None): return _FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)

    description = await describe_image(
        b"png", mime_type="image/png", runtime_config=_runtime(),
    )
    assert description == "ok"
    assert attempts["count"] == 2  # 失败 1 次 + 成功 1 次


@pytest.mark.asyncio
async def test_describe_image_raises_after_max_retries(monkeypatch) -> None:
    class _FakeResponse:
        def raise_for_status(self):
            raise httpx.HTTPStatusError(
                "500", request=MagicMock(), response=MagicMock(),
            )

    class _FakeClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def post(self, url, headers=None, json=None): return _FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)

    with pytest.raises(RuntimeError, match="failed after retries"):
        await describe_image(
            b"png", mime_type="image/png", runtime_config=_runtime(),
        )


@pytest.mark.asyncio
async def test_resolve_vision_llm_runtime_config_uses_settings(monkeypatch) -> None:
    from app.core.config import Settings
    settings = Settings(
        database_url="postgresql://u:p@localhost:5432/t",
        rag_vision_llm_api_key="sk-vlm",
        rag_vision_llm_base_url="https://api.openai.com",
        rag_vision_llm_model="gpt-4o-mini",
    )
    # session 不会被使用（settings 直配优先）
    config = await resolve_vision_llm_runtime_config(
        session=AsyncMock(), user_id="00000000-0000-0000-0000-000000000001",
        settings=settings,
    )
    assert config is not None
    assert config.api_key == "sk-vlm"
    assert config.model == "gpt-4o-mini"
