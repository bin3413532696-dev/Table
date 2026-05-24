// 测试 RAG 系统新增功能
import test from 'node:test';
import assert from 'node:assert/strict';

// 导入被测试的模块
import { estimateTokens, truncateByTokens, cosineSimilarity, mmrRerank } from '../src/modules/knowledge-rag/retrieval/mmr';
import { ragConfigSchema } from '../src/modules/knowledge-rag/config';
import { hybridSearchSchema } from '../src/modules/knowledge-rag/schema';
import type { SearchResultDto } from '../src/modules/knowledge-rag/dto';

// 创建测试用的 SearchResultDto
function createSearchResult(id: string, score: number): SearchResultDto {
  return {
    id,
    documentId: `doc-${id}`,
    documentTitle: `Document ${id}`,
    content: `Content for ${id}`,
    chunkIndex: 0,
    score,
    source: 'semantic',
    sourceInfo: null,
  };
}

// =====================================================
// Token 估算测试
// =====================================================

test('estimateTokens: 纯英文文本估算正确', () => {
  // 英文约 0.25 tokens/字符（4 chars/token）
  const englishText = 'Hello World'; // 11 chars
  const tokens = estimateTokens(englishText);
  assert.equal(tokens, Math.ceil(11 * 0.25)); // 应该是 3
});

test('estimateTokens: 纯中文文本估算正确', () => {
  // 中文约 1.5 tokens/字符
  const chineseText = '人工智能测试'; // 6 chars
  const tokens = estimateTokens(chineseText);
  assert.equal(tokens, Math.ceil(6 * 1.5)); // 应该是 9
});

test('estimateTokens: 中英文混合文本估算正确', () => {
  const mixedText = 'Hello世界'; // 5 英文 + 2 中文
  const tokens = estimateTokens(mixedText);
  // 英文: 5 * 0.25 = 1.25, 中文: 2 * 1.5 = 3
  // 总计: 4.25 → ceil = 5
  assert.equal(tokens, Math.ceil(5 * 0.25 + 2 * 1.5));
});

test('estimateTokens: 空文本返回 0', () => {
  assert.equal(estimateTokens(''), 0);
});

// =====================================================
// Token 截断测试
// =====================================================

test('truncateByTokens: 文本小于限制时不截断', () => {
  const shortText = '短文本';
  const result = truncateByTokens(shortText, 100);
  assert.equal(result, shortText);
});

test('truncateByTokens: 中文文本截断后不超过 token 限制', () => {
  // 500 中文字符 ≈ 750 tokens，超出 400 限制
  const longChinese = '人工智能测试内容'.repeat(50); // 约 350 字符
  const result = truncateByTokens(longChinese, 400);
  const resultTokens = estimateTokens(result);
  assert.ok(resultTokens <= 400, `截断后 tokens (${resultTokens}) 应 <= 400`);
});

test('truncateByTokens: 英文文本截断正确', () => {
  const longEnglish = 'This is a test sentence for token truncation '.repeat(20);
  const result = truncateByTokens(longEnglish, 100);
  const resultTokens = estimateTokens(result);
  assert.ok(resultTokens <= 100, `截断后 tokens (${resultTokens}) 应 <= 100`);
});

test('truncateByTokens: 使用配置默认值', () => {
  const longText = '测试内容'.repeat(100);
  const result = truncateByTokens(longText); // 使用默认 400 tokens
  const resultTokens = estimateTokens(result);
  assert.ok(resultTokens <= 400, `截断后 tokens (${resultTokens}) 应 <= 400 (默认值)`);
});

// =====================================================
// 余弦相似度测试
// =====================================================

test('cosineSimilarity: 相同向量返回 1', () => {
  const vec = [1, 2, 3];
  assert.equal(cosineSimilarity(vec, vec), 1);
});

test('cosineSimilarity: 正交向量返回 0', () => {
  const vec1 = [1, 0];
  const vec2 = [0, 1];
  assert.equal(cosineSimilarity(vec1, vec2), 0);
});

test('cosineSimilarity: 相反向量返回 -1', () => {
  const vec1 = [1, 0];
  const vec2 = [-1, 0];
  assert.equal(cosineSimilarity(vec1, vec2), -1);
});

test('cosineSimilarity: 不同长度向量返回 0', () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
});

test('cosineSimilarity: 空向量返回 0', () => {
  assert.equal(cosineSimilarity([], []), 0);
});

test('cosineSimilarity: 计算部分相似向量', () => {
  const vec1 = [1, 1];
  const vec2 = [1, 0];
  // dot = 1, norm1 = sqrt(2), norm2 = 1
  // similarity = 1 / sqrt(2) ≈ 0.707
  const result = cosineSimilarity(vec1, vec2);
  assert.ok(Math.abs(result - 0.707) < 0.01, `相似度应约 0.707，实际 ${result}`);
});

// =====================================================
// MMR 测试
// =====================================================

test('mmrRerank: 无 embedding 时返回原始排序前 topK', () => {
  const results = [
    createSearchResult('1', 0.9),
    createSearchResult('2', 0.8),
    createSearchResult('3', 0.7),
  ];

  const reranked = mmrRerank(results, null, 0.7, 2);
  assert.equal(reranked.length, 2);
  assert.equal(reranked[0].id, '1');
  assert.equal(reranked[1].id, '2');
});

