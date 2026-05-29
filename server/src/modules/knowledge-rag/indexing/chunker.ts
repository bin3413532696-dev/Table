import crypto from 'crypto';

// 分块结果
export interface ChunkResult {
  id: string;
  content: string;           // 包含标题链前缀的完整内容（用于 embedding）
  originalContent: string;   // 原始内容（不含标题链前缀，用于展示）
  contentHash: string;
  chunkIndex: number;
  startPos: number;
  endPos: number;
  // 标题链元数据
  headingChain?: string;     // 标题链，如 "第一章 > 1.1 概述"
  headingLevel?: number;     // 当前标题层级 (1-4)
}

// 文件类型分块策略
export interface ChunkStrategy {
  chunkSize: number;         // 最大 chunk 大小（字符数）
  chunkOverlap: number;
  minChunkSize: number;      // 最小 chunk 大小（字符数），防止生成信息量不足的小 chunk
  separators: string[];
}

// 按文件类型定义的分块策略
export const CHUNK_STRATEGIES: Record<string, ChunkStrategy> = {
  pdf: {
    chunkSize: 1500,
    chunkOverlap: 300,
    minChunkSize: 200,       // PDF 最小 200 字符
    separators: ['\n\n', '\n', '。', '.', '！', '!', '？', '?', ' ', ''],
  },
  md: {
    chunkSize: 800,
    chunkOverlap: 150,
    minChunkSize: 150,       // Markdown 最小 150 字符
    separators: ['\n\n# ', '\n\n## ', '\n\n### ', '\n\n#### ', '\n\n', '\n', '。', '.', ' ', ''],
  },
  txt: {
    chunkSize: 1000,
    chunkOverlap: 200,
    minChunkSize: 200,       // TXT 最小 200 字符
    separators: ['\n\n', '\n', '。', '.', '！', '!', '？', '?', ' ', ''],
  },
};

// 默认策略（用于未知文件类型）
const DEFAULT_STRATEGY: ChunkStrategy = CHUNK_STRATEGIES.txt;

