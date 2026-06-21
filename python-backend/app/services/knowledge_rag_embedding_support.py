from __future__ import annotations

from app.core.config import Settings
from app.services.knowledge_rag_collaborators import EmbeddingSupportCollaborators


def is_soft_embedding_failure(exc: Exception) -> bool:
    message = str(exc)
    return message.startswith("Embedding request failed:") or message.startswith("Embedding dimension mismatch:")


async def apply_chunk_embeddings(
    session,
    user_id: str,
    chunks: list[dict],
    *,
    settings: Settings,
    runtime_config=None,
    require_provider: bool = False,
    skip_cache_lookup: bool = False,
    collaborators: EmbeddingSupportCollaborators,
) -> int:
    if not chunks:
        return 0

    resolved_runtime_config = runtime_config or await collaborators.resolve_embedding_runtime_config(
        session,
        user_id,
        settings,
    )
    if resolved_runtime_config is None:
        if require_provider:
            raise RuntimeError("Embedding provider is not configured")
        return 0

    chunk_inputs = [
        collaborators.embedding_chunk_input(
            chunk_id=str(chunk["id"]),
            content_hash=chunk["contentHash"],
            content=chunk["content"],
        )
        for chunk in chunks
    ]
    content_hashes = list(dict.fromkeys(chunk.content_hash for chunk in chunk_inputs))
    cached_embeddings = (
        {}
        if skip_cache_lookup
        else await collaborators.find_embedding_cache_batch(
            session,
            user_id,
            content_hashes,
            resolved_runtime_config.model,
        )
    )

    unique_missing_inputs = []
    seen_hashes = set(cached_embeddings)
    for chunk in chunk_inputs:
        if chunk.content_hash in seen_hashes:
            continue
        seen_hashes.add(chunk.content_hash)
        unique_missing_inputs.append(chunk)

    if unique_missing_inputs:
        embedded_chunks = await collaborators.embed_chunk_batch(
            unique_missing_inputs,
            settings,
            runtime_config=resolved_runtime_config,
        )
        for embedded in embedded_chunks:
            embedding_vector = collaborators.format_vector_for_db(embedded["embedding"])
            cached_embeddings[embedded["contentHash"]] = embedding_vector
            await collaborators.store_embedding_cache(
                session,
                user_id,
                content_hash=embedded["contentHash"],
                embedding_vector=embedding_vector,
                embedding_model=embedded["embeddingModel"],
                expires_at=None,
            )

    updates = [
        {
            "chunkId": chunk.chunk_id,
            "embeddingVector": cached_embeddings[chunk.content_hash],
            "embeddingModel": resolved_runtime_config.model,
            "embeddingVersion": settings.embedding_version,
            "embeddingDimensions": settings.embedding_dimensions,
        }
        for chunk in chunk_inputs
        if chunk.content_hash in cached_embeddings
    ]
    if not updates:
        return 0

    return await collaborators.update_chunk_embeddings_batch(session, user_id, updates)
