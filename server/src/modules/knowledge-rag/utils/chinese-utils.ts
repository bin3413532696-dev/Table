// 中文处理工具函数

// =====================================================
// 基础常量定义
// =====================================================

// 中文 Unicode 范围：基本汉字 U+4E00 - U+9FFF，扩展汉字 U+3400 - U+4DBF 等
const CHINESE_REGEX = /[一-鿿㐀-䶿]/;

// 常见中文词汇列表（高频词汇优先）
// 用于提升分词质量，避免将完整词汇拆成单字
const COMMON_CHINESE_WORDS = new Set([
  // 技术相关
  '人工智能', '机器学习', '深度学习', '神经网络', '自然语言', '计算机', '算法', '数据', '模型',
  '程序', '代码', '系统', '框架', '接口', '服务', '架构', '组件', '模块', '配置', '部署', '测试',
  '数据库', '缓存', '索引', '查询', '事务', '并发', '同步', '异步', '分布式', '微服务',

  // 业务相关
  '用户', '权限', '认证', '授权', '安全', '加密', '登录', '注册', '身份', '验证',
  '订单', '商品', '支付', '交易', '库存', '供应链', '物流', '客户', '销售', '采购',

  // 通用高频词
  '开发', '设计', '实现', '优化', '性能', '功能', '需求', '文档', '项目', '管理',
  '公司', '企业', '团队', '产品', '服务', '平台', '应用', '解决方案', '技术', '方案',
  '问题', '解决', '方法', '过程', '流程', '结果', '效果', '分析', '研究', '测试',
  '信息', '内容', '知识', '经验', '资源', '工具', '系统', '平台', '框架', '标准',
  '配置', '设置', '参数', '选项', '规则', '策略', '计划', '目标', '指标', '标准',
]);

// =====================================================
// 基础检测函数
// =====================================================

/**
 * 检测文本是否包含中文字符
 */
export function containsChinese(text: string): boolean {
  return CHINESE_REGEX.test(text);
}

/**
 * 计算文本中中文字符占比
 */
export function chineseProportion(text: string): number {
  if (!text || text.length === 0) return 0;
  const chineseChars = text.match(/[一-鿿㐀-䶿]/g);
  return chineseChars ? chineseChars.length / text.length : 0;
}

/**
 * 判断是否应该使用中文匹配模式
 * 当中文占比超过 30% 时，使用中文匹配
 */
export function shouldUseChineseMode(text: string): boolean {
  return chineseProportion(text) > 0.3;
}

// =====================================================
// 改进的中文分词策略
// =====================================================

/**
 * 中文分词（改进版）
 * 策略：
 * 1. 优先识别常见词汇（保持完整）
 * 2. 滑动窗口提取 N-gram（bigram/trigram）
 * 3. 单字符作为最小粒度补充
 *
 * 注意：这是轻量级实现，不依赖 nodejieba
 * 对于专业场景建议集成 zhparser 或 nodejieba
 */
export function tokenizeChinese(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const tokens: string[] = [];

  // 提取所有连续中文片段
  const chineseSegments = text.match(/[一-鿿㐀-䶿]+/g) || [];

  for (const segment of chineseSegments) {
    // 1. 尝试匹配常见词汇（最长匹配优先）
    const commonTokens = extractCommonWords(segment);
    tokens.push(...commonTokens.tokens);

    // 2. 对未匹配部分使用 N-gram 滑动窗口
    const remaining = commonTokens.remaining;
    if (remaining.length > 0) {
      tokens.push(...extractNgrams(remaining, 2, 3));
    }
  }

  // 提取非中文部分（英文单词、数字等）
  const nonChinese = text
    .replace(/[一-鿿㐀-䶿]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);

  tokens.push(...nonChinese);

  return tokens;
}

/**
 * 从中文片段中提取常见词汇
 * 使用最长匹配原则
 */
