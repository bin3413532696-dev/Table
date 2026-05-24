// 测试 Agentic RAG 新增功能
import test from 'node:test';
import assert from 'node:assert/strict';

// 导入被测试的模块
import { formatStructuredContextForAgent } from '../src/modules/knowledge-rag/retrieval/context-builder';
import { ragConfigSchema } from '../src/modules/knowledge-rag/config';
import { buildToolResultPrompt, SYSTEM_PROMPT } from '../src/modules/agent/langgraph/prompts';
import type { SearchResultDto } from '../src/modules/knowledge-rag/dto';

// 创建测试用的 SearchResultDto
function createSearchResult(id: string, score: number, title?: string, heading?: string): SearchResultDto {
  return {
    id,
    documentId: `doc-${id}`,
    documentTitle: title ?? `Document ${id}`,
    headingChain: heading,
    content: `Content for ${id} with some text to test formatting.`,
    chunkIndex: 0,
    score,
    source: 'semantic',
    sourceInfo: null,
  };
}

// =====================================================
// formatStructuredContextForAgent 测试（G3）
// =====================================================

test('formatStructuredContextForAgent: 空结果返回无内容 XML', () => {
  const result = formatStructuredContextForAgent([]);
  assert.ok(result.includes('<search_result>'));
  assert.ok(result.includes('未找到相关内容'));
  assert.ok(result.includes('<max_score>0</max_score>'));
  assert.ok(result.includes('</search_result>'));
});

test('formatStructuredContextForAgent: 结果包含 chunk ID', () => {
  const results = [createSearchResult('chunk-uuid-001', 0.85)];
  const formatted = formatStructuredContextForAgent(results);

  assert.ok(formatted.includes('chunk-uuid-001'), '应包含 chunk ID');
  assert.ok(formatted.includes('<chunk id="'), '应包含 chunk XML 标签');
  assert.ok(formatted.includes('</chunk>'), '应包含 chunk 结束标签');
});

test('formatStructuredContextForAgent: 结果包含分数', () => {
  const results = [createSearchResult('chunk-001', 0.85)];
  const formatted = formatStructuredContextForAgent(results);

  assert.ok(formatted.includes('<score>0.850</score>'), '应包含分数');
});

test('formatStructuredContextForAgent: 结果包含来源路径', () => {
  const results = [createSearchResult('chunk-001', 0.85, '文档标题', '第一章 > 1.1 概述')];
  const formatted = formatStructuredContextForAgent(results);

  assert.ok(formatted.includes('文档标题 > 第一章 > 1.1 概述'), '应包含完整来源路径');
});

test('formatStructuredContextForAgent: 结果包含提示信息', () => {
  const results = [createSearchResult('chunk-001', 0.85)];
  const formatted = formatStructuredContextForAgent(results);

  assert.ok(formatted.includes('cite_sources'), '应包含 cite_sources 提示');
  assert.ok(formatted.includes('chunk ID'), '应包含 chunk ID 提示');
});

test('formatStructuredContextForAgent: 多个结果正确格式化', () => {
  const results = [
    createSearchResult('chunk-001', 0.85),
    createSearchResult('chunk-002', 0.72),
    createSearchResult('chunk-003', 0.65),
  ];
  const formatted = formatStructuredContextForAgent(results);

  // 应包含 3 个 chunk
  const chunkCount = (formatted.match(/<chunk id=/g) || []).length;
  assert.equal(chunkCount, 3, '应包含 3 个 chunk');

  // 应包含最高分数
  assert.ok(formatted.includes('<max_score>0.850</max_score>'));
});

test('formatStructuredContextForAgent: maxScore 计算正确', () => {
  const results = [
    createSearchResult('chunk-001', 0.65),
    createSearchResult('chunk-002', 0.95), // 最高分数
    createSearchResult('chunk-003', 0.72),
  ];
  const formatted = formatStructuredContextForAgent(results);

  assert.ok(formatted.includes('<max_score>0.950</max_score>'), '应显示最高分数 0.95');
});

test('formatStructuredContextForAgent: 按分数降序排列', () => {
  const results = [
    createSearchResult('chunk-001', 0.65),
    createSearchResult('chunk-002', 0.95),
    createSearchResult('chunk-003', 0.72),
  ];
  const formatted = formatStructuredContextForAgent(results);

  // 第一个 chunk 应是最高分数，XML 结构: <chunk id><source><score>
  const firstChunkMatch = formatted.match(/<chunk id="([^"]+)">\s*<source>[^<]*<\/source>\s*<score>([^<]+)/);
  assert.ok(firstChunkMatch, '应找到第一个 chunk');
  assert.equal(firstChunkMatch![1], 'chunk-002', '第一个 chunk 应是最高分数的');
});

