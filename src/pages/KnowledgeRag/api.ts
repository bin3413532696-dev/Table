import { requestApi } from '../../lib/api/client';
import type {
  IndexJob,
  KnowledgeChunk,
  KnowledgeCorpus,
  KnowledgeDocument,
  RagStats,
  SearchInput,
  SearchResponse,
  UploadResult,
} from './types';

const API_BASE = '/api/knowledge-rag';

type ListResponse<T> = {
  items: T[];
  total: number;
};

export type TriggerIndexResult = {
  job?: IndexJob;
  message?: string;
};

export async function getDocuments(params?: {
  status?: string;
  fileType?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  publishDateRange?: { start?: string; end?: string };
  sourceDept?: string[];
  securityLevel?: string;
  businessCategory?: string[];
}): Promise<ListResponse<KnowledgeDocument>> {
  const query = new URLSearchParams();

  if (params?.status) query.set('status', params.status);
  if (params?.fileType) query.set('fileType', params.fileType);
  if (params?.tags && params.tags.length > 0) query.set('tags', params.tags.join(','));
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  if (params?.publishDateRange?.start) query.set('publishDateStart', params.publishDateRange.start);
  if (params?.publishDateRange?.end) query.set('publishDateEnd', params.publishDateRange.end);
  if (params?.sourceDept && params.sourceDept.length > 0) query.set('sourceDept', params.sourceDept.join(','));
  if (params?.securityLevel) query.set('securityLevel', params.securityLevel);
  if (params?.businessCategory && params.businessCategory.length > 0) {
    query.set('businessCategory', params.businessCategory.join(','));
  }

  return requestApi<ListResponse<KnowledgeDocument>>(`${API_BASE}/documents?${query.toString()}`);
}

export async function getCorpora(): Promise<ListResponse<KnowledgeCorpus>> {
  return requestApi<ListResponse<KnowledgeCorpus>>(`${API_BASE}/corpora`);
}

export async function getCorpus(id: string): Promise<KnowledgeCorpus> {
  return requestApi<KnowledgeCorpus>(`${API_BASE}/corpora/${id}`);
}

export async function createCorpus(data: {
  name: string;
  description?: string;
  defaultTags?: string[];
  documentIds?: string[];
}): Promise<KnowledgeCorpus> {
  return requestApi<KnowledgeCorpus>(`${API_BASE}/corpora`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCorpus(id: string, data: {
  name?: string;
  description?: string;
  defaultTags?: string[];
  documentIds?: string[];
}): Promise<KnowledgeCorpus> {
  return requestApi<KnowledgeCorpus>(`${API_BASE}/corpora/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteCorpus(id: string): Promise<void> {
  await requestApi<void>(`${API_BASE}/corpora/${id}`, {
    method: 'DELETE',
  });
}

export async function getDocument(id: string): Promise<KnowledgeDocument> {
  return requestApi<KnowledgeDocument>(`${API_BASE}/documents/${id}`);
}

export async function uploadDocument(file: File, title?: string, tags?: string[]): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  if (title) {
    formData.append('title', title);
  }
  if (tags && tags.length > 0) {
    formData.append('tags', JSON.stringify(tags));
  }

  return requestApi<UploadResult>(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData,
  });
}

export async function updateDocument(id: string, data: { title?: string; tags?: string[] }): Promise<KnowledgeDocument> {
  return requestApi<KnowledgeDocument>(`${API_BASE}/documents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await requestApi<void>(`${API_BASE}/documents/${id}`, {
    method: 'DELETE',
  });
}

export async function triggerIndex(id: string, force?: boolean): Promise<TriggerIndexResult> {
  return requestApi<TriggerIndexResult>(`${API_BASE}/documents/${id}/index`, {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}

export async function getJobs(params?: {
  status?: string;
  documentId?: string;
  limit?: number;
}): Promise<ListResponse<IndexJob>> {
  const query = new URLSearchParams();

  if (params?.status) query.set('status', params.status);
  if (params?.documentId) query.set('documentId', params.documentId);
  if (params?.limit) query.set('limit', params.limit.toString());

  return requestApi<ListResponse<IndexJob>>(`${API_BASE}/jobs?${query.toString()}`);
}

export async function getJob(id: string): Promise<IndexJob> {
  return requestApi<IndexJob>(`${API_BASE}/jobs/${id}`);
}

export async function getChunks(documentId: string, params?: {
  limit?: number;
  offset?: number;
}): Promise<ListResponse<KnowledgeChunk>> {
  const query = new URLSearchParams();
  query.set('documentId', documentId);

  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());

  return requestApi<ListResponse<KnowledgeChunk>>(`${API_BASE}/chunks?${query.toString()}`);
}

export async function search(input: SearchInput): Promise<SearchResponse> {
  return requestApi<SearchResponse>(`${API_BASE}/search`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getStats(): Promise<RagStats> {
  return requestApi<RagStats>(`${API_BASE}/stats`);
}
