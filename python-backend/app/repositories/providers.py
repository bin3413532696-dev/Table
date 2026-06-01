from uuid import UUID

from app.db.models import ApiProvider, UserSetting
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


async def find_active_provider_for_user(session: AsyncSession, user_id: str) -> ApiProvider | None:
    return await session.scalar(
        select(ApiProvider)
        .where(
            ApiProvider.user_id == UUID(user_id),
            ApiProvider.is_active.is_(True),
        )
        .order_by(ApiProvider.updated_at.desc(), ApiProvider.created_at.desc())
        .limit(1)
    )


async def list_providers_for_user(session: AsyncSession, user_id: str) -> list[ApiProvider]:
    return list(
        await session.scalars(
            select(ApiProvider)
            .where(ApiProvider.user_id == UUID(user_id))
            .order_by(
                ApiProvider.is_active.desc(),
                ApiProvider.updated_at.desc(),
                ApiProvider.created_at.desc(),
            )
        )
    )


async def find_provider_by_id(session: AsyncSession, user_id: str, provider_id: str) -> ApiProvider | None:
    return await session.scalar(
        select(ApiProvider).where(
            ApiProvider.id == UUID(provider_id),
            ApiProvider.user_id == UUID(user_id),
        )
    )


async def count_active_providers_for_user(session: AsyncSession, user_id: str) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(ApiProvider)
            .where(
                ApiProvider.user_id == UUID(user_id),
                ApiProvider.is_active.is_(True),
            )
        )
        or 0
    )


async def find_latest_provider_for_user(session: AsyncSession, user_id: str) -> ApiProvider | None:
    return await session.scalar(
        select(ApiProvider)
        .where(ApiProvider.user_id == UUID(user_id))
        .order_by(ApiProvider.updated_at.desc(), ApiProvider.created_at.desc())
        .limit(1)
    )


async def find_bootstrap_provider_for_user(session: AsyncSession, user_id: str) -> ApiProvider | None:
    return await session.scalar(
        select(ApiProvider)
        .where(
            ApiProvider.user_id == UUID(user_id),
            ApiProvider.source == "bootstrap",
        )
        .order_by(ApiProvider.updated_at.desc(), ApiProvider.created_at.desc())
        .limit(1)
    )


async def find_user_setting(session: AsyncSession, user_id: str) -> UserSetting | None:
    return await session.scalar(select(UserSetting).where(UserSetting.user_id == UUID(user_id)))
