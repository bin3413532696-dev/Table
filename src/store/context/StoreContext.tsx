/**
 * Store Context 和 Hooks
 * 统一状态管理入口
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { EntityId, CrudResult, FinanceRecord, Task, KnowledgeNote, CreateFinanceDTO, UpdateFinanceDTO, CreateTaskDTO, UpdateTaskDTO, CreateNoteDTO, UpdateNoteDTO } from '../../core/types';
import { eventEmitter, EventTopics, subscribeDataChange } from '../../core/events';
import { financeStore, taskStore, noteStore } from '../impl';

/**
 * Store Context 值类型
 */
interface StoreContextValue {
  // 数据
  finance: FinanceRecord[];
  tasks: Task[];
  notes: KnowledgeNote[];

  // 加载状态
  loading: boolean;

  // 财务操作
  financeActions: {
    create: (dto: CreateFinanceDTO) => Promise<CrudResult<FinanceRecord>>;
    update: (id: EntityId, dto: UpdateFinanceDTO) => Promise<CrudResult<FinanceRecord>>;
    delete: (id: EntityId) => Promise<CrudResult<void>>;
    getById: (id: EntityId) => Promise<FinanceRecord | undefined>;
    getStats: () => Promise<{ income: number; expense: number; profit: number }>;
    getModelStats: () => Promise<Record<string, { expense: number; income: number }>>;
  };

  // 任务操作
  taskActions: {
    create: (dto: CreateTaskDTO) => Promise<CrudResult<Task>>;
    update: (id: EntityId, dto: UpdateTaskDTO) => Promise<CrudResult<Task>>;
    delete: (id: EntityId) => Promise<CrudResult<void>>;
    toggle: (id: EntityId) => Promise<{ success: boolean }>;
    getById: (id: EntityId) => Promise<Task | undefined>;
    getStats: () => Promise<{ total: number; completed: number; pending: number }>;
  };

  // 笔记操作
  noteActions: {
    create: (dto: CreateNoteDTO) => Promise<CrudResult<KnowledgeNote>>;
    update: (id: EntityId, dto: UpdateNoteDTO) => Promise<CrudResult<KnowledgeNote>>;
    delete: (id: EntityId) => Promise<CrudResult<void>>;
    getById: (id: EntityId) => Promise<KnowledgeNote | undefined>;
    getStats: () => Promise<{ total: number; tagged: number; linked: number }>;
  };
}

const StoreContext = createContext<StoreContextValue | null>(null);

/**
 * Store Provider
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [finance, setFinance] = useState<FinanceRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [loading, setLoading] = useState(true);

  // 初始化加载数据
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [financeData, tasksData, notesData] = await Promise.all([
          financeStore.getAll(),
          taskStore.getAll(),
          noteStore.getAll(),
        ]);
        setFinance(financeData);
        setTasks(tasksData);
        setNotes(notesData);
      } catch (error) {
        console.error('[Store] Failed to load initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // 订阅数据变更
  useEffect(() => {
    const unsubFinance = subscribeDataChange('finance', async () => {
      setFinance(await financeStore.getAll());
    });

    const unsubTasks = subscribeDataChange('tasks', async () => {
      setTasks(await taskStore.getAll());
    });

    const unsubNotes = subscribeDataChange('notes', async () => {
      setNotes(await noteStore.getAll());
    });

    return () => {
      unsubFinance();
      unsubTasks();
      unsubNotes();
    };
  }, []);

  // 财务操作
  const financeActions = useMemo(() => ({
    create: async (dto: CreateFinanceDTO) => {
      const result = await financeStore.create(dto);
      if (result.success) {
        setFinance(await financeStore.getAll());
      }
      return result;
    },
    update: async (id: EntityId, dto: UpdateFinanceDTO) => {
      const result = await financeStore.update(id, dto);
      if (result.success) {
        setFinance(await financeStore.getAll());
      }
      return result;
    },
    delete: async (id: EntityId) => {
      const result = await financeStore.delete(id);
      if (result.success) {
        setFinance(await financeStore.getAll());
      }
      return result;
    },
    getById: (id: EntityId) => financeStore.getById(id),
    getStats: () => financeStore.getStats(),
    getModelStats: () => financeStore.getModelStats(),
  }), []);

  // 任务操作
  const taskActions = useMemo(() => ({
    create: async (dto: CreateTaskDTO) => {
      const result = await taskStore.create(dto);
      if (result.success) {
        setTasks(await taskStore.getAll());
      }
      return result;
    },
    update: async (id: EntityId, dto: UpdateTaskDTO) => {
      const result = await taskStore.update(id, dto);
      if (result.success) {
        setTasks(await taskStore.getAll());
      }
      return result;
    },
    delete: async (id: EntityId) => {
      const result = await taskStore.delete(id);
      if (result.success) {
        setTasks(await taskStore.getAll());
      }
      return result;
    },
    toggle: async (id: EntityId) => {
      const result = await taskStore.toggle(id);
      if (result.success) {
        setTasks(await taskStore.getAll());
      }
      return result;
    },
    getById: (id: EntityId) => taskStore.getById(id),
    getStats: () => taskStore.getStats(),
  }), []);

  // 笔记操作
  const noteActions = useMemo(() => ({
    create: async (dto: CreateNoteDTO) => {
      const result = await noteStore.create(dto);
      if (result.success) {
        setNotes(await noteStore.getAll());
      }
      return result;
    },
    update: async (id: EntityId, dto: UpdateNoteDTO) => {
      const result = await noteStore.update(id, dto);
      if (result.success) {
        setNotes(await noteStore.getAll());
      }
      return result;
    },
    delete: async (id: EntityId) => {
      const result = await noteStore.delete(id);
      if (result.success) {
        setNotes(await noteStore.getAll());
      }
      return result;
    },
    getById: (id: EntityId) => noteStore.getById(id),
    getStats: () => noteStore.getStats(),
  }), []);

  const value = useMemo(() => ({
    finance,
    tasks,
    notes,
    loading,
    financeActions,
    taskActions,
    noteActions,
  }), [finance, tasks, notes, loading, financeActions, taskActions, noteActions]);

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
}

/**
 * 使用完整 Store
 */
export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within StoreProvider');
  }
  return context;
}

/**
 * 使用财务数据和操作
 */
export function useFinance() {
  const { finance, loading, financeActions } = useStore();
  return { data: finance, loading, ...financeActions };
}

/**
 * 使用任务数据和操作
 */
export function useTasks() {
  const { tasks, loading, taskActions } = useStore();
  return { data: tasks, loading, ...taskActions };
}

/**
 * 使用笔记数据和操作
 */
export function useNotes() {
  const { notes, loading, noteActions } = useStore();
  return { data: notes, loading, ...noteActions };
}