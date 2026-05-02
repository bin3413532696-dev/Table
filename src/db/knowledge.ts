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

// ==================== 数据验证 ====================

function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 10 && /^[a-z0-9-]+$/i.test(id);
}

function isValidNote(note: unknown): note is KnowledgeNote {
  if (typeof note !== 'object' || note === null) return false;
  const n = note as KnowledgeNote;
  return (
    isValidId(n.id) &&
    typeof n.title === 'string' && n.title.length > 0 &&
    typeof n.content === 'string' &&
    Array.isArray(n.tags) && n.tags.every(t => typeof t === 'string') &&
    Array.isArray(n.links) && n.links.every(l => typeof l === 'string') &&
    Array.isArray(n.backlinks) && n.backlinks.every(b => typeof b === 'string') &&
    typeof n.createdAt === 'number' && n.createdAt > 0 &&
    typeof n.updatedAt === 'number' && n.updatedAt > 0
  );
}

// ==================== 变更订阅机制 ====================

type KnowledgeListener = () => void;
const knowledgeListeners = new Set<KnowledgeListener>();

function notifyKnowledgeChange() {
  knowledgeListeners.forEach(listener => listener());
}

export function subscribeKnowledge(listener: KnowledgeListener): () => void {
  knowledgeListeners.add(listener);
  return () => knowledgeListeners.delete(listener);
}

// ==================== 数据同步机制 ====================

let knowledgeSyncTimer: ReturnType<typeof setTimeout> | null = null;
let knowledgeSyncStatus: 'idle' | 'syncing' | 'success' | 'error' = 'idle';
const KNOWLEDGE_SYNC_DELAY = 2000;

async function performKnowledgeSync(): Promise<{ success: boolean; error?: string }> {
  if (knowledgeSyncStatus === 'syncing') {
    return { success: false, error: 'Sync already in progress' };
  }

  try {
    knowledgeSyncStatus = 'syncing';
    const notes = await knowledgeDb.notes.toArray();

    const response = await fetch('/api/sync-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });

    if (!response.ok) {
      throw new Error(`Sync failed with status ${response.status}`);
    }

    knowledgeSyncStatus = 'success';
    return { success: true };
  } catch (error) {
    knowledgeSyncStatus = 'error';
    const errMsg = error instanceof Error ? error.message : 'Unknown sync error';
    console.warn('[Knowledge Sync] Failed:', errMsg);
    return { success: false, error: errMsg };
  } finally {
    knowledgeSyncStatus = 'idle';
  }
}

function scheduleKnowledgeSync() {
  if (knowledgeSyncTimer) clearTimeout(knowledgeSyncTimer);
  knowledgeSyncTimer = setTimeout(() => {
    knowledgeSyncTimer = null;
    if (typeof fetch !== 'undefined') {
      performKnowledgeSync();
    }
  }, KNOWLEDGE_SYNC_DELAY);
}

export function getKnowledgeSyncStatus() {
  return knowledgeSyncStatus;
}

// ==================== WikiLink 提取 ====================

/**
 * 从内容中提取 WikiLink IDs
 * 支持两种格式：
 * 1. 编辑器生成的 data-id 格式
 * 2. Markdown [[笔记名]] 格式
 */
export function extractWikiLinks(content: string, allNotes: KnowledgeNote[]): string[] {
  const links: Set<string> = new Set();

  // 匹配 Markdown 格式的 WikiLink: [[笔记名]]
  const markdownRegex = /\[\[([^\]]+)\]\]/g;
  let match;
  while ((match = markdownRegex.exec(content)) !== null) {
    const linkName = match[1].trim();
    // 尝试通过标题找到对应的笔记 ID
    const linkedNote = allNotes.find(
      (n) => n.title.toLowerCase() === linkName.toLowerCase() ||
             n.id === linkName.toLowerCase().replace(/\s+/g, '-')
    );
    if (linkedNote) {
      links.add(linkedNote.id);
    }
  }

  // 匹配 HTML 格式的 WikiLink: data-id="xxx"
  const htmlRegex = /data-type="wiki-link"[^>]*data-id="([^"]+)"/g;
  while ((match = htmlRegex.exec(content)) !== null) {
    const linkId = match[1];
    // 检查这个 ID 是否对应存在的笔记
    if (allNotes.some((n) => n.id === linkId)) {
      links.add(linkId);
    }
  }

  return Array.from(links);
}

