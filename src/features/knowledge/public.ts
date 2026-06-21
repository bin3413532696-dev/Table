export { syncEngine } from './sync/SyncEngine';
export {
  createNote,
  createPresetTag,
  deleteNote,
  deletePresetTag,
  getAllTags,
  getKnowledgeMetadata,
  getNoteById,
  getNoteList,
  getPresetTagList,
  searchNotes,
  updateNote,
  updatePresetTag,
} from './api/notes';
export {
  createCorpus,
  deleteCorpus,
  deleteDocument,
  getChunks,
  getCorpora,
  getCorpus,
  getDocument,
  getDocuments,
  getJob,
  getJobs,
  getStats,
  search as hybridSearch,
  triggerIndex,
  updateCorpus,
  updateDocument,
  uploadDocument,
} from './api/rag';
export type { TriggerIndexResult } from './api/rag';
export type { LoadResult, SyncResult, SyncStatus } from './sync/config';
