/**
 * 文档元数据提取服务
 *
 * 提取结构化元数据：
 * - publishDate: 发布日期（PDF元数据 → 内容正则 → 文件名）
 * - sourceDept: 来源部门（关键词匹配 → LLM分类）
 * - securityLevel: 保密等级（关键词检测）
 * - businessCategory: 业务分类（LLM分类）
 */

import type { ParseResult } from './document-parser';
import { createChatModel } from '../../agent/langgraph/chatModel';
import { getRequiredActiveProviderForCurrentUser } from '../../providers/service';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

// =====================================================
// 类型定义
// =====================================================

export interface ExtractedMetadata {
  publishDate: Date | null;
  sourceDept: string | null;
  securityLevel: string;
  businessCategory: string | null;
  docLanguage: string;
  confidence: {
    publishDate: number;
    sourceDept: number;
    securityLevel: number;
    businessCategory: number;
  };
}

export interface MetadataExtractionOptions {
  title: string;
  content: string;
  parseResult: ParseResult;
  filename: string;
  useLlm?: boolean;
}

// =====================================================
// 部门关键词映射
// =====================================================

const DEPT_KEYWORDS: Record<string, string[]> = {
  '技术部': ['技术', '研发', '开发', 'IT', '软件', '工程', '架构', '代码', '系统', '平台', '算法', '数据', '测试', '运维', '部署'],
  '财务部': ['财务', '会计', '审计', '预算', '报销', '成本', '资金', '税务', '发票', '账务', '核算', '利润', '收支'],
  '人力资源部': ['人事', 'HR', '招聘', '员工', '薪酬', '绩效', '培训', '福利', '离职', '入职', '考勤', '组织'],
  '市场部': ['市场', '营销', '推广', '品牌', '广告', '公关', '宣传', '活动', '渠道', '客户', '运营', '销售'],
  '运营部': ['运营', '业务', '服务', '支持', '客服', '流程', '管理', '协调', '执行'],
  '法务部': ['法务', '法律', '合规', '合同', '律师', '诉讼', '知识产权', '版权', '专利', '风险'],
  '行政部': ['行政', '办公室', '综合', '后勤', '采购', '物资', '资产', '档案', '会议', '接待'],
  '产品部': ['产品', '需求', '用户', '功能', '迭代', '版本', '规划', '路线', '体验', '设计'],
  '战略部': ['战略', '规划', '发展', '投资', '并购', '分析', '研究', '报告', '洞察'],
};

// =====================================================
// 保密等级关键词
// =====================================================

const SECURITY_KEYWORDS: Record<string, { keywords: string[]; confidence: number }> = {
  'secret': {
    keywords: ['绝密', '机密文件', '核心机密', '最高机密', 'TOP SECRET', '绝密级'],
    confidence: 0.95,
  },
  'confidential': {
    keywords: ['机密', '保密', '内部机密', 'CONFIDENTIAL', '仅限内部', '机密级', '秘密'],
    confidence: 0.85,
  },
  'internal': {
    keywords: ['内部', '仅供内部', '内部文件', '员工专用', 'INTERNAL', '内部级'],
    confidence: 0.75,
  },
  'public': {
    keywords: ['公开', '对外发布', 'PUBLIC', '可公开', '公开级'],
    confidence: 0.80,
  },
};

const DEFAULT_SECURITY_LEVEL = 'internal';

// =====================================================
// 业务分类枚举
// =====================================================

export const BUSINESS_TAXONOMY = [
  '规章制度',
  '技术文档',
  '财务报告',
  '会议纪要',
  '合同协议',
  '通知公告',
  '操作手册',
  '项目文档',
  '培训资料',
  '研究报告',
  '其他',
];

// =====================================================
// 日期正则模式
// =====================================================

const DATE_PATTERNS = [
  // 中文: 2024年1月15日, 2024年01月15日
  { pattern: /(\d{4})年(\d{1,2})月(\d{1,2})日/g, format: 'zh' },
  // 英文完整: January 15, 2024, Jan 15, 2024
  { pattern: /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/gi, format: 'en_full' },
  // 英文缩写: Jan 15, 2024
  { pattern: /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})/gi, format: 'en_short' },
  // ISO: 2024-01-15
  { pattern: /(\d{4})-(\d{2})-(\d{2})/g, format: 'iso' },
  // Slash: 2024/01/15, 2024/1/15
  { pattern: /(\d{4})\/(\d{1,2})\/(\d{1,2})/g, format: 'slash' },
  // 中文简写: 2024.1.15, 2024.01.15
  { pattern: /(\d{4})\.(\d{1,2})\.(\d{1,2})/g, format: 'zh_short' },
];

const MONTH_MAP_EN: Record<string, number> = {
  'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
  'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8,
  'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
};

// =====================================================
// 语言检测
// =====================================================

function detectLanguage(content: string): string {
  const chineseCharCount = (content.match(/[一-鿿㐀-䶿]/g) || []).length;
  const totalCharCount = content.length;

  if (totalCharCount === 0) return 'zh';

  const chineseRatio = chineseCharCount / totalCharCount;

  if (chineseRatio > 0.3) return 'zh';
  if (chineseRatio > 0.1) return 'zh_en';

  // 检测英文
  const englishWordCount = (content.match(/[a-zA-Z]+/g) || []).length;
  if (englishWordCount > totalCharCount * 0.1) return 'en';

  return 'zh';
}

