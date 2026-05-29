import { fetchWithAuth } from '../../lib/auth';
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  IndexJob,
  SearchInput,
  SearchResponse,
  UploadResult,
  RagStats,
  MetadataFilter,
} from './types';

const API_BASE = '/api/knowledge-rag';

// 错误消息提取辅助函数
async function extractErrorMessage(response: Response, defaultMessage: string): Promise<string> {
  try {
    const payload = await response.json() as { message?: string; error?: string };
    return payload.message || payload.error || defaultMessage;
  } catch {
    return `${defaultMessage} (HTTP ${response.status})`;
  }
}

// 获取文档列表
export async function getDocuments(params?: {
  status?: string;
  fileType?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  // === 元数据过滤 ===
  publishDateRange?: { start?: string; end?: string };
  sourceDept?: string[];
  securityLevel?: string;
  businessCategory?: string[];
}): Promise<{ items: KnowledgeDocument[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.fileType) query.set('fileType', params.fileType);
  if (params?.tags && params.tags.length > 0) query.set('tags', params.tags.join(','));
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  // 元数据过滤
  if (params?.publishDateRange?.start) query.set('publishDateStart', params.publishDateRange.start);
  if (params?.publishDateRange?.end) query.set('publishDateEnd', params.publishDateRange.end);
  if (params?.sourceDept && params.sourceDept.length > 0) query.set('sourceDept', params.sourceDept.join(','));
  if (params?.securityLevel) query.set('securityLevel', params.securityLevel);
  if (params?.businessCategory && params.businessCategory.length > 0) query.set('businessCategory', params.businessCategory.join(','));

  const response = await fetchWithAuth(`${API_BASE}/documents?${query}`);
  if (!response.ok) throw new Error(await extractErrorMessage(response, '获取文档列表失败'));
  return response.json();
}

// 获取文档详情
export async function getDocument(id: string): Promise<KnowledgeDocument> {
  const response = await fetchWithAuth(`${API_BASE}/documents/${id}`);
  if (!response.ok) throw new Error(await extractErrorMessage(response, '获取文档详情失败'));
  return response.json();
}

// 上传文档
export async function uploadDocument(
  file: File,
  title?: string,
  tags?: string[]
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (title) formData.append('title', title);
  if (tags && tags.length > 0) formData.append('tags', JSON.stringify(tags));

  const response = await fetchWithAuth(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) throw new Error(await extractErrorMessage(response, '上传文档失败'));
  return response.json();
}

// 更新文档
export async function updateDocument(
  id: string,
  data: { title?: string; tags?: string[] }
): Promise<KnowledgeDocument> {
  const response = await fetchWithAuth(`${API_BASE}/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) throw new Error(await extractErrorMessage(response, '更新文档失败'));
  return response.json();
}

// 删除文档
export async function deleteDocument(id: string): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE}/documents/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) throw new Error(await extractErrorMessage(response, '删除文档失败'));
}

// 触发索引
export async function triggerIndex(
  id: string,
  force?: boolean
): Promise<{ job: IndexJob }> {
  const response = await fetchWithAuth(`${API_BASE}/documents/${id}/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });

  if (!response.ok) throw new Error(await extractErrorMessage(response, '触发索引失败'));
  return response.json();
}

// 获取索引任务列表
export async function getJobs(params?: {
  status?: string;
  documentId?: string;
  limit?: number;
}): Promise<{ items: IndexJob[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.documentId) query.set('documentId', params.documentId);
  if (params?.limit) query.set('limit', params.limit.toString());

  const response = await fetchWithAuth(`${API_BASE}/jobs?${query}`);
  if (!response.ok) throw new Error(await extractErrorMessage(response, '获取任务列表失败'));
  return response.json();
}

// 获取索引任务详情
export async function getJob(id: string): Promise<IndexJob> {
  const response = await fetchWithAuth(`${API_BASE}/jobs/${id}`);
  if (!response.ok) throw new Error(await extractErrorMessage(response, '获取任务详情失败'));
  return response.json();
}

// 获取分块列表
export async function getChunks(documentId: string, params?: {
  limit?: number;
  offset?: number;
}): Promise<{ items: KnowledgeChunk[]; total: number }> {
  const query = new URLSearchParams();
  query.set('documentId', documentId);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());

  const response = await fetchWithAuth(`${API_BASE}/chunks?${query}`);
  if (!response.ok) throw new Error(await extractErrorMessage(response, '获取分块列表失败'));
  return response.json();
}

// 搜索
export async function search(input: SearchInput): Promise<SearchResponse> {
  const response = await fetchWithAuth(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) throw new Error(await extractErrorMessage(response, '搜索失败'));
  return response.json();
}

// 获取统计
export async function getStats(): Promise<RagStats> {
  const response = await fetchWithAuth(`${API_BASE}/stats`);
  if (!response.ok) throw new Error(await extractErrorMessage(response, '获取统计失败'));
  return response.json();
}