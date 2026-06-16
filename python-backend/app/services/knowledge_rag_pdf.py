from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import Settings

logger = logging.getLogger("table-python-backend")


@dataclass(frozen=True)
class PdfImageRegion:
    page_num: int
    image_index: int
    bbox: tuple[float, float, float, float]
    image_bytes: bytes
    mime_type: str
    source_kind: str


@dataclass
class PdfExtractionResult:
    markdown: str
    images: list[PdfImageRegion] = field(default_factory=list)
    parse_method: str = "markitdown"
    page_count: int = 0
    metadata: dict = field(default_factory=dict)


def _placeholder_for(page_num: int, image_index: int) -> str:
    return f"[IMAGE:page={page_num};idx={image_index}]"


def _placeholder_format() -> str:
    """格式说明，会在 markdown 流末尾追加一次，供 VLM 替换时识别。"""
    return "<!-- image-placeholder-format: [IMAGE:page=N;idx=M] -->"


def _extract_markitdown(raw_bytes: bytes) -> tuple[str, int]:
    """同步：MarkItDown 转 markdown。返回 (markdown, page_count)。page_count 不可得时为 0。"""
    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        raise RuntimeError(f"MarkItDown unavailable: {exc}") from exc

    import io

    buffer = io.BytesIO(raw_bytes)
    buffer.name = "upload.pdf"
    converter = MarkItDown()
    result = converter.convert(buffer)
    return (result.text_content or "").strip(), 0


def _extract_raster_images(doc: Any, page_count: int) -> list[PdfImageRegion]:
    """提取栅格图（PNG/JPEG 嵌入对象）。doc 为 fitz.Document。"""
    regions: list[PdfImageRegion] = []
    for page_num in range(1, page_count + 1):
        page = doc[page_num - 1]
        page_images = page.get_images(full=True)
        per_page_idx = 0
        for item in page_images:
            xref = item[0]
            try:
                rects = page.get_image_rects(xref)
                if not rects:
                    continue
                bbox_tuple = (
                    float(rects[0].x0),
                    float(rects[0].y0),
                    float(rects[0].x1),
                    float(rects[0].y1),
                )
                extracted = doc.extract_image(xref)
                if not extracted or not extracted.get("image"):
                    continue
                image_bytes = extracted["image"]
                ext = (extracted.get("ext") or "png").lower()
                mime = "image/jpeg" if ext in {"jpg", "jpeg"} else "image/png"
                regions.append(
                    PdfImageRegion(
                        page_num=page_num,
                        image_index=per_page_idx,
                        bbox=bbox_tuple,
                        image_bytes=image_bytes,
                        mime_type=mime,
                        source_kind="raster",
                    )
                )
                per_page_idx += 1
            except Exception as exc:
                logger.warning("Failed to extract raster image on page %d: %s", page_num, exc)
    return regions


def _cluster_vector_drawings(
    page: Any,
    *,
    min_size: float,
    min_paths: int,
    eps: float = 20.0,
) -> list[tuple[float, float, float, float]]:
    """对页面矢量路径做空间聚类，返回疑似矢量图区域的 bbox 列表。

    算法：取所有 path 的 bbox → 按 (x_center, y_center) 用 grid bucketing 聚类
    （DBSCAN 简易版，eps 邻域）→ 过滤总 bbox 尺寸 + 路径数门槛。
    """
    try:
        drawings = page.get_drawings()
    except Exception:
        return []

    if len(drawings) < min_paths:
        return []

    points: list[tuple[float, float, float, float, float, float]] = []
    for d in drawings:
        rect = d.get("rect")
        if rect is None:
            continue
        if rect.width <= 0 or rect.height <= 0:
            continue
        cx = (rect.x0 + rect.x1) / 2
        cy = (rect.y0 + rect.y1) / 2
        points.append((cx, cy, float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)))

    if len(points) < min_paths:
        return []

    # 简易 DBSCAN：grid bucketing by eps
    visited = [False] * len(points)
    clusters: list[list[int]] = []

    def neighbors(i: int) -> list[int]:
        cx, cy = points[i][0], points[i][1]
        result = []
        for j, p in enumerate(points):
            if i == j:
                continue
            if abs(p[0] - cx) <= eps and abs(p[1] - cy) <= eps:
                result.append(j)
        return result

    for i in range(len(points)):
        if visited[i]:
            continue
        cluster: list[int] = [i]
        visited[i] = True
        queue = [i]
        while queue:
            cur = queue.pop()
            for nb in neighbors(cur):
                if not visited[nb]:
                    visited[nb] = True
                    cluster.append(nb)
                    queue.append(nb)
        if len(cluster) >= min_paths:
            clusters.append(cluster)

    bboxes: list[tuple[float, float, float, float]] = []
    for cluster in clusters:
        x0 = min(points[i][2] for i in cluster)
        y0 = min(points[i][3] for i in cluster)
        x1 = max(points[i][4] for i in cluster)
        y1 = max(points[i][5] for i in cluster)
        if (x1 - x0) < min_size or (y1 - y0) < min_size:
            continue
        bboxes.append((x0, y0, x1, y1))
    return bboxes


