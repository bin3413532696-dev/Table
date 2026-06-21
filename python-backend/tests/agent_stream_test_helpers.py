from __future__ import annotations

import pytest

import app.services.agent._confirmations as agent_confirmations
import app.services.agent._execution as agent_execution
import app.services.agent._provider_runtime as agent_provider_runtime
import app.services.agent._runs as agent_runs
import app.services.agent._runtime_support as agent_runtime_support
import app.services.agent._sessions as agent_sessions

AGENT_PATCH_TARGETS: dict[str, list[tuple[object, str]]] = {
    "find_active_provider_for_user": [
        (agent_runtime_support, "find_active_provider_for_user"),
        (agent_sessions, "find_active_provider_for_user"),
    ],
    "decrypt_provider_secret": [
        (agent_runtime_support, "decrypt_provider_secret"),
    ],
    "find_agent_session_by_id": [
        (agent_runs, "find_agent_session_by_id"),
        (agent_sessions, "find_agent_session_by_id"),
    ],
    "list_runs_for_session": [
        (agent_sessions, "list_runs_for_session"),
    ],
    "stream_agent_run_record": [
        (agent_execution, "stream_agent_run_record"),
    ],
    "find_user_setting": [
        (agent_execution, "find_user_setting"),
    ],
    "create_agent_run": [
        (agent_execution, "create_agent_run"),
    ],
    "update_agent_session": [
        (agent_execution, "update_agent_session"),
    ],
    "update_agent_run": [
        (agent_runtime_support, "update_agent_run"),
    ],
    "find_agent_run_by_id": [
        (agent_execution, "find_agent_run_by_id"),
        (agent_confirmations, "find_agent_run_by_id"),
        (agent_runtime_support, "find_agent_run_by_id"),
    ],
    "_execute_agent_tool_call": [
        (agent_execution, "_execute_agent_tool_call"),
    ],
    "_execute_pending_confirmation_tool": [
        (agent_confirmations, "_execute_pending_confirmation_tool"),
    ],
    "_stream_openai_chat_completion": [
        (agent_provider_runtime, "_stream_openai_chat_completion"),
    ],
    "_stream_anthropic_messages": [
        (agent_provider_runtime, "_stream_anthropic_messages"),
    ],
    "_stream_gemini_generate_content": [
        (agent_provider_runtime, "_stream_gemini_generate_content"),
    ],
    "_stream_provider_chat_completion": [
        (agent_execution, "_stream_provider_chat_completion"),
        (agent_confirmations, "_stream_provider_chat_completion"),
    ],
}


def patch_agent_symbol(monkeypatch: pytest.MonkeyPatch, name: str, value: object) -> None:
    for module, attr_name in AGENT_PATCH_TARGETS[name]:
        monkeypatch.setattr(module, attr_name, value)
