from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.provider_crypto import decrypt_provider_secret
from app.repositories.providers import find_active_provider_for_user
from app.services.api_urls import build_v1_api_url

logger = logging.getLogger("table-python-backend")


VISION_LLM_DESCRIPTION_PROMPT = """你正在分析一张来自技术文档的图片
（可能是架构图、流程图、时序图、UML、表格截图、配置示例等）。
请提取并结构化输出：
1. **图片类型**：架构图 / 流程图 / 时序图 / 类图 / 表格 / 配置 / 其他
2. **可见标签**：所有组件名、节点名、字段名、端点 URL
3. **连接关系**：组件之间的调用、依赖、消息流（A 调用 B / A 依赖 B / A → B）
4. **关键数字**：端口号、超时时间（ms/s）、QPS、版本号、配置值
5. **核心信息**：用一段话总结这张图表达的内容

要求：
- 精确转录数字和名称，不要猜测或补全
- 看不清的部分明确说明"[模糊不可读]"
- 输出 Markdown 格式，简洁清晰"""


@dataclass(frozen=True)
class VisionLLMRuntimeConfig:
    api_key: str
    base_url: str
    model: str
    timeout_ms: int
    max_retries: int
    headers: dict[str, str]


def _to_string_record(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


async def resolve_vision_llm_runtime_config(
    session: AsyncSession,
    user_id: str,
    settings: Settings | None = None,
) -> VisionLLMRuntimeConfig | None:
    current = settings or get_settings()
    if current.rag_vision_llm_api_key:
        return VisionLLMRuntimeConfig(
            api_key=current.rag_vision_llm_api_key,
            base_url=(current.rag_vision_llm_base_url or "https://api.openai.com").rstrip("/"),
            model=current.rag_vision_llm_model,
            timeout_ms=current.rag_vision_llm_timeout_ms,
            max_retries=current.rag_vision_llm_max_retries,
            headers={},
        )

    provider = await find_active_provider_for_user(session, user_id)
    if not provider or provider.api_format not in {"openai", "custom"}:
        return None

    api_key = decrypt_provider_secret(provider.api_key_encrypted, current)
    base_url = (provider.base_url or "").strip().rstrip("/")
    if not api_key or not base_url:
        return None

    return VisionLLMRuntimeConfig(
        api_key=api_key,
        base_url=base_url,
        model=current.rag_vision_llm_model,
        timeout_ms=current.rag_vision_llm_timeout_ms,
        max_retries=current.rag_vision_llm_max_retries,
        headers=_to_string_record(provider.headers_json),
    )


async def vision_llm_provider_available(
    session: AsyncSession,
    user_id: str,
    settings: Settings | None = None,
) -> bool:
    config = await resolve_vision_llm_runtime_config(session, user_id, settings)
    return config is not None


async def describe_image(
    image_bytes: bytes,
    *,
    mime_type: str,
    runtime_config: VisionLLMRuntimeConfig,
    max_tokens: int = 800,
) -> str:
    """调用 OpenAI 兼容 /chat/completions（image_url data URL），返回 VLM 生成的描述文本。

    失败抛 RuntimeError；调用方负责 try/except 转换为占位符替换。
    """
    if not image_bytes:
        raise ValueError("image_bytes is empty")

    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime_type};base64,{b64}"

    headers = {
        **runtime_config.headers,
        "Authorization": f"Bearer {runtime_config.api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "model": runtime_config.model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": VISION_LLM_DESCRIPTION_PROMPT},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        "max_tokens": max_tokens,
        "temperature": 0.1,
    }

    url = build_v1_api_url(runtime_config.base_url, "/chat/completions")
    timeout = runtime_config.timeout_ms / 1000
    last_error: Exception | None = None

    for attempt in range(runtime_config.max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, headers=headers, json=body)
                response.raise_for_status()
                payload = response.json()
                content = _extract_chat_content(payload)
                if content:
                    return content.strip()
                raise RuntimeError("VLM response missing content")
        except Exception as exc:
            last_error = exc
            if attempt < runtime_config.max_retries:
                logger.warning(
                    "VLM describe_image attempt %d failed: %s (retrying)", attempt + 1, exc
                )
                continue
            break

    raise RuntimeError(f"VLM describe_image failed after retries: {last_error}")


def _extract_chat_content(payload: dict) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # 某些 provider 返回 [{"type": "text", "text": "..."}]
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "".join(parts)
    return ""
