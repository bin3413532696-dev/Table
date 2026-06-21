import os
import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.services.agent._execution as agent_execution_service
import app.services.agent._runs as agent_runs_service
from app.repositories.agent import create_agent_run as create_agent_run_entity
from app.core.config import Settings
from app.db.models import AgentRun, AgentSession, User, UserSetting
from app.schemas.agent import (
    AgentRunDetailDto,
    AgentRunMessageDto,
    AgentPersonaDto,
    CreateAgentRunRequest,
    CreateAgentSessionRequest,
    ListAgentRunsQuery,
    TimelineEvent,
    ListAgentSessionsQuery,
    UpdateAgentRunRequest,
    UpdateAgentSessionRequest,
)
from app.services.agent.public import (
    create_agent_run_record,
    create_agent_session_record,
    delete_agent_run_record,
    delete_agent_session_record,
    get_agent_persona,
    get_agent_run_detail,
    get_agent_run_list,
    get_agent_session_detail,
    get_agent_session_list,
    update_agent_persona_record,
    update_agent_run_record,
    update_agent_session_record,
)
from app.services.provider_bootstrap import ensure_user_provider_bootstrap

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_PYTHON_INTEGRATION_TESTS") != "1",
    reason="set RUN_PYTHON_INTEGRATION_TESTS=1 to run database integration tests",
)


@pytest.mark.asyncio
async def test_agent_persona_and_persistence_crud() -> None:
    settings = Settings()
    engine = create_async_engine(settings.sqlalchemy_database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    user_id = uuid.uuid4()

    try:
        async with session_factory() as session:
            session.add(
                User(
                    id=user_id,
                    email=f"{user_id}@example.test",
                    display_name="Agent Integration User",
                    status="active",
                )
            )
            await session.commit()
            await ensure_user_provider_bootstrap(session, str(user_id), settings)

            async def fake_stream_agent_run_record(current_session, current_user_id, payload):
                created_run = await agent_runs_service.resolve_run_session(current_session, current_user_id, payload)
                persisted_run = await create_agent_run_entity(
                    current_session,
                    current_user_id,
                    session_id=str(created_run.id),
                    input_text=payload.inputText,
                    model=payload.model,
                    status="completed",
                )
                detail = AgentRunDetailDto(
                    id=str(persisted_run.id),
                    sessionId=str(persisted_run.session_id),
                    status="completed",
                    inputText=persisted_run.input_text,
                    model=persisted_run.model,
                    createdAt=int(persisted_run.created_at.timestamp() * 1000),
                    updatedAt=int(persisted_run.updated_at.timestamp() * 1000),
                    version=persisted_run.version,
                    messages=[
                        AgentRunMessageDto(
                            id="assistant-1",
                            role="assistant",
                            content="Migration scope reviewed.",
                            createdAt=int(persisted_run.updated_at.timestamp() * 1000),
                        )
                    ],
                    finalText="Migration scope reviewed.",
                    timeline=[
                        TimelineEvent(
                            type="llm_end",
                            timestamp=persisted_run.updated_at.isoformat(),
                            data={"source": "integration-test"},
                        )
                    ],
                )
                yield {"type": "run_completed", "run": detail.model_dump(mode="json")}

            monkeypatch = pytest.MonkeyPatch()
            monkeypatch.setattr(agent_execution_service, "stream_agent_run_record", fake_stream_agent_run_record)

            persona = await get_agent_persona(session, str(user_id))
            assert persona.systemPrompt == ""

            updated_persona = await update_agent_persona_record(
                session,
                str(user_id),
                AgentPersonaDto(systemPrompt="Prefer short, concrete answers."),
            )
            assert updated_persona.systemPrompt == "Prefer short, concrete answers."

            session_record = await create_agent_session_record(
                session,
                str(user_id),
                CreateAgentSessionRequest(title="Migration Slice"),
            )
            assert session_record.title == "Migration Slice"

            updated_session = await update_agent_session_record(
                session,
                str(user_id),
                session_record.id,
                UpdateAgentSessionRequest(title="Migration Slice Updated"),
            )
            assert updated_session is not None
            assert updated_session.title == "Migration Slice Updated"

            run_detail = await create_agent_run_record(
                session,
                str(user_id),
                CreateAgentRunRequest(
                    sessionId=session_record.id,
                    inputText="Review the pending agent migration scope.",
                    model="default",
                ),
            )
            assert run_detail.sessionId == session_record.id
            assert run_detail.status == "completed"
            assert any(message.content == "Migration scope reviewed." for message in run_detail.messages)

            created_run = await get_agent_run_detail(session, str(user_id), run_detail.id)
            assert created_run is not None
            assert created_run.inputText == "Review the pending agent migration scope."

            listed_sessions, session_total = await get_agent_session_list(
                session,
                str(user_id),
                ListAgentSessionsQuery(limit=20, offset=0),
            )
            assert session_total == 1
            assert listed_sessions[0].runs[0].id == run_detail.id

            session_detail = await get_agent_session_detail(session, str(user_id), session_record.id)
            assert session_detail is not None
            assert session_detail.runs[0].id == run_detail.id
            assert session_detail.messages == []

            listed_runs = await get_agent_run_list(
                session,
                str(user_id),
                ListAgentRunsQuery(limit=20, offset=0, sessionId=session_record.id),
            )
            assert listed_runs.total == 1
            assert listed_runs.items[0].id == run_detail.id

            updated_run = await update_agent_run_record(
                session,
                str(user_id),
                run_detail.id,
                UpdateAgentRunRequest(status="completed", version=run_detail.version),
            )
            assert updated_run is not None
            assert updated_run.status == "completed"
            assert updated_run.version == run_detail.version + 1

            delete_run_result = await delete_agent_run_record(session, str(user_id), run_detail.id)
            assert delete_run_result is not None
            assert delete_run_result.deleted is True

            delete_session_result = await delete_agent_session_record(session, str(user_id), session_record.id)
            assert delete_session_result is not None
            assert delete_session_result.deleted is True
            monkeypatch.undo()
    finally:
        async with session_factory() as session:
            await session.execute(delete(AgentRun).where(AgentRun.user_id == user_id))
            await session.execute(delete(AgentSession).where(AgentSession.user_id == user_id))
            await session.execute(delete(UserSetting).where(UserSetting.user_id == user_id))
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()
