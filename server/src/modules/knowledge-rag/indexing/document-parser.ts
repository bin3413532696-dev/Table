import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import crypto from 'crypto';
import { ragConfig } from '../config';
import { processWithOCR, isOCRServiceAvailable, assembleOCRText } from './ocr-client';

// 解析结果
export interface ParseResult {
  content: string;
  metadata: {
    title?: string;
    author?: string;
    pageCount?: number;
    wordCount?: number;
    hasOcr?: boolean;
  };
}

// 文件信息
export interface FileInfo {
  path: string;
  size: number;
  hash: string;
  mimeType: string;
  extension: string;
}

// 获取文件类型
export function getFileType(extension: string): 'pdf' | 'md' | 'txt' | null {
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt' || ext === 'text') return 'txt';
  return null;
}

// 计算文件 SHA-256 哈希
export async function computeFileHash(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// 计算内容 SHA-256 哈希
export function computeContentHash(content: string): Promise<string> {
  return Promise.resolve(
    crypto.createHash('sha256').update(content, 'utf8').digest('hex')
  );
}

// 获取文件信息
export async function getFileInfo(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  const hash = await computeFileHash(filePath);
  const ext = path.extname(filePath);
  const mimeType = getMimeType(ext);

  return {
    path: filePath,
    size: stats.size,
    hash,
    mimeType,
    extension: ext,
  };
}

// MIME 类型映射
function getMimeType(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, '');
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    text: 'text/plain',
  };
  return mimeTypes[ext] ?? 'application/octet-stream';
}

// 解析 Markdown 文件
async function parseMarkdown(filePath: string): Promise<ParseResult> {
  const content = await fs.readFile(filePath, 'utf-8');

  // 提取第一个标题作为标题
  const titleMatch = content.match(/^#\s+(.+)\n/);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(filePath, path.extname(filePath));

  return {
    content,
    metadata: {
      title,
      wordCount: content.split(/\s+/).filter(Boolean).length,
    },
  };
}

// 解析纯文本文件
async function parseText(filePath: string): Promise<ParseResult> {
  const content = await fs.readFile(filePath, 'utf-8');

  return {
    content,
    metadata: {
      title: path.basename(filePath, path.extname(filePath)),
      wordCount: content.split(/\s+/).filter(Boolean).length,
    },
  };
}

// 主解析函数
export async function parseDocument(filePath: string, fileType: string): Promise<ParseResult> {
  switch (fileType) {
    case 'pdf':
      return parsePDF(filePath);
    case 'md':
    case 'markdown':
      return parseMarkdown(filePath);
    case 'txt':
      return parseText(filePath);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

// 解析 PDF 文件（带 OCR 检测）
async function parsePDF(filePath: string): Promise<ParseResult> {
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);

  // 快速提取结果
  const fastResult: ParseResult = {
    content: data.text,
    metadata: {
      title: data.info?.Title,
      author: data.info?.Author,
      pageCount: data.numpages,
      wordCount: data.text.split(/\s+/).filter(Boolean).length,
    },
  };

  // 检测是否可能是扫描件
  const avgCharsPerPage = data.text.length / (data.numpages || 1);
  const possibleScan = avgCharsPerPage < 100;

  // 如果可能是扫描件且 OCR 服务可用，尝试 OCR
  if (possibleScan && ragConfig.OCR_ENABLED) {
    try {
      const ocrAvailable = await isOCRServiceAvailable();
      if (ocrAvailable) {
        console.log(`[OCR] 检测到可能扫描件 (每页${Math.round(avgCharsPerPage)}字符)，启动 OCR`);

        const ocrResult = await processWithOCR(filePath);

        if (ocrResult.metadata.hasOcr && ocrResult.textBlocks.length > 0) {
          // OCR 成功，使用 OCR 结果
          const ocrContent = assembleOCRText(ocrResult);

          return {
            content: ocrContent,
            metadata: {
              ...fastResult.metadata,
              hasOcr: true,
              wordCount: ocrContent.split(/\s+/).filter(Boolean).length,
            },
          };
        }
      }
    } catch (error) {
      // OCR 失败，降级到快速提取结果
      console.warn('[OCR] OCR 处理失败，使用 pdf-parse 结果:', error instanceof Error ? error.message : error);
    }
  }

  return fastResult;
}

// 清理文本内容
export function cleanTextContent(content: string): string {
  // 移除多余空行
  let cleaned = content.replace(/\n{3,}/g, '\n\n');
  // 移除行首行尾空白
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');
  // 移除连续空格
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
  return cleaned.trim();
}