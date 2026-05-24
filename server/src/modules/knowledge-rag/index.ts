// 导出配置
export { ragConfig } from './config';

// 导出 DTO
export type {
  DocumentDto,
  ChunkDto,
  EmbeddingCacheDto,
  IndexJobDto,
  SearchResultDto,
} from './dto';
export {
  toDocumentDto,
  toChunkDto,
  toIndexJobDto,
  formatVectorForDb,
  parseVectorFromDb,
} from './dto';

// 导出 Schema
export type {
  CreateDocumentInput,
  UpdateDocumentInput,
  ListDocumentsQuery,
  HybridSearchInput,
  ListChunksQuery,
  ListJobsQuery,
  TriggerIndexInput,
  SearchMode,
  DocumentStatus,
  FileType,
  JobType,
  JobStatus,
} from './schema';

// 导出 Repository
export type {
  DocumentRecord,
  ChunkRecord,
  IndexJobRecord,
} from './repository';
export {
  listDocuments,
  findDocumentById,
  createDocument,
  updateDocument,
  deleteDocument,
  updateDocumentStatus,
  listChunks,
  createChunks,
  deleteChunksByDocument,
  updateChunkEmbedding,
  getChunksWithoutEmbedding,
  findEmbeddingCache,
  storeEmbeddingCache,
  listJobs,
  findJobById,
  createJob,
  updateJobStatus,
  semanticSearch,
  keywordSearch,
  getRagStats,
} from './repository';

// 导出 Service
export {
  getDocuments,
  getDocument,
  uploadDocument,
  updateDocumentService,
  deleteDocumentService,
  triggerIndex,
  getJobs,
  getJob,
  getStats,
  getChunks,
  backfillEmbeddings,
  search,
  searchWithContext,
  searchForAgent,
} from './service';

// 导出 Routes
export { knowledgeRagRoutes, registerMultipart } from './routes';

// 导出索引模块
export { parseDocument, getFileType, computeFileHash, cleanTextContent, computeContentHash } from './indexing/document-parser';
export { chunkDocument, getChunkStats } from './indexing/chunker';
export { embedQuery, embedChunks, createEmbedder, KnowledgeEmbedder } from './indexing/embedder';
export { jobQueue } from './indexing/job-queue';

// 导出检索模块
export { hybridSearch, searchSuggestions, buildLLMContext, formatContextForAgent } from './retrieval';