// 文档类型
export interface KnowledgeDocument {
  id: string;
  userId: string;
  title: string;
  summary: string;
  content: string;
  source: string | null;
  fileType: string | null;
  fileSize: number;
  status: 'pending' | 'processing' | 'indexed' | 'failed' | 'deleted';
  tags: string[];
  contentHash: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

// 分块类型
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  userId: string;
  content: string;
  contentHash: string;
  chunkIndex: number;
  startPos: number;
  endPos: number;
  hasEmbedding: boolean;
  embeddingModel: string | null;
  createdAt: number;
  updatedAt: number;
}

// 索引任务类型
export interface IndexJob {
  id: string;
  userId: string;
  documentId: string | null;
  jobType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  error: Record<string, unknown> | null;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

// 搜索结果类型
export interface SearchResult {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  score: number;
  source: 'semantic' | 'keyword' | 'hybrid';
  sourceInfo: string | null;
}

// 搜索模式
export type SearchMode = 'hybrid' | 'semantic' | 'keyword';

// 搜索输入
export interface SearchInput {
  query?: string;
  tags?: string[];
  documentIds?: string[];
  mode?: SearchMode;
  limit?: number;
  threshold?: number;
  fusionWeight?: number;
}

// 搜索结果响应
export interface SearchResponse {
  results: SearchResult[];
  semanticCount: number;
  keywordCount: number;
  queryEmbeddingTimeMs: number;
  searchTimeMs: number;
}

// 上传结果
export interface UploadResult {
  document: KnowledgeDocument;
  job: IndexJob;
}

// RAG 统计
export interface RagStats {
  documentCount: number;
  indexedDocumentCount: number;
  chunkCount: number;
  chunkWithEmbeddingCount: number;
  cacheCount: number;
}