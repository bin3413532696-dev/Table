from app.services.knowledge_rag_indexing import chunk_document_content


def test_chunk_document_content_returns_chunks_for_plain_text() -> None:
    content = "\n\n".join([f"paragraph {i} " + ("x" * 120) for i in range(12)])
    chunks = chunk_document_content(content, "txt")
    small_chunks = [chunk for chunk in chunks if chunk["chunkType"] == "small"]
    parent_chunks = [chunk for chunk in chunks if chunk["chunkType"] == "parent"]
    assert len(small_chunks) >= 2
    assert len(parent_chunks) >= 1
    assert small_chunks[0]["chunkIndex"] == 0
    assert all(chunk["parentId"] is not None for chunk in small_chunks)
    assert all(chunk["parentId"] is None for chunk in parent_chunks)


def test_chunk_document_content_merges_tiny_tail_chunks() -> None:
    content = ("a" * 900) + "\n\n" + ("b" * 20)
    chunks = chunk_document_content(content, "txt")
    small_chunks = [chunk for chunk in chunks if chunk["chunkType"] == "small"]
    assert len(small_chunks) == 1
    assert small_chunks[0]["content"].endswith("b" * 20)


def test_chunk_document_content_tracks_offsets_without_strip_drift() -> None:
    content = "  First paragraph  \n\nSecond paragraph\n\n  Third"
    chunks = chunk_document_content(content, "md")
    small_chunks = [chunk for chunk in chunks if chunk["chunkType"] == "small"]

    assert len(small_chunks) == 1
    assert small_chunks[0]["startPos"] == content.index("First")
    assert small_chunks[0]["endPos"] == content.rindex("Third") + len("Third")


def test_chunk_document_content_preserves_previous_end_when_merging_small_tail() -> None:
    content = ("a" * 900) + "\n\n" + ("b" * 80)
    chunks = chunk_document_content(content, "txt")
    small_chunks = [chunk for chunk in chunks if chunk["chunkType"] == "small"]

    assert len(small_chunks) == 1
    assert small_chunks[0]["endPos"] == len(content)


def test_chunk_document_content_splits_oversized_single_paragraph() -> None:
    content = "这是一个没有空行的长段落。" * 120
    chunks = chunk_document_content(content, "txt")
    small_chunks = [chunk for chunk in chunks if chunk["chunkType"] == "small"]
    parent_chunks = [chunk for chunk in chunks if chunk["chunkType"] == "parent"]

    assert len(small_chunks) >= 2
    assert len(parent_chunks) >= 1
    assert all(len(chunk["content"]) <= 1000 for chunk in small_chunks)
    assert small_chunks[0]["startPos"] == 0
    assert small_chunks[-1]["endPos"] == len(content)
