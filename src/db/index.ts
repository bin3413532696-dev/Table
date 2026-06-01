import { subscribe as subscribeCollectionData, type CollectionType } from '../core/events';
import { MESSAGES } from '../core/messages';
import type { FinanceRecord, Task } from '../core/types';
import { getSyncStatus as getSyncStatusSnapshot, syncNow } from '../lib/dataSync';
import { getErrorMessage as getApiErrorMessage } from '../lib/api/client';
import { financeApi } from '../lib/api/finance';
import { maintenanceApi } from '../lib/api/maintenance';
import { taskApi } from '../lib/api/tasks';
import { useCollectionData } from '../lib/useCollectionData';

export type { FinanceRecord, Task };

type Listener = (collection: CollectionType) => void;

export function getErrorMessage(
  error: unknown,
  fallback: string = MESSAGES.common.unknownError
): string {
  return getApiErrorMessage(error, fallback);
}

export function subscribe(listener: Listener): () => void {
  return subscribeCollectionData(listener);
}

export function getStorageError(): Error | null {
  return null;
}

export function isStorageQuotaExceeded(): boolean {
  return false;
}

export function getStorageUsage(): { used: number; available: boolean } {
  try {
    const theme = localStorage.getItem('theme') || '';
    const notificationSettings = localStorage.getItem('notification_settings') || '';
    const used = new Blob([theme + notificationSettings]).size;

    return { used, available: true };
  } catch {
    return { used: 0, available: false };
  }
}

export const financeDB = financeApi;
export const taskDB = taskApi;

export const dataManager = {
  exportBusinessData: maintenanceApi.exportBusinessData,
  exportKnowledgeData: maintenanceApi.exportKnowledgeData,
  exportLocalSettings: maintenanceApi.exportLocalSettings,
  importBusinessData: maintenanceApi.importBusinessData,
  importKnowledgeData: maintenanceApi.importKnowledgeData,
  importLocalSettings: maintenanceApi.importLocalSettings,
  clearKnowledgeData: maintenanceApi.clearKnowledgeData,
  clearLocalSettings: maintenanceApi.clearLocalSettings,
  clearAll: maintenanceApi.clearAll,
  getStats: maintenanceApi.getStats,
  getSyncStatus(): {
    status: 'idle' | 'syncing' | 'success' | 'error';
    lastError: string | null;
    retryCount: number;
    lastSuccessfulSync: string | null;
  } {
    const status = getSyncStatusSnapshot();

    return {
      status: status.status,
      lastError: status.lastError,
      retryCount: status.retryCount,
      lastSuccessfulSync: status.lastSuccessfulSync,
    };
  },
  async triggerSync(): Promise<{ success: boolean; error?: string }> {
    const result = await syncNow();

    if (result.success) {
      return { success: true };
    }

    return {
      success: false,
      error: result.error || 'Unknown sync error',
    };
  },
};

export const initDB = async () => true;

export function createUseDB(_React: typeof import('react')) {
  return function useDB<T>(
    fetcher: () => Promise<T>,
    dependencies: CollectionType[]
  ): { data: T | null; loading: boolean; error: string | null } {
    return useCollectionData(fetcher, dependencies);
  };
}
