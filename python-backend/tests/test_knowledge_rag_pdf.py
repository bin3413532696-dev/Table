"""knowledge_rag_pdf 模块的纯逻辑测试（不依赖真实 fitz/MarkItDown）。"""
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import knowledge_rag_pdf
from app.services.knowledge_rag_pdf import (
    PdfImageRegion,
    _build_markdown_with_placeholders,
    _cluster_vector_drawings,
    _merge_image_indices,
    _placeholder_for,
)


def _settings(*, min_size: int = 100, min_paths: int = 5, extract=True):
    return SimpleNamespace(
        rag_pdf_extract_images_enabled=extract,
        rag_pdf_vector_graphics_min_size=min_size,
        rag_pdf_vector_graphics_min_paths=min_paths,
    )


def test_placeholder_format_includes_page_and_idx() -> None:
    assert _placeholder_for(3, 0) == "[IMAGE:page=3;idx=0]"
    assert _placeholder_for(1, 12) == "[IMAGE:page=1;idx=12]"


def test_build_markdown_with_placeholders_no_images_returns_original() -> None:
    md = "# Title\n\nbody"
    assert _build_markdown_with_placeholders(md, []) == md


def test_build_markdown_with_placeholders_groups_by_page() -> None:
    md = "# Title\n\nbody"
    images = [
        PdfImageRegion(page_num=2, image_index=0, bbox=(0, 0, 10, 10),
                       image_bytes=b"", mime_type="image/png", source_kind="raster"),
        PdfImageRegion(page_num=1, image_index=0, bbox=(0, 0, 10, 10),
                       image_bytes=b"", mime_type="image/png", source_kind="raster"),
        PdfImageRegion(page_num=2, image_index=1, bbox=(0, 0, 10, 10),
                       image_bytes=b"", mime_type="image/png", source_kind="raster"),
    ]
    result = _build_markdown_with_placeholders(md, images)
    # 页码顺序：page 1 在前
    assert result.index("<!-- page 1 -->") < result.index("<!-- page 2 -->")
    # page 2 内 idx 顺序：0 在 1 前
    p2_section = result.split("<!-- page 2 -->")[1]
    assert p2_section.index("[IMAGE:page=2;idx=0]") < p2_section.index("[IMAGE:page=2;idx=1]")
    # 末尾有格式说明
    assert "image-placeholder-format" in result


def test_merge_image_indices_reindexes_per_page_in_reading_order() -> None:
    raster = [
        PdfImageRegion(page_num=1, image_index=0, bbox=(0, 100, 10, 110),
                       image_bytes=b"a", mime_type="image/png", source_kind="raster"),
        PdfImageRegion(page_num=1, image_index=1, bbox=(0, 50, 10, 60),
                       image_bytes=b"b", mime_type="image/png", source_kind="raster"),
    ]
    vector = [
        PdfImageRegion(page_num=1, image_index=0, bbox=(0, 75, 10, 85),
                       image_bytes=b"c", mime_type="image/png", source_kind="vector"),
        PdfImageRegion(page_num=2, image_index=0, bbox=(0, 0, 10, 10),
                       image_bytes=b"d", mime_type="image/png", source_kind="vector"),
    ]
    merged = _merge_image_indices(raster, vector)

    # page 1 三张图按 y 升序：y=50(idx 0), y=75(idx 1), y=100(idx 2)
    page1 = [m for m in merged if m.page_num == 1]
    assert len(page1) == 3
    assert page1[0].image_index == 0 and page1[0].bbox[1] == 50
    assert page1[1].image_index == 1 and page1[1].bbox[1] == 75
    assert page1[2].image_index == 2 and page1[2].bbox[1] == 100
    # page 2 单独
    page2 = [m for m in merged if m.page_num == 2]
    assert len(page2) == 1 and page2[0].image_index == 0


def _rect(x0, y0, x1, y1):
    return SimpleNamespace(x0=x0, y0=y0, x1=x1, y1=y1, width=x1 - x0, height=y1 - y0)


