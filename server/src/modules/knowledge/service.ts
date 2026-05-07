import {
  createNote,
  createPresetTag,
  deleteNote,
  deletePresetTag,
  findNoteById,
  findPresetTagById,
  getKnowledgeMetadata,
  listAllTags,
  listNotes,
  listPresetTags,
  searchNotes,
  updateNote,
  updatePresetTag,
} from './repository';
import type {
  CreateNoteInput,
  CreatePresetTagInput,
  NoteSearchQueryInput,
  UpdateNoteInput,
  UpdatePresetTagInput,
} from './schema';

export async function getNoteList() {
  return listNotes();
}

export async function createNoteRecord(input: CreateNoteInput) {
  return createNote(input);
}

export async function getNoteDetail(id: string) {
  return findNoteById(id);
}

export async function updateNoteRecord(id: string, input: UpdateNoteInput) {
  return updateNote(id, input);
}

export async function deleteNoteRecord(id: string) {
  return deleteNote(id);
}

export async function searchNoteRecords(input: NoteSearchQueryInput) {
  return searchNotes(input);
}

export async function getAllTags() {
  return listAllTags();
}

export async function getPresetTagList() {
  return listPresetTags();
}

export async function createPresetTagRecord(input: CreatePresetTagInput) {
  return createPresetTag(input);
}

export async function getPresetTagDetail(id: string) {
  return findPresetTagById(id);
}

export async function updatePresetTagRecord(id: string, input: UpdatePresetTagInput) {
  return updatePresetTag(id, input);
}

export async function deletePresetTagRecord(id: string) {
  return deletePresetTag(id);
}

export async function getKnowledgeOverview() {
  return getKnowledgeMetadata();
}