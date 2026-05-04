import { financeStore, taskStore } from '../store/impl';
import { generateId } from '../store/base/Store';
import { subscribeDataChange } from '../core/events';
import { isValidCreateFinanceDTO, isValidCreateTaskDTO, isValidFinanceRecord, isValidTask } from '../core/validation';
import { FinanceRecord, Task } from '../core/types';
import {
  createKnowledgeRelation,
  deleteKnowledgeEntity,
  getKnowledgeDataset,
  hydrateKnowledgeDataset,
  upsertKnowledgeEntity,
} from '../kb';
import { syncEngine } from '../sync';

export type { FinanceRecord, Task };

function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length >= 10 && /^[a-z0-9-]+$/i.test(id);
}

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPin(pin: string, hashedPin: string): Promise<boolean> {
  const hashedInput = await hashPin(pin);
  return hashedInput === hashedPin;
}

type CollectionType = 'finance' | 'tasks';
type Listener = (collection: CollectionType) => void;

export function subscribe(listener: Listener): () => void {
  const unsubFinance = subscribeDataChange('finance', () => listener('finance'));
  const unsubTasks = subscribeDataChange('tasks', () => listener('tasks'));

  return () => {
    unsubFinance();
    unsubTasks();
  };
}

let storageError: Error | null = null;
let storageQuotaExceeded = false;

const WORKSPACE_ENTITY_ID = 'entity:workspace';
const TASK_CLASS_ID = 'class:task';
const FINANCE_CLASS_ID = 'class:finance-record';
const TASK_RELATION_ID = 'relation:linkedTask';
const FINANCE_RELATION_ID = 'relation:linkedFinanceRecord';
const TASK_KNOWLEDGE_SOURCE = 'task-module';
const FINANCE_KNOWLEDGE_SOURCE = 'finance-module';

function cloneFinanceData(): Promise<FinanceRecord[]> {
  return financeStore.getAll();
}

function cloneTaskData(): Promise<Task[]> {
  return taskStore.getAll();
}

function buildTaskKnowledgeEntityId(taskId: string): string {
  return `entity:task-${taskId}`;
}

function buildFinanceKnowledgeEntityId(recordId: string): string {
  return `entity:finance-${recordId}`;
}

function normalizeKnowledgeTags(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function buildTaskKnowledgeSummary(task: Task): string {
  const parts = [task.completed ? '已完成' : '待处理', `优先级 ${task.priority}`];
  if (task.dueDate) {
    parts.push(`截止 ${task.dueDate}`);
  }
  return parts.join('，');
}

function buildFinanceKnowledgeSummary(record: FinanceRecord): string {
  const typeLabel = record.type === 'income' ? '收入' : '支出';
  const parts = [`${typeLabel} ${record.amount} 元`, `分类 ${record.category}`, `日期 ${record.date}`];
  if (record.model) {
    parts.push(`模型 ${record.model}`);
  }
  return parts.join('，');
}

function hasKnowledgeWorkspace(): boolean {
  return getKnowledgeDataset().entities.some((entity) => entity.id === WORKSPACE_ENTITY_ID);
}

async function syncTaskKnowledgeEntity(task: Task): Promise<void> {
  const entityId = buildTaskKnowledgeEntityId(task.id);
  await upsertKnowledgeEntity({
    id: entityId,
    typeId: TASK_CLASS_ID,
    title: task.title.trim(),
    summary: buildTaskKnowledgeSummary(task),
    tags: normalizeKnowledgeTags([
      'task',
      task.priority,
      task.completed ? 'completed' : 'pending',
    ]),
    attributes: {
      taskId: task.id,
      completed: task.completed,
      priority: task.priority,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    },
    source: TASK_KNOWLEDGE_SOURCE,
    confidence: 1,
  });

  if (!hasKnowledgeWorkspace()) {
    return;
  }

  await createKnowledgeRelation({
    subjectId: WORKSPACE_ENTITY_ID,
    predicateId: TASK_RELATION_ID,
    targetId: entityId,
    source: TASK_KNOWLEDGE_SOURCE,
    confidence: 1,
  });
}

async function syncFinanceKnowledgeEntity(record: FinanceRecord): Promise<void> {
  const entityId = buildFinanceKnowledgeEntityId(record.id);
  const typeLabel = record.type === 'income' ? '收入' : '支出';
  await upsertKnowledgeEntity({
    id: entityId,
    typeId: FINANCE_CLASS_ID,
    title: `${typeLabel} ${record.description.trim() || record.category}`,
    summary: buildFinanceKnowledgeSummary(record),
    tags: normalizeKnowledgeTags(['finance', record.type, record.category]),
    attributes: {
      financeRecordId: record.id,
      type: record.type,
      amount: record.amount,
      category: record.category,
      date: record.date,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.model ? { model: record.model } : {}),
    },
    source: FINANCE_KNOWLEDGE_SOURCE,
    confidence: 1,
  });

  if (!hasKnowledgeWorkspace()) {
    return;
  }

  await createKnowledgeRelation({
    subjectId: WORKSPACE_ENTITY_ID,
    predicateId: FINANCE_RELATION_ID,
    targetId: entityId,
    source: FINANCE_KNOWLEDGE_SOURCE,
    confidence: 1,
  });
}

