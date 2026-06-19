# OCR Service - PaddleOCR 资料解析降级服务

基于 PaddleOCR 的 OCR 识别和布局分析服务，主要用于 `Table` 的大文件学习场景。当 PDF、图片或扫描件无法直接抽取稳定文本时，该服务作为 RAG 解析链路的降级路径介入。

## 功能特性

- 文字识别（中文优化）
- 布局检测（表格、标题、段落）
- 表格结构提取（HTML 格式）
- PDF 转图片处理
- 扫描件与图片资料的 OCR 降级解析
- 健康检查接口

## API 接口

### 健康检查

```
GET /health
```

响应：
```json
{
  "status": "healthy",
  "service": "ocr-service"
}
```

### 处理 PDF 文档

```
POST /ocr/process
Content-Type: multipart/form-data

参数：
- file: PDF 文件
```

响应：
```json
{
  "text_blocks": [
    {
      "content": "文字内容",
      "type": "paragraph",
      "page": 1,
      "bbox": [x1, y1, x2, y2],
      "confidence": 0.95
    }
  ],
  "tables": [
    {
      "cells": [["单元格1", "单元格2"]],
      "html": "<table>...</table>",
      "page": 1,
      "bbox": [x1, y1, x2, y2]
    }
  ],
  "metadata": {
    "page_count": 10,
    "has_ocr": true,
    "confidence": 0.92,
    "processing_time_ms": 5000
  }
}
```

### 处理单张图片

```
POST /ocr/process-image
Content-Type: multipart/form-data

参数：
- file: PNG/JPG 图片文件
```

## 本地运行

### 方式 1: 直接运行

```bash
# 安装依赖
uv sync --package table-ocr-service

# 启动服务
uv run --package table-ocr-service uvicorn main:app --host 127.0.0.1 --port 8001
```

### 方式 2: Docker 运行

```bash
# 构建镜像
docker build -t ocr-service .

# 运行容器
docker run -d -p 8001:8001 --name ocr-service ocr-service
```

## 测试

```bash
# 健康检查
curl http://localhost:8001/health

# 处理 PDF
curl -X POST http://localhost:8001/ocr/process \
  -H "Content-Type: multipart/form-data" \
  -F "file=@test.pdf"
```

## 性能优化建议

1. **GPU 加速**: 安装 `paddlepaddle-gpu` 替换 `paddlepaddle`
2. **批量处理**: 适当增加 DPI（200-300）以提高识别精度
3. **内存限制**: PaddleOCR 模型较大，建议预留 2GB+ 内存

## 与 Python 后端集成

Python 后端通过 `integrations/ocr_service.py` 调用此服务。它不是独立知识库，而是 `knowledge-rag` pipeline 的一个解析阶段：

1. 优先尝试直接提取文本
2. 对扫描件或文本层质量过低的文件触发 OCR
3. 将 OCR 结果回填到后续分块、检索与 Agent 问答链路

## 注意事项

- 服务启动时 PPStructure 模型会自动下载（约 100MB）
- 首次请求可能较慢（模型加载）
- 建议在生产环境预热模型
- 对于文本层完整的 PDF，主流程通常不会调用该服务
