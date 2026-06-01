from app.services.knowledge_rag_indexing import chunk_document_content


def test_chunk_document_content_returns_chunks_for_plain_text() -> None:
    content = "\n\n".join([f"paragraph {i} " + ("x" * 120) for i in range(12)])
    chunks = chunk_document_content(content, "txt")
    assert len(chunks) >= 2
    assert chunks[0]["chunkIndex"] == 0
    assert all(chunk["chunkType"] == "small" for chunk in chunks)


def test_chunk_document_content_merges_tiny_tail_chunks() -> None:
    content = ("a" * 900) + "\n\n" + ("b" * 20)
    chunks = chunk_document_content(content, "txt")
    assert len(chunks) == 1
    assert chunks[0]["content"].endswith("b" * 20)