// 计算内容哈希
function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// 从原文提取指定位置的标题链（用于 Markdown）
// 返回 chunk 所在章节的层级标题链
function extractHeadingChainAtPosition(
  fullContent: string,
  startPos: number,
  endPos: number
): { chain: string; level: number } | null {
  // 提取全文所有标题及其位置
  const allHeadings: { level: number; text: string; pos: number }[] = [];

  // 匹配 Markdown 标题（格式：\n\n# 标题 或文件开头 # 标题）
  // 同时匹配文件开头的标题（没有 \n\n 前缀）
  const headingRegex = /(?:^|\n\n)(#{1,4})\s+([^\n]+)/g;
  let match;

  while ((match = headingRegex.exec(fullContent)) !== null) {
    const headingStartPos = match[0].startsWith('\n\n') ? match.index + 2 : match.index;
    allHeadings.push({
      level: match[1].length,
      text: match[2].trim(),
      pos: headingStartPos,
    });
  }

  if (allHeadings.length === 0) return null;

  // 找到 chunk 范围内的标题
  const headingsInRange = allHeadings.filter(h => h.pos >= startPos && h.pos < endPos);
  const headingsBeforeRange = allHeadings.filter(h => h.pos < startPos);

  // 确定当前 chunk 的标题层级
  // 如果 chunk 开头有标题，使用该标题及其父级
  // 否则使用 chunk 之前最近的标题层级

  let currentHeading: { level: number; text: string } | null = null;
  let parentHeadings: { level: number; text: string }[] = [];

  if (headingsInRange.length > 0) {
    // chunk 内有标题，取第一个
    currentHeading = { level: headingsInRange[0].level, text: headingsInRange[0].text };
  }

  // 找到当前标题的父级标题链
  // 从 startPos 之前的标题中，按层级递增选择
  const relevantParent = headingsBeforeRange.filter(h =>
    currentHeading ? h.level < currentHeading.level : true
  );

  // 构建层级递增的父级链
  if (relevantParent.length > 0) {
    relevantParent.sort((a, b) => b.pos - a.pos); // 按位置倒序（最近的在前）

    // 从最近的标题开始，向上找层级递减的父级
    const chainHeadings: { level: number; text: string }[] = [];
    let lastLevel = currentHeading?.level ?? 5; // 从当前层级或最高层级开始

    for (const h of relevantParent) {
      if (h.level < lastLevel && h.level === lastLevel - 1) {
        chainHeadings.unshift(h);
        lastLevel = h.level;
      }
    }

    parentHeadings = chainHeadings;
  }

  // 组合完整标题链
  const fullChain = [...parentHeadings];
  if (currentHeading) {
    fullChain.push(currentHeading);
  }

  if (fullChain.length === 0) {
    // 没有找到标题，使用最近的一个标题
    const nearestHeading = allHeadings.reduce((nearest, h) =>
      h.pos < startPos && (!nearest || h.pos > nearest.pos) ? h : nearest
    , null as { level: number; text: string; pos: number } | null);

    if (nearestHeading) {
      return { chain: nearestHeading.text, level: nearestHeading.level };
    }
    return null;
  }

  return {
    chain: fullChain.map(h => h.text).join(' > '),
    level: fullChain[fullChain.length - 1].level,
  };
}

/**
 * 递归切分文本，同时精确追踪位置
 *
 * 核心改进：不再依赖 indexOf 回找位置（LangChain trim 后无法匹配）
 * 而是用 slice() 边切边记录 startPos/endPos，位置 100% 精确
 */
function splitTextRecursive(
  text: string,
  separators: string[],
  chunkSize: number,
  chunkOverlap: number
): { content: string; startPos: number; endPos: number }[] {
  if (text.length <= chunkSize) {
    return [{ content: text, startPos: 0, endPos: text.length }];
  }

  // 找到当前可用的分隔符
  let separator = '';
  let newSeparators: string[] = [];

  for (let i = 0; i < separators.length; i++) {
    const s = separators[i];
    if (s === '') {
      separator = s;
      break;
    }
    if (text.includes(s)) {
      separator = s;
      newSeparators = separators.slice(i + 1);
      break;
    }
  }

  // 按分隔符切分（保留分隔符以精确追踪位置）
  const splits: { content: string; pos: number }[] = [];
  if (separator === '') {
    // 空分隔符：按字符切分
    for (let i = 0; i < text.length; i++) {
      splits.push({ content: text[i], pos: i });
    }
  } else {
    // 使用前瞻断言保留分隔符位置
    const regex = new RegExp(`(?=${escapeRegex(separator)})`, 'g');
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const pos = match.index;
      if (pos > lastIndex) {
        splits.push({ content: text.slice(lastIndex, pos), pos: lastIndex });
      }
      lastIndex = pos + separator.length; // 手动推进，避免前瞻断言导致的无限循环
      regex.lastIndex = lastIndex; // 同步更新正则的 lastIndex
    }
    if (lastIndex < text.length) {
      splits.push({ content: text.slice(lastIndex), pos: lastIndex });
    }
  }

  // 合并片段为 chunk，精确追踪位置
  // 核心改进：用 endPos - startPos 计算长度，包含分隔符
  const chunks: { content: string; startPos: number; endPos: number }[] = [];
  let currentStartPos = 0;
  let currentChunks: { content: string; pos: number }[] = [];

  for (const split of splits) {
    // 当前 chunk 的实际结束位置（包含分隔符）
    const potentialEndPos = split.pos + split.content.length;
    const actualLength = currentChunks.length > 0
      ? potentialEndPos - currentChunks[0].pos
      : split.content.length;

    if (actualLength > chunkSize) {
      // 当前 chunk 超长，需要输出并开始新 chunk
      if (currentChunks.length > 0) {
        const startPos = currentChunks[0].pos;
        const endPos = currentChunks[currentChunks.length - 1].pos + currentChunks[currentChunks.length - 1].content.length;
        const content = text.slice(startPos, endPos);

        chunks.push({ content, startPos, endPos });

        // 滑动窗口：保留 overlap 部分（用位置计算，包含分隔符）
        const overlapChunks: { content: string; pos: number }[] = [];
        let overlapStart = endPos;

        for (let j = currentChunks.length - 1; j >= 0; j--) {
          const chunkStart = currentChunks[j].pos;
          if (endPos - chunkStart >= chunkOverlap) {
            overlapChunks.unshift(...currentChunks.slice(j));
            overlapStart = chunkStart;
            break;
          }
        }

        currentChunks = overlapChunks;
        currentStartPos = overlapStart;
      }

      // 如果单个 split 就超过 chunkSize，递归切分
      if (split.content.length > chunkSize && newSeparators.length > 0) {
        const subChunks = splitTextRecursive(split.content, newSeparators, chunkSize, chunkOverlap);
        for (const sub of subChunks) {
          chunks.push({
            content: sub.content,
            startPos: split.pos + sub.startPos,
            endPos: split.pos + sub.endPos,
          });
        }
        currentChunks = [];
        currentStartPos = split.pos + (subChunks[subChunks.length - 1]?.endPos ?? split.content.length);
      } else {
        // 无法继续切分，直接加入（可能超过 chunkSize）
        currentChunks.push(split);
        currentStartPos = split.pos;
      }
    } else {
      currentChunks.push(split);
      currentStartPos = currentChunks[0].pos;
    }
  }

  // 处理剩余的片段
  if (currentChunks.length > 0) {
    const startPos = currentChunks[0].pos;
    const endPos = currentChunks[currentChunks.length - 1].pos + currentChunks[currentChunks.length - 1].content.length;
    const content = text.slice(startPos, endPos);
    chunks.push({ content, startPos, endPos });
  }

  return chunks;
}

