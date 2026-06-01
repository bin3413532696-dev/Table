from typing import Annotated

from uuid import UUID

from app.core.config import get_settings
from app.core.errors import AuthError
from app.core.user_context import UserContext, get_user_context, validate_user_id
from app.db.models import User
from app.db.session import get_session
from app.services.provider_bootstrap import ensure_user_provider_bootstrap
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

DbSession = Annotated[AsyncSession, Depends(get_session)]


async def get_authenticated_user(session: DbSession) -> UserContext:
    settings = get_settings()
    context = get_user_context(settings)

    if context.source == "missing" and not settings.allow_default_user_fallback:
        raise AuthError("Missing x-user-id header", 401, "UNAUTHORIZED")

    try:
        validate_user_id(context.user_id)
    except ValueError as exc:
        raise AuthError("Invalid x-user-id header", 401, "UNAUTHORIZED") from exc

    user_id = UUID(context.user_id)
    existing_user = await session.scalar(select(User).where(User.id == user_id))
    if existing_user:
        if existing_user.status != "active":
            raise AuthError("User is not active", 403, "FORBIDDEN")
        await ensure_user_provider_bootstrap(session, context.user_id, settings)
        return context

    if context.user_id != settings.default_user_id:
        raise AuthError("User not found. Please create the user first.", 401, "UNAUTHORIZED")

    session.add(
        User(
            id=user_id,
            display_name="Default Local User",
            status="active",
        )
    )
    await session.commit()
    await ensure_user_provider_bootstrap(session, context.user_id, settings)
    return context


AuthenticatedUser = Annotated[UserContext, Depends(get_authenticated_user)]