def test_cluster_vector_drawings_returns_empty_when_below_min_paths() -> None:
    page = MagicMock()
    page.get_drawings.return_value = [
        {"rect": _rect(0, 0, 10, 10)},
        {"rect": _rect(20, 20, 30, 30)},
    ]
    clusters = _cluster_vector_drawings(page, min_size=100, min_paths=5)
    assert clusters == []


def test_cluster_vector_drawings_clusters_nearby_paths() -> None:
    """5 个相邻 path（在 eps=20 内）应聚为 1 个聚类；远处的孤立点不参与。"""
    page = MagicMock()
    page.get_drawings.return_value = [
        {"rect": _rect(100, 100, 110, 110)},
        {"rect": _rect(105, 105, 115, 115)},
        {"rect": _rect(108, 100, 118, 110)},
        {"rect": _rect(100, 108, 110, 118)},
        {"rect": _rect(115, 115, 125, 125)},
        # 远处的孤立 path，不在 eps=20 内
        {"rect": _rect(500, 500, 510, 510)},
    ]
    clusters = _cluster_vector_drawings(page, min_size=10, min_paths=5, eps=20)
    assert len(clusters) == 1
    bbox = clusters[0]
    # bbox 覆盖 5 个 path 的并集
    assert bbox[0] == 100 and bbox[1] == 100
    assert bbox[2] == 125 and bbox[3] == 125


def test_cluster_vector_drawings_filters_clusters_below_min_size() -> None:
    """聚类路径数够但 bbox 太小 → 被 min_size 过滤。"""
    page = MagicMock()
    page.get_drawings.return_value = [
        {"rect": _rect(0, 0, 5, 5)},
        {"rect": _rect(0, 1, 5, 6)},
        {"rect": _rect(0, 2, 5, 7)},
        {"rect": _rect(0, 3, 5, 8)},
        {"rect": _rect(0, 4, 5, 9)},
    ]
    clusters = _cluster_vector_drawings(page, min_size=100, min_paths=5, eps=20)
    assert clusters == []  # bbox 只有 5x9，低于 min_size=100


def test_cluster_vector_drawings_handles_zero_size_rects() -> None:
    page = MagicMock()
    page.get_drawings.return_value = [
        {"rect": _rect(0, 0, 0, 0)},  # 0 size，跳过
        {"rect": _rect(0, 0, 5, 5)},
        {"rect": _rect(0, 1, 5, 6)},
        {"rect": _rect(0, 2, 5, 7)},
        {"rect": _rect(0, 3, 5, 8)},
        {"rect": _rect(0, 4, 5, 9)},
    ]
    clusters = _cluster_vector_drawings(page, min_size=5, min_paths=5, eps=20)
    assert len(clusters) == 1


def test_cluster_vector_drawings_handles_get_drawings_exception() -> None:
    page = MagicMock()
    page.get_drawings.side_effect = RuntimeError("fitz error")
    assert _cluster_vector_drawings(page, min_size=10, min_paths=2) == []


def test_save_pdf_images_creates_dir_and_writes_files(tmp_path) -> None:
    from pathlib import Path
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"fake")

    images = [
        PdfImageRegion(page_num=1, image_index=0, bbox=(0, 0, 10, 10),
                       image_bytes=b"png1", mime_type="image/png", source_kind="raster"),
        PdfImageRegion(page_num=2, image_index=0, bbox=(0, 0, 10, 10),
                       image_bytes=b"jpg1", mime_type="image/jpeg", source_kind="raster"),
    ]
    out_dir = knowledge_rag_pdf.save_pdf_images(images, pdf_file_path=pdf_path)

    assert out_dir == tmp_path / "doc_images"
    assert (out_dir / "page_1_idx_0.png").read_bytes() == b"png1"
    assert (out_dir / "page_2_idx_0.jpg").read_bytes() == b"jpg1"


def test_save_pdf_images_returns_empty_path_when_no_images(tmp_path) -> None:
    pdf_path = tmp_path / "doc.pdf"
    pdf_path.write_bytes(b"fake")
    out_dir = knowledge_rag_pdf.save_pdf_images([], pdf_file_path=pdf_path)
    assert str(out_dir) == "."
