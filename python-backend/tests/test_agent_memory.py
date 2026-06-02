from __future__ import annotations

from datetime import datetime, timezone
import uuid

from app.db.models import AgentRun, AgentSession
from app.services.agent._memory import (
    _build_session_memory_block,
    _parse_memory_model_output,
    _should_refresh_session_memory,
)


def _build_session(*, run_count: int = 0, status: str = "idle", disabled: bool = False) -> AgentSession:
    return AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        title="Memory Session",
        memory_summary="用户偏好简洁回答。",
        memory_preferences_json=["偏好分点说明"],
        memory_facts_json=["正在推进迁移方案"],
        memory_goals_json=[{"title": "上线记忆能力", "status": "active"}],
        memory_todos_json=[{"title": "补接口测试", "status": "open", "dueHint": None, "sourceRunId": None}],
        memory_rules_json=["不要跳过测试"],
        memory_status=status,
        memory_disabled=disabled,
        memory_run_count=run_count,
        created_at=datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc),
        updated_at=datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc),
    )


def _build_runs(count: int) -> list[AgentRun]:
    created_at = datetime(2026, 6, 1, 0, 0, tzinfo=timezone.utc)
    user_id = uuid.uuid4()
    session_id = uuid.uuid4()
    runs: list[AgentRun] = []
    for index in range(count):
        runs.append(
            AgentRun(
                id=uuid.uuid4(),
                user_id=user_id,
                session_id=session_id,
                status="completed",
                input_text=f"question-{index}",
                model="gpt-4o-mini",
                messages_json=[
                    {"id": f"u-{index}", "role": "user", "content": f"question-{index}", "createdAt": index * 2 + 1},
                    {"id": f"a-{index}", "role": "assistant", "content": f"answer-{index}", "createdAt": index * 2 + 2},
                ],
                created_at=created_at,
                updated_at=created_at,
                version=1,
            )
        )
    return runs


def test_build_session_memory_block_includes_summary_sections() -> None:
    session = _build_session(run_count=3, status="ready")

    block = _build_session_memory_block(session)

    assert "【会话记忆】" in block
    assert "摘要：用户偏好简洁回答。" in block
    assert "用户偏好：偏好分点说明" in block
    assert "执行规则：不要跳过测试" in block


def test_should_refresh_session_memory_respects_thresholds() -> None:
    session = _build_session(run_count=0, status="idle")
    assert _should_refresh_session_memory(session, _build_runs(2)) is False
    assert _should_refresh_session_memory(session, _build_runs(3)) is True

    updated_session = _build_session(run_count=3, status="ready")
    assert _should_refresh_session_memory(updated_session, _build_runs(4)) is False
    assert _should_refresh_session_memory(updated_session, _build_runs(5)) is True

    disabled_session = _build_session(run_count=0, status="idle", disabled=True)
    assert _should_refresh_session_memory(disabled_session, _build_runs(5)) is False


def test_parse_memory_model_output_redacts_sensitive_content() -> None:
    payload = """
    {
      "summary": "用户手机号是 13800138000",
      "preferences": ["偏好简洁回答", "邮箱 test@example.com"],
      "facts": ["使用 sk-test_secret_1234567890"],
      "goals": [{"title": "完成迁移", "status": "active"}],
      "todos": [{"title": "联系 13800138000", "status": "open"}],
      "rules": ["不要跳过测试"],
      "status": "ready"
    }
    """

    memory = _parse_memory_model_output(payload)

    assert memory.summary == ""
    assert memory.preferences == ["偏好简洁回答"]
    assert memory.facts == []
    assert memory.goals[0].title == "完成迁移"
    assert memory.todos == []
    assert memory.rules == ["不要跳过测试"]