function extractCommonWords(segment: string): { tokens: string[]; remaining: string } {
  const tokens: string[] = [];
  let remaining = segment;
  let i = 0;

  // 从左到右扫描，优先匹配最长词汇
  while (i < remaining.length) {
    let matched = false;

    // 尝试匹配 4 字词 -> 3 字词 -> 2 字词
    for (const wordLen of [4, 3, 2]) {
      if (i + wordLen <= remaining.length) {
        const candidate = remaining.slice(i, i + wordLen);
        if (COMMON_CHINESE_WORDS.has(candidate)) {
          tokens.push(candidate);
          i += wordLen;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      i++;
    }
  }

  // 计算剩余未匹配部分（用单字填充的位置）
  // 构建 remaining 字符串用于后续 N-gram 处理
  const matchedPositions = new Set<number>();
  let pos = 0;
  for (const token of tokens) {
    for (let j = 0; j < token.length; j++) {
      matchedPositions.add(pos + j);
    }
    pos += token.length;
  }

  const remainingChars = segment
    .split('')
    .filter((_, idx) => !matchedPositions.has(idx))
    .join('');

  return { tokens, remaining: remainingChars };
}

/**
 * N-gram 滑动窗口提取
 * @param text 输入文本
 * @param minN 最小窗口大小
 * @param maxN 最大窗口大小
 */
function extractNgrams(text: string, minN: number, maxN: number): string[] {
  const ngrams: string[] = [];
  const len = text.length;

  // 提取 bigram 和 trigram
  for (const n of [maxN, minN]) {
    for (let i = 0; i <= len - n; i++) {
      const ngram = text.slice(i, i + n);
      // 跳过重复单字（如 "的的"）
      if (!isRepetitive(ngram)) {
        ngrams.push(ngram);
      }
    }
  }

  // 单字符作为最小粒度（仅在无 N-gram 时添加）
  if (ngrams.length === 0 && len > 0) {
    ngrams.push(...text.split(''));
  }

  return ngrams;
}

/**
 * 检查是否为重复字符组成
 * 如 "的的"、"是是" 等
 */
function isRepetitive(text: string): boolean {
  if (text.length <= 1) return false;
  const first = text[0];
  return text.split('').every(c => c === first);
}

// =====================================================
// ILIKE 匹配模式构建
// =====================================================

/**
 * 构建 ILIKE 匹配模式数组
 * 用于 PostgreSQL ILIKE ANY 查询
 */
export function buildIlikePatterns(tokens: string[]): string[] {
  return tokens.map(t => `%${t}%`);
}

// =====================================================
// 高级分词选项
// =====================================================

export interface TokenizeOptions {
  /** 是否启用常见词汇匹配 */
  useCommonWords?: boolean;
  /** 是否启用 N-gram */
  useNgrams?: boolean;
  /** N-gram 窗口大小范围 */
  ngramRange?: [number, number];
  /** 是否包含单字符 */
  includeSingleChars?: boolean;
}

/**
 * 可配置的中文分词
 */
export function tokenizeWithOptions(
  text: string,
  options: TokenizeOptions = {}
): string[] {
  const {
    useCommonWords = true,
    useNgrams = true,
    ngramRange = [2, 3],
    includeSingleChars = true,
  } = options;

  if (!text || text.trim().length === 0) return [];

  const tokens: string[] = [];
  const chineseSegments = text.match(/[一-鿿㐀-䶿]+/g) || [];

  for (const segment of chineseSegments) {
    if (useCommonWords) {
      const commonTokens = extractCommonWords(segment);
      tokens.push(...commonTokens.tokens);

      if (useNgrams && commonTokens.remaining.length > 0) {
        const [minN, maxN] = ngramRange;
        tokens.push(...extractNgrams(commonTokens.remaining, minN, maxN));
      } else if (includeSingleChars) {
        tokens.push(...commonTokens.remaining.split(''));
      }
    } else if (useNgrams) {
      const [minN, maxN] = ngramRange;
      tokens.push(...extractNgrams(segment, minN, maxN));
    } else if (includeSingleChars) {
      tokens.push(...segment.split(''));
    }
  }

  // 非中文部分
  const nonChinese = text
    .replace(/[一-鿿㐀-䶿]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);

  tokens.push(...nonChinese);

  return tokens;
}

// =====================================================
// 向量化词权重计算（用于 BM25 优化）
// =====================================================

/**
 * 计算词频权重
 * 常见词汇权重更高，单字权重更低
 */
export function getTokenWeights(tokens: string[]): Map<string, number> {
  const weights = new Map<string, number>();

  for (const token of tokens) {
    const baseWeight = COMMON_CHINESE_WORDS.has(token) ? 2.0 : 1.0;
    const lengthBonus = Math.min(token.length / 2, 1.5); // 长词权重更高
    weights.set(token, baseWeight * lengthBonus);
  }

  return weights;
}