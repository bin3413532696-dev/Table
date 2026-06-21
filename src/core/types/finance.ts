/**
 * 财务相关类型定义
 */

import { BaseEntity } from './base';

/** 财务记录类型 */
export type FinanceType = 'income' | 'expense';

/** 财务类别（字符串类型，可扩展） */
export type FinanceCategory = string;

/**
 * 财务记录实体
 */
export interface FinanceRecord extends BaseEntity {
  type: FinanceType;
  amount: number;
  description: string;
  category: FinanceCategory;
  date: string; // ISO 日期格式 YYYY-MM-DD，用于按日查询
  model?: string; // 关联模型（可选）
}

/**
 * 创建财务记录 DTO
 * 不包含 id 和时间戳，由 Store 自动生成
 */
export interface CreateFinanceDTO {
  type: FinanceType;
  amount: number;
  description: string;
  category: FinanceCategory;
  date: string;
  model?: string;
}

/**
 * 更新财务记录 DTO
 */
export type UpdateFinanceDTO = Partial<CreateFinanceDTO>;

/**
 * 财务统计结果
 */
export interface FinanceStats {
  income: number;
  expense: number;
  profit: number;
}

/**
 * 按模型统计结果
 */
export interface ModelStats {
  expense: number;
  income: number;
}
