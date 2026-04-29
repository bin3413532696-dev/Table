import React, { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { financeDB, taskDB, noteDB, folderDB, subscribe, type FolderTreeNode, type FinanceRecord, type Task, type Note, type Folder } from '../db';

export interface AppState {
  finance: FinanceRecord[];
  tasks: Task[];
  notes: Note[];
  folders: Folder[];
  loading: boolean;
  selectedNoteId: string | null;
  selectedFolderId: string | null;
}

type Action =
  | { type: 'LOAD_DATA'; payload: { finance: FinanceRecord[]; tasks: Task[]; notes: Note[]; folders: Folder[] } }
  | { type: 'UPDATE_FINANCE'; payload: FinanceRecord[] }
  | { type: 'UPDATE_TASKS'; payload: Task[] }
  | { type: 'UPDATE_NOTES'; payload: Note[] }
  | { type: 'UPDATE_FOLDERS'; payload: Folder[] }
  | { type: 'SELECT_NOTE'; payload: string | null }
  | { type: 'SELECT_FOLDER'; payload: string | null }
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
    case 'UPDATE_FOLDERS':
      return { ...state, folders: action.payload };
    case 'SELECT_NOTE':
      return { ...state, selectedNoteId: action.payload, selectedFolderId: null };
    case 'SELECT_FOLDER':
      return { ...state, selectedFolderId: action.payload, selectedNoteId: null };
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
  folders: [],
  loading: true,
  selectedNoteId: null,
  selectedFolderId: null,
};

interface StoreContextType {
  state: AppState;
  loadData: () => Promise<void>;
  selectNote: (noteId: string | null) => void;
  selectFolder: (folderId: string | null) => void;
  
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
    getAll: () => Promise<Note[]>;
    getByFolder: (folderId: string | null) => Promise<Note[]>;
    add: (record: Omit<Note, 'id'>) => Promise<Note>;
    update: (id: string, updates: Partial<Note>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    search: (query: string) => Promise<Note[]>;
    updateLinks: (noteId: string, links: string[]) => Promise<void>;
    getBacklinks: (noteTitle: string) => Promise<Note[]>;
  };
  
  folderActions: {
    getAll: () => Promise<Folder[]>;
    getByParent: (parentId: string | null) => Promise<Folder[]>;
    add: (record: Omit<Folder, 'id'>) => Promise<Folder>;
    update: (id: string, updates: Partial<Folder>) => Promise<void>;
    delete: (id: string) => Promise<void>;
    getTree: () => Promise<FolderTreeNode[]>;
  };
}

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadData = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    const [finance, tasks, notes, folders] = await Promise.all([
      financeDB.getAll(),
      taskDB.getAll(),
      noteDB.getAll(),
      folderDB.getAll(),
    ]);
    dispatch({
      type: 'LOAD_DATA',
      payload: { finance, tasks, notes, folders },
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
        case 'notes':
          dispatch({ type: 'UPDATE_NOTES', payload: await noteDB.getAll() });
          break;
        case 'folders':
          dispatch({ type: 'UPDATE_FOLDERS', payload: await folderDB.getAll() });
          break;
      }
    });

    return unsubscribe;
  }, []);

  const selectNote = useCallback((noteId: string | null) => {
    dispatch({ type: 'SELECT_NOTE', payload: noteId });
  }, []);

  const selectFolder = useCallback((folderId: string | null) => {
    dispatch({ type: 'SELECT_FOLDER', payload: folderId });
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
      const data = await noteDB.getAll();
      dispatch({ type: 'UPDATE_NOTES', payload: data });
      return data;
    },
    getByFolder: async (folderId: string | null) => {
      return noteDB.getByFolder(folderId);
    },
    add: async (record: Omit<Note, 'id'>) => {
      const newRecord = await noteDB.add(record);
      dispatch({ type: 'UPDATE_NOTES', payload: await noteDB.getAll() });
      return newRecord;
    },
    update: async (id: string, updates: Partial<Note>) => {
      await noteDB.update(id, updates);
      dispatch({ type: 'UPDATE_NOTES', payload: await noteDB.getAll() });
    },
    delete: async (id: string) => {
      await noteDB.delete(id);
      dispatch({ type: 'UPDATE_NOTES', payload: await noteDB.getAll() });
    },
    search: async (query: string) => noteDB.search(query),
    updateLinks: async (noteId: string, links: string[]) => {
      await noteDB.updateLinks(noteId, links);
      dispatch({ type: 'UPDATE_NOTES', payload: await noteDB.getAll() });
    },
    getBacklinks: async (noteTitle: string) => noteDB.getBacklinks(noteTitle),
  }), []);

  const folderActions = useMemo(() => ({
    getAll: async () => {
      const data = await folderDB.getAll();
      dispatch({ type: 'UPDATE_FOLDERS', payload: data });
      return data;
    },
    getByParent: async (parentId: string | null) => folderDB.getByParent(parentId),
    add: async (record: Omit<Folder, 'id'>) => {
      const newRecord = await folderDB.add(record);
      dispatch({ type: 'UPDATE_FOLDERS', payload: await folderDB.getAll() });
      return newRecord;
    },
    update: async (id: string, updates: Partial<Folder>) => {
      await folderDB.update(id, updates);
      dispatch({ type: 'UPDATE_FOLDERS', payload: await folderDB.getAll() });
    },
    delete: async (id: string) => {
      await folderDB.delete(id);
      dispatch({ type: 'UPDATE_FOLDERS', payload: await folderDB.getAll() });
      dispatch({ type: 'UPDATE_NOTES', payload: await noteDB.getAll() });
    },
    getTree: async () => folderDB.getTree(),
  }), []);

  const value = useMemo(() => ({
    state,
    loadData,
    selectNote,
    selectFolder,
    financeActions,
    taskActions,
    noteActions,
    folderActions,
  }), [state, loadData, selectNote, selectFolder, financeActions, taskActions, noteActions, folderActions]);

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

export function useFolders() {
  const { state, folderActions } = useStore();
  return { data: state.folders, ...folderActions };
}

export function useSelection() {
  const { state, selectNote, selectFolder } = useStore();
  return {
    selectedNoteId: state.selectedNoteId,
    selectedFolderId: state.selectedFolderId,
    selectNote,
    selectFolder,
  };
}