from __future__ import annotations

import re

from app.schemas.agent import AgentRunDetailDto
from app.services.agent._memory import _redact_sensitive_text

_PREFERENCE_PATTERNS = [
    re.compile(r"(以后|今后|默认).{0,12}(中文|简体中文)"),
    re.compile(r"(请|希望|偏好).{0,12}(简洁|精简|分点|条列|结构化)"),
]
_RULE_PATTERNS = [
    re.compile(r"(不要|别).{0,12}(自动).{0,12}(删除|修改|写入|记账|财务)"),
    re.compile(r"(必须|需要|务必).{0,12}(确认)"),
]
_CLAUSE_SPLIT_PATTERN = re.compile(r"[，,。；;！!\n]+")
_GOAL_KEYWORDS = ["帮我", "需要", "整理", "总结", "复习", "学习", "继续", "讲解", "以后", "默认", "请", "希望"]
_LEADING_FILLER_PATTERN = re.compile(r"^(并且|而且|然后|同时|另外|再|也|还要|还需|再者)")


def _normalize_line(value: str, *, limit: int = 180) -> str:
    cleaned = _redact_sensitive_text(value).strip()
    if not cleaned:
        return ""
    return cleaned[:limit].rstrip()


def _collect_user_messages(detail: AgentRunDetailDto) -> list[str]:
    return [
        _normalize_line(message.content)
        for message in detail.messages
        if message.role == "user" and isinstance(message.content, str)
    ]


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    deduped: list[str] = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


def _split_message_clauses(messages: list[str]) -> list[str]:
    clauses: list[str] = []
    for message in messages:
        if not message:
            continue
        parts = _CLAUSE_SPLIT_PATTERN.split(message)
        for part in parts:
            normalized = _normalize_line(part, limit=120)
            normalized = _LEADING_FILLER_PATTERN.sub("", normalized).strip()
            if normalized:
                clauses.append(normalized)
    return _dedupe_preserve_order(clauses)


def _extract_preference_memory(messages: list[str]) -> list[str]:
    clauses = _split_message_clauses(messages)
    matches: list[str] = []
    for clause in clauses:
        if any(pattern.search(clause) for pattern in _PREFERENCE_PATTERNS):
            matches.append(clause)
    return matches[:4]


def _extract_rule_memory(messages: list[str]) -> list[str]:
    clauses = _split_message_clauses(messages)
    matches: list[str] = []
    for clause in clauses:
        if any(pattern.search(clause) for pattern in _RULE_PATTERNS):
            matches.append(clause)
    return matches[:4]


def _extract_goal_memory(messages: list[str]) -> list[str]:
    clauses = _split_message_clauses(messages)
    preferences = set(_extract_preference_memory(messages))
    rules = set(_extract_rule_memory(messages))

    goals: list[str] = []
    for clause in clauses:
        if clause in preferences or clause in rules:
            continue
        if any(keyword in clause for keyword in _GOAL_KEYWORDS):
            goals.append(clause)
    return goals[:4]


def _extract_corpus_document_ids(detail: AgentRunDetailDto) -> list[str]:
    document_ids: list[str] = []
    for tool_call in detail.executedToolCalls:
        result = tool_call.result or {}
        sources = result.get("sources")
        if not isinstance(sources, list):
            continue
        for source in sources:
            if not isinstance(source, dict):
                continue
            document_id = source.get("documentId")
            if isinstance(document_id, str) and document_id and document_id not in document_ids:
                document_ids.append(document_id)
    return document_ids


def _build_session_summary(
    detail: AgentRunDetailDto,
    goals: list[str],
    preferences: list[str],
    rules: list[str],
) -> str:
    lines: list[str] = []
    if goals:
        lines.append(f"当前重点：{goals[0]}")
    if detail.finalText.strip():
        lines.append(f"最近产出：{_normalize_line(detail.finalText, limit=220)}")
    if preferences:
        lines.append("风格偏好：" + "；".join(preferences[:2]))
    if rules:
        lines.append("执行约束：" + "；".join(rules[:2]))
    return "\n".join(line for line in lines if line).strip()


def _merge_memory_lines(*groups: list[str], limit: int) -> list[str]:
    merged: list[str] = []
    for group in groups:
        for item in group:
            if item and item not in merged:
                merged.append(item)
                if len(merged) >= limit:
                    return merged
    return merged
