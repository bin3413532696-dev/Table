from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.provider_crypto import decrypt_provider_secret
from app.repositories.agent import (
    create_agent_run,
    find_agent_run_by_id,
    find_agent_session_by_id,
    find_user_setting,
    list_runs_for_session,
    update_agent_run,
    update_agent_session,
)
from app.repositories.providers import find_active_provider_for_user
from app.services.agent._constants import SUPPORTED_STREAM_PROVIDER_FORMATS
from app.services.agent._provider import _resolve_agent_runtime_config, _stream_provider_chat_completion


@dataclass(frozen=True)
class AgentProviderData:
    id: object
    name: str
    api_format: str
    api_key: str
    base_url: str
    model: str
    headers_json: object


async def resolve_runtime_config_for_user(
    session: AsyncSession,
    user_id: str,
    requested_model: str,
):
    provider = await find_active_provider_for_user(session, user_id)
    if not provider:
        raise RuntimeError("Agent provider is not configured.")
    if provider.api_format not in SUPPORTED_STREAM_PROVIDER_FORMATS:
        raise RuntimeError(
            "Python agent streaming currently supports only anthropic/openai/gemini/custom providers."
        )
    current = get_settings()
    api_key = decrypt_provider_secret(provider.api_key_encrypted, current)
    provider_data = AgentProviderData(
        id=provider.id,
        name=provider.name,
        api_format=provider.api_format,
        api_key=api_key,
        base_url=provider.base_url,
        model=provider.model,
        headers_json=provider.headers_json,
    )
    return await _resolve_agent_runtime_config(
        provider_data,
        requested_model=requested_model,
        settings=current,
    )


__all__ = [
    "_stream_provider_chat_completion",
    "create_agent_run",
    "find_active_provider_for_user",
    "find_agent_run_by_id",
    "find_agent_session_by_id",
    "find_user_setting",
    "list_runs_for_session",
    "resolve_runtime_config_for_user",
    "update_agent_run",
    "update_agent_session",
]
