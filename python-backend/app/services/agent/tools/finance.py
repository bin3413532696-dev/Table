from __future__ import annotations

from datetime import datetime

from app.repositories.finance import (
    create_finance_record as create_finance_record_repo,
)
from app.repositories.finance import (
    list_finance_records as list_finance_records_repo,
)
from app.schemas.finance import CreateFinanceRecordRequest
from app.services.agent.registry import AgentToolDefinition, AgentToolExecutionContext, register_tool_definition
from app.services.agent.tools.common import int_arg, string_arg
from app.services.finance import to_finance_record_response


async def _query_finance(context: AgentToolExecutionContext, arguments: dict[str, object]) -> object:
    records = await list_finance_records_repo(context.session, context.user_id)
    type_filter = string_arg(arguments, "type") or "all"
    category_filter = string_arg(arguments, "category")
    start_date = string_arg(arguments, "startDate")
    end_date = string_arg(arguments, "endDate")
    limit = int_arg(arguments, "limit", 50)
    filtered_records = records
    if type_filter != "all":
        filtered_records = [record for record in filtered_records if record.type == type_filter]
    if category_filter:
        filtered_records = [record for record in filtered_records if record.category == category_filter]
    if start_date:
        start_value = datetime.fromisoformat(start_date).date()
        filtered_records = [record for record in filtered_records if record.record_date >= start_value]
    if end_date:
        end_value = datetime.fromisoformat(end_date).date()
        filtered_records = [record for record in filtered_records if record.record_date <= end_value]
    return [to_finance_record_response(record).model_dump() for record in filtered_records[:limit]]


async def _get_finance_stats(context: AgentToolExecutionContext, _arguments: dict[str, object]) -> object:
    records = await list_finance_records_repo(context.session, context.user_id)
    total_income = sum(float(record.amount) for record in records if record.type == "income")
    total_expense = sum(float(record.amount) for record in records if record.type == "expense")
    return {
        "totalRecords": len(records),
        "totalIncome": total_income,
        "totalExpense": total_expense,
        "balance": total_income - total_expense,
    }


async def _unsupported_mutation(name: str) -> object:
    raise ValueError(f"{name} should only execute after user confirmation.")


async def _add_finance_record_after_confirmation(
    context: AgentToolExecutionContext,
    arguments: dict[str, object],
) -> object:
    payload = CreateFinanceRecordRequest.model_validate(
        {
            "type": arguments.get("type"),
            "amount": arguments.get("amount"),
            "description": arguments.get("description"),
            "category": arguments.get("category"),
            "date": arguments.get("date"),
        }
    )
    record = await create_finance_record_repo(
        context.session,
        context.user_id,
        payload.model_dump(exclude_none=True),
    )
    return to_finance_record_response(record).model_dump()


def register_finance_tools() -> None:
    register_tool_definition(
        AgentToolDefinition(
            name="query_finance",
            description="查询财务记录，可按类型、分类、时间范围和数量过滤。",
            prompt_signature="query_finance(type?, category?, startDate?, endDate?, limit?)",
            category="query",
            module="finance",
            execute=_query_finance,
        )
    )
    register_tool_definition(
        AgentToolDefinition(
            name="get_finance_stats",
            description="获取财务记录总数、收入、支出与结余统计。",
            prompt_signature="get_finance_stats()",
            category="query",
            module="finance",
            execute=_get_finance_stats,
        )
    )
    register_tool_definition(
        AgentToolDefinition(
            name="add_finance_record",
            description="新增财务记录。",
            prompt_signature="add_finance_record(type!, amount!, description!, category!, date!)",
            category="mutation",
            module="finance",
            execute=lambda _context, _arguments: _unsupported_mutation("add_finance_record"),
            execute_after_confirmation=_add_finance_record_after_confirmation,
            requires_confirmation=True,
        )
    )
