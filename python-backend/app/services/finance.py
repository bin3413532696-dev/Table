from app.core.errors import VersionConflictError
from app.db.models import FinanceRecord
from app.repositories.finance import (
    create_finance_record,
    delete_finance_record,
    find_finance_record_by_id,
    list_finance_records,
    update_finance_record,
)
from app.schemas.finance import (
    CreateFinanceRecordRequest,
    FinanceRecordResponse,
    UpdateFinanceRecordRequest,
)
from sqlalchemy.ext.asyncio import AsyncSession


def to_finance_record_response(record: FinanceRecord) -> FinanceRecordResponse:
    return FinanceRecordResponse(
        id=str(record.id),
        type=record.type,
        amount=float(record.amount),
        description=record.description,
        category=record.category,
        date=record.record_date.isoformat(),
        model=record.model,
        createdAt=int(record.created_at.timestamp() * 1000),
        updatedAt=int(record.updated_at.timestamp() * 1000),
        version=record.version,
    )


async def get_finance_list(session: AsyncSession, user_id: str) -> list[FinanceRecordResponse]:
    return [to_finance_record_response(record) for record in await list_finance_records(session, user_id)]


async def create_finance_record_entry(
    session: AsyncSession,
    user_id: str,
    payload: CreateFinanceRecordRequest,
) -> FinanceRecordResponse:
    record = await create_finance_record(session, user_id, payload.model_dump(exclude_none=True))
    return to_finance_record_response(record)


async def get_finance_record_detail(
    session: AsyncSession,
    user_id: str,
    record_id: str,
) -> FinanceRecordResponse | None:
    record = await find_finance_record_by_id(session, user_id, record_id)
    return to_finance_record_response(record) if record else None


async def update_finance_record_entry(
    session: AsyncSession,
    user_id: str,
    record_id: str,
    payload: UpdateFinanceRecordRequest,
) -> FinanceRecordResponse | None:
    existing = await find_finance_record_by_id(session, user_id, record_id)
    if not existing:
        return None

    record = await update_finance_record(
        session,
        user_id,
        record_id,
        payload.version,
        payload.model_dump(exclude_unset=True, exclude={"version"}),
    )
    if not record:
        raise VersionConflictError(
            "Finance record was modified by another request. Please refresh and try again."
        )
    return to_finance_record_response(record)


async def delete_finance_record_entry(
    session: AsyncSession,
    user_id: str,
    record_id: str,
) -> FinanceRecordResponse | None:
    record = await delete_finance_record(session, user_id, record_id)
    return to_finance_record_response(record) if record else None
