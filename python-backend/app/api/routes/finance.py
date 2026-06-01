from uuid import UUID

from app.dependencies import AuthenticatedUser, DbSession
from app.schemas.finance import (
    CreateFinanceRecordRequest,
    FinanceRecordEnvelope,
    FinanceRecordListEnvelope,
    UpdateFinanceRecordRequest,
)
from app.services.finance import (
    create_finance_record_entry,
    delete_finance_record_entry,
    get_finance_list,
    get_finance_record_detail,
    update_finance_record_entry,
)
from fastapi import APIRouter, HTTPException, Response, status

router = APIRouter()


@router.get("/", response_model=FinanceRecordListEnvelope)
async def list_finance_records(
    session: DbSession, user: AuthenticatedUser
) -> FinanceRecordListEnvelope:
    items = await get_finance_list(session, user.user_id)
    return FinanceRecordListEnvelope(items=items, total=len(items), source="postgres")


@router.post("/", response_model=FinanceRecordEnvelope, status_code=status.HTTP_201_CREATED)
async def create_finance_record(
    payload: CreateFinanceRecordRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> FinanceRecordEnvelope:
    record = await create_finance_record_entry(session, user.user_id, payload)
    return FinanceRecordEnvelope(data=record, source="postgres")


@router.get("/{record_id}", response_model=FinanceRecordEnvelope)
async def get_finance_record(
    record_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> FinanceRecordEnvelope:
    record = await get_finance_record_detail(session, user.user_id, str(record_id))
    if not record:
        raise HTTPException(
            status_code=404,
            detail={"error": "NOT_FOUND", "message": "Finance record not found"},
        )
    return FinanceRecordEnvelope(data=record, source="postgres")


@router.patch("/{record_id}", response_model=FinanceRecordEnvelope)
async def update_finance_record(
    record_id: UUID,
    payload: UpdateFinanceRecordRequest,
    session: DbSession,
    user: AuthenticatedUser,
) -> FinanceRecordEnvelope:
    record = await update_finance_record_entry(session, user.user_id, str(record_id), payload)
    if not record:
        raise HTTPException(
            status_code=404,
            detail={"error": "NOT_FOUND", "message": "Finance record not found"},
        )
    return FinanceRecordEnvelope(data=record, source="postgres")


@router.delete("/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_finance_record(
    record_id: UUID,
    session: DbSession,
    user: AuthenticatedUser,
) -> Response:
    record = await delete_finance_record_entry(session, user.user_id, str(record_id))
    if not record:
        raise HTTPException(
            status_code=404,
            detail={"error": "NOT_FOUND", "message": "Finance record not found"},
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