// =====================================================
// Agent Config Schema 测试（G1/R1）
// =====================================================

test('ragConfigSchema: RERANKER_ENABLED_BY_DEFAULT 默认值为 true', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.RERANKER_ENABLED_BY_DEFAULT, true);
});

test('ragConfigSchema: MMR_ENABLED_BY_DEFAULT 默认值为 false', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.MMR_ENABLED_BY_DEFAULT, false);
});

test('ragConfigSchema: QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT 默认值为 false', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.QUERY_PREPROCESSOR_ENABLED_BY_DEFAULT, false);
});

test('ragConfigSchema: CITATION_MIN_CHUNKS 默认值为 1', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.CITATION_MIN_CHUNKS, 1);
});

test('ragConfigSchema: CITATION_MAX_CHUNKS 默认值为 10', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.CITATION_MAX_CHUNKS, 10);
});

test('ragConfigSchema: CITATION_REQUIRED_FOR_FACTS 默认值为 true', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.CITATION_REQUIRED_FOR_FACTS, true);
});

test('ragConfigSchema: CITATION_LOW_SCORE_THRESHOLD 默认值为 0.4', () => {
  const config = ragConfigSchema.parse({});
  assert.equal(config.CITATION_LOW_SCORE_THRESHOLD, 0.4);
});

test('ragConfigSchema: Agent 配置可通过环境变量覆盖', () => {
  const config = ragConfigSchema.parse({
    RERANKER_ENABLED_BY_DEFAULT: 'false',
    CITATION_MIN_CHUNKS: '2',
    CITATION_LOW_SCORE_THRESHOLD: '0.5',
  });
  assert.equal(config.RERANKER_ENABLED_BY_DEFAULT, false);
  assert.equal(config.CITATION_MIN_CHUNKS, 2);
  assert.equal(config.CITATION_LOW_SCORE_THRESHOLD, 0.5);
});

// =====================================================
// Prompts 测试（G4/G7）
// =====================================================

test('SYSTEM_PROMPT: 包含 RAG 引用规范', () => {
  assert.ok(SYSTEM_PROMPT.includes('RAG 引用规范'), '应包含 RAG 引用规范');
  assert.ok(SYSTEM_PROMPT.includes('cite_sources'), '应提及 cite_sources 工具');
});

test('SYSTEM_PROMPT: 包含质量判断规则', () => {
  assert.ok(SYSTEM_PROMPT.includes('0.4'), '应包含分数阈值');
  assert.ok(SYSTEM_PROMPT.includes('相关性较低'), '应包含低分提示');
});

test('SYSTEM_PROMPT: 包含新工具描述', () => {
  assert.ok(SYSTEM_PROMPT.includes('semantic_search'), '应包含 semantic_search 工具');
  assert.ok(SYSTEM_PROMPT.includes('keyword_search'), '应包含 keyword_search 工具');
  assert.ok(SYSTEM_PROMPT.includes('chunk_read'), '应包含 chunk_read 工具');
  assert.ok(SYSTEM_PROMPT.includes('cite_sources'), '应包含 cite_sources 工具');
});

test('buildToolResultPrompt: 无工具调用返回空字符串', () => {
  const result = buildToolResultPrompt([]);
  assert.equal(result, '');
});

test('buildToolResultPrompt: 正常格式化工具结果', () => {
  const toolCalls = [
    { name: 'semantic_search', arguments: { query: 'test' }, result: '<search_result>...</search_result>' },
  ];
  const result = buildToolResultPrompt(toolCalls);

  assert.ok(result.includes('semantic_search'), '应包含工具名');
  assert.ok(result.includes('<search_result>'), '应包含结果内容');
});

test('buildToolResultPrompt: 低分搜索返回警告提示', () => {
  const toolCalls = [
    { name: 'semantic_search', arguments: {}, result: '结果' },
  ];
  const result = buildToolResultPrompt(toolCalls, 0.35);

  assert.ok(result.includes('注意'), '应包含注意提示');
  assert.ok(result.includes('0.350'), '应显示分数');
  assert.ok(result.includes('相关性较低'), '应包含低分警告');
});

