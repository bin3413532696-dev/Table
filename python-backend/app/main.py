import logging

from app.api.router import api_router
from app.core.config import get_settings
from app.core.csrf import (
    CSRF_COOKIE_NAME,
    generate_csrf_token,
    request_has_csrf_cookie,
    validate_csrf_token,
)
from app.core.errors import AuthError, VersionConflictError
from app.core.user_context import reset_user_context, resolve_request_user_context, set_user_context
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Table Python Backend", version="0.1.0")
    logger = logging.getLogger("table-python-backend")
    app.include_router(api_router)

    @app.middleware("http")
    async def request_context_middleware(request: Request, call_next):
        if not request.url.path.startswith("/api/health") and request.method not in {"GET", "HEAD", "OPTIONS"}:
            if not validate_csrf_token(request):
                return JSONResponse(
                    status_code=403,
                    content={"error": "FORBIDDEN", "message": "CSRF token validation failed"},
                )

        context = resolve_request_user_context(request, settings)
        token = set_user_context(context)
        try:
            response = await call_next(request)
        finally:
            reset_user_context(token)

        if (
            request.method == "GET"
            and not request.url.path.startswith("/api/health")
            and not request_has_csrf_cookie(request)
        ):
            response.set_cookie(
                key=CSRF_COOKIE_NAME,
                value=generate_csrf_token(),
                path="/",
                samesite="lax",
                secure=settings.is_production,
            )
        return response

    @app.exception_handler(AuthError)
    async def auth_error_handler(_request: Request, exc: AuthError):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.code, "message": str(exc)},
        )

    @app.exception_handler(VersionConflictError)
    async def conflict_error_handler(_request: Request, exc: VersionConflictError):
        return JSONResponse(
            status_code=409,
            content={"error": "VERSION_CONFLICT", "message": str(exc)},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "error": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": exc.errors(),
            },
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException):
        if isinstance(exc.detail, dict):
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": "HTTP_ERROR", "message": str(exc.detail)},
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(_request: Request, exc: Exception):
        logger.error("Unhandled application error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={"error": "INFRASTRUCTURE_ERROR", "message": "Unexpected server error"},
        )

    return app


app = create_app()