async function deleteKnowledgeEntityIfPresent(id: string): Promise<void> {
  const exists = getKnowledgeDataset().entities.some((entity) => entity.id === id);
  if (!exists) {
    return;
  }

  await deleteKnowledgeEntity(id);
}

async function deleteTaskKnowledgeEntity(taskId: string): Promise<void> {
  await deleteKnowledgeEntityIfPresent(buildTaskKnowledgeEntityId(taskId));
}

async function deleteFinanceKnowledgeEntity(recordId: string): Promise<void> {
  await deleteKnowledgeEntityIfPresent(buildFinanceKnowledgeEntityId(recordId));
}

function logKnowledgeSyncError(scope: string, error: unknown): void {
  console.warn(
    `[DB] ${scope} knowledge sync failed, primary data preserved:`,
    error
  );
}

function scheduleKnowledgeSync(scope: string, action: () => Promise<void>): void {
  void action().catch((error) => {
    logKnowledgeSyncError(scope, error);
  });
}

async function runKnowledgeSyncSafely(scope: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    logKnowledgeSyncError(scope, error);
  }
}

async function rebuildModuleKnowledgeMappings(
  financeRecords: FinanceRecord[],
  tasks: Task[]
): Promise<void> {
  const dataset = getKnowledgeDataset();
  const nextTaskIds = new Set(tasks.map((task) => buildTaskKnowledgeEntityId(task.id)));
  const nextFinanceIds = new Set(
    financeRecords.map((record) => buildFinanceKnowledgeEntityId(record.id))
  );

  const staleTaskEntityIds = dataset.entities
    .filter((entity) => entity.typeId === TASK_CLASS_ID && entity.source === TASK_KNOWLEDGE_SOURCE)
    .map((entity) => entity.id)
    .filter((id) => !nextTaskIds.has(id));

  const staleFinanceEntityIds = dataset.entities
    .filter(
      (entity) => entity.typeId === FINANCE_CLASS_ID && entity.source === FINANCE_KNOWLEDGE_SOURCE
    )
    .map((entity) => entity.id)
    .filter((id) => !nextFinanceIds.has(id));

  for (const entityId of staleTaskEntityIds) {
    await deleteKnowledgeEntityIfPresent(entityId);
  }

  for (const entityId of staleFinanceEntityIds) {
    await deleteKnowledgeEntityIfPresent(entityId);
  }

  for (const task of tasks) {
    await syncTaskKnowledgeEntity(task);
  }

  for (const record of financeRecords) {
    await syncFinanceKnowledgeEntity(record);
  }
}

function buildFinanceRecord(record: Omit<FinanceRecord, 'id'>): FinanceRecord {
  if (!isValidCreateFinanceDTO(record)) {
    throw new Error('Failed to create finance record');
  }

  const entity: FinanceRecord = {
    ...record,
    id: generateId(),
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? Date.now(),
  };

  if (!isValidFinanceRecord(entity)) {
    throw new Error('Failed to create finance record');
  }

  return entity;
}