// =====================================================
// 日期提取
// =====================================================

function extractDateFromPdfMetadata(metadata: ParseResult['metadata']): Date | null {
  // pdf-parse 的 info 对象可能包含 CreationDate 或 ModDate
  const rawInfo = (metadata as any).rawInfo || {};
  const creationDate = rawInfo.CreationDate || rawInfo['CreationDate'];

  if (creationDate) {
    // PDF 日期格式: D:20240115120000 或类似
    if (typeof creationDate === 'string' && creationDate.startsWith('D:')) {
      const dateStr = creationDate.slice(2);
      const year = parseInt(dateStr.slice(0, 4), 10);
      const month = parseInt(dateStr.slice(4, 6), 10);
      const day = parseInt(dateStr.slice(6, 8), 10);
      if (year > 1970 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return new Date(year, month - 1, day);
      }
    }
  }

  return null;
}

function extractDateFromContent(content: string): Date | null {
  // 只分析前5000字符（通常日期在文档开头）
  const searchContent = content.slice(0, 5000);

  for (const { pattern, format } of DATE_PATTERNS) {
    const matches = searchContent.matchAll(pattern);
    for (const match of matches) {
      try {
        let year: number | undefined, month: number | undefined, day: number | undefined;

        if (format === 'zh' || format === 'zh_short' || format === 'iso' || format === 'slash') {
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10);
          day = parseInt(match[3], 10);
        } else if (format === 'en_full' || format === 'en_short') {
          const monthName = match[1].toLowerCase();
          month = MONTH_MAP_EN[monthName] || 1;
          day = parseInt(match[2], 10);
          year = parseInt(match[3], 10);
        }

        // 验证日期有效性
        if (year !== undefined && month !== undefined && day !== undefined &&
            year >= 1970 && year <= new Date().getFullYear() + 1 &&
            month >= 1 && month <= 12 &&
            day >= 1 && day <= 31) {
          return new Date(year, month - 1, day);
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function extractDateFromFilename(filename: string): Date | null {
  // 从文件名提取日期: 2024-01-15_report.pdf, 20240115_report.pdf
  const patterns = [
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{4})(\d{2})(\d{2})/,
    /(\d{4})\.(\d{2})\.(\d{2})/,
    /(\d{4})\/(\d{2})\/(\d{2})/,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);

      if (year >= 1970 && year <= new Date().getFullYear() + 1 &&
          month >= 1 && month <= 12 &&
          day >= 1 && day <= 31) {
        return new Date(year, month - 1, day);
      }
    }
  }

  return null;
}

export function extractPublishDate(
  metadata: ParseResult['metadata'],
  content: string,
  filename: string
): { date: Date | null; source: string; confidence: number } {
  // 优先级 1: PDF 元数据
  const pdfDate = extractDateFromPdfMetadata(metadata);
  if (pdfDate) {
    return { date: pdfDate, source: 'pdf_metadata', confidence: 0.9 };
  }

  // 优先级 2: 内容正则匹配
  const contentDate = extractDateFromContent(content);
  if (contentDate) {
    return { date: contentDate, source: 'content_pattern', confidence: 0.7 };
  }

  // 优先级 3: 文件名
  const filenameDate = extractDateFromFilename(filename);
  if (filenameDate) {
    return { date: filenameDate, source: 'filename', confidence: 0.5 };
  }

  return { date: null, source: 'none', confidence: 0 };
}

// =====================================================
// 部门提取（关键词匹配）
// =====================================================

export function extractSourceDeptByKeywords(title: string, content: string): { dept: string | null; confidence: number } {
  const searchContent = `${title} ${content.slice(0, 2000)}`;

  const deptScores: Record<string, number> = {};

  for (const [dept, keywords] of Object.entries(DEPT_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const count = (searchContent.match(new RegExp(keyword, 'gi')) || []).length;
      score += count;
    }
    if (score > 0) {
      deptScores[dept] = score;
    }
  }

  if (Object.keys(deptScores).length === 0) {
    return { dept: null, confidence: 0 };
  }

  // 选择得分最高的部门
  const sortedDepts = Object.entries(deptScores).sort((a, b) => b[1] - a[1]);
  const topDept = sortedDepts[0][0];
  const topScore = sortedDepts[0][1];
  const totalScore = sortedDepts.reduce((sum, [, score]) => sum + score, 0);

  // 置信度 = 最高得分占比
  const confidence = totalScore > 0 ? topScore / totalScore : 0;

  return { dept: topDept, confidence: Math.min(confidence, 0.8) };
}

// =====================================================
// 保密等级提取
// =====================================================

export function extractSecurityLevel(title: string, content: string): { level: string; confidence: number } {
  const searchContent = `${title} ${content.slice(0, 3000)}`;

  for (const [level, config] of Object.entries(SECURITY_KEYWORDS)) {
    for (const keyword of config.keywords) {
      if (searchContent.includes(keyword)) {
        return { level, confidence: config.confidence };
      }
    }
  }

  return { level: DEFAULT_SECURITY_LEVEL, confidence: 0.5 };
}

// =====================================================
// LLM 分类提取
// =====================================================

const DEPT_CLASSIFICATION_PROMPT = `分析以下文档内容，判断该文档最可能来自哪个部门。

可选部门：技术部、财务部、人力资源部、市场部、运营部、法务部、行政部、产品部、战略部

如果无法确定，返回 "未知"。

文档标题：{title}
文档内容摘要：{summary}

请只返回部门名称，不要解释。`;

const CATEGORY_CLASSIFICATION_PROMPT = `分析以下文档内容，判断其业务分类。

可选分类：规章制度、技术文档、财务报告、会议纪要、合同协议、通知公告、操作手册、项目文档、培训资料、研究报告、其他

文档标题：{title}
文档内容摘要：{summary}

请只返回分类名称，不要解释。`;

async function classifyWithLlm(
  prompt: string,
  title: string,
  summary: string,
  provider: {
    id: string;
    name: string;
    apiFormat: 'anthropic' | 'openai' | 'gemini' | 'custom';
    baseUrl: string;
    apiKey: string;
    model?: string;
    headers?: Record<string, string>;
  }
): Promise<string | null> {
  try {
    const chatModel = createChatModel(
      {
        id: provider.id,
        name: provider.name,
        apiFormat: provider.apiFormat,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        headers: provider.headers,
      },
      provider.model || 'default'
    );

    const fullPrompt = prompt.replace('{title}', title).replace('{summary}', summary);

    const response = await chatModel.invoke([
      new SystemMessage('你是一个文档分类助手，只返回分类结果，不要解释。'),
      new HumanMessage(fullPrompt),
    ]);

    const content = response.content;
    if (typeof content === 'string') {
      return content.trim();
    }

    return null;
  } catch (error) {
    console.error('[MetadataExtractor] LLM classification failed:', error);
    return null;
  }
}

// =====================================================
// 主提取函数
// =====================================================

export async function extractMetadata(options: MetadataExtractionOptions): Promise<ExtractedMetadata> {
  const { title, content, parseResult, filename, useLlm = true } = options;

  // 1. 语言检测
  const docLanguage = detectLanguage(content);

  // 2. 发布日期提取
  const dateResult = extractPublishDate(parseResult.metadata, content, filename);

  // 3. 保密等级提取（关键词检测）
  const securityResult = extractSecurityLevel(title, content);

  // 4. 来源部门提取（先关键词，再 LLM）
  let deptResult = extractSourceDeptByKeywords(title, content);
  let sourceDept = deptResult.dept;
  let deptConfidence = deptResult.confidence;

  // 5. 业务分类提取（LLM）
  let businessCategory: string | null = null;
  let categoryConfidence = 0;

  // 如果启用 LLM 且关键词匹配置信度较低，使用 LLM 补充
  if (useLlm && (deptConfidence < 0.6 || !sourceDept)) {
    try {
      const provider = await getRequiredActiveProviderForCurrentUser();
      const summary = content.slice(0, 1000);

      // LLM 部门分类
      if (!sourceDept || deptConfidence < 0.6) {
        const llmDept = await classifyWithLlm(DEPT_CLASSIFICATION_PROMPT, title, summary, provider);
        if (llmDept && llmDept !== '未知') {
          sourceDept = llmDept;
          deptConfidence = 0.85;
        }
      }

      // LLM 业务分类
      const llmCategory = await classifyWithLlm(CATEGORY_CLASSIFICATION_PROMPT, title, summary, provider);
      if (llmCategory && BUSINESS_TAXONOMY.includes(llmCategory)) {
        businessCategory = llmCategory;
        categoryConfidence = 0.8;
      }
    } catch (error) {
      console.warn('[MetadataExtractor] LLM extraction skipped:', error instanceof Error ? error.message : error);
    }
  }

  return {
    publishDate: dateResult.date,
    sourceDept,
    securityLevel: securityResult.level,
    businessCategory,
    docLanguage,
    confidence: {
      publishDate: dateResult.confidence,
      sourceDept: deptConfidence,
      securityLevel: securityResult.confidence,
      businessCategory: categoryConfidence,
    },
  };
}

// =====================================================
// 批量提取（不使用 LLM，用于回填）
// =====================================================

export function extractMetadataFast(options: MetadataExtractionOptions): ExtractedMetadata {
  const { title, content, parseResult, filename } = options;

  const docLanguage = detectLanguage(content);
  const dateResult = extractPublishDate(parseResult.metadata, content, filename);
  const securityResult = extractSecurityLevel(title, content);
  const deptResult = extractSourceDeptByKeywords(title, content);

  return {
    publishDate: dateResult.date,
    sourceDept: deptResult.dept,
    securityLevel: securityResult.level,
    businessCategory: null,
    docLanguage,
    confidence: {
      publishDate: dateResult.confidence,
      sourceDept: deptResult.confidence,
      securityLevel: securityResult.confidence,
      businessCategory: 0,
    },
  };
}