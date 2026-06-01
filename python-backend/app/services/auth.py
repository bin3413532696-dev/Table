from __future__ import annotations

from uuid import UUID, uuid4

from app.core.config import Settings
from app.core.pin import hash_pin, verify_pin
from app.core.user_context import DEV_SESSION_COOKIE, USER_ID_HEADER, UserContext
from app.db.models import User, UserSetting
from app.schemas.auth import (
    AuthCreateUserResponse,
    AuthInfoDto,
    AuthMeData,
    AuthMeResponse,
    AuthUserDto,
    AuthUserListData,
    AuthUserListItem,
    AuthUserListResponse,
    CreateAuthUserRequest,
    PinStatusResponse,
    SuccessResponse,
    UpdateAuthMeRequest,
    UpdatePinRequest,
    VerifyPinRequest,
    VerifyPinResponse,
)
from app.services.provider_bootstrap import ensure_user_provider_bootstrap
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _extract_bio(profile_json: object) -> str:
    if not isinstance(profile_json, dict):
        return ""
    bio = profile_json.get("bio", "")
    return bio if isinstance(bio, str) else ""


def _to_auth_user(user: User, *, profile_json: object = None) -> AuthUserDto:
    return AuthUserDto(
        id=str(user.id),
        displayName=user.display_name,
        email=user.email,
        status=user.status,
        bio=_extract_bio(profile_json),
        createdAt=user.created_at.isoformat(),
        updatedAt=user.updated_at.isoformat(),
    )


def _to_auth_info(context: UserContext, settings: Settings) -> AuthInfoDto:
    return AuthInfoDto(
        userIdHeader=USER_ID_HEADER,
        source=context.source,
        isDefaultUser=context.user_id == settings.default_user_id,
        devSessionCookie=DEV_SESSION_COOKIE,
    )


async def _get_user_with_settings(session: AsyncSession, user_id: str) -> tuple[User, UserSetting | None]:
    row = (
        await session.execute(
            select(User, UserSetting)
            .outerjoin(UserSetting, UserSetting.user_id == User.id)
            .where(User.id == UUID(user_id))
        )
    ).first()
    if not row:
        raise LookupError("User not found")
    return row


async def _ensure_default_user(session: AsyncSession, settings: Settings) -> tuple[User, UserSetting | None]:
    existing = await session.scalar(select(User).where(User.id == UUID(settings.default_user_id)))
    if not existing:
        existing = User(
            id=UUID(settings.default_user_id),
            display_name="Default Local User",
            status="active",
        )
        session.add(existing)
        await session.commit()
    await ensure_user_provider_bootstrap(session, settings.default_user_id, settings)
    return await _get_user_with_settings(session, settings.default_user_id)


async def get_auth_me(session: AsyncSession, context: UserContext, settings: Settings) -> AuthMeResponse:
    user, user_setting = await _get_user_with_settings(session, context.user_id)
    return AuthMeResponse(
        data=AuthMeData(
            user=_to_auth_user(user, profile_json=user_setting.profile_json if user_setting else None),
            auth=_to_auth_info(context, settings),
        )
    )


async def list_auth_users(session: AsyncSession, current_user_id: str) -> AuthUserListResponse:
    rows = (
        await session.execute(
            select(User, UserSetting)
            .outerjoin(UserSetting, UserSetting.user_id == User.id)
            .where(User.status == "active")
            .order_by(User.updated_at.desc(), User.created_at.desc())
        )
    ).all()

    items = [
        AuthUserListItem(
            **_to_auth_user(user, profile_json=user_setting.profile_json if user_setting else None).model_dump(),
            isCurrentUser=str(user.id) == current_user_id,
        )
        for user, user_setting in rows
    ]
    return AuthUserListResponse(data=AuthUserListData(items=items, total=len(items)))


