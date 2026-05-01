import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { embedText, cosineSimilarity } from './embeddings';

export interface VectorDocument {
  id: string;
  text: string;
  vector: Float32Array;
  metadata?: Record<string, any>;
  updatedAt: number;
}

interface VectorDBSchema extends DBSchema {
  vectors: {
    key: string;
    value: VectorDocument;
    indexes: { 'by-updated': number };
  };
}

let db: IDBPDatabase<VectorDBSchema> | null = null;

export async function initVectorStore(): Promise<void> {
  if (db) return;

  db = await openDB<VectorDBSchema>('semantic-search-db', 1, {
    upgrade(database) {
      const store = database.createObjectStore('vectors', { keyPath: 'id' });
      store.createIndex('by-updated', 'updatedAt');
    },
  });
}

export async function addDocument(doc: Omit<VectorDocument, 'vector' | 'updatedAt'>): Promise<void> {
  if (!db) await initVectorStore();
  if (!db) throw new Error('Database not initialized');

  const vector = await embedText(doc.text);
  await db!.put('vectors', {
    ...doc,
    vector,
    updatedAt: Date.now(),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  if (!db) await initVectorStore();
  if (!db) throw new Error('Database not initialized');

  await db!.delete('vectors', id);
}

export async function searchVectors(
  query: string,
  topK: number = 5
): Promise<Array<{ id: string; text: string; score: number; metadata?: Record<string, any> }>> {
  if (!db) await initVectorStore();
  if (!db) throw new Error('Database not initialized');

  const queryVector = await embedText(query);
  const allDocs = await db!.getAll('vectors');

  const scores = allDocs.map((doc) => ({
    id: doc.id,
    text: doc.text,
    score: cosineSimilarity(queryVector, doc.vector),
    metadata: doc.metadata,
  }));

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function reindexAll(
  docs: Array<{ id: string; text: string; metadata?: Record<string, any> }>,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  if (!db) await initVectorStore();
  if (!db) throw new Error('Database not initialized');

  const total = docs.length;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const vector = await embedText(doc.text);

    await db!.put('vectors', {
      id: doc.id,
      text: doc.text,
      vector,
      metadata: doc.metadata,
      updatedAt: Date.now(),
    });

    onProgress?.(i + 1, total);
  }
}

export async function getIndexedCount(): Promise<number> {
  if (!db) await initVectorStore();
  if (!db) return 0;

  return db!.count('vectors');
}

export async function clearVectorStore(): Promise<void> {
  if (!db) await initVectorStore();
  if (!db) return;

  await db!.clear('vectors');
}