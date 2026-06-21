from fastapi import APIRouter

from app.core.config import get_settings
from app.core.errors import AuthError
from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.maintenance import (
    BusinessSnapshotResponse,
    ImportBusinessSnapshotRequest,
    ImportBusinessSnapshotResponse,
    ResetWorkspaceRequest,
    ResetWorkspaceResponse,
)
from app.services.maintenance import (
    export_business_snapshot,
    import_business_snapshot,
    reset_workspace_data,
)

router = APIRouter(prefix="/maintenance")


def _ensure_default_user(user: AuthenticatedUser) -> None:
    settings = get_settings()
    if user.user_id != settings.default_user_id:
        raise AuthError("Only default user can access maintenance operations", 403, "FORBIDDEN")


@router.get("/business-snapshot", response_model=BusinessSnapshotResponse)
async def export_business_snapshot_route(
    session: DbSession,
    user: AuthenticatedUser,
) -> BusinessSnapshotResponse:
    _ensure_default_user(user)
    return await export_business_snapshot(session, user.user_id)


@router.post("/business-snapshot", response_model=ImportBusinessSnapshotResponse)
async def import_business_snapshot_route(
    payload: ImportBusinessSnapshotRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> ImportBusinessSnapshotResponse:
    _ensure_default_user(user)
    return await import_business_snapshot(session, user.user_id, payload)


@router.post("/reset", response_model=ResetWorkspaceResponse)
async def reset_workspace_route(
    payload: ResetWorkspaceRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> ResetWorkspaceResponse:
    _ensure_default_user(user)
    return await reset_workspace_data(session, user.user_id, payload.scope)
