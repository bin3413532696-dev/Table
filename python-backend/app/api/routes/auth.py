from urllib.parse import quote

from app.core.config import get_settings
from app.core.csrf import CSRF_COOKIE_NAME, generate_csrf_token
from app.core.session import sign_session_token
from app.core.user_context import DEV_SESSION_COOKIE
from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.auth import (
    AuthCreateUserResponse,
    AuthMeResponse,
    AuthUserListResponse,
    CreateAuthUserRequest,
    PinStatusResponse,
    SuccessResponse,
    SwitchSessionRequest,
    UpdateAuthMeRequest,
    UpdatePinRequest,
    VerifyPinRequest,
    VerifyPinResponse,
)
from app.services.auth import (
    clear_auth_session_target,
    clear_pin_code,
    create_auth_user,
    get_auth_me,
    get_pin_status,
    get_session_target_user,
    list_auth_users,
    set_pin_code,
    update_auth_me,
    verify_pin_code,
)
from fastapi import APIRouter, HTTPException, Response, status

router = APIRouter(prefix="/auth")


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=DEV_SESSION_COOKIE,
        value=quote(token, safe=""),
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
    )


def _clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.set_cookie(
        key=DEV_SESSION_COOKIE,
        value="",
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.is_production,
        max_age=0,
    )


def _set_csrf_cookie(response: Response) -> None:
    settings = get_settings()
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=generate_csrf_token(),
        path="/",
        samesite="lax",
        secure=settings.is_production,
    )


@router.get("/me", response_model=AuthMeResponse)
async def auth_me(session: DbSession, user: AuthenticatedUser) -> AuthMeResponse:
    return await get_auth_me(session, user, get_settings())


@router.get("/users", response_model=AuthUserListResponse)
async def auth_users(session: DbSession, user: AuthenticatedUser) -> AuthUserListResponse:
    return await list_auth_users(session, user.user_id)


@router.post("/users", response_model=AuthCreateUserResponse, status_code=status.HTTP_201_CREATED)
async def create_auth_user_route(
    payload: CreateAuthUserRequest,
    session: DbSession,
    _user: AuthenticatedUser,
) -> AuthCreateUserResponse:
    return await create_auth_user(session, payload, get_settings())


@router.patch("/me", response_model=AuthMeResponse)
async def update_auth_me_route(
    payload: UpdateAuthMeRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> AuthMeResponse:
    updated_user = await update_auth_me(session, user.user_id, payload)
    settings = get_settings()
    return AuthMeResponse(
        data={
            "user": updated_user,
            "auth": {
                "userIdHeader": "x-user-id",
                "source": user.source,
                "isDefaultUser": user.user_id == settings.default_user_id,
                "devSessionCookie": DEV_SESSION_COOKIE,
            },
        }
    )


@router.post("/session", response_model=AuthMeResponse)
async def switch_auth_session(
    payload: SwitchSessionRequest,
    response: Response,
    session: DbSession,
    _user: AuthenticatedUser,
) -> AuthMeResponse:
    target_user = await get_session_target_user(session, str(payload.userId))
    if not target_user:
        raise HTTPException(status_code=404, detail={"message": "User not found or inactive"})

    settings = get_settings()
    _set_session_cookie(response, sign_session_token(str(payload.userId), settings.provider_secret_key))
    return AuthMeResponse(
        data={
            "user": target_user,
            "auth": {
                "userIdHeader": "x-user-id",
                "source": "signed_session",
                "isDefaultUser": str(payload.userId) == settings.default_user_id,
                "devSessionCookie": DEV_SESSION_COOKIE,
            },
        }
    )


@router.delete("/session", response_model=AuthMeResponse)
async def clear_auth_session(response: Response, session: DbSession, _user: AuthenticatedUser) -> AuthMeResponse:
    settings = get_settings()
    _clear_session_cookie(response)
    target_user = await clear_auth_session_target(session, settings)
    return AuthMeResponse(
        data={
            "user": target_user,
            "auth": {
                "userIdHeader": "x-user-id",
                "source": "default",
                "isDefaultUser": True,
                "devSessionCookie": DEV_SESSION_COOKIE,
            },
        }
    )


@router.get("/pin", response_model=PinStatusResponse)
async def pin_status(session: DbSession, user: AuthenticatedUser) -> PinStatusResponse:
    return await get_pin_status(session, user.user_id)


@router.post("/pin/verify", response_model=VerifyPinResponse)
async def verify_pin_route(
    payload: VerifyPinRequest,
    response: Response,
    session: DbSession,
    user: AuthenticatedUser,
) -> VerifyPinResponse:
    try:
        result = VerifyPinResponse.model_validate(await verify_pin_code(session, user.user_id, payload))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail={"error": "NOT_FOUND", "message": str(exc)}) from exc

    if result.valid:
        settings = get_settings()
        _set_session_cookie(response, sign_session_token(user.user_id, settings.provider_secret_key))
        _set_csrf_cookie(response)
    return result


@router.patch("/pin", response_model=SuccessResponse)
async def set_pin_route(
    payload: UpdatePinRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> SuccessResponse:
    return await set_pin_code(session, user.user_id, payload)


@router.delete("/pin", response_model=SuccessResponse)
async def clear_pin_route(session: DbSession, user: AuthenticatedUser) -> SuccessResponse:
    return await clear_pin_code(session, user.user_id)