test('buildToolResultPrompt: 高分搜索无警告', () => {
  const toolCalls = [
    { name: 'semantic_search', arguments: {}, result: '结果' },
  ];
  const result = buildToolResultPrompt(toolCalls, 0.85);

  assert.ok(!result.includes('注意'), '高分不应包含警告');
  assert.ok(!result.includes('相关性较低'), '高分不应包含低分提示');
});

test('buildToolResultPrompt: 结构化结果正确显示', () => {
  const toolCalls = [
    { name: 'semantic_search', arguments: {}, result: { cited: ['chunk-001', 'chunk-002'], count: 2 } },
  ];
  const result = buildToolResultPrompt(toolCalls);

  assert.ok(result.includes('chunk-001'), '应显示结构化结果');
});

// =====================================================
// XML 格式完整性测试
// =====================================================

test('XML 格式: 包含所有必需元素', () => {
  const results = [createSearchResult('chunk-001', 0.85, '文档A', '章节1')];
  const formatted = formatStructuredContextForAgent(results);

  // 验证 XML 结构完整
  assert.ok(formatted.startsWith('<search_result>'), '应以 <search_result> 开始');
  assert.ok(formatted.endsWith('</search_result>'), '应以 </search_result> 结束');
  assert.ok(formatted.includes('<message>'), '应包含 <message>');
  assert.ok(formatted.includes('<max_score>'), '应包含 <max_score>');
  assert.ok(formatted.includes('<chunks>'), '应包含 <chunks>');
  assert.ok(formatted.includes('<hint>'), '应包含 <hint>');
});

test('XML 格式: chunk 元素完整', () => {
  const results = [createSearchResult('chunk-001', 0.85)];
  const formatted = formatStructuredContextForAgent(results);

  assert.ok(formatted.includes('<chunk id="'), '应包含 chunk id 属性');
  assert.ok(formatted.includes('<source>'), '应包含 <source>');
  assert.ok(formatted.includes('<score>'), '应包含 <score>');
  assert.ok(formatted.includes('<content>'), '应包含 <content>');
});

test('XML 格式: 包含 original_semantic_max_score', () => {
  const results = [createSearchResult('chunk-001', 0.85)];
  const formatted = formatStructuredContextForAgent(results, 3000, 0.92);

  assert.ok(formatted.includes('<original_semantic_max_score>'), '应包含 original_semantic_max_score 标签');
  assert.ok(formatted.includes('0.920'), '应显示传入的原始语义分数');
});

test('XML 格式: original_semantic_max_score 默认为 0', () => {
  const results = [createSearchResult('chunk-001', 0.85)];
  const formatted = formatStructuredContextForAgent(results); // 不传递 originalSemanticMaxScore

  assert.ok(formatted.includes('<original_semantic_max_score>0'), '默认应显示 0');
});

// =====================================================
// 边界情况测试
// =====================================================

test('formatStructuredContextForAgent: 单字符内容', () => {
  const results: SearchResultDto[] = [{
    id: 'chunk-001',
    documentId: 'doc-001',
    documentTitle: '文档',
    content: 'a',
    chunkIndex: 0,
    score: 0.9,
    source: 'semantic' as const,
    sourceInfo: null,
  }];
  const formatted = formatStructuredContextForAgent(results);

  assert.ok(formatted.includes('chunk-001'), '应处理短内容');
});

test('formatStructuredContextForAgent: 内容含特殊字符', () => {
  const results: SearchResultDto[] = [{
    id: 'chunk-001',
    documentId: 'doc-001',
    documentTitle: '文档',
    content: '内容含<特殊>字符&符号',
    chunkIndex: 0,
    score: 0.9,
    source: 'semantic' as const,
    sourceInfo: null,
  }];
  const formatted = formatStructuredContextForAgent(results);

  // XML 中的特殊字符可能需要转义，但至少不应崩溃
  assert.ok(formatted.includes('<chunk'), '应处理特殊字符');
});

test('buildToolResultPrompt: 多个工具调用', () => {
  const toolCalls = [
    { name: 'semantic_search', arguments: {}, result: '搜索结果' },
    { name: 'cite_sources', arguments: {}, result: { cited: ['id1'] } },
    { name: 'query_tasks', arguments: {}, result: [] },
  ];
  const result = buildToolResultPrompt(toolCalls);

  assert.ok(result.includes('semantic_search'), '应包含第一个工具');
  assert.ok(result.includes('cite_sources'), '应包含第二个工具');
  assert.ok(result.includes('query_tasks'), '应包含第三个工具');
});