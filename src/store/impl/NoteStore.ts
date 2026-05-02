/**
 * 笔记存储实现
 * 使用 IndexedDB (Dexie)
 */

import Dexie, { Table } from 'dexie';
import { BaseStore } from '../base/Store';
import { StoreConfig } from '../base/types';
import { KnowledgeNote, CreateNoteDTO, UpdateNoteDTO, NoteStats } from '../../core/types';
import { EventTopics } from '../../core/events';
import { isValidNote, isValidCreateNoteDTO } from '../../core/validation';

/**
 * 笔记数据库类
 */
class NoteDB extends Dexie {
  notes!: Table<KnowledgeNote>;

  constructor() {
    super('KnowledgeDB');
    this.version(1).stores({
      notes: 'id, title, updatedAt, *tags, *links, *backlinks',
    });
  }
}

/**
 * 笔记数据库实例
 */
const noteDB = new NoteDB();

/**
 * 笔记存储配置
 */
const NOTE_STORE_CONFIG: StoreConfig = {
  storageKey: 'notes',
  typeName: 'KnowledgeNote',
  autoSync: true,
};

/**
 * 笔记存储类
 */
class NoteStoreClass extends BaseStore<KnowledgeNote, CreateNoteDTO, UpdateNoteDTO> {
  protected readonly config = NOTE_STORE_CONFIG;
  protected readonly changeTopic = EventTopics.NOTES_CHANGED;

  // IndexedDB 不使用 localStorage，重写加载/保存逻辑
  protected loadFromStorage(): KnowledgeNote[] {
    // IndexedDB 是异步的，这里返回空数组
    // 实际数据在构造后通过 init() 加载
    return [];
  }

  protected saveToStorage(data: KnowledgeNote[]): void {
    // IndexedDB 不需要同步保存，由各操作方法处理
  }

  private dbData: KnowledgeNote[] = [];
  private dbInitialized = false;

  /**
   * 初始化 IndexedDB 数据
   */
  async init(): Promise<void> {
    if (this.dbInitialized) return;
    this.dbData = await noteDB.notes.toArray();
    this.dbInitialized = true;
  }

  protected validate(entity: unknown): entity is KnowledgeNote {
    return isValidNote(entity);
  }

  protected validateCreateDTO(dto: unknown): dto is CreateNoteDTO {
    return isValidCreateNoteDTO(dto);
  }

  /**
   * 获取所有笔记
   */
  async getAll(): Promise<KnowledgeNote[]> {
    await this.init();
    return [...this.dbData];
  }

  /**
   * 按 ID 获取笔记
   */
  async getById(id: string): Promise<KnowledgeNote | undefined> {
    await this.init();
    return this.dbData.find(n => n.id === id);
  }

  /**
   * 创建笔记
   */
  async create(dto: CreateNoteDTO): Promise<{ success: boolean; data?: KnowledgeNote; error?: import('../../core/errors').AppError }> {
    try {
      if (!isValidCreateNoteDTO(dto)) {
        return {
          success: false,
          error: await import('../../core/errors').then(({ AppError, ErrorCode }) =>
            AppError.fromCode(ErrorCode.VALIDATION_FAILED, this.config.typeName)
          ),
        };
      }

      const now = Date.now();
      const note: KnowledgeNote = {
        id: crypto.randomUUID(),
        title: dto.title,
        content: dto.content,
        tags: dto.tags || [],
        links: [],
        backlinks: [],
        createdAt: now,
        updatedAt: now,
      };

      await noteDB.notes.add(note);
      this.dbData = [note, ...this.dbData];
      this.persist();

      return { success: true, data: note };
    } catch (error) {
      return {
        success: false,
        error: await import('../../core/errors').then(({ errorHandler }) =>
          errorHandler.handle(error, `${this.config.typeName}.create`)
        ),
      };
    }
  }

