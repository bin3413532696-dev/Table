/**
 * 文档文本清洗服务
 *
 * 清洗流水线：
 * 1. Unicode 规范化 (NFKC)     ← 全角→半角、合字拆分
 * 2. 控制字符清理              ← \x00-\x08, \x0B-\x0C, \x0E-\x1F
 * 3. 页眉页脚检测与移除         ← 重复行频率分析
 * 4. 页码移除                  ← 中英文页码正则
 * 5. OCR 噪音清理              ← 常见识别错误模式
 * 6. 最终整理                  ← 空行/空格压缩
 */

import { cleanTextContent } from './document-parser';

// =====================================================
// 类型定义
// =====================================================

export interface CleaningResult {
  cleanedText: string;
  qualityScore: number;        // 0-1, 越高越好
  removedSections: string[];   // 被移除的内容摘要
  stats: {
    originalLength: number;
    cleanedLength: number;
    removedChars: number;
    headerFooterLines: number;
    pageNumbersRemoved: number;
  };
}

// =====================================================
// 页码正则模式
// =====================================================

const PAGE_NUMBER_PATTERNS = [
  /第\s*\d+\s*页/g,                       // 中文: 第1页, 第 2 页
  /第\s*\d+\s*页\s*共\s*\d+\s*页/g,        // 中文: 第1页共5页
  /Page\s*\d+\s*of\s*\d+/gi,              // 英文: Page 1 of 5
  /Page\s*\d+/gi,                         // 英文: Page 1
  /-\s*\d+\s*-/g,                         // 格式: - 1 -
  /\[\s*页\s*\d+\s*\]/g,                   // 格式: [页 1]
  /\[\s*\d+\s*\]/g,                        // 格式: [1]
];

// =====================================================
// OCR 噪音模式
// =====================================================

const OCR_NOISE_PATTERNS = [
  /\s*[|]{2,}\s*/g,           // 多竖线: || |||
  /\s*[~]{3,}\s*/g,           // 多波浪线: ~~~
  /\s*[-]{3,}\s*/g,           // 多横线: ---
  /\s*[=]{3,}\s*/g,           // 多等号: ===
  /[^\S\n]{5,}/g,             // 超长空白（非换行）
  /\.{3,}/g,                  // 多点: ......
  /[^\x00-\x7F一-鿿　-〿＀-￯]{2,}/g,  // 连续非常见字符
];

// =====================================================
// 页眉页脚检测
// =====================================================

/**
 * 检测并移除页眉页脚
 *
 * 原理：页眉/页脚通常在每页顶部/底部出现，内容重复
 * 分析跨页重复的行，移除出现频率超过阈值的行
 */
function removeHeaderFooter(text: string): { text: string; removedLines: string[] } {
  // 按换页符(\f)分割页面
  const pages = text.split(/\f/);

  if (pages.length < 3) {
    // 少于3页无法可靠检测
    return { text, removedLines: [] };
  }

  // 统计每行出现频率（只检查每页的前3行和后3行）
  const lineFreq = new Map<string, { count: number; lines: string[] }>();

  for (const page of pages) {
    const lines = page.split('\n');
    // 前N行（页眉候选）
    const headerLines = lines.slice(0, 3).map(l => l.trim().toLowerCase());
    // 后N行（页脚候选）
    const footerLines = lines.slice(-3).map(l => l.trim().toLowerCase());

    for (const line of [...headerLines, ...footerLines]) {
      // 只统计有意义长度（太短或太长都不太可能是页眉页脚）
      if (line.length > 3 && line.length < 100) {
        const existing = lineFreq.get(line);
        if (existing) {
          existing.count++;
        } else {
          lineFreq.set(line, { count: 1, lines: [] });
        }
      }
    }
  }

  // 出现在 30%+ 页面的行视为页眉/页脚
  const threshold = Math.ceil(pages.length * 0.3);
  const noiseLines = new Set<string>();
  const removedOriginals: string[] = [];

  for (const [line, data] of lineFreq.entries()) {
    if (data.count >= threshold) {
      noiseLines.add(line);
      // 记录原始形式（用于报告）
      removedOriginals.push(line);
    }
  }

  if (noiseLines.size === 0) {
    return { text, removedLines: [] };
  }

  // 移除这些行
  const cleanedPages = pages.map(page => {
    const lines = page.split('\n');
    return lines.filter(line => {
      const normalized = line.trim().toLowerCase();
      return !noiseLines.has(normalized);
    }).join('\n');
  });

  return {
    text: cleanedPages.join('\f'),
    removedLines: removedOriginals.slice(0, 10),  // 只报告前10个
  };
}

