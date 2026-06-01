from __future__ import annotations

from hashlib import sha256
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.db.models import UserSetting
from app.repositories.providers import (
    find_bootstrap_provider_for_user,
    find_user_setting,
    list_providers_for_user,
)
from app.schemas.providers import CreateProviderRequest, UpdateProviderRequest
from app.services.providers import create_provider_service, update_provider_service


def compute_provider_config_hash(
    base_url: str,
    api_key: str,
    model: str,
) -> str:
    payload = "||".join([base_url.strip(), api_key.strip(), model.strip()])
    return sha256(payload.encode("utf-8")).hexdigest()


def default_provider_config_available(settings: Settings) -> bool:
    return settings.default_provider_base_url.strip() != ""


async def ensure_user_provider_bootstrap(
    session: AsyncSession,
    user_id: str,
    settings: Settings | None = None,
) -> None:
    current = settings or get_settings()
    current_env_hash = compute_provider_config_hash(
        current.default_provider_base_url,
        current.default_provider_api_key,
        current.default_provider_model,
    )

    existing_settings = await find_user_setting(session, user_id)
    if not existing_settings:
        existing_settings = UserSetting(
            user_id=UUID(user_id),
            theme="light",
            profile_json={},
            notification_json={},
            agent_preferences_json={},
            provider_config_hash=current_env_hash,
        )
        session.add(existing_settings)
        await session.flush()

    existing_providers = await list_providers_for_user(session, user_id)
    bootstrap_provider = await find_bootstrap_provider_for_user(session, user_id)

    if not existing_providers:
        if default_provider_config_available(current):
            await create_provider_service(
                session,
                user_id,
                CreateProviderRequest(
                    name=current.default_provider_name,
                    apiFormat=current.default_provider_format,
                    baseUrl=current.default_provider_base_url,
                    apiKey=current.default_provider_api_key,
                    model=current.default_provider_model,
                    headers={},
                    isActive=True,
                    source="bootstrap",
                ),
            )
        existing_settings.provider_config_hash = current_env_hash
        await session.commit()
        return

    if bootstrap_provider and default_provider_config_available(current):
        stored_hash = existing_settings.provider_config_hash
        if stored_hash != current_env_hash:
            await update_provider_service(
                session,
                user_id,
                str(bootstrap_provider.id),
                UpdateProviderRequest(
                    name=current.default_provider_name,
                    apiFormat=current.default_provider_format,
                    baseUrl=current.default_provider_base_url,
                    apiKey=current.default_provider_api_key,
                    model=current.default_provider_model,
                    version=bootstrap_provider.version,
                ),
            )
            existing_settings.provider_config_hash = current_env_hash
            await session.commit()
            return

    if bootstrap_provider and existing_settings.provider_config_hash != current_env_hash:
        existing_settings.provider_config_hash = current_env_hash
        await session.commit()
        return

    if existing_settings.provider_config_hash is None:
        existing_settings.provider_config_hash = current_env_hash
        await session.commit()
