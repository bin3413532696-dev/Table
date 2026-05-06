import {
  createKnowledgeRelationStructured,
  deleteOntologyClass,
  deleteOntologyRelation,
  deleteKnowledgeAssertionStructured,
  deleteKnowledgeDocumentStructured,
  deleteKnowledgeEntityStructured,
  deleteKnowledgeRelationStructured,
  getKnowledgeDatasetRecord,
  getKnowledgeMetadataRecord,
  listOntologyClasses,
  listOntologyRelations,
  listKnowledgeAssertionRecords,
  listKnowledgeDocumentRecords,
  listKnowledgeEntityRecords,
  searchKnowledgeRecords,
  rebuildKnowledgeProjections,
  replaceKnowledgeDataset,
  upsertOntologyClass,
  upsertOntologyRelation,
  upsertKnowledgeAssertionStructured,
  upsertKnowledgeDocumentStructured,
  upsertKnowledgeEntityStructured,
} from './repository';
import type {
  CreateKnowledgeRelationInput,
  KnowledgeSearchQueryInput,
  UpsertOntologyClassInput,
  UpsertOntologyRelationInput,
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

export async function searchKnowledge(input: KnowledgeSearchQueryInput) {
  return searchKnowledgeRecords(input);
}

export async function listKnowledgeOntologyClasses() {
  return listOntologyClasses();
}

export async function upsertKnowledgeOntologyClass(input: UpsertOntologyClassInput) {
  return upsertOntologyClass(input);
}

export async function deleteKnowledgeOntologyClass(id: string) {
  return deleteOntologyClass(id);
}

export async function listKnowledgeOntologyRelations() {
  return listOntologyRelations();
}

export async function upsertKnowledgeOntologyRelation(input: UpsertOntologyRelationInput) {
  return upsertOntologyRelation(input);
}

export async function deleteKnowledgeOntologyRelation(id: string) {
  return deleteOntologyRelation(id);
}

export async function rebuildKnowledgeProjectionRecords() {
  return rebuildKnowledgeProjections();
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