// =====================================================
// 页码移除
// =====================================================

function removePageNumbers(text: string): { text: string; count: number } {
  let cleaned = text;
  let totalCount = 0;

  for (const pattern of PAGE_NUMBER_PATTERNS) {
    const matches = cleaned.match(pattern);
    if (matches) {
      totalCount += matches.length;
    }
    cleaned = cleaned.replace(pattern, '');
  }

  return { text: cleaned, count: totalCount };
}

// =====================================================
// OCR 噪音清理
// =====================================================

function removeOCRNoise(text: string): string {
  let cleaned = text;

  for (const pattern of OCR_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ');
  }

  // 修复常见 OCR 错误模式
  // 字母 o/O 混淆为数字 0
  cleaned = cleaned.replace(/(?<=\d)o(?=\d)/g, '0');
  cleaned = cleaned.replace(/(?<=\d)O(?=\d)/g, '0');

  // 字母 l/I 混淆为数字 1
  cleaned = cleaned.replace(/(?<=\d)l(?=\d)/g, '1');
  cleaned = cleaned.replace(/(?<=\d)I(?=\d)/g, '1');

  return cleaned;
}

// =====================================================
// 质量评分计算
// =====================================================

/**
 * 计算清洗后的文本质量分数
 *
 * 考虑因素：
 * - 文本保留比例（不应过度清洗）
 * - 有效字符密度
 * - 中文/英文比例
 */
function calculateQualityScore(cleanedText: string, originalText: string): number {
  if (originalText.length === 0) return 1;

  // 保留比例（不低于 50% 为正常）
  const retentionRatio = cleanedText.length / originalText.length;
  if (retentionRatio < 0.3) {
    // 过度清洗，可能有问题
    return 0.3;
  }

  // 有效字符密度（非空白字符占比）
  const effectiveChars = cleanedText.replace(/\s+/g, '').length;
  const density = effectiveChars / cleanedText.length;

  // 中文字符检测
  const chineseChars = (cleanedText.match(/[一-鿿㐀-䶿]/g) || []).length;
  const englishChars = (cleanedText.match(/[a-zA-Z]/g) || []).length;
  const validChars = chineseChars + englishChars;
  const validRatio = validChars / effectiveChars;

  // 综合评分
  // retentionRatio: 保留比例权重 0.3
  // density: 有效字符密度权重 0.3
  // validRatio: 有效字符占比权重 0.4
  const score =
    Math.min(retentionRatio, 1) * 0.3 +
    density * 0.3 +
    Math.min(validRatio, 1) * 0.4;

  return Math.max(0, Math.min(1, score));
}

// =====================================================
// 主清洗函数
// =====================================================

/**
 * 清洗文档文本
 *
 * @param rawText 原始文本
 * @returns 清洗结果（清理后的文本、质量评分、移除的内容摘要）
 */
export function cleanDocumentText(rawText: string): CleaningResult {
  const originalLength = rawText.length;
  let text = rawText;
  const removedSections: string[] = [];
  let headerFooterLines = 0;
  let pageNumbersRemoved = 0;

  // 1. Unicode NFKC 规范化（全角→半角、合字拆分）
  text = text.normalize('NFKC');

  // 2. 控制字符清理（保留 \n \r \t 和常见空白）
  // 移除: \x00-\x08 (NUL-BS), \x0B (VT), \x0C (FF), \x0E-\x1F (SO-US)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // 3. 页眉页脚检测与移除
  const hfResult = removeHeaderFooter(text);
  text = hfResult.text;
  headerFooterLines = hfResult.removedLines.length;
  if (hfResult.removedLines.length > 0) {
    removedSections.push(`页眉页脚: ${hfResult.removedLines.join(', ')}`);
  }

  // 4. 页码移除
  const pnResult = removePageNumbers(text);
  text = pnResult.text;
  pageNumbersRemoved = pnResult.count;
  if (pnResult.count > 0) {
    removedSections.push(`页码: ${pnResult.count}处`);
  }

  // 5. OCR 噪音清理
  text = removeOCRNoise(text);

  // 6. 最终整理（复用现有 cleanTextContent）
  text = cleanTextContent(text);

  const cleanedLength = text.length;
  const qualityScore = calculateQualityScore(text, rawText);

  return {
    cleanedText: text,
    qualityScore,
    removedSections,
    stats: {
      originalLength,
      cleanedLength,
      removedChars: originalLength - cleanedLength,
      headerFooterLines,
      pageNumbersRemoved,
    },
  };
}

/**
 * 根据质量评分确定解析质量等级
 */
export function getParseQualityLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}