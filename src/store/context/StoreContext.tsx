import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type {
  CreateFinanceDTO,
  CreateTaskDTO,
  CrudResult,
  EntityId,
  FinanceRecord,
  Task,
  UpdateFinanceDTO,
  UpdateTaskDTO,
} from '../../core/types';
import { financeDB, subscribe, taskDB } from '../../db';

interface StoreContextValue {
  finance: FinanceRecord[];
  tasks: Task[];
  loading: boolean;
  financeActions: {
    create: (dto: CreateFinanceDTO) => Promise<CrudResult<FinanceRecord>>;
    update: (id: EntityId, dto: UpdateFinanceDTO) => Promise<CrudResult<FinanceRecord>>;
    delete: (id: EntityId) => Promise<CrudResult<void>>;
    getById: (id: EntityId) => Promise<FinanceRecord | undefined>;
    getStats: () => Promise<{ income: number; expense: number; profit: number }>;
    getModelStats: () => Promise<Record<string, { expense: number; income: number }>>;
  };
  taskActions: {
    create: (dto: CreateTaskDTO) => Promise<CrudResult<Task>>;
    update: (id: EntityId, dto: UpdateTaskDTO) => Promise<CrudResult<Task>>;
    delete: (id: EntityId) => Promise<CrudResult<void>>;
    toggle: (id: EntityId) => Promise<{ success: boolean }>;
    getById: (id: EntityId) => Promise<Task | undefined>;
    getStats: () => Promise<{ total: number; completed: number; pending: number }>;
  };
}

const StoreContext = createContext<StoreContextValue | null>(null);

function toErrorResult<T>(message: string): CrudResult<T> {
  return {
    success: false,
    error: { message } as any,
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [finance, setFinance] = useState<FinanceRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [financeData, taskData] = await Promise.all([
          financeDB.getAll(),
          taskDB.getAll(),
        ]);
        setFinance(financeData);
        setTasks(taskData);
      } catch (error) {
        console.error('[Store] Failed to load initial data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    return subscribe(async (collection) => {
      if (collection === 'finance') {
        setFinance(await financeDB.getAll());
        return;
      }

      if (collection === 'tasks') {
        setTasks(await taskDB.getAll());
      }
    });
  }, []);

  const financeActions = useMemo(() => ({
    create: async (dto: CreateFinanceDTO): Promise<CrudResult<FinanceRecord>> => {
      try {
        const record = await financeDB.add({
          ...dto,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        setFinance(await financeDB.getAll());
        return { success: true, data: record };
      } catch (error) {
        return toErrorResult<FinanceRecord>(error instanceof Error ? error.message : 'Failed to create finance record');
      }
    },
    update: async (id: EntityId, dto: UpdateFinanceDTO): Promise<CrudResult<FinanceRecord>> => {
      try {
        await financeDB.update(id, dto);
        const nextFinance = await financeDB.getAll();
        setFinance(nextFinance);
        return { success: true, data: nextFinance.find((item) => item.id === id) };
      } catch (error) {
        return toErrorResult<FinanceRecord>(error instanceof Error ? error.message : 'Failed to update finance record');
      }
    },
    delete: async (id: EntityId): Promise<CrudResult<void>> => {
      try {
        await financeDB.delete(id);
        setFinance(await financeDB.getAll());
        return { success: true };
      } catch (error) {
        return toErrorResult<void>(error instanceof Error ? error.message : 'Failed to delete finance record');
      }
    },
    getById: async (id: EntityId) => (await financeDB.getAll()).find((item) => item.id === id),
    getStats: () => financeDB.getStats(),
    getModelStats: () => financeDB.getModelStats(),
  }), []);

  const taskActions = useMemo(() => ({
    create: async (dto: CreateTaskDTO): Promise<CrudResult<Task>> => {
      try {
        const task = await taskDB.add({
          ...dto,
          completed: dto.completed ?? false,
          priority: dto.priority ?? 'medium',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        setTasks(await taskDB.getAll());
        return { success: true, data: task };
      } catch (error) {
        return toErrorResult<Task>(error instanceof Error ? error.message : 'Failed to create task');
      }
    },
    update: async (id: EntityId, dto: UpdateTaskDTO): Promise<CrudResult<Task>> => {
      try {
        await taskDB.update(id, dto);
        const nextTasks = await taskDB.getAll();
        setTasks(nextTasks);
        return { success: true, data: nextTasks.find((item) => item.id === id) };
      } catch (error) {
        return toErrorResult<Task>(error instanceof Error ? error.message : 'Failed to update task');
      }
    },
    delete: async (id: EntityId): Promise<CrudResult<void>> => {
      try {
        await taskDB.delete(id);
        setTasks(await taskDB.getAll());
        return { success: true };
      } catch (error) {
        return toErrorResult<void>(error instanceof Error ? error.message : 'Failed to delete task');
      }
    },
    toggle: async (id: EntityId): Promise<{ success: boolean }> => {
      try {
        await taskDB.toggle(id);
        setTasks(await taskDB.getAll());
        return { success: true };
      } catch {
        return { success: false };
      }
    },
    getById: async (id: EntityId) => (await taskDB.getAll()).find((item) => item.id === id),
    getStats: () => taskDB.getStats(),
  }), []);

  const value = useMemo(() => ({
    finance,
    tasks,
    loading,
    financeActions,
    taskActions,
  }), [finance, tasks, loading, financeActions, taskActions]);

  return (
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within StoreProvider');
  }
  return context;
}

export function useFinance() {
  const { finance, loading, financeActions } = useStore();
  return { data: finance, loading, ...financeActions };
}

export function useTasks() {
  const { tasks, loading, taskActions } = useStore();
  return { data: tasks, loading, ...taskActions };
}
