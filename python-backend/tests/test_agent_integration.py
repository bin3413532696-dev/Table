import os
import uuid

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.db.models import AgentRun, AgentSession, User, UserSetting
from app.schemas.agent import (
    AgentPersonaDto,
    CreateAgentRunRequest,
    CreateAgentSessionRequest,
    ListAgentRunsQuery,
    ListAgentSessionsQuery,
    UpdateAgentRunRequest,
    UpdateAgentSessionRequest,
)
from app.services.agent import (
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
            assert run_detail.status == "pending"
            assert run_detail.messages == []

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
    finally:
        async with session_factory() as session:
            await session.execute(delete(AgentRun).where(AgentRun.user_id == user_id))
            await session.execute(delete(AgentSession).where(AgentSession.user_id == user_id))
            await session.execute(delete(UserSetting).where(UserSetting.user_id == user_id))
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()