// ==================== IndexedDB 数据库 ====================

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

// ==================== 笔记操作 ====================

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
    notifyKnowledgeChange();
    scheduleKnowledgeSync();
    return id;
  },

  async update(id: string, updates: Partial<KnowledgeNote>): Promise<void> {
    await knowledgeDb.notes.update(id, { ...updates, updatedAt: Date.now() });
    notifyKnowledgeChange();
    scheduleKnowledgeSync();
  },

  async delete(id: string): Promise<void> {
    // 删除笔记时，需要从其他笔记的 links 和 backlinks 中移除该 ID
    const allNotes = await knowledgeDb.notes.toArray();
    for (const note of allNotes) {
      if (note.links.includes(id)) {
        await knowledgeDb.notes.update(note.id, {
          links: note.links.filter((linkId) => linkId !== id),
          updatedAt: Date.now(),
        });
      }
      if (note.backlinks.includes(id)) {
        await knowledgeDb.notes.update(note.id, {
          backlinks: note.backlinks.filter((backlinkId) => backlinkId !== id),
          updatedAt: Date.now(),
        });
      }
    }
    await knowledgeDb.notes.delete(id);
    notifyKnowledgeChange();
    scheduleKnowledgeSync();
  },

  async getAll(): Promise<KnowledgeNote[]> {
    return knowledgeDb.notes.toArray();
  },

  async getCount(): Promise<number> {
    return knowledgeDb.notes.count();
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
    notifyKnowledgeChange();
    scheduleKnowledgeSync();
  },

  /**
   * 更新笔记内容并自动提取/更新 links
   */
  async updateContent(id: string, content: string, title?: string): Promise<void> {
    const allNotes = await knowledgeDb.notes.toArray();
    const newLinks = extractWikiLinks(content, allNotes);

    const updates: Partial<KnowledgeNote> = {
      content,
      links: newLinks,
      updatedAt: Date.now(),
    };
    if (title) {
      updates.title = title;
    }
    await knowledgeDb.notes.update(id, updates);
    notifyKnowledgeChange();
    scheduleKnowledgeSync();
  },

  /**
   * 重建所有笔记的 links 关系
   */
  async rebuildAllLinks(): Promise<void> {
    const allNotes = await knowledgeDb.notes.toArray();
    for (const note of allNotes) {
      const newLinks = extractWikiLinks(note.content, allNotes);
      if (newLinks.length !== note.links.length ||
          !newLinks.every(link => note.links.includes(link))) {
        await knowledgeDb.notes.update(note.id, {
          links: newLinks,
          updatedAt: Date.now(),
        });
      }
    }
    notifyKnowledgeChange();
    scheduleKnowledgeSync();
  },

  /**
   * 批量导入笔记
   */
  async importNotes(notes: KnowledgeNote[]): Promise<{ success: boolean; imported: number }> {
    const validNotes = notes.filter(isValidNote);
    if (validNotes.length !== notes.length) {
      console.warn('[Knowledge] Some notes failed validation');
    }

    for (const note of validNotes) {
      await knowledgeDb.notes.put(note);
    }

    notifyKnowledgeChange();
    scheduleKnowledgeSync();

    return { success: true, imported: validNotes.length };
  },

  /**
   * 清空所有笔记
   */
  async clearAll(): Promise<void> {
    await knowledgeDb.notes.clear();
    notifyKnowledgeChange();
    scheduleKnowledgeSync();
  },
};

// ==================== 统计信息 ====================

export const knowledgeStats = {
  async getStats(): Promise<{ total: number; tagged: number; linked: number }> {
    const notes = await knowledgeDb.notes.toArray();
    return {
      total: notes.length,
      tagged: notes.filter(n => n.tags.length > 0).length,
      linked: notes.filter(n => n.links.length > 0).length,
    };
  },

  async getTagStats(): Promise<Record<string, number>> {
    const notes = await knowledgeDb.notes.toArray();
    const tagCounts: Record<string, number> = {};
    notes.forEach(note => {
      note.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    return tagCounts;
  },
};