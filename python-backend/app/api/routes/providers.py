from uuid import UUID

from fastapi import APIRouter, status

from app.api.error_mapping import http_not_found
from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.providers import (
    CreateProviderRequest,
    ProviderDataEnvelope,
    ProviderDeleteData,
    ProviderDeleteEnvelope,
    ProviderEnvelope,
    ProviderListData,
    ProviderListEnvelope,
    UpdateProviderRequest,
)
from app.services.providers import (
    activate_provider_service,
    create_provider_service,
    delete_provider_service,
    get_active_provider_service,
    list_providers_service,
    update_provider_service,
)

router = APIRouter(prefix="/providers")


@router.get("", response_model=ProviderListEnvelope)
async def list_providers(session: DbSession, user: AuthenticatedUser) -> ProviderListEnvelope:
    items = await list_providers_service(session, user.user_id)
    return ProviderListEnvelope(data=ProviderListData(items=items, total=len(items)))


@router.get("/active", response_model=ProviderEnvelope)
async def get_active_provider(session: DbSession, user: AuthenticatedUser) -> ProviderEnvelope:
    provider = await get_active_provider_service(session, user.user_id)
    return ProviderEnvelope(data=ProviderDataEnvelope(provider=provider))


@router.post("", response_model=ProviderEnvelope, status_code=status.HTTP_201_CREATED)
async def create_provider(
    payload: CreateProviderRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> ProviderEnvelope:
    provider = await create_provider_service(session, user.user_id, payload)
    return ProviderEnvelope(data=ProviderDataEnvelope(provider=provider))


@router.patch("/{provider_id}", response_model=ProviderEnvelope)
async def update_provider(
    provider_id: UUID,
    payload: UpdateProviderRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> ProviderEnvelope:
    provider = await update_provider_service(session, user.user_id, str(provider_id), payload)
    if not provider:
        raise http_not_found("Provider not found")
    return ProviderEnvelope(data=ProviderDataEnvelope(provider=provider))


@router.delete("/{provider_id}", response_model=ProviderDeleteEnvelope)
async def delete_provider(
    provider_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> ProviderDeleteEnvelope:
    result = await delete_provider_service(session, user.user_id, str(provider_id))
    if not result:
        raise http_not_found("Provider not found")
    return ProviderDeleteEnvelope(data=ProviderDeleteData(**result))


@router.post("/{provider_id}/activate", response_model=ProviderEnvelope)
async def activate_provider(
    provider_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> ProviderEnvelope:
    provider = await activate_provider_service(session, user.user_id, str(provider_id))
    if not provider:
        raise http_not_found("Provider not found")
    return ProviderEnvelope(data=ProviderDataEnvelope(provider=provider))
