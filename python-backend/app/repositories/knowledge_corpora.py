from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import KnowledgeCorpus, KnowledgeCorpusDocument


def _now() -> datetime:
    return datetime.now(UTC)


async def list_corpora(session: AsyncSession, user_id: str) -> list[KnowledgeCorpus]:
    return list(
        await session.scalars(
            select(KnowledgeCorpus)
            .where(KnowledgeCorpus.user_id == UUID(user_id))
            .order_by(KnowledgeCorpus.updated_at.desc(), KnowledgeCorpus.created_at.desc())
        )
    )


async def find_corpus_by_id(session: AsyncSession, user_id: str, corpus_id: str) -> KnowledgeCorpus | None:
    return await session.scalar(
        select(KnowledgeCorpus).where(
            KnowledgeCorpus.id == UUID(corpus_id),
            KnowledgeCorpus.user_id == UUID(user_id),
        )
    )


async def create_corpus(
    session: AsyncSession,
    user_id: str,
    *,
    name: str,
    description: str,
    default_tags: list[str],
) -> KnowledgeCorpus:
    item = KnowledgeCorpus(
        user_id=UUID(user_id),
        name=name,
        description=description,
        default_tags_json=default_tags,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


async def update_corpus(
    session: AsyncSession,
    user_id: str,
    corpus_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    default_tags: list[str] | None = None,
) -> KnowledgeCorpus | None:
    item = await find_corpus_by_id(session, user_id, corpus_id)
    if not item:
        return None
    if name is not None:
        item.name = name
    if description is not None:
        item.description = description
    if default_tags is not None:
        item.default_tags_json = default_tags
    item.updated_at = _now()
    await session.commit()
    await session.refresh(item)
    return item


async def delete_corpus(session: AsyncSession, user_id: str, corpus_id: str) -> bool:
    item = await find_corpus_by_id(session, user_id, corpus_id)
    if not item:
        return False
    await session.delete(item)
    await session.commit()
    return True


async def replace_corpus_documents(
    session: AsyncSession,
    user_id: str,
    *,
    corpus_id: str,
    document_ids: list[str],
) -> None:
    await session.execute(
        delete(KnowledgeCorpusDocument).where(
            KnowledgeCorpusDocument.user_id == UUID(user_id),
            KnowledgeCorpusDocument.corpus_id == UUID(corpus_id),
        )
    )
    for index, document_id in enumerate(document_ids):
        session.add(
            KnowledgeCorpusDocument(
                corpus_id=UUID(corpus_id),
                document_id=UUID(document_id),
                user_id=UUID(user_id),
                sort_order=index,
            )
        )
    await session.commit()


async def list_corpus_document_links(
    session: AsyncSession,
    user_id: str,
    *,
    corpus_id: str | None = None,
    document_id: str | None = None,
) -> list[KnowledgeCorpusDocument]:
    stmt = select(KnowledgeCorpusDocument).where(KnowledgeCorpusDocument.user_id == UUID(user_id))
    if corpus_id:
        stmt = stmt.where(KnowledgeCorpusDocument.corpus_id == UUID(corpus_id))
    if document_id:
        stmt = stmt.where(KnowledgeCorpusDocument.document_id == UUID(document_id))
    stmt = stmt.order_by(KnowledgeCorpusDocument.sort_order.asc(), KnowledgeCorpusDocument.added_at.asc())
    return list(await session.scalars(stmt))


async def find_primary_corpus_for_document(
    session: AsyncSession,
    user_id: str,
    *,
    document_id: str,
) -> KnowledgeCorpusDocument | None:
    return await session.scalar(
        select(KnowledgeCorpusDocument)
        .where(
            KnowledgeCorpusDocument.user_id == UUID(user_id),
            KnowledgeCorpusDocument.document_id == UUID(document_id),
        )
        .order_by(KnowledgeCorpusDocument.sort_order.asc(), KnowledgeCorpusDocument.added_at.asc())
        .limit(1)
    )