function buildTaskRecord(record: Omit<Task, 'id'>): Task {
  const normalizedRecord = {
    ...record,
    completed: record.completed ?? false,
    priority: record.priority ?? 'medium',
    dueDate: record.dueDate || undefined,
  };

  if (!isValidCreateTaskDTO(normalizedRecord)) {
    throw new Error('Failed to create task');
  }

  const entity: Task = {
    ...normalizedRecord,
    id: generateId(),
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.updatedAt ?? Date.now(),
  };

  if (!isValidTask(entity)) {
    throw new Error('Failed to create task');
  }

  return entity;
}

async function runFinanceMutation<T>(
  operation: (snapshot: FinanceRecord[]) => { next: FinanceRecord[]; result: T },
  afterCommit?: (context: { previous: FinanceRecord[]; next: FinanceRecord[]; result: T }) => Promise<void> | void
): Promise<T> {
  const previous = await cloneFinanceData();
  const { next, result } = operation(previous);

  financeStore.replaceAll(next);
  if (afterCommit) {
    scheduleKnowledgeSync('Finance mutation', async () => {
      await afterCommit({ previous, next, result });
    });
  }

  void syncEngine.syncNow('finance').then((syncResult) => {
    if (!syncResult.success) {
      console.warn('[DB] Finance sync failed, local data preserved:', syncResult.error);
    }
  });

  return result;
}

async function runTaskMutation<T>(
  operation: (snapshot: Task[]) => { next: Task[]; result: T },
  afterCommit?: (context: { previous: Task[]; next: Task[]; result: T }) => Promise<void> | void
): Promise<T> {
  const previous = await cloneTaskData();
  const { next, result } = operation(previous);

  taskStore.replaceAll(next);
  if (afterCommit) {
    scheduleKnowledgeSync('Task mutation', async () => {
      await afterCommit({ previous, next, result });
    });
  }

  void syncEngine.syncNow('tasks').then((syncResult) => {
    if (!syncResult.success) {
      console.warn('[DB] Task sync failed, local data preserved:', syncResult.error);
    }
  });

  return result;
}

export function getStorageError(): Error | null {
  return storageError;
}

export function isStorageQuotaExceeded(): boolean {
  return storageQuotaExceeded;
}

export function getStorageUsage(): { used: number; available: boolean } {
  try {
    const financeData = localStorage.getItem('finance_records') || '';
    const tasksData = localStorage.getItem('tasks_records') || '';
    const used = new Blob([financeData + tasksData]).size;
    return { used, available: true };
  } catch {
    return { used: 0, available: false };
  }
}

