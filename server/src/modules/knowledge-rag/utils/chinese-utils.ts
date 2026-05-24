// 中文处理工具函数

// 中文 Unicode 范围：基本汉字 U+4E00 - U+9FFF，扩展汉字 U+3400 - U+4DBF 等
const CHINESE_REGEX = /[一-鿿㐀-䶿]/;

// 检测文本是否包含中文字符
export function containsChinese(text: string): boolean {
  return CHINESE_REGEX.test(text);
}

// 计算文本中中文字符占比
export function chineseProportion(text: string): number {
  if (!text || text.length === 0) return 0;
  const chineseChars = text.match(/[一-鿿㐀-䶿]/g);
  return chineseChars ? chineseChars.length / text.length : 0;
}

// 中文分词（字符级）
// 将中文拆分为单字符，英文拆分为单词
// 注意：这是基础实现，不依赖 nodejieba，适用于简单匹配场景
export function tokenizeChinese(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const tokens: string[] = [];

  // 提取所有中文字符作为独立 token
  const chineseMatches = text.match(/[一-鿿㐀-䶿]+/g);
  if (chineseMatches) {
    for (const match of chineseMatches) {
      // 将连续中文拆分为单字符（字符级分词）
      for (const char of match) {
        tokens.push(char);
      }
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

// 构建 ILIKE 匹配模式数组
export function buildIlikePatterns(tokens: string[]): string[] {
  return tokens.map(t => `%${t}%`);
}

// 判断是否应该使用中文匹配模式
// 当中文占比超过 30% 时，使用中文匹配
export function shouldUseChineseMode(text: string): boolean {
  return chineseProportion(text) > 0.3;
}