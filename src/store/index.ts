/**
 * Store 模块导出
 * 统一数据存储入口
 */

// Store 实现
export { financeStore, taskStore, noteStore } from './impl';

// Context 和 Hooks
export { StoreProvider, useStore, useFinance, useTasks, useNotes } from './context';

// 基类和类型
export { BaseStore, generateId } from './base/Store';
export { IStore, StoreConfig } from './base/types';