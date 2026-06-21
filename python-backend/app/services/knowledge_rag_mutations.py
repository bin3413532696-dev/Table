from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.schemas.knowledge_rag import (
    CreateKnowledgeCorpusRequest,
    KnowledgeCorpusResponse,
    KnowledgeDocumentResponse,
    UpdateDocumentRequest,
    UpdateKnowledgeCorpusRequest,
)
from app.services.knowledge_rag_collaborators import (
    BackfillEmbeddingsCollaborators,
    CreateCorpusCollaborators,
    DeleteCorpusCollaborators,
    UpdateCorpusCollaborators,
    UpdateDocumentCollaborators,
)


async def create_corpus_service(
    session: AsyncSession,
    user_id: str,
    payload: CreateKnowledgeCorpusRequest,
    *,
    collaborators: CreateCorpusCollaborators,
) -> KnowledgeCorpusResponse:
    corpus = await collaborators.create_corpus(
        session,
        user_id,
        name=payload.name,
        description=payload.description or "",
        default_tags=list(payload.defaultTags or []),
    )
    document_ids = list(payload.documentIds or [])
    if document_ids:
        await collaborators.replace_corpus_documents(
            session,
            user_id,
            corpus_id=str(corpus.id),
            document_ids=document_ids,
        )
    return (await collaborators.get_corpus(session, user_id, str(corpus.id))) or collaborators.to_corpus_response(
        corpus,
        [],
    )


async def update_corpus_service(
    session: AsyncSession,
    user_id: str,
    corpus_id: str,
    payload: UpdateKnowledgeCorpusRequest,
    *,
    collaborators: UpdateCorpusCollaborators,
) -> KnowledgeCorpusResponse | None:
    corpus = await collaborators.update_corpus(
        session,
        user_id,
        corpus_id,
        name=payload.name if "name" in payload.model_fields_set else None,
        description=payload.description if "description" in payload.model_fields_set else None,
        default_tags=list(payload.defaultTags or []) if "defaultTags" in payload.model_fields_set else None,
    )
    if not corpus:
        return None
    if "documentIds" in payload.model_fields_set:
        await collaborators.replace_corpus_documents(
            session,
            user_id,
            corpus_id=corpus_id,
            document_ids=list(payload.documentIds or []),
        )
    return await collaborators.get_corpus(session, user_id, corpus_id)


async def delete_corpus_service(
    session: AsyncSession,
    user_id: str,
    corpus_id: str,
    *,
    collaborators: DeleteCorpusCollaborators,
) -> bool:
    return await collaborators.delete_corpus(session, user_id, corpus_id)


async def update_document_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    payload: UpdateDocumentRequest,
    *,
    collaborators: UpdateDocumentCollaborators,
) -> KnowledgeDocumentResponse | None:
    document = await collaborators.update_document(
        session,
        user_id,
        document_id,
        payload.model_dump(exclude_unset=True),
    )
    if not document:
        return None
    return collaborators.to_document_response(document)


async def backfill_embeddings_service(
    session: AsyncSession,
    user_id: str,
    document_id: str,
    settings: Settings | None = None,
    *,
    collaborators: BackfillEmbeddingsCollaborators,
) -> dict[str, int]:
    current = settings or get_settings()
    document = await collaborators.find_document_by_id(session, user_id, document_id)
    if not document:
        raise ValueError("Document not found")

    rows = await collaborators.get_chunks_without_embedding(session, user_id, document_id)
    if not rows:
        return {"count": 0}

    count = await collaborators.apply_chunk_embeddings(
        session,
        user_id,
        [
            {
                "id": row["id"],
                "content": row["content"],
                "contentHash": row["content_hash"],
            }
            for row in rows
        ],
        settings=current,
        require_provider=True,
    )
    return {"count": count}
