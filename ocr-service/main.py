"""
PaddleOCR 文档处理服务

提供 PDF OCR 识别和布局分析能力：
- 文字识别（中文优化）
- 布局检测（表格、标题、段落）
- 表格结构提取

启动方式：
  uvicorn main:app --host 0.0.0.0 --port 8001

依赖安装：
  pip install -r requirements.txt
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from paddleocr import PPStructure
import fitz  # PyMuPDF
import io
import base64
import logging
from typing import List, Dict, Any, Optional
from pydantic import BaseModel

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="OCR Service",
    description="PaddleOCR 文档处理服务",
    version="1.0.0",
)

# 初始化 PP-Structure（布局分析引擎）
# show_log=False 减少日志输出，image_dir=None 不保存中间图片
table_engine = None


def get_table_engine():
    """懒加载 PPStructure，避免启动时阻塞"""
    global table_engine
    if table_engine is None:
        logger.info("Initializing PPStructure engine...")
        table_engine = PPStructure(show_log=False, image_dir=None, use_gpu=False)
        logger.info("PPStructure engine initialized")
    return table_engine


class TextBlock(BaseModel):
    content: str
    type: str  # paragraph, title, list_item, figure, table
    page: int
    bbox: Optional[List[float]] = None  # [x1, y1, x2, y2]
    confidence: Optional[float] = None


class TableBlock(BaseModel):
    cells: List[List[str]]
    html: Optional[str] = None
    page: int
    bbox: Optional[List[float]] = None


class OCRMetadata(BaseModel):
    page_count: int
    has_ocr: bool
    confidence: float
    processing_time_ms: int


class OCRResult(BaseModel):
    text_blocks: List[TextBlock]
    tables: List[TableBlock]
    metadata: OCRMetadata


def pdf_to_images(pdf_bytes: bytes, dpi: int = 200) -> List[bytes]:
    """
    将 PDF 转换为 PNG 图片列表

    Args:
        pdf_bytes: PDF 文件的二进制内容
        dpi: 图片分辨率（默认 200，平衡质量和速度）

    Returns:
        PNG 图片的二进制内容列表
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    images = []

    for page_num in range(doc.page_count):
        page = doc[page_num]
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        images.append(img_bytes)

    doc.close()
    return images


def process_image(image_bytes: bytes, page_num: int) -> tuple[List[TextBlock], List[TableBlock]]:
    """
    处理单张图片，提取文字和表格

    Args:
        image_bytes: PNG 图片的二进制内容
        page_num: 页码（从 1 开始）

    Returns:
        (text_blocks, tables) 文字块和表格列表
    """
    engine = get_table_engine()
    result = engine(image_bytes)

    text_blocks = []
    tables = []

    for region in result:
        region_type = region.get("type", "text")

        if region_type == "table":
            # 表格区域
            cells = []
            html = None
            bbox = region.get("bbox")

            # 从 res 中提取表格内容
            if "res" in region and isinstance(region["res"], dict):
                # PP-Structure 表格结果
                if "html" in region["res"]:
                    html = region["res"]["html"]

                # 尝试提取单元格内容
                if "cells" in region["res"]:
                    for row in region["res"]["cells"]:
                        row_data = []
                        for cell in row:
                            if isinstance(cell, dict):
                                row_data.append(cell.get("text", ""))
                            else:
                                row_data.append(str(cell) if cell else "")
                        cells.append(row_data)

            tables.append(TableBlock(
                cells=cells if cells else [[]],
                html=html,
                page=page_num,
                bbox=bbox,
            ))

        else:
            # 文字区域（段落、标题、列表等）
            bbox = region.get("bbox")
            confidence = None

            # 从 res 中提取文字
            text_content = ""
            if "res" in region:
                if isinstance(region["res"], list) and len(region["res"]) > 0:
                    # OCR 结果是列表形式
                    for item in region["res"]:
                        if isinstance(item, list) and len(item) >= 1:
                            text_content += item[0] + " "
                    text_content = text_content.strip()
                elif isinstance(region["res"], dict):
                    # 字典形式
                    text_content = region["res"].get("text", "")

            # 尝试获取置信度
            if isinstance(region["res"], list) and len(region["res"]) > 0:
                first_item = region["res"][0]
                if isinstance(first_item, list) and len(first_item) >= 2:
                    confidence = first_item[1] if isinstance(first_item[1], float) else None

            if text_content:
                text_blocks.append(TextBlock(
                    content=text_content,
                    type=region_type,
                    page=page_num,
                    bbox=bbox,
                    confidence=confidence,
                ))

    return text_blocks, tables


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "healthy", "service": "ocr-service"}