def _render_region_to_png(page: Any, bbox: tuple[float, float, float, float], *, dpi: int = 200) -> bytes | None:
    try:
        import fitz  # type: ignore[import-not-found]
    except ImportError:
        return None
    clip = fitz.Rect(bbox)
    matrix = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=matrix, clip=clip)
    return pix.tobytes("png")


def _extract_vector_regions(
    doc: Any,
    page_count: int,
    *,
    settings: Settings,
) -> list[PdfImageRegion]:
    """扫描每页矢量绘图，聚类为疑似架构图区域，渲染为 PNG。"""
    if not settings.rag_pdf_extract_images_enabled:
        return []
    regions: list[PdfImageRegion] = []
    min_size = float(settings.rag_pdf_vector_graphics_min_size)
    min_paths = int(settings.rag_pdf_vector_graphics_min_paths)
    for page_num in range(1, page_count + 1):
        page = doc[page_num - 1]
        cluster_bboxes = _cluster_vector_drawings(page, min_size=min_size, min_paths=min_paths)
        if not cluster_bboxes:
            continue
        per_page_idx = 0
        for bbox in cluster_bboxes:
            png_bytes = _render_region_to_png(page, bbox)
            if not png_bytes:
                continue
            regions.append(
                PdfImageRegion(
                    page_num=page_num,
                    image_index=per_page_idx,
                    bbox=bbox,
                    image_bytes=png_bytes,
                    mime_type="image/png",
                    source_kind="vector",
                )
            )
            per_page_idx += 1
    return regions


def _merge_image_indices(raster: list[PdfImageRegion], vector: list[PdfImageRegion]) -> list[PdfImageRegion]:
    """栅格和矢量图统一编号 idx（每页内顺序）。返回新列表。"""
    by_page: dict[int, list[PdfImageRegion]] = {}
    for r in raster:
        by_page.setdefault(r.page_num, []).append(r)
    for v in vector:
        by_page.setdefault(v.page_num, []).append(v)

    merged: list[PdfImageRegion] = []
    for page_num in sorted(by_page.keys()):
        items = by_page[page_num]
        items_sorted = sorted(items, key=lambda r: (r.bbox[1], r.bbox[0]))  # 先 y 后 x：阅读顺序
        for new_idx, region in enumerate(items_sorted):
            merged.append(
                PdfImageRegion(
                    page_num=page_num,
                    image_index=new_idx,
                    bbox=region.bbox,
                    image_bytes=region.image_bytes,
                    mime_type=region.mime_type,
                    source_kind=region.source_kind,
                )
            )
    return merged