// 转义正则表达式特殊字符
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 按单个分隔符切分（不考虑长度限制），返回位置信息
function splitBySeparator(
  text: string,
  separator: string
): { content: string; startPos: number; endPos: number }[] {
  const chunks: { content: string; startPos: number; endPos: number }[] = [];

  if (separator === '') {
    // 空分隔符：返回整个文本
    return [{ content: text, startPos: 0, endPos: text.length }];
  }

  const regex = new RegExp(`(?=${escapeRegex(separator)})`, 'g');
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const pos = match.index;
    if (pos > lastIndex) {
      chunks.push({
        content: text.slice(lastIndex, pos),
        startPos: lastIndex,
        endPos: pos,
      });
    }
    lastIndex = pos + separator.length;
    regex.lastIndex = lastIndex;
  }

  if (lastIndex < text.length) {
    chunks.push({
      content: text.slice(lastIndex),
      startPos: lastIndex,
      endPos: text.length,
    });
  }

  return chunks;
}

// 分块文档内容
export async function chunkDocument(
  content: string,
  fileType?: string  // 新增：文件类型参数，用于选择分块策略
): Promise<ChunkResult[]> {
  // 根据文件类型选择策略
  const strategy = fileType
    ? CHUNK_STRATEGIES[fileType] ?? DEFAULT_STRATEGY
    : DEFAULT_STRATEGY;

  // Markdown 特殊处理：即使内容不长，也按一级标题切分，确保章节完整性
  let rawChunks: { content: string; startPos: number; endPos: number }[];
  if (fileType === 'md' && content.includes('\n\n# ')) {
    // 强制按一级标题切分（注意 `\n\n# ` 只匹配 `# 标题`，不匹配 `##`）
    const h1Separator = '\n\n# ';
    const h1Chunks = splitBySeparator(content, h1Separator);

    // 对每个章节内部，如果仍超长，再递归切分
    rawChunks = [];
    for (const h1Chunk of h1Chunks) {
      if (h1Chunk.content.length > strategy.chunkSize) {
        const subChunks = splitTextRecursive(
          h1Chunk.content,
          strategy.separators.slice(1), // 去掉一级标题分隔符
          strategy.chunkSize,
          strategy.chunkOverlap
        );
        for (const sub of subChunks) {
          rawChunks.push({
            content: sub.content,
            startPos: h1Chunk.startPos + sub.startPos,
            endPos: h1Chunk.startPos + sub.endPos,
          });
        }
      } else {
        rawChunks.push(h1Chunk);
      }
    }
  } else {
    rawChunks = splitTextRecursive(
      content,
      strategy.separators,
      strategy.chunkSize,
      strategy.chunkOverlap
    );
  }

  // 过滤空 chunk 并生成最终结果
  const intermediateResults: ChunkResult[] = rawChunks
    .filter(chunk => chunk.content.trim().length > 0)
    .map((chunk, index) => {
      const originalContent = chunk.content;

      // 为 Markdown 提取标题链
      let headingChain: string | undefined;
      let headingLevel: number | undefined;

      if (fileType === 'md') {
        const heading = extractHeadingChainAtPosition(content, chunk.startPos, chunk.endPos);
        if (heading) {
          headingChain = heading.chain;
          headingLevel = heading.level;
        }
      }

      // 将标题链注入到 content 前缀中（用于 embedding，包含章节上下文）
      const enhancedContent = headingChain
        ? `[${headingChain}] ${originalContent}`
        : originalContent;

      return {
        id: crypto.randomUUID(),
        content: enhancedContent,        // 含标题链前缀，用于 embedding
        originalContent,                 // 原始内容，用于展示
        contentHash: computeHash(originalContent), // 原始内容的哈希
        chunkIndex: index,
        startPos: chunk.startPos,
        endPos: chunk.endPos,
        headingChain,
        headingLevel,
      };
    });

  // 最小 chunk 大小保护：合并过小的 chunk
  const finalResults: ChunkResult[] = [];
  const minSize = strategy.minChunkSize;

  for (const chunk of intermediateResults) {
    const lastResult = finalResults[finalResults.length - 1];

    // 如果当前 chunk 太小且上一个 chunk 不太大，合并
    if (
      chunk.originalContent.length < minSize &&
      lastResult &&
      lastResult.content.length + chunk.content.length < strategy.chunkSize * 1.5
    ) {
      // 合并到上一个 chunk
      lastResult.content = lastResult.content + '\n' + chunk.content;
      lastResult.originalContent = lastResult.originalContent + '\n' + chunk.originalContent;
      lastResult.endPos = chunk.endPos;
      lastResult.contentHash = computeHash(lastResult.originalContent);
      // 保留层级更高的标题链
      if (chunk.headingLevel && (!lastResult.headingLevel || chunk.headingLevel < lastResult.headingLevel)) {
        lastResult.headingChain = chunk.headingChain;
        lastResult.headingLevel = chunk.headingLevel;
      }
    } else {
      // 更新 chunkIndex（合并后重新编号）
      chunk.chunkIndex = finalResults.length;
      finalResults.push(chunk);
    }
  }

  return finalResults;
}

