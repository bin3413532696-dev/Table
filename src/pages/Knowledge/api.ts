import { fetchWithAuth } from '../../lib/auth';
import type { KnowledgeNote, KnowledgePresetTag, KnowledgeSearchHit, KnowledgeMetadata } from './types';

function assertOk(response: Response, context: string): void {
  if (!response.ok) {
    throw new Error(`${context}: HTTP ${response.status}`);
  }
}

export async function getNoteList(): Promise<KnowledgeNote[]> {
  const response = await fetchWithAuth('/api/knowledge/notes');
  assertOk(response, 'Failed to fetch notes');
  const data = await response.json();
  return data.items;
}

export async function createNote(input: { title: string; content?: string; tags?: string[] }): Promise<KnowledgeNote> {
  const response = await fetchWithAuth('/api/knowledge/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  assertOk(response, 'Failed to create note');
  const data = await response.json();
  return data.data;
}

export async function getNoteById(id: string): Promise<KnowledgeNote | null> {
  const response = await fetchWithAuth(`/api/knowledge/notes/${id}`);
  if (response.status === 404) {
    return null;
  }
  assertOk(response, 'Failed to fetch note');
  const data = await response.json();
  return data.data;
}

export async function updateNote(id: string, input: { title?: string; content?: string; tags?: string[] }): Promise<KnowledgeNote | null> {
  const response = await fetchWithAuth(`/api/knowledge/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 404) {
    return null;
  }
  assertOk(response, 'Failed to update note');
  const data = await response.json();
  return data.data;
}

export async function deleteNote(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/knowledge/notes/${id}`, {
    method: 'DELETE',
  });
  assertOk(response, 'Failed to delete note');
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
  const response = await fetchWithAuth(`/api/knowledge/search?${params.toString()}`);
  assertOk(response, 'Failed to search notes');
  const data = await response.json();
  return data.items;
}

export async function getAllTags(): Promise<string[]> {
  const response = await fetchWithAuth('/api/knowledge/tags');
  assertOk(response, 'Failed to fetch tags');
  const data = await response.json();
  return data.items;
}

export async function getPresetTagList(): Promise<KnowledgePresetTag[]> {
  const response = await fetchWithAuth('/api/knowledge/tags/preset');
  assertOk(response, 'Failed to fetch preset tags');
  const data = await response.json();
  return data.items;
}

export async function createPresetTag(input: { name: string; color?: string }): Promise<KnowledgePresetTag> {
  const response = await fetchWithAuth('/api/knowledge/tags/preset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  assertOk(response, 'Failed to create preset tag');
  const data = await response.json();
  return data.data;
}

export async function updatePresetTag(id: string, input: { name?: string; color?: string }): Promise<KnowledgePresetTag | null> {
  const response = await fetchWithAuth(`/api/knowledge/tags/preset/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (response.status === 404) {
    return null;
  }
  assertOk(response, 'Failed to update preset tag');
  const data = await response.json();
  return data.data;
}

export async function deletePresetTag(id: string): Promise<void> {
  const response = await fetchWithAuth(`/api/knowledge/tags/preset/${id}`, {
    method: 'DELETE',
  });
  assertOk(response, 'Failed to delete preset tag');
}

export async function getKnowledgeMetadata(): Promise<KnowledgeMetadata> {
  const response = await fetchWithAuth('/api/knowledge/metadata');
  assertOk(response, 'Failed to fetch knowledge metadata');
  const data = await response.json();
  return data.data;
}
