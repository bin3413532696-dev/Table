/**
 * 统一验证机制
 * 所有数据验证函数集中定义
 */

import { Timestamp, EntityId } from '../types';

/**
 * 验证常量
 */
export const VALIDATION_CONSTANTS = {
  MAX_AMOUNT: 999999999.99,
  MAX_STRING_LENGTH: 500,
  MAX_TITLE_LENGTH: 100,
  MAX_CONTENT_LENGTH: 100000, // 100KB
  MIN_ID_LENGTH: 10,
} as const;

/**
 * 统一 ID 验证
 * 单一定义，避免重复
 */
export function isValidId(id: unknown): id is EntityId {
  return (
    typeof id === 'string' &&
    id.length >= VALIDATION_CONSTANTS.MIN_ID_LENGTH &&
    /^[a-z0-9-]+$/i.test(id)
  );
}

/**
 * 时间戳验证
 */
export function isValidTimestamp(timestamp: unknown): timestamp is Timestamp {
  return (
    typeof timestamp === 'number' &&
    timestamp > 0 &&
    timestamp <= Date.now() + 86400000 // 允许未来24小时内
  );
}

/**
 * ISO 日期格式验证 (YYYY-MM-DD)
 */
export function isValidISODate(dateStr: unknown): boolean {
  if (typeof dateStr !== 'string') return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * 金额验证
 */
export function isValidAmount(amount: unknown): boolean {
  return (
    typeof amount === 'number' &&
    amount >= 0 &&
    amount <= VALIDATION_CONSTANTS.MAX_AMOUNT &&
    !isNaN(amount)
  );
}

/**
 * 字符串长度验证
 */
export function isValidString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

/**
 * 非空字符串验证
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 数组验证
 */
export function isValidArray(value: unknown, itemValidator?: (item: unknown) => boolean): value is unknown[] {
  if (!Array.isArray(value)) return false;
  if (itemValidator) {
    return value.every(itemValidator);
  }
  return true;
}

/**
 * 字符串数组验证
 */
export function isStringArray(value: unknown): value is string[] {
  return isValidArray(value, (item): item is string => typeof item === 'string');
}

/**
 * 创建验证器工厂函数
 * 用于组合多个验证规则
 */
export function createValidator<T>(
  ...rules: Array<(value: unknown) => boolean>
): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    return rules.every(rule => rule(value));
  };
}

/**
 * 财务记录验证
 */
export function isValidFinanceRecord(record: unknown): record is import('../types').FinanceRecord {
  if (typeof record !== 'object' || record === null) return false;
  const r = record as Record<string, unknown>;

  return (
    isValidId(r.id) &&
    (r.type === 'income' || r.type === 'expense') &&
    isValidAmount(r.amount) &&
    isValidString(r.description, VALIDATION_CONSTANTS.MAX_STRING_LENGTH) &&
    isValidString(r.category, VALIDATION_CONSTANTS.MAX_STRING_LENGTH) &&
    isValidISODate(r.date) &&
    isValidTimestamp(r.createdAt) &&
    isValidTimestamp(r.updatedAt) &&
    (r.model === undefined || isValidString(r.model, VALIDATION_CONSTANTS.MAX_STRING_LENGTH))
  );
}

/**
 * 创建财务记录 DTO 验证
 */
export function isValidCreateFinanceDTO(dto: unknown): dto is import('../types').CreateFinanceDTO {
  if (typeof dto !== 'object' || dto === null) return false;
  const d = dto as Record<string, unknown>;

  return (
    (d.type === 'income' || d.type === 'expense') &&
    isValidAmount(d.amount) &&
    isValidString(d.description, VALIDATION_CONSTANTS.MAX_STRING_LENGTH) &&
    isValidString(d.category, VALIDATION_CONSTANTS.MAX_STRING_LENGTH) &&
    isValidISODate(d.date) &&
    (d.model === undefined || isValidString(d.model, VALIDATION_CONSTANTS.MAX_STRING_LENGTH))
  );
}

/**
 * 任务验证
 */
export function isValidTask(record: unknown): record is import('../types').Task {
  if (typeof record !== 'object' || record === null) return false;
  const r = record as Record<string, unknown>;

  return (
    isValidId(r.id) &&
    isValidString(r.title, VALIDATION_CONSTANTS.MAX_TITLE_LENGTH) &&
    typeof r.completed === 'boolean' &&
    isValidTimestamp(r.createdAt) &&
    isValidTimestamp(r.updatedAt) &&
    (r.priority === 'low' || r.priority === 'medium' || r.priority === 'high') &&
    (r.dueDate === undefined || isValidISODate(r.dueDate))
  );
}

/**
 * 创建任务 DTO 验证
 */
export function isValidCreateTaskDTO(dto: unknown): dto is import('../types').CreateTaskDTO {
  if (typeof dto !== 'object' || dto === null) return false;
  const d = dto as Record<string, unknown>;

  return (
    isValidString(d.title, VALIDATION_CONSTANTS.MAX_TITLE_LENGTH) &&
    (d.completed === undefined || typeof d.completed === 'boolean') &&
    (d.priority === undefined || ['low', 'medium', 'high'].includes(d.priority as string)) &&
    (d.dueDate === undefined || isValidISODate(d.dueDate))
  );
}

/**
 * 知识笔记验证
 */
export function isValidNote(note: unknown): note is import('../types').KnowledgeNote {
  if (typeof note !== 'object' || note === null) return false;
  const n = note as Record<string, unknown>;

  return (
    isValidId(n.id) &&
    isNonEmptyString(n.title) &&
    isValidString(n.content, VALIDATION_CONSTANTS.MAX_CONTENT_LENGTH) &&
    isStringArray(n.tags) &&
    isStringArray(n.links) &&
    isStringArray(n.backlinks) &&
    isValidTimestamp(n.createdAt) &&
    isValidTimestamp(n.updatedAt)
  );
}

/**
 * 创建笔记 DTO 验证
 */
export function isValidCreateNoteDTO(dto: unknown): dto is import('../types').CreateNoteDTO {
  if (typeof dto !== 'object' || dto === null) return false;
  const d = dto as Record<string, unknown>;

  return (
    isNonEmptyString(d.title) &&
    isValidString(d.content, VALIDATION_CONSTANTS.MAX_CONTENT_LENGTH) &&
    (d.tags === undefined || isStringArray(d.tags))
  );
}
