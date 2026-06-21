from __future__ import annotations

import json

from app.db.models import AgentRun, AgentSession
from app.services.agent._memory_sanitization import (
    MEMORY_TRIGGER_INCREMENTAL_RUNS,
    MEMORY_TRIGGER_INITIAL_RUNS,
    _redact_sensitive_text,
    _to_agent_session_memory_dto,
)


def _has_session_memory(session: AgentSession) -> bool:
    memory = _to_agent_session_memory_dto(session)
    return bool(
        memory.summary
        or memory.preferences
        or memory.facts
        or memory.goals
        or memory.todos
        or memory.rules
    )


def _build_session_memory_block(session: AgentSession) -> str:
    memory = _to_agent_session_memory_dto(session)
    if memory.disabled or memory.status != "ready" or not _has_session_memory(session):
        return ""

    lines = ["【会话记忆】"]
    if memory.summary:
        lines.append(f"摘要：{memory.summary}")
    if memory.preferences:
        lines.append("用户偏好：" + "；".join(memory.preferences))
    if memory.facts:
        lines.append("已确认事实：" + "；".join(memory.facts))
    if memory.goals:
        lines.append("当前目标：" + "；".join(f"{goal.title}（{goal.status}）" for goal in memory.goals))
    if memory.todos:
        lines.append(
            "待办事项："
            + "；".join(
                f"{todo.title}（{todo.status}{f'，{todo.dueHint}' if todo.dueHint else ''}）"
                for todo in memory.todos
            )
        )
    if memory.rules:
        lines.append("执行规则：" + "；".join(memory.rules))
    lines.append("以上记忆仅供参考，若与用户当前明确指令冲突，以当前指令为准。")
    return "\n".join(lines)


def _eligible_memory_runs(runs: list[AgentRun]) -> list[AgentRun]:
    return [run for run in runs if run.status in {"completed", "waiting_confirmation"}]


def _should_refresh_session_memory(session: AgentSession, runs: list[AgentRun]) -> bool:
    if session.memory_disabled:
        return False
    eligible_runs = _eligible_memory_runs(runs)
    eligible_count = len(eligible_runs)
    if eligible_count < MEMORY_TRIGGER_INITIAL_RUNS:
        return False

    recorded_count = max(int(session.memory_run_count or 0), 0)
    if recorded_count <= 0:
        return True
    if recorded_count > eligible_count:
        return True

    delta_count = eligible_count - recorded_count
    if session.memory_status == "failed":
        return delta_count >= 1
    return delta_count >= MEMORY_TRIGGER_INCREMENTAL_RUNS


def _select_runs_for_memory_refresh(session: AgentSession, runs: list[AgentRun]) -> tuple[list[AgentRun], int]:
    eligible_runs = _eligible_memory_runs(runs)
    eligible_count = len(eligible_runs)
    recorded_count = max(int(session.memory_run_count or 0), 0)

    if recorded_count <= 0 or recorded_count > eligible_count:
        return eligible_runs, eligible_count
    return eligible_runs[recorded_count:], eligible_count


def _format_runs_for_memory_prompt(runs: list[AgentRun]) -> str:
    entries: list[str] = []
    for run in runs:
        messages = run.messages_json if isinstance(run.messages_json, list) else []
        visible_messages: list[str] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            content = message.get("content")
            if role not in {"user", "assistant"} or not isinstance(content, str):
                continue
            redacted = _redact_sensitive_text(content)
            if not redacted:
                continue
            visible_messages.append(f"{role}: {redacted}")
        if not visible_messages:
            visible_messages.append(f"user: {_redact_sensitive_text(run.input_text)}")
            if run.final_text:
                visible_messages.append(f"assistant: {_redact_sensitive_text(run.final_text)}")
        entries.append("\n".join(visible_messages))
    return "\n\n".join(entries)


def _build_memory_generation_messages(
    session: AgentSession,
    runs: list[AgentRun],
) -> list[dict[str, str]]:
    existing_memory = _to_agent_session_memory_dto(session)
    existing_payload = json.dumps(existing_memory.model_dump(), ensure_ascii=False)
    conversation_excerpt = _format_runs_for_memory_prompt(runs)

    system_prompt = (
        "你是一个对话记忆整理器。"
        "你的任务是根据已有记忆和新增对话，输出用于后续会话承接的记忆 JSON。"
        "不要调用工具，不要输出解释，不要输出 Markdown，只输出一个 JSON 对象。"
        "不要记录任何邮箱、电话、密钥、口令、证件号、银行卡号等敏感信息。"
        "如果信息不稳定、不确定、一次性或与后续无关，就不要写入记忆。"
        "JSON 结构必须为："
        '{"summary":"",'
        '"preferences":[""],'
        '"facts":[""],'
        '"goals":[{"title":"","status":"active"}],'
        '"todos":[{"title":"","status":"open","dueHint":null,"sourceRunId":null}],'
        '"rules":[""],'
        '"status":"ready"}。'
    )
    user_prompt = (
        f"已有记忆：\n{existing_payload}\n\n"
        f"新增对话：\n{conversation_excerpt or '（无）'}\n\n"
        "要求：\n"
        "1. summary 控制在 800 字以内。\n"
        "2. 每个列表尽量保留高价值信息，避免重复。\n"
        "3. 只有明确承诺或稳定目标才写入 todos/goals。\n"
        "4. 只保留后续对话可能复用的事实、偏好和规则。\n"
        "5. 如果没有可写入内容，返回空列表和空 summary，status 仍为 ready。\n"
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
