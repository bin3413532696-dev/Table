export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgePresetTag {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface KnowledgeSearchHit {
  id: string;
  title: string;
  content: string;
  tags: string[];
  score: number;
  updatedAt: number;
}

export interface KnowledgeMetadata {
  noteCount: number;
  presetTagCount: number;
}

export interface KnowledgeDocument {
  id: string;
  userId: string;
  corpusIds: string[];
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
  publishDate: number | null;
  sourceDept: string | null;
  securityLevel: string | null;
  businessCategory: string | null;
  docLanguage: string | null;
  parseQuality: string | null;
  hasOcr: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  userId: string;
  content: string;
  contentHash: string;
  chunkIndex: number;
  startPos: number;
  endPos: number;
  chunkType?: string | null;
  parentId?: string | null;
  hasEmbedding: boolean;
  embeddingModel: string | null;
  createdAt: number;
  updatedAt: number;
}

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

export interface SearchResult {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
  score: number;
  source: 'semantic' | 'keyword' | 'hybrid' | 'reranked';
  sourceInfo: string | null;
  publishDate: number | null;
  sourceDept: string | null;
  securityLevel: string | null;
  businessCategory: string | null;
}

export type SearchMode = 'hybrid' | 'semantic' | 'keyword';
export type SecurityLevel = 'public' | 'internal' | 'confidential' | 'secret';

export interface MetadataFilter {
  publishDateRange?: { start?: string; end?: string };
  sourceDept?: string[];
  securityLevel?: SecurityLevel;
  businessCategory?: string[];
}

export interface SearchInput {
  query?: string;
  tags?: string[];
  documentIds?: string[];
  mode?: SearchMode;
  limit?: number;
  threshold?: number;
  fusionWeight?: number;
  enableRerank?: boolean;
  rerankerThreshold?: number;
  enableQueryPreprocess?: boolean;
  enableExpansion?: boolean;
  enableRewrite?: boolean;
  enableMmr?: boolean;
  mmrLambda?: number;
  publishDateRange?: { start?: string; end?: string };
  sourceDept?: string[];
  securityLevel?: SecurityLevel;
  businessCategory?: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  semanticCount: number;
  keywordCount: number;
  queryEmbeddingTimeMs: number;
  searchTimeMs: number;
  preprocessTimeMs?: number;
  mmrTimeMs?: number;
  rerankTimeMs?: number;
}

export interface UploadResult {
  document: KnowledgeDocument;
  job: IndexJob;
}

export interface RagStats {
  documentCount: number;
  indexedDocumentCount: number;
  chunkCount: number;
  chunkWithEmbeddingCount: number;
  cacheCount: number;
}

export interface KnowledgeCorpus {
  id: string;
  userId: string;
  name: string;
  description: string;
  defaultTags: string[];
  documentIds: string[];
  createdAt: number;
  updatedAt: number;
}