@app.post("/ocr/process", response_model=OCRResult)
async def process_document(file: UploadFile):
    """
    处理 PDF 文档，提取文字和表格

    Args:
        file: PDF 文件（multipart/form-data）

    Returns:
        OCRResult: 包含文字块、表格和元数据
    """
    import time
    start_time = time.time()

    # 验证文件类型
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    try:
        # 读取 PDF 文件
        pdf_bytes = await file.read()
        if len(pdf_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty file")

        logger.info(f"Processing PDF: {file.filename}, size: {len(pdf_bytes)} bytes")

        # 转换为图片
        images = pdf_to_images(pdf_bytes, dpi=200)
        page_count = len(images)

        logger.info(f"Converted to {page_count} images")

        # 处理每页
        all_text_blocks = []
        all_tables = []
        total_confidence = 0.0
        confidence_count = 0

        for i, img_bytes in enumerate(images):
            page_num = i + 1  # 页码从 1 开始
            logger.info(f"Processing page {page_num}")

            text_blocks, tables = process_image(img_bytes, page_num)
            all_text_blocks.extend(text_blocks)
            all_tables.extend(tables)

            # 收集置信度
            for block in text_blocks:
                if block.confidence:
                    total_confidence += block.confidence
                    confidence_count += 1

        # 计算平均置信度
        avg_confidence = confidence_count > 0 ? total_confidence / confidence_count : 0.0

        # 判断是否真正进行了 OCR（有文字提取）
        has_ocr = len(all_text_blocks) > 0 or len(all_tables) > 0

        processing_time = int((time.time() - start_time) * 1000)

        logger.info(f"OCR completed: {len(all_text_blocks)} text blocks, {len(all_tables)} tables, "
                    f"confidence: {avg_confidence:.2f}, time: {processing_time}ms")

        return OCRResult(
            text_blocks=all_text_blocks,
            tables=all_tables,
            metadata=OCRMetadata(
                page_count=page_count,
                has_ocr=has_ocr,
                confidence=avg_confidence,
                processing_time_ms=processing_time,
            ),
        )

    except Exception as e:
        logger.error(f"OCR processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ocr/process-image", response_model=OCRResult)
async def process_single_image(file: UploadFile):
    """
    处理单张图片（PNG/JPG）

    Args:
        file: 图片文件（multipart/form-data）

    Returns:
        OCRResult: 包含文字块、表格和元数据
    """
    import time
    start_time = time.time()

    # 验证文件类型
    allowed_types = [".png", ".jpg", ".jpeg"]
    if not any(file.filename.lower().endswith(ext) for ext in allowed_types):
        raise HTTPException(status_code=400, detail="Only PNG/JPG files are supported")

    try:
        img_bytes = await file.read()
        if len(img_bytes) == 0:
            raise HTTPException(status_code=400, detail="Empty file")

        logger.info(f"Processing image: {file.filename}, size: {len(img_bytes)} bytes")

        # 处理图片
        text_blocks, tables = process_image(img_bytes, 1)

        total_confidence = 0.0
        confidence_count = 0
        for block in text_blocks:
            if block.confidence:
                total_confidence += block.confidence
                confidence_count += 1

        avg_confidence = confidence_count > 0 ? total_confidence / confidence_count : 0.0
        has_ocr = len(text_blocks) > 0 or len(tables) > 0
        processing_time = int((time.time() - start_time) * 1000)

        return OCRResult(
            text_blocks=text_blocks,
            tables=tables,
            metadata=OCRMetadata(
                page_count=1,
                has_ocr=has_ocr,
                confidence=avg_confidence,
                processing_time_ms=processing_time,
            ),
        )

    except Exception as e:
        logger.error(f"Image OCR failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)