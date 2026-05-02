import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { financeDB, taskDB, subscribe, type FinanceRecord, type Task } from '../db';
import { knowledgeDb, subscribeKnowledge, type KnowledgeNote } from '../db/knowledge';

export interface AppState {
  finance: FinanceRecord[];
  tasks: Task[];
  notes: KnowledgeNote[];
  loading: boolean;
}

type Action =
  | { type: 'LOAD_DATA'; payload: { finance: FinanceRecord[]; tasks: Task[]; notes: KnowledgeNote[] } }
  | { type: 'UPDATE_FINANCE'; payload: FinanceRecord[] }
  | { type: 'UPDATE_TASKS'; payload: Task[] }
  | { type: 'UPDATE_NOTES'; payload: KnowledgeNote[] }
  | { type: 'SET_LOADING'; payload: boolean };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOAD_DATA':
      return { ...state, ...action.payload, loading: false };
    case 'UPDATE_FINANCE':
      return { ...state, finance: action.payload };
    case 'UPDATE_TASKS':
      return { ...state, tasks: action.payload };
    case 'UPDATE_NOTES':
      return { ...state, notes: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    default:
      return state;
  }
}

const initialState: AppState = {
  finance: [],
  tasks: [],
  notes: [],
  loading: true,
};

interface StoreContextType {
  state: AppState;
  loadData: () => Promise<void>;

  financeActions: {
    getAll: () => Promise<FinanceRecord[]>;
    add: (record: Omit<FinanceRecord, 'id'>) => Promise<FinanceRecord>;
    update: (id: string, updates: Partial<FinanceRecord>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    getStats: () => Promise<{ income: number; expense: number; profit: number }>;
    getModelStats: () => Promise<Record<string, { expense: number; income: number }>>;
  };

  taskActions: {
    getAll: () => Promise<Task[]>;
    add: (record: Omit<Task, 'id'>) => Promise<Task>;
    update: (id: string, updates: Partial<Task>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    toggle: (id: string) => Promise<void>;
    getStats: () => Promise<{ total: number; completed: number; pending: number }>;
  };

  noteActions: {
    getAll: () => Promise<KnowledgeNote[]>;
    getCount: () => Promise<number>;
    getStats: () => Promise<{ total: number; tagged: number; linked: number }>;
  };
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadData = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    const [finance, tasks, notes] = await Promise.all([
      financeDB.getAll(),
      taskDB.getAll(),
      knowledgeDb.notes.toArray(),
    ]);
    dispatch({
      type: 'LOAD_DATA',
      payload: { finance, tasks, notes },
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const unsubscribe = subscribe(async (collection) => {
      switch (collection) {
        case 'finance':
          dispatch({ type: 'UPDATE_FINANCE', payload: await financeDB.getAll() });
          break;
        case 'tasks':
          dispatch({ type: 'UPDATE_TASKS', payload: await taskDB.getAll() });
          break;
      }
    });

    return unsubscribe;
  }, []);

  // 知识库数据订阅
  useEffect(() => {
    const unsubscribe = subscribeKnowledge(async () => {
      const notes = await knowledgeDb.notes.toArray();
      dispatch({ type: 'UPDATE_NOTES', payload: notes });
    });

    return unsubscribe;
  }, []);

  const financeActions = useMemo(() => ({
    getAll: async () => {
      const data = await financeDB.getAll();
      dispatch({ type: 'UPDATE_FINANCE', payload: data });
      return data;
    },
    add: async (record: Omit<FinanceRecord, 'id'>) => {
      const newRecord = await financeDB.add(record);
      dispatch({ type: 'UPDATE_FINANCE', payload: await financeDB.getAll() });
      return newRecord;
    },
    update: async (id: string, updates: Partial<FinanceRecord>) => {
      await financeDB.update(id, updates);
      dispatch({ type: 'UPDATE_FINANCE', payload: await financeDB.getAll() });
    },
    delete: async (id: string) => {
      await financeDB.delete(id);
      dispatch({ type: 'UPDATE_FINANCE', payload: await financeDB.getAll() });
    },
    getStats: async () => financeDB.getStats(),
    getModelStats: async () => financeDB.getModelStats(),
  }), []);

  const taskActions = useMemo(() => ({
    getAll: async () => {
      const data = await taskDB.getAll();
      dispatch({ type: 'UPDATE_TASKS', payload: data });
      return data;
    },
    add: async (record: Omit<Task, 'id'>) => {
      const newRecord = await taskDB.add(record);
      dispatch({ type: 'UPDATE_TASKS', payload: await taskDB.getAll() });
      return newRecord;
    },
    update: async (id: string, updates: Partial<Task>) => {
      await taskDB.update(id, updates);
      dispatch({ type: 'UPDATE_TASKS', payload: await taskDB.getAll() });
    },
    delete: async (id: string) => {
      await taskDB.delete(id);
      dispatch({ type: 'UPDATE_TASKS', payload: await taskDB.getAll() });
    },
    toggle: async (id: string) => {
      await taskDB.toggle(id);
      dispatch({ type: 'UPDATE_TASKS', payload: await taskDB.getAll() });
    },
    getStats: async () => taskDB.getStats(),
  }), []);

  const noteActions = useMemo(() => ({
    getAll: async () => {
      const data = await knowledgeDb.notes.toArray();
      dispatch({ type: 'UPDATE_NOTES', payload: data });
      return data;
    },
    getCount: async () => knowledgeDb.notes.count(),
    getStats: async () => {
      const notes = await knowledgeDb.notes.toArray();
      return {
        total: notes.length,
        tagged: notes.filter(n => n.tags.length > 0).length,
        linked: notes.filter(n => n.links.length > 0).length,
      };
    },
  }), []);

  const value = useMemo(() => ({
    state,
    loadData,
    financeActions,
    taskActions,
    noteActions,
  }), [state, loadData, financeActions, taskActions, noteActions]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}

export function useFinance() {
  const { state, financeActions } = useStore();
  return { data: state.finance, ...financeActions };
}

export function useTasks() {
  const { state, taskActions } = useStore();
  return { data: state.tasks, ...taskActions };
}

export function useNotes() {
  const { state, noteActions } = useStore();
  return { data: state.notes, ...noteActions };
}