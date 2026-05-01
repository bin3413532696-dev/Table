import Dexie, { Table } from 'dexie';

export interface KnowledgeNote {
  id: string;
  title: string;
  content: string;
  tags: string[];
  links: string[];
  backlinks: string[];
  createdAt: number;
  updatedAt: number;
}

class KnowledgeDB extends Dexie {
  notes!: Table<KnowledgeNote>;

  constructor() {
    super('KnowledgeDB');
    this.version(1).stores({
      notes: 'id, title, updatedAt, *tags, *links, *backlinks',
    });
  }
}

export const knowledgeDb = new KnowledgeDB();

export const noteOperations = {
  async create(note: Omit<KnowledgeNote, 'id' | 'createdAt' | 'updatedAt' | 'links' | 'backlinks'>): Promise<string> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await knowledgeDb.notes.add({
      ...note,
      id,
      links: [],
      backlinks: [],
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },

  async update(id: string, updates: Partial<KnowledgeNote>): Promise<void> {
    await knowledgeDb.notes.update(id, { ...updates, updatedAt: Date.now() });
  },

  async delete(id: string): Promise<void> {
    await knowledgeDb.notes.delete(id);
  },

  async getAll(): Promise<KnowledgeNote[]> {
    return knowledgeDb.notes.toArray();
  },

  async getById(id: string): Promise<KnowledgeNote | undefined> {
    return knowledgeDb.notes.get(id);
  },

  async findBacklinks(targetId: string): Promise<KnowledgeNote[]> {
    const allNotes = await knowledgeDb.notes.toArray();
    return allNotes.filter(note => note.links.includes(targetId));
  },

  async updateLinks(id: string, links: string[]): Promise<void> {
    await knowledgeDb.notes.update(id, { links, updatedAt: Date.now() });
  },
};