export const financeDB = {
  async getAll(): Promise<FinanceRecord[]> {
    const records = await financeStore.getAll();
    return records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  async add(record: Omit<FinanceRecord, 'id'>): Promise<FinanceRecord> {
    return runFinanceMutation(
      (snapshot) => {
        const created = buildFinanceRecord(record);
        return {
          next: [created, ...snapshot],
          result: created,
        };
      },
      async ({ result }) => {
        await syncFinanceKnowledgeEntity(result);
      }
    );
  },

  async update(id: string, updates: Partial<FinanceRecord>): Promise<void> {
    await runFinanceMutation(
      (snapshot) => {
        const index = snapshot.findIndex((item) => item.id === id);
        if (index === -1) {
          throw new Error('Failed to update finance record');
        }

        const updated: FinanceRecord = {
          ...snapshot[index],
          ...updates,
          id,
          updatedAt: Date.now(),
        };

        if (!isValidFinanceRecord(updated)) {
          throw new Error('Failed to update finance record');
        }

        const next = [...snapshot];
        next[index] = updated;
        return { next, result: undefined };
      },
      async ({ next }) => {
        const updated = next.find((item) => item.id === id);
        if (updated) {
          await syncFinanceKnowledgeEntity(updated);
        }
      }
    );
  },

  async delete(id: string): Promise<void> {
    await runFinanceMutation(
      (snapshot) => {
        const next = snapshot.filter((item) => item.id !== id);
        if (next.length === snapshot.length) {
          throw new Error('Failed to delete finance record');
        }

        return { next, result: undefined };
      },
      async () => {
        await deleteFinanceKnowledgeEntity(id);
      }
    );
  },

  async getStats() {
    return financeStore.getStats();
  },

  async getModelStats(): Promise<Record<string, { expense: number; income: number }>> {
    return financeStore.getModelStats();
  }
};

export const taskDB = {
  async getAll(): Promise<Task[]> {
    const records = await taskStore.getAll();
    return records.sort((a, b) => b.createdAt - a.createdAt);
  },

  async add(record: Omit<Task, 'id'>): Promise<Task> {
    return runTaskMutation(
      (snapshot) => {
        const created = buildTaskRecord(record);
        return {
          next: [created, ...snapshot],
          result: created,
        };
      },
      async ({ result }) => {
        await syncTaskKnowledgeEntity(result);
      }
    );
  },

  async update(id: string, updates: Partial<Task>): Promise<void> {
    await runTaskMutation(
      (snapshot) => {
        const index = snapshot.findIndex((item) => item.id === id);
        if (index === -1) {
          throw new Error('Failed to update task');
        }

        const updated: Task = {
          ...snapshot[index],
          ...updates,
          id,
          dueDate: updates.dueDate === '' ? undefined : (updates.dueDate ?? snapshot[index].dueDate),
          updatedAt: Date.now(),
        };

        if (!isValidTask(updated)) {
          throw new Error('Failed to update task');
        }

        const next = [...snapshot];
        next[index] = updated;
        return { next, result: undefined };
      },
      async ({ next }) => {
        const updated = next.find((item) => item.id === id);
        if (updated) {
          await syncTaskKnowledgeEntity(updated);
        }
      }
    );
  },

  async delete(id: string): Promise<void> {
    await runTaskMutation(
      (snapshot) => {
        const next = snapshot.filter((item) => item.id !== id);
        if (next.length === snapshot.length) {
          throw new Error('Failed to delete task');
        }

        return { next, result: undefined };
      },
      async () => {
        await deleteTaskKnowledgeEntity(id);
      }
    );
  },

  async toggle(id: string): Promise<void> {
    await runTaskMutation(
      (snapshot) => {
        const index = snapshot.findIndex((item) => item.id === id);
        if (index === -1) {
          throw new Error('Failed to toggle task');
        }

        const updated: Task = {
          ...snapshot[index],
          completed: !snapshot[index].completed,
          updatedAt: Date.now(),
        };

        if (!isValidTask(updated)) {
          throw new Error('Failed to toggle task');
        }

        const next = [...snapshot];
        next[index] = updated;
        return { next, result: undefined };
      },
      async ({ next }) => {
        const updated = next.find((item) => item.id === id);
        if (updated) {
          await syncTaskKnowledgeEntity(updated);
        }
      }
    );
  },

  async getStats() {
    return taskStore.getStats();
  }
};

export const dataManager = {
  async exportAll(): Promise<string> {
    const [finance, tasks] = await Promise.all([
      financeStore.getAll(),
      taskStore.getAll(),
    ]);
    const knowledge = getKnowledgeDataset();

    const data = {
      version: 3,
      finance,
      tasks,
      knowledge,
      userSettings: {
        profile: localStorage.getItem('user_profile'),
        theme: localStorage.getItem('theme'),
        notificationSettings: localStorage.getItem('notification_settings'),
        securityPin: localStorage.getItem('security_pin_hashed'),
      },
      exportTime: new Date().toISOString(),
    };

    return JSON.stringify(data, null, 2);
  },

  async importAll(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);
      const nextFinance = Array.isArray(data.finance)
        ? data.finance.filter((record: any): record is FinanceRecord =>
            isValidId(record.id) &&
            (record.type === 'income' || record.type === 'expense') &&
            typeof record.amount === 'number'
          )
        : [];

      const nextTasks = Array.isArray(data.tasks)
        ? data.tasks.filter((record: any): record is Task =>
            isValidId(record.id) &&
            typeof record.title === 'string' &&
            typeof record.completed === 'boolean'
          )
        : [];

      const baseKnowledge = data.knowledge !== undefined ? data.knowledge : getKnowledgeDataset();
      financeStore.replaceAll(nextFinance);
      taskStore.replaceAll(nextTasks);
      await hydrateKnowledgeDataset(baseKnowledge);
      await runKnowledgeSyncSafely('Import', async () => {
        await rebuildModuleKnowledgeMappings(nextFinance, nextTasks);
      });
      const syncResult = await syncEngine.syncNow('all');
      if (!syncResult.success) {
        throw new Error(syncResult.error || 'Unknown sync error');
      }

      if (data.userSettings) {
        if (data.userSettings.profile) {
          localStorage.setItem('user_profile', data.userSettings.profile);
        }
        if (data.userSettings.theme) {
          localStorage.setItem('theme', data.userSettings.theme);
        }
        if (data.userSettings.notificationSettings) {
          localStorage.setItem('notification_settings', data.userSettings.notificationSettings);
        }
        if (data.userSettings.securityPin) {
          localStorage.setItem('security_pin_hashed', data.userSettings.securityPin);
        }
      }

      return true;
    } catch (error) {
      console.error('[DB] Import failed:', error);
      return false;
    }
  },

  async clearAll(): Promise<void> {
    financeStore.replaceAll([]);
    taskStore.replaceAll([]);
    await hydrateKnowledgeDataset({
      ...getKnowledgeDataset(),
      entities: [],
      documents: [],
      assertions: [],
      updatedAt: Date.now(),
    });
    localStorage.removeItem('user_profile');
    localStorage.removeItem('theme');
    localStorage.removeItem('notification_settings');
    localStorage.removeItem('security_pin_hashed');

    const syncResult = await syncEngine.syncNow('all');
    if (!syncResult.success) {
      throw new Error(syncResult.error || 'Unknown clear error');
    }
  },

  async getStats() {
    const [finance, tasks] = await Promise.all([
      financeStore.getAll(),
      taskStore.getAll(),
    ]);
    const knowledge = getKnowledgeDataset();

    return {
      finance: finance.length,
      tasks: tasks.length,
      knowledgeEntities: knowledge.entities.length,
      knowledgeDocuments: knowledge.documents.length,
      knowledgeAssertions: knowledge.assertions.length,
      totalSize: JSON.stringify({ finance, tasks, knowledge }).length,
    };
  },

  getSyncStatus(): {
    status: 'idle' | 'syncing' | 'success' | 'error';
    lastError: string | null;
    retryCount: number;
    lastSuccessfulSync: string | null;
  } {
    const status = syncEngine.getStatus();
    return {
      status: status.status,
      lastError: status.lastError,
      retryCount: status.retryCount,
      lastSuccessfulSync: status.lastSuccessfulSync,
    };
  },

  async triggerSync(): Promise<{ success: boolean; error?: string }> {
    const result = await syncEngine.syncNow('all');
    return result.success
      ? { success: true }
      : { success: false, error: result.error || 'Unknown sync error' };
  }
};

export const initDB = async () => true;

export function createUseDB(React: typeof import('react')) {
  return function useDB<T>(
    fetcher: () => Promise<T>,
    dependencies: CollectionType[]
  ): { data: T | null; loading: boolean } {
    const [data, setData] = React.useState<T | null>(null);
    const [loading, setLoading] = React.useState(true);
    const fetcherRef = React.useRef(fetcher);
    const depsRef = React.useRef(dependencies);

    React.useEffect(() => {
      fetcherRef.current = fetcher;
    }, [fetcher]);

    React.useEffect(() => {
      depsRef.current = dependencies;
    }, [dependencies]);

    React.useEffect(() => {
      let ignore = false;

      const load = async () => {
        setLoading(true);
        try {
          const result = await fetcherRef.current();
          if (!ignore) setData(result);
        } catch (error) {
          console.error('useDB fetch error:', error);
        } finally {
          if (!ignore) setLoading(false);
        }
      };

      load();

      const unsubscribe = subscribe((collection) => {
        if (depsRef.current.includes(collection)) {
          load();
        }
      });

      return () => {
        ignore = true;
        unsubscribe();
      };
    }, []);

    return { data, loading };
  };
}
