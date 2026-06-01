from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from uuid import uuid4


@dataclass(frozen=True)
class ChunkStrategy:
    chunk_size: int
    chunk_overlap: int
    min_chunk_size: int


STRATEGIES: dict[str, ChunkStrategy] = {
    "pdf": ChunkStrategy(chunk_size=1500, chunk_overlap=300, min_chunk_size=200),
    "md": ChunkStrategy(chunk_size=800, chunk_overlap=150, min_chunk_size=150),
    "markdown": ChunkStrategy(chunk_size=800, chunk_overlap=150, min_chunk_size=150),
    "txt": ChunkStrategy(chunk_size=1000, chunk_overlap=200, min_chunk_size=200),
}
DEFAULT_STRATEGY = STRATEGIES["txt"]


def compute_content_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()


def _split_text(text: str, strategy: ChunkStrategy) -> list[dict]:
    normalized = text.replace("\r\n", "\n").strip()
    if not normalized:
        return []

    paragraphs = [segment.strip() for segment in normalized.split("\n\n") if segment.strip()]
    chunks: list[dict] = []
    cursor = 0
    current = ""
    current_start = 0

    def flush_current() -> None:
        nonlocal current, current_start
        content = current.strip()
        if not content:
            return

        end_pos = current_start + len(content)
        if chunks and len(content) < strategy.min_chunk_size:
            previous = chunks[-1]
            previous["content"] = previous["content"] + "\n\n" + content
            previous["endPos"] = end_pos
            previous["contentHash"] = compute_content_hash(previous["content"])
        else:
            chunks.append(
                {
                    "id": uuid4(),
                    "content": content,
                    "contentHash": compute_content_hash(content),
                    "chunkIndex": len(chunks),
                    "startPos": current_start,
                    "endPos": end_pos,
                    "chunkType": "small",
                    "parentId": None,
                    "headingChain": None,
                    "headingLevel": None,
                    "embeddingDimensions": None,
                    "embeddingVersion": None,
                }
            )

        overlap = content[-strategy.chunk_overlap :] if strategy.chunk_overlap > 0 else ""
        current = overlap
        current_start = max(0, end_pos - len(overlap))

    for paragraph in paragraphs:
        if not current:
            current = paragraph
            current_start = cursor
        elif len(current) + 2 + len(paragraph) <= strategy.chunk_size:
            current = current + "\n\n" + paragraph
        else:
            flush_current()
            if current:
                current = current + ("\n\n" + paragraph if current.strip() else paragraph)
            else:
                current = paragraph
                current_start = cursor
        cursor += len(paragraph) + 2

    flush_current()
    for index, chunk in enumerate(chunks):
        chunk["chunkIndex"] = index
    return chunks


def chunk_document_content(content: str, file_type: str | None) -> list[dict]:
    strategy = STRATEGIES.get(file_type or "", DEFAULT_STRATEGY)
    return _split_text(content, strategy)
