from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import re
from uuid import uuid4


@dataclass(frozen=True)
class ChunkStrategy:
    chunk_size: int
    chunk_overlap: int
    min_chunk_size: int
    parent_chunk_size: int


STRATEGIES: dict[str, ChunkStrategy] = {
    "pdf": ChunkStrategy(chunk_size=1500, chunk_overlap=300, min_chunk_size=200, parent_chunk_size=4500),
    "md": ChunkStrategy(chunk_size=800, chunk_overlap=150, min_chunk_size=150, parent_chunk_size=2400),
    "markdown": ChunkStrategy(chunk_size=800, chunk_overlap=150, min_chunk_size=150, parent_chunk_size=2400),
    "txt": ChunkStrategy(chunk_size=1000, chunk_overlap=200, min_chunk_size=200, parent_chunk_size=3000),
}
DEFAULT_STRATEGY = STRATEGIES["txt"]
SPLIT_BOUNDARY_CHARS = "\n。！？；.!?;，,、:：)"


def compute_content_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()


def _find_split_index(content: str, *, start: int, max_length: int, min_length: int) -> int:
    window = content[start : start + max_length]
    if len(window) <= max_length and len(window) <= min_length:
        return len(window)

    for index in range(len(window) - 1, min_length - 1, -1):
        if window[index] in SPLIT_BOUNDARY_CHARS:
            return index + 1

    for index in range(len(window) - 1, min_length - 1, -1):
        if window[index].isspace():
            return index + 1

    return len(window)


def _split_oversized_paragraph(content: str, start_offset: int, strategy: ChunkStrategy) -> list[dict]:
    if len(content) <= strategy.chunk_size:
        return [{"content": content, "start": start_offset, "end": start_offset + len(content)}]

    segments: list[dict] = []
    cursor = 0
    min_length = max(strategy.min_chunk_size, strategy.chunk_size // 2)

    while cursor < len(content):
        remaining = len(content) - cursor
        if remaining <= strategy.chunk_size:
            end = len(content)
        else:
            split_index = _find_split_index(
                content,
                start=cursor,
                max_length=strategy.chunk_size,
                min_length=min_length,
            )
            end = cursor + max(split_index, 1)

        segments.append(
            {
                "content": content[cursor:end],
                "start": start_offset + cursor,
                "end": start_offset + end,
            }
        )

        if end >= len(content):
            break

        next_cursor = max(end - strategy.chunk_overlap, cursor + 1)
        cursor = next_cursor

    return segments


def _split_text(text: str, strategy: ChunkStrategy) -> list[dict]:
    normalized = text.replace("\r\n", "\n")
    if not normalized.strip():
        return []

    paragraphs = [
        {
            "content": match.group(0),
            "start": match.start(),
            "end": match.end(),
        }
        for match in re.finditer(r"\S(?:[\s\S]*?\S)?(?=(?:\n\s*\n)|\Z)", normalized)
    ]
    chunks: list[dict] = []
    current = ""
    current_start = 0
    current_end = 0

    def flush_current() -> None:
        nonlocal current, current_start, current_end
        content = current
        if not content:
            return

        end_pos = current_end
        if chunks and len(content) < strategy.min_chunk_size:
            previous = chunks[-1]
            previous["content"] = previous["content"] + "\n\n" + content
            previous["endPos"] = max(previous["endPos"], end_pos)
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
        current_end = end_pos

    for paragraph in paragraphs:
        paragraph_content = paragraph["content"]
        paragraph_start = int(paragraph["start"])
        paragraph_end = int(paragraph["end"])
        if len(paragraph_content) > strategy.chunk_size:
            flush_current()
            current = ""
            current_start = 0
            current_end = 0
            for segment in _split_oversized_paragraph(paragraph_content, paragraph_start, strategy):
                chunks.append(
                    {
                        "id": uuid4(),
                        "content": segment["content"],
                        "contentHash": compute_content_hash(segment["content"]),
                        "chunkIndex": len(chunks),
                        "startPos": segment["start"],
                        "endPos": segment["end"],
                        "chunkType": "small",
                        "parentId": None,
                        "headingChain": None,
                        "headingLevel": None,
                        "embeddingDimensions": None,
                        "embeddingVersion": None,
                    }
                )
            continue

        if not current:
            current = paragraph_content
            current_start = paragraph_start
            current_end = paragraph_end
        elif len(current) + 2 + len(paragraph_content) <= strategy.chunk_size:
            current = current + "\n\n" + paragraph_content
            current_end = paragraph_end
        else:
            flush_current()
            if current:
                current = current + "\n\n" + paragraph_content
                current_end = paragraph_end
            else:
                current = paragraph_content
                current_start = paragraph_start
                current_end = paragraph_end

    flush_current()
    for index, chunk in enumerate(chunks):
        chunk["chunkIndex"] = index
    return chunks


def _attach_parent_chunks(text: str, small_chunks: list[dict], strategy: ChunkStrategy) -> list[dict]:
    if not small_chunks:
        return []

    chunks = [dict(chunk) for chunk in small_chunks]
    parent_chunks: list[dict] = []
    child_group: list[dict] = []
    parent_index = len(chunks)

    def flush_group() -> None:
        nonlocal child_group, parent_index
        if not child_group:
            return

        start_pos = int(child_group[0]["startPos"])
        end_pos = int(child_group[-1]["endPos"])
        parent_id = uuid4()
        parent_content = text[start_pos:end_pos]
        parent_chunk = {
            "id": parent_id,
            "content": parent_content,
            "contentHash": compute_content_hash(parent_content),
            "chunkIndex": parent_index,
            "startPos": start_pos,
            "endPos": end_pos,
            "chunkType": "parent",
            "parentId": None,
            "headingChain": None,
            "headingLevel": None,
            "embeddingDimensions": None,
            "embeddingVersion": None,
        }
        for child in child_group:
            child["parentId"] = parent_id
        parent_chunks.append(parent_chunk)
        parent_index += 1
        child_group = []

    for chunk in chunks:
        if not child_group:
            child_group = [chunk]
            continue

        group_start = int(child_group[0]["startPos"])
        next_end = int(chunk["endPos"])
        if next_end - group_start <= strategy.parent_chunk_size:
            child_group.append(chunk)
            continue

        flush_group()
        child_group = [chunk]

    flush_group()
    return chunks + parent_chunks


def chunk_document_content(content: str, file_type: str | None) -> list[dict]:
    strategy = STRATEGIES.get(file_type or "", DEFAULT_STRATEGY)
    normalized = content.replace("\r\n", "\n")
    small_chunks = _split_text(normalized, strategy)
    return _attach_parent_chunks(normalized, small_chunks, strategy)
