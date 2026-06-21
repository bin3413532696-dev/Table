import os
import uuid

import pytest
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import app.services.knowledge_rag_embedding_support as knowledge_rag_embedding_support
import app.services.knowledge_rag_mutations as knowledge_rag_mutations
import app.services.knowledge_rag_query as knowledge_rag_query
from app.core.config import Settings
from app.core.provider_crypto import encrypt_provider_secret
from app.db.models import ApiProvider, User
from app.repositories.knowledge_rag import create_chunks, create_document, update_chunk_embeddings_batch
from app.schemas.knowledge_rag import HybridSearchRequest
from app.services.knowledge_rag_collaborators import BackfillEmbeddingsCollaborators, EmbeddingSupportCollaborators
from app.services.knowledge_rag_embeddings import EmbeddingChunkInput, format_vector_for_db, resolve_embedding_runtime_config

pytestmark = pytest.mark.skipif(
    os.getenv("RUN_PYTHON_INTEGRATION_TESTS") != "1",
    reason="set RUN_PYTHON_INTEGRATION_TESTS=1 to run database integration tests",
)


async def _database_has_required_schema(session) -> bool:
    rows = (
        await session.execute(
            text(
                """
                SELECT table_name, column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND (
                    (table_name = 'knowledge_chunks' AND column_name IN (
                      'heading_chain', 'heading_level', 'embedding_dimensions',
                      'embedding_version', 'chunk_type', 'parent_id', 'embedding_model', 'embedding'
                    ))
                    OR (table_name = 'api_providers' AND column_name IN (
                      'embedding_model', 'api_key_encrypted', 'headers_json', 'is_active'
                    ))
                  )
                """
            )
        )
    ).all()
    existing = {(row[0], row[1]) for row in rows}
    required = {
        ("knowledge_chunks", "heading_chain"),
        ("knowledge_chunks", "heading_level"),
        ("knowledge_chunks", "embedding_dimensions"),
        ("knowledge_chunks", "embedding_version"),
        ("knowledge_chunks", "chunk_type"),
        ("knowledge_chunks", "parent_id"),
        ("knowledge_chunks", "embedding_model"),
        ("knowledge_chunks", "embedding"),
        ("api_providers", "embedding_model"),
        ("api_providers", "api_key_encrypted"),
        ("api_providers", "headers_json"),
        ("api_providers", "is_active"),
    }
    return required.issubset(existing)


