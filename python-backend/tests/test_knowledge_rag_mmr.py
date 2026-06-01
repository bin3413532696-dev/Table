from app.schemas.knowledge_rag import SearchResultResponse
from app.services.knowledge_rag_mmr import cosine_similarity, mmr_rerank


def _result(result_id: str, score: float) -> SearchResultResponse:
    return SearchResultResponse(
        id=result_id,
        documentId=f"doc-{result_id}",
        documentTitle=f"Doc {result_id}",
        content=f"content {result_id}",
        chunkIndex=0,
        score=score,
        source="hybrid",
        sourceInfo=None,
    )


def test_cosine_similarity_returns_expected_score() -> None:
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0


def test_mmr_rerank_prefers_diverse_results() -> None:
    results = [
        _result("a", 0.90),
        _result("b", 0.89),
        _result("c", 0.70),
    ]
    embeddings = {
        "a": [1.0, 0.0],
        "b": [0.99, 0.01],
        "c": [0.0, 1.0],
    }

    reranked = mmr_rerank(results, embeddings, lambda_weight=0.5, top_k=3)

    assert [item.id for item in reranked] == ["a", "c", "b"]


def test_mmr_rerank_falls_back_when_embeddings_missing() -> None:
    results = [_result("a", 0.90), _result("b", 0.89)]

    reranked = mmr_rerank(results, None, lambda_weight=0.7, top_k=2)

    assert [item.id for item in reranked] == ["a", "b"]