  /**
   * 更新笔记
   */
  async update(id: string, dto: UpdateNoteDTO): Promise<{ success: boolean; data?: KnowledgeNote; error?: import('../../core/errors').AppError }> {
    try {
      const index = this.dbData.findIndex(n => n.id === id);
      if (index === -1) {
        return {
          success: false,
          error: await import('../../core/errors').then(({ AppError, ErrorCode }) =>
            AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, id)
          ),
        };
      }

      const oldNote = this.dbData[index];
      const updated: KnowledgeNote = {
        ...oldNote,
        ...dto,
        updatedAt: Date.now(),
      };

      if (!isValidNote(updated)) {
        return {
          success: false,
          error: await import('../../core/errors').then(({ AppError, ErrorCode }) =>
            AppError.fromCode(ErrorCode.VALIDATION_FAILED, this.config.typeName)
          ),
        };
      }

      // 同步 backlinks：当 links 变化时，需要更新被链接笔记的 backlinks
      if (dto.links !== undefined && dto.links !== oldNote.links) {
        const oldLinkIds = new Set(oldNote.links);
        const newLinkIds = new Set(dto.links);

        // 1. 从之前链接但现在不再链接的笔记的 backlinks 中移除
        for (const removedLinkId of oldLinkIds) {
          if (!newLinkIds.has(removedLinkId)) {
            const targetNote = this.dbData.find(n => n.id === removedLinkId);
            if (targetNote && targetNote.backlinks.includes(id)) {
              const updatedBacklinks = targetNote.backlinks.filter(b => b !== id);
              await noteDB.notes.update(removedLinkId, { backlinks: updatedBacklinks, updatedAt: Date.now() });
              const targetIndex = this.dbData.findIndex(n => n.id === removedLinkId);
              if (targetIndex !== -1) {
                this.dbData[targetIndex] = { ...this.dbData[targetIndex], backlinks: updatedBacklinks, updatedAt: Date.now() };
              }
            }
          }
        }

        // 2. 向新链接的笔记的 backlinks 中添加
        for (const addedLinkId of newLinkIds) {
          if (!oldLinkIds.has(addedLinkId)) {
            const targetNote = this.dbData.find(n => n.id === addedLinkId);
            if (targetNote && !targetNote.backlinks.includes(id)) {
              const updatedBacklinks = [...targetNote.backlinks, id];
              await noteDB.notes.update(addedLinkId, { backlinks: updatedBacklinks, updatedAt: Date.now() });
              const targetIndex = this.dbData.findIndex(n => n.id === addedLinkId);
              if (targetIndex !== -1) {
                this.dbData[targetIndex] = { ...this.dbData[targetIndex], backlinks: updatedBacklinks, updatedAt: Date.now() };
              }
            }
          }
        }
      }

      await noteDB.notes.update(id, {
        title: updated.title,
        content: updated.content,
        tags: updated.tags,
        links: updated.links,
        backlinks: updated.backlinks,
        updatedAt: updated.updatedAt,
      });
      this.dbData[index] = updated;
      this.persist();

      return { success: true, data: updated };
    } catch (error) {
      return {
        success: false,
        error: await import('../../core/errors').then(({ errorHandler }) =>
          errorHandler.handle(error, `${this.config.typeName}.update`)
        ),
      };
    }
  }

  /**
   * 删除笔记
   */
  async delete(id: string): Promise<{ success: boolean; error?: import('../../core/errors').AppError }> {
    try {
      const index = this.dbData.findIndex(n => n.id === id);
      if (index === -1) {
        return {
          success: false,
          error: await import('../../core/errors').then(({ AppError, ErrorCode }) =>
            AppError.fromCode(ErrorCode.ENTITY_NOT_FOUND, id)
          ),
        };
      }

      // 删除笔记时，清理其他笔记中的链接
      for (const note of this.dbData) {
        if (note.links.includes(id)) {
          const updatedLinks = note.links.filter(l => l !== id);
          await noteDB.notes.update(note.id, { links: updatedLinks, updatedAt: Date.now() });
        }
        if (note.backlinks.includes(id)) {
          const updatedBacklinks = note.backlinks.filter(b => b !== id);
          await noteDB.notes.update(note.id, { backlinks: updatedBacklinks, updatedAt: Date.now() });
        }
      }

      await noteDB.notes.delete(id);
      this.dbData.splice(index, 1);
      this.persist();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: await import('../../core/errors').then(({ errorHandler }) =>
          errorHandler.handle(error, `${this.config.typeName}.delete`)
        ),
      };
    }
  }

  /**
   * 获取数量
   */
  async count(): Promise<number> {
    await this.init();
    return this.dbData.length;
  }

  /**
   * 获取笔记统计
   */
  async getStats(): Promise<NoteStats> {
    await this.init();
    const total = this.dbData.length;
    const tagged = this.dbData.filter(n => n.tags.length > 0).length;
    const linked = this.dbData.filter(n => n.links.length > 0).length;

    return { total, tagged, linked };
  }

  /**
   * 查找反向链接
   */
  async findBacklinks(targetId: string): Promise<KnowledgeNote[]> {
    await this.init();
    return this.dbData.filter(n => n.links.includes(targetId));
  }

  /**
   * 更新笔记内容并自动提取 WikiLinks
   */
  async updateContent(id: string, content: string, title?: string): Promise<{ success: boolean; error?: import('../../core/errors').AppError }> {
    await this.init();
    const newLinks = this.extractWikiLinks(content, this.dbData);

    const dto: UpdateNoteDTO = {
      content,
      links: newLinks,
    };
    if (title) dto.title = title;

    return this.update(id, dto);
  }

  /**
   * 从内容中提取 WikiLinks
   */
  private extractWikiLinks(content: string, allNotes: KnowledgeNote[]): string[] {
    const links: Set<string> = new Set();

    // Markdown 格式: [[笔记名]]
    const markdownRegex = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = markdownRegex.exec(content)) !== null) {
      const linkName = match[1].trim();
      const linkedNote = allNotes.find(
        n => n.title.toLowerCase() === linkName.toLowerCase() ||
             n.id === linkName.toLowerCase().replace(/\s+/g, '-')
      );
      if (linkedNote) links.add(linkedNote.id);
    }

    // HTML 格式: data-id="xxx"
    const htmlRegex = /data-type="wiki-link"[^>]*data-id="([^"]+)"/g;
    while ((match = htmlRegex.exec(content)) !== null) {
      const linkId = match[1];
      if (allNotes.some(n => n.id === linkId)) links.add(linkId);
    }

    return Array.from(links);
  }

  /**
   * 批量导入笔记
   */
  async importNotes(notes: KnowledgeNote[]): Promise<{ success: boolean; imported: number }> {
    const validNotes = notes.filter(isValidNote);

    for (const note of validNotes) {
      await noteDB.notes.put(note);
    }

    this.dbData = await noteDB.notes.toArray();
    this.persist();

    return { success: true, imported: validNotes.length };
  }

  /**
   * 清空所有笔记
   */
  async clearAll(): Promise<void> {
    await noteDB.notes.clear();
    this.dbData = [];
    this.persist();
  }

  /**
   * 持久化触发事件和同步
   */
  protected persist(): void {
    import('../../core/events').then(({ eventEmitter }) => {
      eventEmitter.emit(this.changeTopic);
    });
    import('../../sync').then(({ syncEngine }) => {
      syncEngine.schedule('notes');
    });
  }
}

/**
 * 笔记存储实例
 */
export const noteStore = new NoteStoreClass();