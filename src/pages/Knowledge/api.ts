import { ErrorCode, isAppError } from '../../core/errors';
import { requestApi, requestApiData, type ApiListResponse } from '../../lib/api/client';
import type { KnowledgeMetadata, KnowledgeNote, KnowledgePresetTag, KnowledgeSearchHit } from './types';

export async function getNoteList(): Promise<KnowledgeNote[]> {
  const data = await requestApi<ApiListResponse<KnowledgeNote>>('/api/knowledge/notes');
  return data.items;
}

export async function createNote(input: { title: string; content?: string; tags?: string[] }): Promise<KnowledgeNote> {
  return requestApiData<KnowledgeNote>('/api/knowledge/notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getNoteById(id: string): Promise<KnowledgeNote | null> {
  try {
    return await requestApiData<KnowledgeNote>(`/api/knowledge/notes/${id}`);
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.ENTITY_NOT_FOUND) {
      return null;
    }

    throw error;
  }
}

export async function updateNote(id: string, input: { title?: string; content?: string; tags?: string[] }): Promise<KnowledgeNote | null> {
  try {
    return await requestApiData<KnowledgeNote>(`/api/knowledge/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.ENTITY_NOT_FOUND) {
      return null;
    }

    throw error;
  }
}

export async function deleteNote(id: string): Promise<void> {
  await requestApi<void>(`/api/knowledge/notes/${id}`, {
    method: 'DELETE',
  });
}

export async function searchNotes(input: { query?: string; tags?: string[]; limit?: number }): Promise<KnowledgeSearchHit[]> {
  const params = new URLSearchParams();

  if (input.query) {
    params.set('query', input.query);
  }
  if (input.tags && input.tags.length > 0) {
    params.set('tags', input.tags.join(','));
  }
  if (input.limit) {
    params.set('limit', String(input.limit));
  }

  const data = await requestApi<ApiListResponse<KnowledgeSearchHit>>(`/api/knowledge/search?${params.toString()}`);
  return data.items;
}

export async function getAllTags(): Promise<string[]> {
  const data = await requestApi<ApiListResponse<string>>('/api/knowledge/tags');
  return data.items;
}

export async function getPresetTagList(): Promise<KnowledgePresetTag[]> {
  const data = await requestApi<ApiListResponse<KnowledgePresetTag>>('/api/knowledge/tags/preset');
  return data.items;
}

export async function createPresetTag(input: { name: string; color?: string }): Promise<KnowledgePresetTag> {
  return requestApiData<KnowledgePresetTag>('/api/knowledge/tags/preset', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updatePresetTag(id: string, input: { name?: string; color?: string }): Promise<KnowledgePresetTag | null> {
  try {
    return await requestApiData<KnowledgePresetTag>(`/api/knowledge/tags/preset/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (isAppError(error) && error.code === ErrorCode.ENTITY_NOT_FOUND) {
      return null;
    }

    throw error;
  }
}

export async function deletePresetTag(id: string): Promise<void> {
  await requestApi<void>(`/api/knowledge/tags/preset/${id}`, {
    method: 'DELETE',
  });
}

export async function getKnowledgeMetadata(): Promise<KnowledgeMetadata> {
  return requestApiData<KnowledgeMetadata>('/api/knowledge/metadata');
}