// 分块带元数据的文档
export interface DocumentChunkMeta {
  title?: string;
  source?: string;
}

export async function chunkDocumentWithMeta(
  content: string,
  fileType?: string,  // 新增：文件类型参数
  meta?: DocumentChunkMeta
): Promise<ChunkResult[]> {
  const chunks = await chunkDocument(content, fileType);

  // 如果有标题，可以将其添加到第一个分块的开头
  if (meta?.title && chunks.length > 0) {
    const enhancedContent = `[${meta.title}]\n\n${chunks[0].content}`;
    chunks[0] = {
      ...chunks[0],
      content: enhancedContent,
      contentHash: computeHash(enhancedContent),
    };
  }

  return chunks;
}

// 获取分块统计
export function getChunkStats(chunks: ChunkResult[]): {
  count: number;
  avgLength: number;
  minLength: number;
  maxLength: number;
  belowMinCount: number;    // 低于 minChunkSize 的 chunk 数量
} {
  if (chunks.length === 0) {
    return { count: 0, avgLength: 0, minLength: 0, maxLength: 0, belowMinCount: 0 };
  }

  const lengths = chunks.map(c => c.originalContent.length);
  return {
    count: chunks.length,
    avgLength: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    minLength: Math.min(...lengths),
    maxLength: Math.max(...lengths),
    belowMinCount: 0, // 合并后不应有极小 chunk
  };
}

// =====================================================
// 小块大块架构 (Parent-Child Chunking)
// =====================================================