test('mmrRerank: embedding 空时返回原始排序', () => {
  const results = [
    createSearchResult('1', 0.9),
  ];

  const reranked = mmrRerank(results, new Map(), 0.7, 1);
  assert.equal(reranked.length, 1);
  assert.equal(reranked[0].id, '1');
});

test('mmrRerank: 有 embedding 时降低相似结果的排序', () => {
  const results = [
    createSearchResult('1', 0.9),
    createSearchResult('2', 0.85),
    createSearchResult('3', 0.7),
  ];

  // 创建 embedding：id1 和 id2 相似，id3 不同
  const embeddings = new Map<string, number[]>();
  embeddings.set('1', [1, 0]);   // 方向 (1, 0)
  embeddings.set('2', [0.9, 0.1]); // 接近 (1, 0)，与 id1 相似
  embeddings.set('3', [0, 1]);   // 方向 (0, 1)，与 id1、id2 正交

  const reranked = mmrRerank(results, embeddings, 0.5, 3);

  assert.equal(reranked.length, 3);
  // lambda=0.5 时，MMR 会惩罚相似结果
  // id3 应该排在 id2 前面
  assert.ok(reranked.findIndex(r => r.id === '3') < reranked.findIndex(r => r.id === '2'),
    '不相似的 id3 应排在相似的 id2 前面');
});

// =====================================================
// Config Schema 测试
// =====================================================

test('ragConfigSchema: RERANKER_TIMEOUT_MS 默认值为 2000', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.RERANKER_TIMEOUT_MS, 2000);
});

test('ragConfigSchema: EMBEDDING_VERSION 默认值为 1', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.EMBEDDING_VERSION, 1);
});

test('ragConfigSchema: RERANKER_MIN_SCORE 默认值为 0.3', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.RERANKER_MIN_SCORE, 0.3);
});

test('ragConfigSchema: RERANKER_MAX_TOKENS 默认值为 400', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.RERANKER_MAX_TOKENS, 400);
});

test('ragConfigSchema: MMR_ENABLED 默认值为 false', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.MMR_ENABLED, false);
});

test('ragConfigSchema: MMR_LAMBDA 默认值为 0.7', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.MMR_LAMBDA, 0.7);
});

test('ragConfigSchema: RERANKER_CANDIDATE_MIN 默认值为 50', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.RERANKER_CANDIDATE_MIN, 50);
});

test('ragConfigSchema: RERANKER_CANDIDATE_MAX 默认值为 100', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.RERANKER_CANDIDATE_MAX, 100);
});

test('ragConfigSchema: 环境变量覆盖默认值', () => {
  const config = ragConfigSchema.parse({
    EMBEDDING_VERSION: '2',
    RERANKER_TIMEOUT_MS: '5000',
    MMR_LAMBDA: '0.8',
  });
  assert.equal(config.EMBEDDING_VERSION, 2);
  assert.equal(config.RERANKER_TIMEOUT_MS, 5000);
  assert.equal(config.MMR_LAMBDA, 0.8);
});

// =====================================================
// Search Schema 测试
// =====================================================

test('hybridSearchSchema: enableMmr 默认值为 false', () => {
  const params = hybridSearchSchema.parse({});
  assert.equal(params.enableMmr, false);
});

test('hybridSearchSchema: rerankerThreshold 可选', () => {
  const params = hybridSearchSchema.parse({});
  assert.equal(params.rerankerThreshold, undefined);
});

test('hybridSearchSchema: mmrLambda 可选', () => {
  const params = hybridSearchSchema.parse({});
  assert.equal(params.mmrLambda, undefined);
});

test('hybridSearchSchema: rerankerThreshold 范围限制 0-1', () => {
  // 正常值
  assert.equal(hybridSearchSchema.parse({ rerankerThreshold: 0.5 }).rerankerThreshold, 0.5);

  // 超出范围应该报错
  assert.throws(
    () => hybridSearchSchema.parse({ rerankerThreshold: 1.5 }),
    (err) => err instanceof Error && err.message.includes('max')
  );
});

test('hybridSearchSchema: mmrLambda 范围限制 0-1', () => {
  // 正常值
  assert.equal(hybridSearchSchema.parse({ mmrLambda: 0.8 }).mmrLambda, 0.8);

  // 超出范围应该报错
  assert.throws(
    () => hybridSearchSchema.parse({ mmrLambda: 1.5 }),
    (err) => err instanceof Error
  );
});

test('hybridSearchSchema: 完整参数解析', () => {
  const params = hybridSearchSchema.parse({
    query: '测试查询',
    limit: 20,
    threshold: 0.3,
    enableRerank: true,
    rerankerThreshold: 0.4,
    enableMmr: true,
    mmrLambda: 0.6,
  });

  assert.equal(params.query, '测试查询');
  assert.equal(params.limit, 20);
  assert.equal(params.threshold, 0.3);
  assert.equal(params.enableRerank, true);
  assert.equal(params.rerankerThreshold, 0.4);
  assert.equal(params.enableMmr, true);
  assert.equal(params.mmrLambda, 0.6);
});