async def create_auth_user(
    session: AsyncSession,
    payload: CreateAuthUserRequest,
    settings: Settings,
) -> AuthCreateUserResponse:
    user = User(
        id=payload.id or uuid4(),
        display_name=payload.displayName,
        email=(payload.email or None) if payload.email is not None else None,
        status="active",
    )
    session.add(user)
    await session.flush()

    session.add(
        UserSetting(
            user_id=user.id,
            theme="light",
            profile_json={"bio": payload.bio or ""},
            notification_json={},
            agent_preferences_json={},
        )
    )
    await session.commit()
    await ensure_user_provider_bootstrap(session, str(user.id), settings)
    stored_user, stored_setting = await _get_user_with_settings(session, str(user.id))
    return AuthCreateUserResponse(
        data={"user": _to_auth_user(stored_user, profile_json=stored_setting.profile_json if stored_setting else None)}
    )


async def update_auth_me(
    session: AsyncSession,
    user_id: str,
    payload: UpdateAuthMeRequest,
) -> AuthUserDto:
    user, user_setting = await _get_user_with_settings(session, user_id)
    if payload.displayName is not None:
        user.display_name = payload.displayName
    if "email" in payload.model_fields_set:
        user.email = payload.email or None

    if user_setting:
        next_profile = dict(user_setting.profile_json) if isinstance(user_setting.profile_json, dict) else {}
        if payload.bio is not None:
            next_profile["bio"] = payload.bio
        user_setting.profile_json = next_profile
    else:
        user_setting = UserSetting(
            user_id=user.id,
            theme="light",
            profile_json={"bio": payload.bio or ""},
            notification_json={},
            agent_preferences_json={},
        )
        session.add(user_setting)

    await session.commit()
    refreshed_user, refreshed_setting = await _get_user_with_settings(session, user_id)
    return _to_auth_user(
        refreshed_user,
        profile_json=refreshed_setting.profile_json if refreshed_setting else None,
    )


async def get_session_target_user(session: AsyncSession, user_id: str) -> AuthUserDto | None:
    row = (
        await session.execute(
            select(User, UserSetting)
            .outerjoin(UserSetting, UserSetting.user_id == User.id)
            .where(
                User.id == UUID(user_id),
                User.status == "active",
            )
        )
    ).first()
    if not row:
        return None
    user, user_setting = row
    return _to_auth_user(user, profile_json=user_setting.profile_json if user_setting else None)


async def clear_auth_session_target(session: AsyncSession, settings: Settings) -> AuthUserDto:
    user, user_setting = await _ensure_default_user(session, settings)
    return _to_auth_user(user, profile_json=user_setting.profile_json if user_setting else None)


async def get_pin_status(session: AsyncSession, user_id: str) -> PinStatusResponse:
    setting = await session.scalar(select(UserSetting).where(UserSetting.user_id == UUID(user_id)))
    return PinStatusResponse(enabled=bool(setting and setting.security_pin_hash))


async def verify_pin_code(session: AsyncSession, user_id: str, payload: VerifyPinRequest) -> VerifyPinResponse:
    setting = await session.scalar(select(UserSetting).where(UserSetting.user_id == UUID(user_id)))
    if not setting or not setting.security_pin_hash:
        raise LookupError("PIN not set")
    return VerifyPinResponse(valid=verify_pin(payload.pin, setting.security_pin_hash))


async def set_pin_code(session: AsyncSession, user_id: str, payload: UpdatePinRequest) -> SuccessResponse:
    setting = await session.scalar(select(UserSetting).where(UserSetting.user_id == UUID(user_id)))
    hashed = hash_pin(payload.pin)
    if setting:
        setting.security_pin_hash = hashed
    else:
        session.add(
            UserSetting(
                user_id=UUID(user_id),
                theme="light",
                profile_json={},
                notification_json={},
                agent_preferences_json={},
                security_pin_hash=hashed,
            )
        )
    await session.commit()
    return SuccessResponse(success=True)


async def clear_pin_code(session: AsyncSession, user_id: str) -> SuccessResponse:
    setting = await session.scalar(select(UserSetting).where(UserSetting.user_id == UUID(user_id)))
    if setting:
        setting.security_pin_hash = None
        await session.commit()
    return SuccessResponse(success=True)
