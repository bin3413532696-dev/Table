/**
 * 知识笔记相关类型定义
 */

import { BaseEntity, Timestamp } from './base';

/**
 * 知识笔记实体
 */
export interface KnowledgeNote extends BaseEntity {
  title: string;
  content: string;
  tags: string[];
  links: string[]; // WikiLink 目标笔记 ID
  backlinks: string[]; // 反向链接来源笔记 ID
}

/**
 * 创建笔记 DTO
 */
export interface CreateNoteDTO {
  title: string;
  content: string;
  tags?: string[];
}

/**
 * 更新笔记 DTO
 */
export interface UpdateNoteDTO {
  title?: string;
  content?: string;
  tags?: string[];
  links?: string[];
}

/**
 * 笔记统计结果
 */
export interface NoteStats {
  total: number;
  tagged: number;
  linked: number;
}

/**
 * 搜索结果
 */
export interface NoteSearchResult {
  note: KnowledgeNote;
  score: number;
}