def _build_markdown_with_placeholders(
    markdown: str,
    images: list[PdfImageRegion],
) -> str:
    """图片占位符追加到每页末尾。MarkItDown 输出无页码信息，按图片元数据 page 分组追加。"""
    if not images:
        return markdown

    by_page: dict[int, list[PdfImageRegion]] = {}
    for img in images:
        by_page.setdefault(img.page_num, []).append(img)

    parts: list[str] = [markdown.strip(), ""]
    for page_num in sorted(by_page.keys()):
        parts.append(f"\n<!-- page {page_num} -->")
        for img in by_page[page_num]:
            parts.append(_placeholder_for(img.page_num, img.image_index))
    parts.append(_placeholder_format())
    return "\n".join(parts).strip()


def save_pdf_images(
    images: list[PdfImageRegion],
    *,
    pdf_file_path: Path,
) -> Path:
    """把图片写到 file_path 同级目录下的 `<doc_id>_images/`。返回该目录。"""
    if not images:
        return Path("")
    stem = pdf_file_path.stem
    images_dir = pdf_file_path.parent / f"{stem}_images"
    images_dir.mkdir(parents=True, exist_ok=True)
    for img in images:
        ext = "png" if img.mime_type == "image/png" else "jpg"
        out = images_dir / f"page_{img.page_num}_idx_{img.image_index}.{ext}"
        out.write_bytes(img.image_bytes)
    return images_dir


async def extract_pdf_with_images(
    raw_bytes: bytes,
    *,
    file_path: Path | None = None,
    settings: Settings,
    ocr_fallback: Any | None = None,
) -> PdfExtractionResult:
    """PDF 解析主入口。

    流程：
    1. 用 PyMuPDF 打开（顺便取 page_count）
    2. 扫描件预检（外部已做）→ 跳过本函数走 OCR fallback
    3. MarkItDown 转 markdown（线程内同步执行）
    4. PyMuPDF 提取栅格图 + 矢量图
    5. 合并 + 重新编号 idx
    6. 占位符追加到 markdown
    7. file_path 提供时把图片写入 `<stem>_images/`

    Args:
        raw_bytes: PDF 二进制
        file_path: PDF 文件路径（用于派生图片输出目录）
        settings: 全局配置
        ocr_fallback: 异步 callable，无参；当 MarkItDown 失败时调用走 OCR 服务
    """
    import fitz  # type: ignore[import-not-found]

    try:
        doc = fitz.open(stream=raw_bytes, filetype="pdf")
    except Exception as exc:
        logger.warning("PyMuPDF failed to open PDF: %s", exc)
        if ocr_fallback is not None:
            return await ocr_fallback()
        raise

    page_count = doc.page_count

    # MarkItDown 主路径（在线程里跑，避免阻塞 event loop）
    try:
        markdown, _ = await asyncio.to_thread(_extract_markitdown, raw_bytes)
    except Exception as exc:
        logger.warning("MarkItDown conversion failed: %s", exc)
        markdown = ""

    if len(markdown) < settings.rag_pdf_markitdown_min_chars:
        if ocr_fallback is not None:
            logger.info("MarkItDown output too short (%d chars), falling back to OCR", len(markdown))
            doc.close()
            return await ocr_fallback()
        markdown = markdown or ""

    # 提取图片
    images: list[PdfImageRegion] = []
    if settings.rag_pdf_extract_images_enabled:
        try:
            raster = _extract_raster_images(doc, page_count)
            vector = _extract_vector_regions(doc, page_count, settings=settings)
            images = _merge_image_indices(raster, vector)
        except Exception as exc:
            logger.warning("Image extraction failed (continuing with text only): %s", exc)
            images = []

    doc.close()

    markdown_final = _build_markdown_with_placeholders(markdown, images)

    if file_path is not None and images:
        try:
            save_pdf_images(images, pdf_file_path=file_path)
        except Exception as exc:
            logger.warning("Failed to save image files: %s", exc)

    metadata = {
        "parseMethod": "markitdown",
        "pageCount": page_count,
        "imageCount": len(images),
        "rasterImageCount": sum(1 for i in images if i.source_kind == "raster"),
        "vectorImageCount": sum(1 for i in images if i.source_kind == "vector"),
    }
    return PdfExtractionResult(
        markdown=markdown_final,
        images=images,
        parse_method="markitdown",
        page_count=page_count,
        metadata=metadata,
    )