@pytest.mark.asyncio
async def test_hybrid_search_uses_active_provider_from_database(monkeypatch) -> None:
    settings = Settings()
    engine = create_async_engine(settings.sqlalchemy_database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    embedding = [0.0] * settings.embedding_dimensions
    embedding[0] = 0.1
    embedding[1] = 0.2

    user_id = uuid.uuid4()
    doc_id = uuid.uuid4()
    chunk_id = uuid.uuid4()
    provider_id = uuid.uuid4()

    try:
        async with session_factory() as session:
            if not await _database_has_required_schema(session):
                pytest.skip("database schema is behind the Python migration; run the latest migrations first")

            session.add(
                User(
                    id=user_id,
                    email=f"{user_id}@example.test",
                    display_name="Integration Test User",
                    status="active",
                )
            )
            await session.commit()

            session.add(
                ApiProvider(
                    id=provider_id,
                    user_id=user_id,
                    name="Integration Provider",
                    api_format="openai",
                    base_url="https://provider.example.com",
                    api_key_encrypted=encrypt_provider_secret("integration-secret", settings),
                    embedding_model="text-embedding-provider",
                    headers_json={"X-Provider-Test": "1"},
                    is_active=True,
                    source="manual",
                )
            )
            await session.commit()

            document = await create_document(
                session,
                str(user_id),
                {
                    "id": doc_id,
                    "title": "Budget Planning",
                    "summary": "Integration summary",
                    "content": "budget planning and execution guidance",
                    "source": "integration.md",
                    "fileType": "md",
                    "fileSize": 128,
                    "status": "indexed",
                    "tags": ["finance"],
                    "contentHash": "doc-hash",
                    "version": 1,
                },
            )
            await create_chunks(
                session,
                str(user_id),
                str(document.id),
                [
                    {
                        "id": chunk_id,
                        "content": "budget planning and execution guidance",
                        "contentHash": "chunk-hash",
                        "chunkIndex": 0,
                        "startPos": 0,
                        "endPos": 38,
                        "chunkType": "small",
                        "parentId": None,
                        "headingChain": None,
                        "headingLevel": None,
                        "embeddingDimensions": None,
                        "embeddingVersion": None,
                    }
                ],
            )
            await update_chunk_embeddings_batch(
                session,
                str(user_id),
                [
                    {
                        "chunkId": str(chunk_id),
                        "embeddingVector": format_vector_for_db(embedding),
                        "embeddingModel": "text-embedding-provider",
                        "embeddingVersion": settings.embedding_version,
                        "embeddingDimensions": settings.embedding_dimensions,
                    }
                ],
            )

            async def fake_embed_query(query, current_settings, runtime_config=None):
                assert query == "budget"
                assert runtime_config is not None
                assert runtime_config.api_key == "integration-secret"
                assert runtime_config.base_url == "https://provider.example.com"
                assert runtime_config.model == "text-embedding-provider"
                assert runtime_config.headers == {"X-Provider-Test": "1"}
                return embedding

            monkeypatch.setattr(knowledge_rag_query, "embed_query", fake_embed_query)

            response = await knowledge_rag_query.search_service(
                session=session,
                user_id=str(user_id),
                payload=HybridSearchRequest(
                    query="budget",
                    mode="hybrid",
                    limit=5,
                    threshold=0.1,
                ),
                settings=settings,
            )

            assert response.semanticCount == 1
            assert response.keywordCount == 1
            assert len(response.results) == 1
            assert response.results[0].documentTitle == "Budget Planning"
            assert response.results[0].source == "hybrid"
    finally:
        async with session_factory() as session:
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()


@pytest.mark.asyncio
async def test_backfill_embeddings_service_updates_missing_chunk_vectors(monkeypatch) -> None:
    settings = Settings(
        embedding_api_key="integration-token",
    )
    engine = create_async_engine(settings.sqlalchemy_database_url, future=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    embedding = [0.0] * settings.embedding_dimensions
    embedding[0] = 0.1
    embedding[1] = 0.2

    user_id = uuid.uuid4()
    doc_id = uuid.uuid4()
    chunk_id = uuid.uuid4()

    try:
        async with session_factory() as session:
            if not await _database_has_required_schema(session):
                pytest.skip("database schema is behind the Python migration; run the latest migrations first")

            session.add(
                User(
                    id=user_id,
                    email=f"{user_id}@example.test",
                    display_name="Integration Backfill User",
                    status="active",
                )
            )
            await session.commit()

            document = await create_document(
                session,
                str(user_id),
                {
                    "id": doc_id,
                    "title": "Backfill Target",
                    "summary": "Integration summary",
                    "content": "backfill target content",
                    "source": "integration.md",
                    "fileType": "md",
                    "fileSize": 64,
                    "status": "indexed",
                    "tags": ["finance"],
                    "contentHash": "doc-hash-backfill",
                    "version": 1,
                },
            )
            await create_chunks(
                session,
                str(user_id),
                str(document.id),
                [
                    {
                        "id": chunk_id,
                        "content": "backfill target content",
                        "contentHash": "chunk-hash-backfill",
                        "chunkIndex": 0,
                        "startPos": 0,
                        "endPos": 23,
                        "chunkType": "small",
                        "parentId": None,
                        "headingChain": None,
                        "headingLevel": None,
                        "embeddingDimensions": None,
                        "embeddingVersion": None,
                    }
                ],
            )

            async def fake_embed_chunk_batch(inputs, current_settings, runtime_config=None):
                assert len(inputs) == 1
                assert inputs[0].chunk_id == str(chunk_id)
                assert runtime_config is not None
                assert runtime_config.api_key == "integration-token"
                return [
                    {
                        "chunkId": str(chunk_id),
                        "contentHash": "chunk-hash-backfill",
                        "embedding": embedding,
                        "embeddingModel": current_settings.embedding_model,
                    }
                ]

            async def fake_find_document_by_id(current_session, requested_user_id, requested_document_id):
                del current_session
                assert requested_user_id == str(user_id)
                assert requested_document_id == str(document.id)
                return document

            async def fake_get_chunks_without_embedding(current_session, requested_user_id, requested_document_id):
                del current_session
                assert requested_user_id == str(user_id)
                assert requested_document_id == str(document.id)
                return [
                    {
                        "id": chunk_id,
                        "content": "backfill target content",
                        "content_hash": "chunk-hash-backfill",
                    }
                ]

            async def fake_find_embedding_cache_batch(current_session, requested_user_id, content_hashes, embedding_model):
                del current_session
                assert requested_user_id == str(user_id)
                assert content_hashes == ["chunk-hash-backfill"]
                assert embedding_model == settings.embedding_model
                return {}

            async def fake_store_embedding_cache(
                current_session,
                requested_user_id,
                *,
                content_hash,
                embedding_vector,
                embedding_model,
                expires_at,
            ):
                del expires_at
                assert requested_user_id == str(user_id)
                await current_session.execute(
                    text(
                        """
                        INSERT INTO knowledge_embedding_cache (
                          id,
                          user_id,
                          content_hash,
                          embedding,
                          embedding_model,
                          created_at,
                          expires_at
                        )
                        VALUES (
                          gen_random_uuid(),
                          CAST(:user_id AS uuid),
                          :content_hash,
                          CAST(:embedding_vector AS vector),
                          :embedding_model,
                          NOW(),
                          NULL
                        )
                        """
                    ),
                    {
                        "user_id": str(user_id),
                        "content_hash": content_hash,
                        "embedding_vector": embedding_vector,
                        "embedding_model": embedding_model,
                    },
                )

            async def fake_apply_chunk_embeddings(
                current_session,
                requested_user_id,
                chunks,
                *,
                settings,
                runtime_config=None,
                require_provider=False,
            ):
                return await knowledge_rag_embedding_support.apply_chunk_embeddings(
                    current_session,
                    requested_user_id,
                    chunks,
                    settings=settings,
                    runtime_config=runtime_config,
                    require_provider=require_provider,
                    collaborators=EmbeddingSupportCollaborators(
                        embedding_chunk_input=EmbeddingChunkInput,
                        embed_chunk_batch=fake_embed_chunk_batch,
                        find_embedding_cache_batch=fake_find_embedding_cache_batch,
                        format_vector_for_db=format_vector_for_db,
                        resolve_embedding_runtime_config=resolve_embedding_runtime_config,
                        store_embedding_cache=fake_store_embedding_cache,
                        update_chunk_embeddings_batch=update_chunk_embeddings_batch,
                    ),
                )

            result = await knowledge_rag_mutations.backfill_embeddings_service(
                session=session,
                user_id=str(user_id),
                document_id=str(document.id),
                settings=settings,
                collaborators=BackfillEmbeddingsCollaborators(
                    apply_chunk_embeddings=fake_apply_chunk_embeddings,
                    find_document_by_id=fake_find_document_by_id,
                    get_chunks_without_embedding=fake_get_chunks_without_embedding,
                ),
            )

            assert result == {"count": 1}

            chunk_row = (
                await session.execute(
                    text(
                        """
                        SELECT embedding IS NOT NULL AS has_embedding,
                               embedding_model,
                               embedding_dimensions,
                               embedding_version
                        FROM knowledge_chunks
                        WHERE id = CAST(:chunk_id AS uuid)
                        """
                    ),
                    {"chunk_id": str(chunk_id)},
                )
            ).mappings().one()
            assert chunk_row["has_embedding"] is True
            assert chunk_row["embedding_model"] == settings.embedding_model
            assert chunk_row["embedding_dimensions"] == settings.embedding_dimensions
            assert chunk_row["embedding_version"] == settings.embedding_version

            cache_row = (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*) AS count
                        FROM knowledge_embedding_cache
                        WHERE user_id = CAST(:user_id AS uuid)
                          AND content_hash = :content_hash
                          AND embedding_model = :embedding_model
                        """
                    ),
                    {
                        "user_id": str(user_id),
                        "content_hash": "chunk-hash-backfill",
                        "embedding_model": settings.embedding_model,
                    },
                )
            ).mappings().one()
            assert int(cache_row["count"]) == 1
    finally:
        async with session_factory() as session:
            await session.execute(delete(User).where(User.id == user_id))
            await session.commit()
        await engine.dispose()
