from __future__ import annotations

import asyncio
import re
from hashlib import sha256
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.services.knowledge_rag_collaborators import ImageDescriptionCollaborators

_PLACEHOLDER_RE = None


def image_placeholder_regex() -> re.Pattern:
    global _PLACEHOLDER_RE
    if _PLACEHOLDER_RE is None:
        _PLACEHOLDER_RE = re.compile(r"\[IMAGE:page=(\d+);idx=(\d+)\]")
    return _PLACEHOLDER_RE


def find_image_file(images_dir: Path, page_num: int, image_index: int) -> Path | None:
    if not images_dir.exists():
        return None
    for ext in ("png", "jpg", "jpeg"):
        candidate = images_dir / f"page_{page_num}_idx_{image_index}.{ext}"
        if candidate.exists():
            return candidate
    return None


async def describe_single_image_vlm(
    *,
    image_path: Path,
    runtime_config,
    semaphore: asyncio.Semaphore,
) -> str:
    image_bytes = image_path.read_bytes()
    mime_type = "image/jpeg" if image_path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    from app.services.knowledge_rag_vision import describe_image

    async with semaphore:
        return await describe_image(image_bytes, mime_type=mime_type, runtime_config=runtime_config)


async def describe_images_and_replace_placeholders(
    *,
    session: AsyncSession,
    user_id: str,
    document_id: str,
    content: str,
    settings: Settings,
    collaborators: ImageDescriptionCollaborators,
) -> str:
    if not settings.rag_vision_llm_enabled:
        return content
    if "[IMAGE:" not in content:
        return content

    from app.services.knowledge_rag_vision import resolve_vision_llm_runtime_config

    runtime_config = await resolve_vision_llm_runtime_config(session, user_id, settings)
    if runtime_config is None:
        collaborators.logger.info(
            "Vision LLM unavailable; leaving %d image placeholders as-is",
            len(collaborators.image_placeholder_regex().findall(content)),
        )
        return content

    file_path = collaborators.find_uploaded_document_path(settings, user_id, document_id)
    if file_path is None:
        return content
    images_dir = file_path.parent / f"{file_path.stem}_images"

    placeholders = list(collaborators.image_placeholder_regex().finditer(content))
    if not placeholders:
        return content

    max_images = settings.rag_vision_llm_max_images_per_doc
    semaphore = asyncio.Semaphore(max(1, settings.rag_vision_llm_max_concurrency))

    tasks_to_process = placeholders[:max_images]
    skipped = placeholders[max_images:]
    pending: list[tuple[re.Match, Path, str]] = []
    descriptions: dict[str, str] = {}

    for match in tasks_to_process:
        page_num = int(match.group(1))
        idx = int(match.group(2))
        image_path = collaborators.find_image_file(images_dir, page_num, idx)
        if image_path is None:
            descriptions[match.group(0)] = f"[图片文件缺失：page={page_num},idx={idx}]"
            continue
        image_bytes = image_path.read_bytes()
        content_hash = sha256(image_bytes).hexdigest()
        cached = await collaborators.find_image_description_cache(
            session, user_id, content_hash=content_hash, model=runtime_config.model
        )
        if cached:
            descriptions[match.group(0)] = cached
            continue
        pending.append((match, image_path, content_hash))

    async def _safe_vlm(image_path: Path, match: re.Match) -> tuple[str, str | None, str | None]:
        try:
            desc = await collaborators.describe_single_image_vlm(
                image_path=image_path,
                runtime_config=runtime_config,
                semaphore=semaphore,
            )
            return match.group(0), desc, None
        except Exception as exc:
            collaborators.logger.warning("VLM describe_image failed for %s: %s", image_path.name, exc)
            return match.group(0), None, str(exc)

    vlm_results = await asyncio.gather(*(_safe_vlm(ip, m) for m, ip, _ in pending))

    pending_hashes = {m.group(0): ch for m, _, ch in pending}
    for original, desc, err in vlm_results:
        if desc is None:
            descriptions[original] = f"[图片描述失败：{err}]"
            continue
        descriptions[original] = desc
        content_hash = pending_hashes.get(original)
        if content_hash:
            try:
                await collaborators.store_image_description_cache(
                    session,
                    user_id,
                    content_hash=content_hash,
                    description=desc,
                    model=runtime_config.model,
                    source_kind="vlm",
                )
            except Exception as exc:
                collaborators.logger.warning("Failed to cache image description: %s", exc)

    for match in skipped:
        descriptions[match.group(0)] = "[图片描述跳过：超出单文档上限]"

    def _format_desc(original: str, desc: str) -> str:
        matched = collaborators.image_placeholder_regex().match(original)
        page_num = matched.group(1) if matched else "?"
        return f"\n\n[图片描述 (page {page_num})]\n{desc}\n"

    def _replace(match):
        desc = descriptions.get(match.group(0))
        if desc is None:
            return match.group(0)
        if desc.startswith("[图片"):
            return f"\n\n{desc}\n"
        return _format_desc(match.group(0), desc)

    return collaborators.image_placeholder_regex().sub(_replace, content)
