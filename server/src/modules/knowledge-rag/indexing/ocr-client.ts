/**
 * OCR 服务客户端
 *
 * 调用 PaddleOCR Python 微服务处理 PDF 文档
 * 支持扫描件检测和 OCR 文字提取
 */

import fs from 'fs/promises';
import { ragConfig } from '../config';

// =====================================================
// 类型定义
// =====================================================

export interface OCRTextBlock {
  content: string;
  type: 'paragraph' | 'title' | 'list_item' | 'figure' | 'table';
  page: number;
  bbox?: [number, number, number, number];  // [x1, y1, x2, y2]
  confidence?: number;
}

export interface OCRTableBlock {
  cells: string[][];
  html?: string;
  page: number;
  bbox?: [number, number, number, number];
}

export interface OCRMetadata {
  pageCount: number;
  hasOcr: boolean;
  confidence: number;
  processingTimeMs: number;
}

export interface OCRResult {
  textBlocks: OCRTextBlock[];
  tables: OCRTableBlock[];
  metadata: OCRMetadata;
}

// =====================================================
// OCR 服务调用
// =====================================================

const OCR_SERVICE_URL = ragConfig.OCR_SERVICE_URL || 'http://localhost:8001';
const OCR_TIMEOUT_MS = ragConfig.OCR_TIMEOUT_MS || 120000;
const OCR_ENABLED = ragConfig.OCR_ENABLED !== false;

/**
 * 检测 OCR 服务是否可用
 */
export async function isOCRServiceAvailable(): Promise<boolean> {
  if (!OCR_ENABLED) {
    return false;
  }

  try {
    const response = await fetch(`${OCR_SERVICE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json() as { status: string };
    return data.status === 'healthy';
    }

    return false;
  } catch (error) {
    console.warn('[OCR] Service unavailable:', error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * 调用 OCR 服务处理 PDF 文件
 *
 * @param filePath PDF 文件路径
 * @returns OCR 结果（文字块、表格、元数据）
 */
export async function processWithOCR(filePath: string): Promise<OCRResult> {
  if (!OCR_ENABLED) {
    throw new Error('OCR service is disabled');
  }

  // 读取文件
  const fileBuffer = await fs.readFile(filePath);
  const filename = filePath.split('/').pop() || 'document.pdf';

  // 构建 FormData
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), filename);

  console.log(`[OCR] Processing file: ${filename}, size: ${fileBuffer.length} bytes`);

  try {
    const response = await fetch(`${OCR_SERVICE_URL}/ocr/process`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OCR service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as OCRResult;

    console.log(`[OCR] Result: ${result.textBlocks.length} text blocks, ${result.tables.length} tables, `
                + `confidence: ${result.metadata.confidence.toFixed(2)}, time: ${result.metadata.processingTimeMs}ms`);

    return result;
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`OCR service timeout (${OCR_TIMEOUT_MS}ms)`);
    }
    throw error;
  }
}

/**
 * 将 OCR 结果组装为纯文本（保留布局结构）
 *
 * @param result OCR 结果
 * @returns 组装后的纯文本
 */
export function assembleOCRText(result: OCRResult): string {
  const parts: string[] = [];

  // 按页分组
  const pages = new Map<number, OCRTextBlock[]>();
  for (const block of result.textBlocks) {
    const pageBlocks = pages.get(block.page) || [];
    pageBlocks.push(block);
    pages.set(block.page, pageBlocks);
  }

  // 添加表格（按页）
  const tablePages = new Map<number, OCRTableBlock[]>();
  for (const table of result.tables) {
    const pageTables = tablePages.get(table.page) || [];
    pageTables.push(table);
    tablePages.set(table.page, pageTables);
  }

  // 按页顺序输出
  const totalPages = result.metadata.pageCount;
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    // 页分隔符
    if (pageNum > 1) {
      parts.push('\n--- Page ' + pageNum + ' ---\n');
    }

    // 文字块（按类型排序：标题 → 段落 → 其他）
    const blocks = pages.get(pageNum) || [];
    const sortedBlocks = blocks.sort((a, b) => {
      const typeOrder = { title: 0, paragraph: 1, list_item: 2, figure: 3, table: 4 };
      return (typeOrder[a.type] || 5) - (typeOrder[b.type] || 5);
    });

    for (const block of sortedBlocks) {
      // 根据类型添加格式
      if (block.type === 'title') {
        parts.push('\n## ' + block.content + '\n');
      } else if (block.type === 'list_item') {
        parts.push('- ' + block.content);
      } else {
        parts.push(block.content);
      }
    }

    // 表格（转 Markdown）
    const tables = tablePages.get(pageNum) || [];
    for (const table of tables) {
      if (table.cells.length > 0) {
        parts.push('\n');
        parts.push(convertTableToMarkdown(table.cells));
        parts.push('\n');
      }
    }
  }

  return parts.join('\n').trim();
}

/**
 * 将表格单元格转换为 Markdown 格式
 */
function convertTableToMarkdown(cells: string[][]): string {
  if (cells.length === 0) return '';

  const lines: string[] = [];

  // 表头行
  if (cells[0]) {
    lines.push('| ' + cells[0].join(' | ') + ' |');
    lines.push('| ' + cells[0].map(() => '---').join(' | ') + ' |');
  }

  // 数据行
  for (let i = 1; i < cells.length; i++) {
    if (cells[i]) {
      lines.push('| ' + cells[i].join(' | ') + ' |');
    }
  }

  return lines.join('\n');
}

/**
 * 检测文档是否可能是扫描件（需要 OCR）
 *
 * @param content 已提取的文本内容
 * @param pageCount PDF 页数
 * @returns 是否可能是扫描件
 */
export function isPossibleScan(content: string, pageCount: number): boolean {
  if (pageCount <= 0) return false;

  const avgCharsPerPage = content.length / pageCount;

  // 每页平均少于 100 字符可能是扫描件
  // 也可能是空白 PDF 或图片型 PDF
  return avgCharsPerPage < 100;
}