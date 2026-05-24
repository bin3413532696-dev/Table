/**
 * 上传完整测试文档并触发索引
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const userId = '00000000-0000-0000-0000-000000000001';

// 完整的技术文档内容
const TECH_DOC_CONTENT = `# Agent RAG 系统架构设计文档

## 1. 系统概述

Agent RAG（Retrieval-Augmented Generation）系统是一个智能知识检索与生成系统，结合了向量搜索、全文检索和大语言模型的能力。

### 1.1 核心组件

系统由以下核心组件构成：

- **文档解析层**：负责解析 PDF、Markdown、TXT 等格式文档
- **分块索引层**：将文档切分为语义单元并生成向量嵌入
- **混合检索层**：结合 pgvector 向量搜索和 PostgreSQL FTS 全文检索
- **重排序层**：使用 RRF（Reciprocal Rank Fusion）算法融合多路检索结果
- **上下文构建层**：将检索结果组装为 LLM 可理解的上下文格式
- **Agent 工具层**：提供 semantic_search、keyword_search、chunk_read、cite_sources 工具

## 2. 技术架构

### 2.1 向量存储

系统使用 PostgreSQL 的 pgvector 扩展存储文档嵌入向量：

- 向量维度：1024（适配 bge-m3 模型）
- 索引类型：HNSW（Hierarchical Navigable Small World）
- 相似度度量：余弦距离（vector_cosine_ops）
- 索引条件：仅对已生成 embedding 的 chunk 创建索引

### 2.2 嵌入模型配置

系统支持多种嵌入模型配置：

- 默认模型：text-embedding-3-small（1536 维度）
- 推荐模型：bge-m3（1024 维度，多语言支持）
- 配置方式：通过 ApiProvider.embeddingModel 字段设置

### 2.3 混合检索流程

检索流程分为三个阶段：

1. **向量检索**：使用 pgvector 进行语义相似度搜索
2. **全文检索**：使用 PostgreSQL tsquery 进行关键词匹配
3. **RRF 融合**：将两路结果按 Reciprocal Rank Fusion 算法合并

RRF 公式：
\`\`\`
score(d) = Σ 1/(k + rank(d))
\`\`\`
其中 k=60 是常数参数。

### 2.4 Grounding Guardrail

为了防止 LLM 生成无依据的内容，系统实现了 Grounding Guardrail 机制：

- Agent 必须通过 cite_sources 工具引用检索到的知识片段
- 每个引用包含 chunk_id、document_title、content_preview
- 最终回答中必须包含引用标记（如 [1], [2]）

## 3. 数据库设计

### 3.1 核心表结构

\`\`\`sql
-- 文档表
CREATE TABLE knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 分块表
CREATE TABLE knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024),
  embedding_model TEXT,
  chunk_index INT DEFAULT 0,
  heading_chain TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 嵌入缓存表
CREATE TABLE knowledge_embedding_cache (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  content_hash TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  embedding_model TEXT NOT NULL,
  expires_at TIMESTAMPTZ
);
\`\`\`

### 3.2 索引策略

系统使用以下索引优化查询性能：

- HNSW 向量索引：用于快速相似度搜索
- B-tree 文档 ID 索引：用于关联查询
- GIN tsvector 索引：用于全文检索
- Embedding 版本索引：用于增量更新

## 4. Agent 工具设计

### 4.1 semantic_search 工具

语义搜索工具通过向量相似度检索知识：

\`\`\`typescript
const semanticSearchTool = {
  name: 'semantic_search',
  description: '通过语义相似度搜索知识库内容',
  parameters: {
    query: '搜索查询文本',
    limit: '返回结果数量限制',
    threshold: '相似度阈值（0-1）'
  },
  execute: async (params) => {
    // 1. 将查询文本转换为向量
    const queryEmbedding = await embedder.embed(params.query);

    // 2. 使用 pgvector 进行相似度搜索
    const results = await prisma.$queryRaw\`
      SELECT id, content, document_id,
             1 - (embedding <=> query_vector) as score
      FROM knowledge_chunks
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> query_vector
      LIMIT params.limit
    \`;

    // 3. 返回格式化的搜索结果
    return formatSearchResults(results);
  }
};
\`\`\`

### 4.2 keyword_search 工具

关键词搜索工具使用 PostgreSQL 全文检索：

\`\`\`typescript
const keywordSearchTool = {
  name: 'keyword_search',
  description: '通过关键词匹配搜索知识库内容',
  parameters: {
    query: '搜索关键词',
    limit: '返回结果数量限制'
  },
  execute: async (params) => {
    // 1. 清理特殊字符，构建 tsquery
    const tsquery = cleanTsquery(params.query);

    // 2. 执行全文检索
    const results = await prisma.$queryRaw\`
      SELECT id, content, document_id,
             ts_rank_cd(search_vector, tsquery) as score
      FROM knowledge_chunks
      WHERE search_vector @@ tsquery
      ORDER BY ts_rank_cd(search_vector, tsquery) DESC
      LIMIT params.limit
    \`;

    return formatSearchResults(results);
  }
};
\`\`\`

### 4.3 cite_sources 工具

引用工具用于标注知识来源：

\`\`\`typescript
const citeSourcesTool = {
  name: 'cite_sources',
  description: '引用检索到的知识片段作为回答依据',
  parameters: {
    sources: '要引用的知识片段列表'
  },
  execute: async (params) => {
    return params.sources.map((s, i) => ({
      citation_id: i + 1,
      chunk_id: s.chunk_id,
      document_title: s.document_title,
      content_preview: s.content.slice(0, 200)
    }));
  }
};
\`\`\`

## 5. 配置参数

### 5.1 分块参数

\`\`\`env
CHUNK_SIZE=1000        # 每个分块的目标字符数
CHUNK_OVERLAP=200      # 分块之间的重叠字符数
\`\`\`

### 5.2 检索参数

\`\`\`env
SEARCH_FUSION_WEIGHT=0.5   # 向量搜索权重
SEARCH_MIN_THRESHOLD=0.3   # 最小相似度阈值
SEARCH_DEFAULT_LIMIT=5     # 默认返回结果数
\`\`\`

### 5.3 嵌入参数

\`\`\`env
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_TIMEOUT_MS=60000
EMBEDDING_MAX_RETRIES=3
\`\`\`

## 6. 性能优化建议

### 6.1 批量处理

- 使用批量嵌入 API 减少 API 调用次数
- 并发索引限制：最多 3 个文档同时处理
- 同文档防重复索引机制

### 6.2 缓存策略

- 嵌入结果缓存：使用 content_hash 作为缓存键
- 缓存有效期：7 天（可配置）
- 缓存命中时直接返回，避免重复嵌入计算

### 6.3 查询优化

- 向量搜索使用 HNSW 索引，O(log N) 复杂度
- 全文检索使用 GIN 索引
- RRF 融合在应用层完成，避免复杂 SQL

## 7. 最佳实践

### 7.1 文档格式建议

- Markdown 格式最佳，可保留标题层级信息
- PDF 需要额外解析步骤，可能丢失格式信息
- TXT 格式简单但缺乏结构信息

### 7.2 分块策略

- 保留标题链信息，便于上下文理解
- 设置合理的 overlap，避免语义断裂
- 根据文档类型调整分块大小

### 7.3 检索调优

- 根据查询类型选择合适的搜索模式（semantic/keyword/hybrid）
- 调整 threshold 过滤低质量结果
- 使用 reranker 对结果进行二次排序

## 8. 错误处理

### 8.1 常见错误

- **Embedding API 超时**：增加 timeout 和 retry 配置
- **向量维度不匹配**：检查 embedding_model 与数据库向量维度配置
- **全文检索语法错误**：过滤 tsquery 特殊字符（&|!():*）

### 8.2 错误恢复

- 索引任务失败时自动重试
- 嵌入缓存失效后重新生成
- 文档状态标记便于追踪处理进度

## 9. 未来扩展

### 9.1 多模态支持

- 图片内容 OCR 提取
- 表格数据结构化解析
- 音频/视频内容转文本

### 9.2 智能分块

- 基于语义边界动态分块
- 保留文档结构信息
- 代码块特殊处理

### 9.3 知识图谱

- 实体识别与关系抽取
- 知识图谱构建
- 图谱增强检索

## 10. 总结

Agent RAG 系统通过结合向量搜索、全文检索和大语言模型，实现了智能知识检索与生成。系统架构设计注重可扩展性、性能优化和错误恢复能力，为用户提供高效、准确的知识服务。
`;

async function main() {
  console.log('========================================');
  console.log('上传完整测试文档');
  console.log('========================================\n');

  // 1. 清理旧文档
  console.log('[1] 清理旧文档...');
  await prisma.$executeRaw`
    DELETE FROM knowledge_chunks
    WHERE user_id = ${userId}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM knowledge_documents
    WHERE user_id = ${userId}::uuid
  `;
  console.log('清理完成');

  // 2. 创建新文档
  console.log('\n[2] 创建新文档...');
  const doc = await prisma.$queryRaw<Array<{id: string}>>`
    INSERT INTO knowledge_documents (user_id, title, content, status)
    VALUES (${userId}::uuid, 'Agent RAG 系统架构完整文档', ${TECH_DOC_CONTENT}, 'pending')
    RETURNING id
  `;
  const docId = doc[0].id;
  console.log('文档ID:', docId.slice(0, 8));
  console.log('文档内容长度:', TECH_DOC_CONTENT.length);

  // 3. 手动分块
  console.log('\n[3] 执行分块...');
  const chunks = splitIntoChunks(TECH_DOC_CONTENT, 1000, 200);
  console.log('分块数量:', chunks.length);

  // 4. 存储 chunks
  console.log('\n[4] 存储 Chunks...');
  for (let i = 0; i < chunks.length; i++) {
    const contentHash = createContentHash(chunks[i]);
    await prisma.$executeRaw`
      INSERT INTO knowledge_chunks (document_id, user_id, content, content_hash, chunk_index)
      VALUES (${docId}::uuid, ${userId}::uuid, ${chunks[i]}, ${contentHash}, ${i})
    `;
  }
  console.log('Chunks 存储完成');

  // 5. 更新文档状态
  await prisma.$executeRaw`
    UPDATE knowledge_documents
    SET status = 'processing', updated_at = NOW()
    WHERE id = ${docId}::uuid
  `;

  // 6. 生成 Embedding
  console.log('\n[5] 生成 Embedding...');

  // 获取 provider 配置
  const provider = await prisma.$queryRaw<Array<{
    id: string;
    base_url: string;
    api_key_encrypted: string;
    embedding_model: string;
    headers_json: any;
  }>>`
    SELECT id, base_url, api_key_encrypted, embedding_model, headers_json
    FROM api_providers
    WHERE user_id = ${userId}::uuid AND is_active = true
    LIMIT 1
  `;

  if (!provider[0]) {
    console.log('未找到活跃的 Provider');
    await prisma.$disconnect();
    return;
  }

  console.log('Provider:', {
    baseUrl: provider[0].base_url,
    embeddingModel: provider[0].embedding_model
  });

  // 获取所有 chunks
  const allChunks = await prisma.$queryRaw<Array<{
    id: string;
    content: string;
    content_hash: string;
  }>>`
    SELECT id, content, content_hash
    FROM knowledge_chunks
    WHERE document_id = ${docId}::uuid AND embedding IS NULL
    ORDER BY chunk_index
  `;

  console.log('待嵌入 Chunks:', allChunks.length);

  // 批量生成 embedding
  const { decryptProviderSecret } = await import('./src/shared/crypto');
  const apiKey = decryptProviderSecret(provider[0].api_key_encrypted || '');
  const baseUrl = provider[0].base_url;
  const embeddingModel = provider[0].embedding_model || 'text-embedding-3-small';

  // 批量嵌入（每批 5 个）
  const batchSize = 5;
  let embeddedCount = 0;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    console.log(`嵌入批次 ${Math.floor(i/batchSize) + 1}/${Math.ceil(allChunks.length/batchSize)}...`);

    const embeddings = await batchEmbed(batch.map(c => c.content), apiKey, baseUrl, embeddingModel);

    for (let j = 0; j < batch.length; j++) {
      const embeddingStr = '[' + embeddings[j].join(',') + ']';
      await prisma.$executeRaw`
        UPDATE knowledge_chunks
        SET embedding = ${embeddingStr}::vector,
            embedding_model = ${embeddingModel},
            embedding_dimensions = 1024,
            embedding_version = 1,
            updated_at = NOW()
        WHERE id = ${batch[j].id}::uuid
      `;
      embeddedCount++;
    }
  }

  console.log('嵌入完成:', embeddedCount);

  // 7. 更新文档状态为 indexed
  await prisma.$executeRaw`
    UPDATE knowledge_documents
    SET status = 'indexed', updated_at = NOW()
    WHERE id = ${docId}::uuid
  `;

  // 8. 验证结果
  console.log('\n[6] 验证结果...');
  const finalChunks = await prisma.$queryRaw<Array<{total: bigint, with_emb: bigint}>>`
    SELECT COUNT(*) as total, COUNT(CASE WHEN embedding IS NOT NULL THEN 1 END) as with_emb
    FROM knowledge_chunks
    WHERE document_id = ${docId}::uuid
  `;
  console.log('最终统计:', {
    total: Number(finalChunks[0].total),
    withEmbedding: Number(finalChunks[0].with_emb)
  });

  await prisma.$disconnect();
  console.log('\n========================================');
  console.log('文档上传和索引完成');
  console.log('========================================');
}

// 分块函数
function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - overlap;
    if (start >= text.length - overlap) break;
  }

  return chunks;
}

// 内容哈希
function createContentHash(content: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(content).digest('hex');
}

// 批量嵌入 API
async function batchEmbed(texts: string[], apiKey: string, baseUrl: string, model: string): Promise<number[][]> {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: texts,
      model: model,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API 失败: ${response.status} ${error}`);
  }

  const data = await response.json() as { data: Array<{ index: number; embedding: number[] }> };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

main().catch(console.error);