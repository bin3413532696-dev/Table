from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FinanceRecord


def parse_record_date(value: str) -> date:
    return date.fromisoformat(value)


def parse_amount(value: float) -> Decimal:
    return Decimal(str(value))


async def list_finance_records(session: AsyncSession, user_id: str) -> list[FinanceRecord]:
    result = await session.scalars(
        select(FinanceRecord)
        .where(FinanceRecord.user_id == UUID(user_id))
        .order_by(FinanceRecord.updated_at.desc())
    )
    return list(result)


async def create_finance_record(
    session: AsyncSession,
    user_id: str,
    payload: dict,
) -> FinanceRecord:
    record = FinanceRecord(
        user_id=UUID(user_id),
        type=payload["type"],
        amount=parse_amount(payload["amount"]),
        category=payload["category"],
        description=payload["description"],
        record_date=parse_record_date(payload.get("date") or payload["recordDate"]),
        model=payload.get("model"),
    )
    session.add(record)
    await session.commit()
    await session.refresh(record)
    return record


async def find_finance_record_by_id(
    session: AsyncSession,
    user_id: str,
    record_id: str,
) -> FinanceRecord | None:
    return await session.scalar(
        select(FinanceRecord).where(
            FinanceRecord.id == UUID(record_id),
            FinanceRecord.user_id == UUID(user_id),
        )
    )


async def update_finance_record(
    session: AsyncSession,
    user_id: str,
    record_id: str,
    version: int,
    payload: dict,
) -> FinanceRecord | None:
    values = {"updated_at": func.now(), "version": FinanceRecord.version + 1}
    if "type" in payload:
        values["type"] = payload["type"]
    if "amount" in payload:
        values["amount"] = parse_amount(payload["amount"])
    if "category" in payload:
        values["category"] = payload["category"]
    if "description" in payload:
        values["description"] = payload["description"]
    if "date" in payload or "recordDate" in payload:
        values["record_date"] = parse_record_date(payload.get("date") or payload.get("recordDate"))
    if "model" in payload:
        values["model"] = payload["model"]

    result = await session.execute(
        update(FinanceRecord)
        .where(
            FinanceRecord.id == UUID(record_id),
            FinanceRecord.user_id == UUID(user_id),
            FinanceRecord.version == version,
        )
        .values(**values)
        .returning(FinanceRecord)
    )
    record = result.scalar_one_or_none()
    if record:
        await session.commit()
    else:
        await session.rollback()
    return record


async def delete_finance_record(
    session: AsyncSession,
    user_id: str,
    record_id: str,
) -> FinanceRecord | None:
    record = await find_finance_record_by_id(session, user_id, record_id)
    if not record:
        return None

    await session.execute(delete(FinanceRecord).where(FinanceRecord.id == UUID(record_id)))
    await session.commit()
    return record
