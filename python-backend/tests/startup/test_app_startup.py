from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.db.models import KnowledgeDocument, KnowledgeIndexJob, User
from app.main import create_app

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_PYTHON_INTEGRATION_TESTS") != "1",
    reason="set RUN_PYTHON_INTEGRATION_TESTS=1 to run database integration tests",
)


async def _build_test_session_factory():
    settings = Settings()
    engine = create_async_engine(settings.sqlalchemy_database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, session_factory


@pytest.mark.asyncio
async def test_app_startup_succeeds_with_live_database(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, session_factory = await _build_test_session_factory()
    monkeypatch.setattr("app.main.SessionLocal", session_factory)
    app = create_app()

    @asynccontextmanager
    async def managed_app():
        async with app.router.lifespan_context(app):
            yield

    try:
        async with managed_app():
            assert app.title == "Table Python Backend"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_app_startup_fails_fast_when_database_is_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    unreachable_settings = Settings(DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:9/table_dev")

    engine = create_async_engine(unreachable_settings.sqlalchemy_database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    monkeypatch.setattr("app.main.SessionLocal", session_factory)

    app = create_app()

    @asynccontextmanager
    async def managed_app():
        async with app.router.lifespan_context(app):
            yield

    with pytest.raises(OSError):
        async with managed_app():
            pass

    await engine.dispose()


@pytest.mark.asyncio
async def test_app_startup_marks_orphan_jobs_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    engine, session_factory = await _build_test_session_factory()
    monkeypatch.setattr("app.main.SessionLocal", session_factory)

    user_id = uuid.uuid4()
    document_id = uuid.uuid4()
    pending_job_id = uuid.uuid4()
    running_job_id = uuid.uuid4()

    try:
        async with session_factory() as session:
            session.add(
                User(
                    id=user_id,
                    email=f"{user_id}@example.test",
                    display_name="Startup Integration User",
                    status="active",
                )
            )
            await session.commit()

        async with session_factory() as session:
            session.add(
                KnowledgeDocument(
                    id=document_id,
                    user_id=user_id,
                    title="Startup orphan cleanup",
                    summary="",
                    content="",
                    source="startup.md",
                    file_type="md",
                    file_size=1,
                    status="pending",
                    tags_json=[],
                )
            )
            session.add_all(
                [
                    KnowledgeIndexJob(
                        id=pending_job_id,
                        user_id=user_id,
                        document_id=document_id,
                        job_type="index",
                        status="pending",
                        progress=0,
                    ),
                    KnowledgeIndexJob(
                        id=running_job_id,
                        user_id=user_id,
                        document_id=document_id,
                        job_type="index",
                        status="running",
                        progress=45,
                    ),
                ]
            )
            await session.commit()

        app = create_app()

        @asynccontextmanager
        async def managed_app():
            async with app.router.lifespan_context(app):
                yield

        async with managed_app():
            pass

        async with session_factory() as session:
            jobs = (
                await session.execute(
                    select(KnowledgeIndexJob)
                    .where(KnowledgeIndexJob.id.in_([pending_job_id, running_job_id]))
                    .order_by(KnowledgeIndexJob.id)
                )
            ).scalars().all()
            assert len(jobs) == 2
            assert all(job.status == "failed" for job in jobs)
            assert all(job.error_json == {"message": "orphaned by restart"} for job in jobs)
            assert all(job.completed_at is not None for job in jobs)

            document = await session.get(KnowledgeDocument, document_id)
            assert document is not None
            assert document.status == "failed"
    finally:
        async with session_factory() as session:
            await session.execute(delete(KnowledgeIndexJob).where(KnowledgeIndexJob.user_id == user_id))
            await session.execute(delete(KnowledgeDocument).where(KnowledgeDocument.user_id == user_id))
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()
