"""describe_images_and_replace_placeholders 流程测试（mock session + 文件系统）。"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.services.knowledge_rag_images as knowledge_rag_images
from app.services.knowledge_rag_collaborators import ImageDescriptionCollaborators
from app.services.knowledge_rag_vision import VisionLLMRuntimeConfig


def _runtime() -> VisionLLMRuntimeConfig:
    return VisionLLMRuntimeConfig(
        api_key="k", base_url="https://api.openai.com", model="gpt-4o",
        timeout_ms=30000, max_retries=1, headers={},
    )


def _collaborators(**overrides) -> ImageDescriptionCollaborators:
    collaborators = {
        "describe_single_image_vlm": AsyncMock(return_value=""),
        "find_image_description_cache": AsyncMock(return_value=None),
        "find_image_file": knowledge_rag_images.find_image_file,
        "find_uploaded_document_path": lambda settings, user_id, document_id: None,
        "image_placeholder_regex": knowledge_rag_images.image_placeholder_regex,
        "logger": MagicMock(),
        "store_image_description_cache": AsyncMock(),
    }
    collaborators.update(overrides)
    return ImageDescriptionCollaborators(**collaborators)


@pytest.mark.asyncio
async def test_describe_phase_skipped_when_vision_disabled(monkeypatch, tmp_path) -> None:
    del monkeypatch, tmp_path
    settings = SimpleNamespace(rag_vision_llm_enabled=False)
    content = "no images here"
    result = await knowledge_rag_images.describe_images_and_replace_placeholders(
        session=MagicMock(),
        user_id="u",
        document_id="d",
        content=content,
        settings=settings,
        collaborators=_collaborators(),
    )
    assert result == content


@pytest.mark.asyncio
async def test_describe_phase_no_op_when_no_placeholders(monkeypatch, tmp_path) -> None:
    del monkeypatch, tmp_path
    settings = SimpleNamespace(
        rag_vision_llm_enabled=True,
        rag_vision_llm_max_images_per_doc=50,
        rag_vision_llm_max_concurrency=3,
    )
    result = await knowledge_rag_images.describe_images_and_replace_placeholders(
        session=MagicMock(),
        user_id="u",
        document_id="d",
        content="plain text",
        settings=settings,
        collaborators=_collaborators(),
    )
    assert result == "plain text"


@pytest.mark.asyncio
async def test_describe_phase_keeps_placeholder_when_no_provider(monkeypatch, tmp_path) -> None:
    del tmp_path
    settings = SimpleNamespace(
        rag_vision_llm_enabled=True,
        rag_vision_llm_max_images_per_doc=50,
        rag_vision_llm_max_concurrency=3,
    )
    # 函数内 import → patch 源模块
    import app.services.knowledge_rag_vision as vision_mod
    monkeypatch.setattr(
        vision_mod, "resolve_vision_llm_runtime_config",
        AsyncMock(return_value=None),
    )

    content = "before [IMAGE:page=1;idx=0] after"
    result = await knowledge_rag_images.describe_images_and_replace_placeholders(
        session=MagicMock(),
        user_id="u",
        document_id="d",
        content=content,
        settings=settings,
        collaborators=_collaborators(),
    )
    assert result == content


@pytest.mark.asyncio
async def test_describe_phase_replaces_placeholder_with_cached_description(
    monkeypatch, tmp_path,
) -> None:
    """缓存命中：不调 VLM，直接用缓存描述替换占位符。"""
    settings = SimpleNamespace(
        rag_vision_llm_enabled=True,
        rag_vision_llm_max_images_per_doc=50,
        rag_vision_llm_max_concurrency=3,
    )

    # 准备图片文件
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"pdf")
    images_dir = tmp_path / "doc_images"
    images_dir.mkdir()
    image_path = images_dir / "page_1_idx_0.png"
    image_path.write_bytes(b"png-bytes")

    import app.services.knowledge_rag_vision as vision_mod
    monkeypatch.setattr(
        vision_mod, "resolve_vision_llm_runtime_config",
        AsyncMock(return_value=_runtime()),
    )

    find_cache = AsyncMock(return_value="cached desc")
    store_mock = AsyncMock()
    vlm_call = AsyncMock()

    content = "before [IMAGE:page=1;idx=0] after"
    result = await knowledge_rag_images.describe_images_and_replace_placeholders(
        session=MagicMock(),
        user_id="u",
        document_id="d",
        content=content,
        settings=settings,
        collaborators=_collaborators(
            describe_single_image_vlm=vlm_call,
            find_image_description_cache=find_cache,
            find_uploaded_document_path=lambda settings, user_id, document_id: pdf_path,
            store_image_description_cache=store_mock,
        ),
    )
    assert "[图片描述 (page 1)]" in result
    assert "cached desc" in result
    vlm_call.assert_not_called()
    store_mock.assert_not_called()


@pytest.mark.asyncio
async def test_describe_phase_calls_vlm_on_cache_miss(monkeypatch, tmp_path) -> None:
    """缓存未命中 → 调 VLM → 写缓存。"""
    settings = SimpleNamespace(
        rag_vision_llm_enabled=True,
        rag_vision_llm_max_images_per_doc=50,
        rag_vision_llm_max_concurrency=3,
    )

    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"pdf")
    images_dir = tmp_path / "doc_images"
    images_dir.mkdir()
    (images_dir / "page_2_idx_0.png").write_bytes(b"img")

    import app.services.knowledge_rag_vision as vision_mod
    monkeypatch.setattr(
        vision_mod, "resolve_vision_llm_runtime_config",
        AsyncMock(return_value=_runtime()),
    )
    find_cache = AsyncMock(return_value=None)
    store_mock = AsyncMock()
    describe_image = AsyncMock(return_value="vlm desc")

    content = "[IMAGE:page=2;idx=0]"
    result = await knowledge_rag_images.describe_images_and_replace_placeholders(
        session=MagicMock(),
        user_id="u",
        document_id="d",
        content=content,
        settings=settings,
        collaborators=_collaborators(
            describe_single_image_vlm=describe_image,
            find_image_description_cache=find_cache,
            find_uploaded_document_path=lambda settings, user_id, document_id: pdf_path,
            store_image_description_cache=store_mock,
        ),
    )

    assert "vlm desc" in result
    assert "[图片描述 (page 2)]" in result
    store_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_describe_phase_skips_beyond_max_images(monkeypatch, tmp_path) -> None:
    """超过 max_images_per_doc 的占位符替换为跳过标记。"""
    settings = SimpleNamespace(
        rag_vision_llm_enabled=True,
        rag_vision_llm_max_images_per_doc=1,
        rag_vision_llm_max_concurrency=3,
    )

    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"pdf")
    images_dir = tmp_path / "doc_images"
    images_dir.mkdir()
    (images_dir / "page_1_idx_0.png").write_bytes(b"img1")
    (images_dir / "page_1_idx_1.png").write_bytes(b"img2")

    import app.services.knowledge_rag_vision as vision_mod
    monkeypatch.setattr(
        vision_mod, "resolve_vision_llm_runtime_config",
        AsyncMock(return_value=_runtime()),
    )
    describe_image = AsyncMock(return_value="desc")

    content = "[IMAGE:page=1;idx=0] [IMAGE:page=1;idx=1]"
    result = await knowledge_rag_images.describe_images_and_replace_placeholders(
        session=MagicMock(),
        user_id="u",
        document_id="d",
        content=content,
        settings=settings,
        collaborators=_collaborators(
            describe_single_image_vlm=describe_image,
            find_image_description_cache=AsyncMock(return_value=None),
            find_uploaded_document_path=lambda settings, user_id, document_id: pdf_path,
            store_image_description_cache=AsyncMock(),
        ),
    )

    assert "desc" in result
    assert "超出单文档上限" in result


@pytest.mark.asyncio
async def test_describe_phase_handles_missing_image_file(monkeypatch, tmp_path) -> None:
    """占位符存在但图片文件不在 → 替换为缺失占位符。"""
    settings = SimpleNamespace(
        rag_vision_llm_enabled=True,
        rag_vision_llm_max_images_per_doc=50,
        rag_vision_llm_max_concurrency=3,
    )

    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"pdf")

    import app.services.knowledge_rag_vision as vision_mod
    monkeypatch.setattr(
        vision_mod, "resolve_vision_llm_runtime_config",
        AsyncMock(return_value=_runtime()),
    )

    content = "[IMAGE:page=1;idx=0]"
    result = await knowledge_rag_images.describe_images_and_replace_placeholders(
        session=MagicMock(),
        user_id="u",
        document_id="d",
        content=content,
        settings=settings,
        collaborators=_collaborators(
            find_uploaded_document_path=lambda settings, user_id, document_id: pdf_path,
        ),
    )
    assert "图片文件缺失" in result


def test_image_placeholder_regex_matches_valid_format() -> None:
    pattern = knowledge_rag_images.image_placeholder_regex()
    text = "before [IMAGE:page=10;idx=3] after"
    matches = list(pattern.finditer(text))
    assert len(matches) == 1
    assert matches[0].group(1) == "10"
    assert matches[0].group(2) == "3"


def test_image_placeholder_regex_ignores_malformed() -> None:
    pattern = knowledge_rag_images.image_placeholder_regex()
    text = "[IMAGE:page=1] [IMAGE:idx=0] [IMAGE:page=;idx=0]"
    assert list(pattern.finditer(text)) == []
