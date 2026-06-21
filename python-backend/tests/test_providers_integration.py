import os
import uuid

import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.db.models import User
from app.schemas.providers import CreateProviderRequest, UpdateProviderRequest
from app.services.provider_bootstrap import ensure_user_provider_bootstrap
from app.services.providers import (
    activate_provider_service,
    create_provider_service,
    delete_provider_service,
    get_active_provider_service,
    list_providers_service,
    update_provider_service,
)

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_PYTHON_INTEGRATION_TESTS") != "1",
    reason="set RUN_PYTHON_INTEGRATION_TESTS=1 to run database integration tests",
)


@pytest.mark.asyncio
async def test_provider_crud_lifecycle() -> None:
    settings = Settings()
    engine = create_async_engine(settings.sqlalchemy_database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    user_id = uuid.uuid4()
    provider_a_id = str(uuid.uuid4())
    provider_b_id = str(uuid.uuid4())

    try:
        async with session_factory() as session:
            session.add(
                User(
                    id=user_id,
                    email=f"{user_id}@example.test",
                    display_name="Provider Integration User",
                    status="active",
                )
            )
            await session.commit()

            provider_a = await create_provider_service(
                session,
                str(user_id),
                CreateProviderRequest(
                    id=provider_a_id,
                    name="Provider A",
                    apiFormat="openai",
                    baseUrl="https://provider-a.example.com",
                    apiKey="secret-a",
                    model="gpt-4o-mini",
                ),
            )
            assert provider_a.isActive is True
            assert provider_a.hasApiKey is True

            provider_b = await create_provider_service(
                session,
                str(user_id),
                CreateProviderRequest(
                    id=provider_b_id,
                    name="Provider B",
                    apiFormat="custom",
                    baseUrl="https://provider-b.example.com",
                    apiKey="secret-b",
                    embeddingModel="text-embedding-provider",
                    rerankerModel="rerank-v3",
                    isActive=False,
                ),
            )
            assert provider_b.isActive is False

            updated_b = await update_provider_service(
                session,
                str(user_id),
                provider_b_id,
                UpdateProviderRequest(name="Provider B Updated", version=provider_b.version),
            )
            assert updated_b is not None
            assert updated_b.name == "Provider B Updated"
            assert updated_b.version == provider_b.version + 1

            activated_b = await activate_provider_service(session, str(user_id), provider_b_id)
            assert activated_b is not None
            assert activated_b.isActive is True

            active_provider = await get_active_provider_service(session, str(user_id))
            assert active_provider is not None
            assert active_provider.id == provider_b_id
            assert active_provider.apiKey == "secret-b"

            providers = await list_providers_service(session, str(user_id))
            assert len(providers) == 2
            assert providers[0].id == provider_b_id

            delete_result = await delete_provider_service(session, str(user_id), provider_b_id)
            assert delete_result == {"id": provider_b_id, "deleted": True}

            fallback_active = await get_active_provider_service(session, str(user_id))
            assert fallback_active is not None
            assert fallback_active.id == provider_a_id
    finally:
        async with session_factory() as session:
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()


@pytest.mark.asyncio
async def test_provider_bootstrap_creates_default_provider_and_settings() -> None:
    settings = Settings(
        default_provider_name="Bootstrap Provider",
        default_provider_format="openai",
        default_provider_base_url="https://bootstrap.example.com",
        default_provider_api_key="bootstrap-secret",
        default_provider_model="gpt-4o-mini",
    )
    engine = create_async_engine(settings.sqlalchemy_database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    user_id = uuid.uuid4()

    try:
        async with session_factory() as session:
            session.add(
                User(
                    id=user_id,
                    email=f"{user_id}@example.test",
                    display_name="Bootstrap Integration User",
                    status="active",
                )
            )
            await session.commit()

            await ensure_user_provider_bootstrap(session, str(user_id), settings)

            provider = await get_active_provider_service(session, str(user_id))
            assert provider is not None
            assert provider.name == "Bootstrap Provider"
            assert provider.source == "bootstrap"
            assert provider.apiKey == "bootstrap-secret"

            setting_row = (
                await session.execute(
                    text(
                        """
                        SELECT provider_config_hash
                        FROM user_settings
                        WHERE user_id = CAST(:user_id AS uuid)
                        """
                    ),
                    {"user_id": str(user_id)},
                )
            ).mappings().one()
            assert setting_row["provider_config_hash"]
    finally:
        async with session_factory() as session:
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()
