from __future__ import annotations

from app.schemas.knowledge_rag import SearchResultResponse


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        return 0.0

    dot = 0.0
    norm_left = 0.0
    norm_right = 0.0
    for left_value, right_value in zip(left, right, strict=False):
        dot += left_value * right_value
        norm_left += left_value * left_value
        norm_right += right_value * right_value

    norm = (norm_left**0.5) * (norm_right**0.5)
    return dot / norm if norm > 0 else 0.0


def mmr_rerank(
    results: list[SearchResultResponse],
    embeddings: dict[str, list[float]] | None,
    *,
    lambda_weight: float,
    top_k: int,
) -> list[SearchResultResponse]:
    if not embeddings:
        return results[:top_k]

    selected: list[SearchResultResponse] = []
    remaining = list(results)

    while len(selected) < top_k and remaining:
        max_score = float("-inf")
        max_index = 0

        for index, candidate in enumerate(remaining):
            candidate_embedding = embeddings.get(candidate.id)
            max_similarity = 0.0
            if candidate_embedding and selected:
                for current in selected:
                    current_embedding = embeddings.get(current.id)
                    if current_embedding:
                        max_similarity = max(
                            max_similarity,
                            cosine_similarity(candidate_embedding, current_embedding),
                        )

            mmr_score = lambda_weight * candidate.score - (1 - lambda_weight) * max_similarity
            if mmr_score > max_score:
                max_score = mmr_score
                max_index = index

        selected.append(remaining[max_index])
        remaining.pop(max_index)

    return selected
