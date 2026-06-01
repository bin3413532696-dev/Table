from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import VersionConflictError
from app.core.provider_crypto import (
    decrypt_provider_secret,
    encrypt_provider_secret,
    has_provider_secret,
    mask_provider_secret,
)
from app.db.models import ApiProvider
from app.repositories.providers import (
    count_active_providers_for_user,
    find_active_provider_for_user,
    find_latest_provider_for_user,
    find_provider_by_id,
    list_providers_for_user,
)
from app.schemas.providers import CreateProviderRequest, ProviderResponse, UpdateProviderRequest


def _to_string_record(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {key: item for key, item in value.items() if isinstance(key, str) and isinstance(item, str)}


def _normalize_optional_string(value: str | None) -> str | None:
    normalized = (value or "").strip()
    return normalized or None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def to_provider_response(provider: ApiProvider, *, include_secret: bool = False) -> ProviderResponse:
    return ProviderResponse(
        id=str(provider.id),
        name=provider.name,
        apiFormat=provider.api_format,
        baseUrl=provider.base_url,
        apiKey=decrypt_provider_secret(provider.api_key_encrypted) if include_secret else "",
        model=provider.model or None,
        embeddingModel=provider.embedding_model or None,
        rerankerModel=provider.reranker_model or None,
        headers=_to_string_record(provider.headers_json),
        isActive=provider.is_active,
        hasApiKey=has_provider_secret(provider.api_key_encrypted),
        apiKeyPreview=mask_provider_secret(provider.api_key_encrypted),
        source=provider.source,
        createdAt=(provider.created_at or _now()).isoformat(),
        updatedAt=(provider.updated_at or _now()).isoformat(),
        version=provider.version,
    )


async def list_providers_service(session: AsyncSession, user_id: str) -> list[ProviderResponse]:
    providers = await list_providers_for_user(session, user_id)
    return [to_provider_response(provider) for provider in providers]


async def get_active_provider_service(session: AsyncSession, user_id: str) -> ProviderResponse | None:
    provider = await find_active_provider_for_user(session, user_id)
    return to_provider_response(provider, include_secret=True) if provider else None


async def create_provider_service(
    session: AsyncSession,
    user_id: str,
    payload: CreateProviderRequest,
) -> ProviderResponse:
    active_provider_count = await count_active_providers_for_user(session, user_id)
    should_activate = payload.isActive or active_provider_count == 0
    current_time = _now()

    if should_activate:
        await session.execute(
            update(ApiProvider)
            .where(
                ApiProvider.user_id == UUID(user_id),
                ApiProvider.is_active.is_(True),
            )
            .values(is_active=False, updated_at=current_time)
        )

    provider = ApiProvider(
        id=payload.id or uuid4(),
        user_id=UUID(user_id),
        name=payload.name.strip(),
        api_format=payload.apiFormat,
        base_url=payload.baseUrl.strip(),
        api_key_encrypted=encrypt_provider_secret(payload.apiKey) if _normalize_optional_string(payload.apiKey) else None,
        model=_normalize_optional_string(payload.model),
        embedding_model=_normalize_optional_string(payload.embeddingModel),
        reranker_model=_normalize_optional_string(payload.rerankerModel),
        headers_json=payload.headers or {},
        is_active=should_activate,
        source=payload.source,
    )
    session.add(provider)
    await session.commit()
    await session.refresh(provider)
    return to_provider_response(provider)


async def update_provider_service(
    session: AsyncSession,
    user_id: str,
    provider_id: str,
    payload: UpdateProviderRequest,
) -> ProviderResponse | None:
    provider = await find_provider_by_id(session, user_id, provider_id)
    if not provider:
        return None

    if payload.version is not None and payload.version != provider.version:
        raise VersionConflictError("Provider was modified by another request. Please refresh and try again.")

    current_time = _now()
    if payload.isActive is True:
        await session.execute(
            update(ApiProvider)
            .where(
                ApiProvider.user_id == UUID(user_id),
                ApiProvider.is_active.is_(True),
                ApiProvider.id != provider.id,
            )
            .values(is_active=False, updated_at=current_time)
        )

    if payload.name is not None:
        provider.name = payload.name.strip()
    if payload.apiFormat is not None:
        provider.api_format = payload.apiFormat
    if payload.baseUrl is not None:
        provider.base_url = payload.baseUrl.strip()
    if payload.apiKey is not None:
        next_api_key = _normalize_optional_string(payload.apiKey)
        if next_api_key:
            provider.api_key_encrypted = encrypt_provider_secret(next_api_key)
    if payload.model is not None:
        provider.model = _normalize_optional_string(payload.model)
    if payload.embeddingModel is not None:
        provider.embedding_model = _normalize_optional_string(payload.embeddingModel)
    if payload.rerankerModel is not None:
        provider.reranker_model = _normalize_optional_string(payload.rerankerModel)
    if payload.headers is not None:
        provider.headers_json = payload.headers
    if payload.isActive is not None:
        provider.is_active = payload.isActive

    provider.version += 1
    provider.updated_at = current_time
    await session.commit()
    await session.refresh(provider)
    return to_provider_response(provider)


async def activate_provider_service(session: AsyncSession, user_id: str, provider_id: str) -> ProviderResponse | None:
    provider = await find_provider_by_id(session, user_id, provider_id)
    if not provider:
        return None

    current_time = _now()
    await session.execute(
        update(ApiProvider)
        .where(
            ApiProvider.user_id == UUID(user_id),
            ApiProvider.is_active.is_(True),
        )
        .values(is_active=False, updated_at=current_time)
    )
    provider.is_active = True
    provider.version += 1
    provider.updated_at = current_time
    await session.commit()
    await session.refresh(provider)
    return to_provider_response(provider)


async def delete_provider_service(session: AsyncSession, user_id: str, provider_id: str) -> dict[str, object] | None:
    provider = await find_provider_by_id(session, user_id, provider_id)
    if not provider:
        return None

    was_active = provider.is_active
    await session.delete(provider)
    await session.flush()

    if was_active:
        fallback = await find_latest_provider_for_user(session, user_id)
        if fallback:
            fallback.is_active = True
            fallback.version += 1
            fallback.updated_at = _now()

    await session.commit()
    return {"id": provider_id, "deleted": True}