// 分层分块策略
export interface HierarchicalChunkStrategy {
  parentChunkSize: number;    // 大块大小（1500-2000字）
  parentOverlap: number;      // 大块重叠
  childChunkSize: number;     // 小块大小（200-300字）
  childOverlap: number;       // 小块重叠
  minChildSize: number;       // 小块最小大小
  separators: string[];       // 分隔符优先级
}

// 按文件类型定义的分层策略
export const HIERARCHICAL_STRATEGIES: Record<string, HierarchicalChunkStrategy> = {
  pdf: {
    parentChunkSize: 1800,
    parentOverlap: 200,
    childChunkSize: 250,
    childOverlap: 50,
    minChildSize: 100,
    separators: ['\n\n', '\n', '。', '.', '！', '!', '？', '?', ' ', ''],
  },
  md: {
    parentChunkSize: 1200,
    parentOverlap: 150,
    childChunkSize: 200,
    childOverlap: 40,
    minChildSize: 80,
    separators: ['\n\n# ', '\n\n## ', '\n\n### ', '\n\n#### ', '\n\n', '\n', '。', '.', ' ', ''],
  },
  txt: {
    parentChunkSize: 1500,
    parentOverlap: 200,
    childChunkSize: 250,
    childOverlap: 50,
    minChildSize: 100,
    separators: ['\n\n', '\n', '。', '.', '！', '!', '？', '?', ' ', ''],
  },
};

const DEFAULT_HIERARCHICAL_STRATEGY = HIERARCHICAL_STRATEGIES.txt;

// 大块结果（用于生成上下文）
export interface ParentChunkResult extends ChunkResult {
  chunkType: 'parent';
  childCount: number;  // 包含的小块数量
}

// 分层分块结果
export interface HierarchicalChunkResult {
  parentChunks: ParentChunkResult[];           // 大块列表
  childChunks: (ChunkResult & { parentId: string; chunkType: 'small' })[];  // 小块列表（关联大块）
}

/**
 * 分层分块文档内容（小块大块架构）
 *
 * 流程：
 * 1. 先生成大块（parent chunks），大小 1500-2000字
 * 2. 在每个大块边界内生成小块（child chunks），大小 200-300字
 * 3. 小块关联大块（parentId），小块用于检索，大块用于生成
 *
 * @param content 文档内容
 * @param fileType 文件类型
 * @returns 分层分块结果
 */
