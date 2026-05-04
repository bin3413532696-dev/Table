import {
  createKnowledgeRelationStructured,
  deleteKnowledgeAssertionStructured,
  deleteKnowledgeDocumentStructured,
  deleteKnowledgeEntityStructured,
  deleteKnowledgeRelationStructured,
  getKnowledgeDatasetRecord,
  getKnowledgeMetadataRecord,
  listKnowledgeAssertionRecords,
  listKnowledgeDocumentRecords,
  listKnowledgeEntityRecords,
  replaceKnowledgeDataset,
  upsertKnowledgeAssertionStructured,
  upsertKnowledgeDocumentStructured,
  upsertKnowledgeEntityStructured,
} from './repository';
import type {
  CreateKnowledgeRelationInput,
  UpsertKnowledgeAssertionInput,
  UpsertKnowledgeDocumentInput,
  UpsertKnowledgeEntityInput,
} from './schema';

export async function getKnowledgeDataset() {
  return getKnowledgeDatasetRecord();
}

export async function getKnowledgeMetadata() {
  return getKnowledgeMetadataRecord();
}

export async function replaceKnowledgeAuthorityDataset(raw: unknown) {
  return replaceKnowledgeDataset(raw);
}

export async function loadKnowledgeSyncPayload() {
  const knowledge = await getKnowledgeDatasetRecord();
  return {
    success: true,
    data: {
      knowledge,
    },
    timestamp: Date.now(),
  };
}

export async function replaceKnowledgeSyncPayload(raw: unknown) {
  const knowledge = await replaceKnowledgeDataset(raw);
  return {
    success: true,
    data: {
      knowledge,
    },
    timestamp: Date.now(),
  };
}

export async function listKnowledgeEntities() {
  return listKnowledgeEntityRecords();
}

export async function upsertKnowledgeEntityRecord(input: UpsertKnowledgeEntityInput) {
  return upsertKnowledgeEntityStructured(input);
}

export async function deleteKnowledgeEntityRecord(id: string) {
  return deleteKnowledgeEntityStructured(id);
}

export async function listKnowledgeDocuments() {
  return listKnowledgeDocumentRecords();
}

export async function upsertKnowledgeDocumentRecord(input: UpsertKnowledgeDocumentInput) {
  return upsertKnowledgeDocumentStructured(input);
}

export async function deleteKnowledgeDocumentRecord(id: string) {
  return deleteKnowledgeDocumentStructured(id);
}

export async function listKnowledgeAssertions() {
  return listKnowledgeAssertionRecords();
}

export async function upsertKnowledgeAssertionRecord(input: UpsertKnowledgeAssertionInput) {
  return upsertKnowledgeAssertionStructured(input);
}

export async function deleteKnowledgeAssertionRecord(id: string) {
  return deleteKnowledgeAssertionStructured(id);
}

export async function createKnowledgeRelationRecord(input: CreateKnowledgeRelationInput) {
  return createKnowledgeRelationStructured(input);
}

export async function deleteKnowledgeRelationRecord(
  subjectId: string,
  predicateId: string,
  targetId: string
) {
  return deleteKnowledgeRelationStructured(subjectId, predicateId, targetId);
}