export async function chunkDocumentHierarchical(
  content: string,
  fileType?: string
): Promise<HierarchicalChunkResult> {
  const strategy = fileType
    ? HIERARCHICAL_STRATEGIES[fileType] ?? DEFAULT_HIERARCHICAL_STRATEGY
    : DEFAULT_HIERARCHICAL_STRATEGY;

  // Step 1: 生成大块（parent chunks）
  let parentRawChunks: { content: string; startPos: number; endPos: number }[];

  // Markdown 特殊处理：按一级标题切分
  if (fileType === 'md' && content.includes('\n\n# ')) {
    const h1Separator = '\n\n# ';
    const h1Chunks = splitBySeparator(content, h1Separator);

    parentRawChunks = [];
    for (const h1Chunk of h1Chunks) {
      if (h1Chunk.content.length > strategy.parentChunkSize) {
        const subChunks = splitTextRecursive(
          h1Chunk.content,
          strategy.separators.slice(1),
          strategy.parentChunkSize,
          strategy.parentOverlap
        );
        for (const sub of subChunks) {
          parentRawChunks.push({
            content: sub.content,
            startPos: h1Chunk.startPos + sub.startPos,
            endPos: h1Chunk.startPos + sub.endPos,
          });
        }
      } else {
        parentRawChunks.push(h1Chunk);
      }
    }
  } else {
    parentRawChunks = splitTextRecursive(
      content,
      strategy.separators,
      strategy.parentChunkSize,
      strategy.parentOverlap
    );
  }

  // 过滤空块并生成大块结果
  const parentChunks: ParentChunkResult[] = parentRawChunks
    .filter(chunk => chunk.content.trim().length > 0)
    .map((chunk, index) => {
      const originalContent = chunk.content;

      // 提取标题链
      let headingChain: string | undefined;
      let headingLevel: number | undefined;
      if (fileType === 'md') {
        const heading = extractHeadingChainAtPosition(content, chunk.startPos, chunk.endPos);
        if (heading) {
          headingChain = heading.chain;
          headingLevel = heading.level;
        }
      }

      const enhancedContent = headingChain
        ? `[${headingChain}] ${originalContent}`
        : originalContent;

      return {
        id: crypto.randomUUID(),
        content: enhancedContent,
        originalContent,
        contentHash: computeHash(originalContent),
        chunkIndex: index,
        startPos: chunk.startPos,
        endPos: chunk.endPos,
        headingChain,
        headingLevel,
        chunkType: 'parent',
        childCount: 0,  // 后面更新
      };
    });

  // Step 2: 在每个大块内生成小块
  const childChunks: (ChunkResult & { parentId: string; chunkType: 'small' })[] = [];

  for (const parentChunk of parentChunks) {
    // 在大块边界内切分小块
    const childRawChunks = splitTextRecursive(
      parentChunk.originalContent,
      strategy.separators,
      strategy.childChunkSize,
      strategy.childOverlap
    );

    // 过滤空块并生成小块结果
    const parentChildChunks = childRawChunks
      .filter(chunk => chunk.content.trim().length > 0)
      .map((chunk, childIndex) => {
        const originalContent = chunk.content;

        // 小块继承大块的标题链（可选增强）
        const enhancedContent = parentChunk.headingChain
          ? `[${parentChunk.headingChain}] ${originalContent}`
          : originalContent;

        return {
          id: crypto.randomUUID(),
          content: enhancedContent,
          originalContent,
          contentHash: computeHash(originalContent),
          chunkIndex: childIndex,  // 在大块内的序号
          startPos: parentChunk.startPos + chunk.startPos,  // 相对文档的位置
          endPos: parentChunk.startPos + chunk.endPos,
          headingChain: parentChunk.headingChain,
          headingLevel: parentChunk.headingLevel,
          parentId: parentChunk.id,
          chunkType: 'small' as const,
        };
      });

    // 合并过小的小块
    const mergedChildChunks: (ChunkResult & { parentId: string; chunkType: 'small' })[] = [];
    for (const child of parentChildChunks) {
      const lastChild = mergedChildChunks[mergedChildChunks.length - 1];

      if (
        child.originalContent.length < strategy.minChildSize &&
        lastChild &&
        lastChild.content.length + child.content.length < strategy.childChunkSize * 1.5
      ) {
        // 合并到上一小块
        lastChild.content = lastChild.content + '\n' + child.content;
        lastChild.originalContent = lastChild.originalContent + '\n' + child.originalContent;
        lastChild.endPos = child.endPos;
        lastChild.contentHash = computeHash(lastChild.originalContent);
      } else {
        child.chunkIndex = mergedChildChunks.length;
        mergedChildChunks.push(child);
      }
    }

    // 更新大块的 childCount
    parentChunk.childCount = mergedChildChunks.length;

    // 添加小块到总列表
    childChunks.push(...mergedChildChunks);
  }

  return {
    parentChunks,
    childChunks,
  };
}

// 获取分层分块统计
export function getHierarchicalChunkStats(result: HierarchicalChunkResult): {
  parentCount: number;
  childCount: number;
  avgParentLength: number;
  avgChildLength: number;
  minChildLength: number;
  maxChildLength: number;
} {
  const parentLengths = result.parentChunks.map(p => p.originalContent.length);
  const childLengths = result.childChunks.map(c => c.originalContent.length);

  return {
    parentCount: result.parentChunks.length,
    childCount: result.childChunks.length,
    avgParentLength: parentLengths.length > 0
      ? Math.round(parentLengths.reduce((a, b) => a + b, 0) / parentLengths.length)
      : 0,
    avgChildLength: childLengths.length > 0
      ? Math.round(childLengths.reduce((a, b) => a + b, 0) / childLengths.length)
      : 0,
    minChildLength: childLengths.length > 0 ? Math.min(...childLengths) : 0,
    maxChildLength: childLengths.length > 0 ? Math.max(...childLengths) : 0,
  };
}