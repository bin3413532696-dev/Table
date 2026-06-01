import type { FinanceRecord, Task } from '../../core/types';
import { fetchAuthMe, updateAuthMe } from '../auth';
import { syncEngine } from '../../sync';
import { financeApi } from './finance';
import { getNoteList, getPresetTagList } from '../../pages/Knowledge/api';
import { requestApi } from './client';
import { taskApi } from './tasks';

type BusinessSnapshot = {
  version: number;
  exportedAt: string;
  tasks: Task[];
  finance: FinanceRecord[];
  knowledge?: {
    notes?: Array<{
      id: string;
      title: string;
      content: string;
      tags: string[];
      createdAt: number;
      updatedAt: number;
    }>;
    presetTags?: Array<{
      id: string;
      name: string;
      color: string;
      sortOrder: number;
    }>;
  };
};

const LOCAL_THEME_KEY = 'theme';
const LOCAL_NOTIFICATION_SETTINGS_KEY = 'notification_settings';
const LOCAL_SECURITY_PIN_KEY = 'security_pin_hashed';

async function refreshKnowledgeAuthorityData(): Promise<void> {
  const result = await syncEngine.loadKnowledgeFromServer();

  if (!result.success) {
    console.warn('[Maintenance API] Failed to refresh knowledge cache:', result.error);
  }
}

function getLocalSettingsUsage(): { used: number; available: boolean } {
  try {
    const theme = localStorage.getItem(LOCAL_THEME_KEY) || '';
    const notificationSettings = localStorage.getItem(LOCAL_NOTIFICATION_SETTINGS_KEY) || '';
    const used = new Blob([theme + notificationSettings]).size;

    return { used, available: true };
  } catch {
    return { used: 0, available: false };
  }
}

export const maintenanceApi = {
  async exportBusinessData(): Promise<string> {
    const snapshot = await requestApi<BusinessSnapshot>('/api/maintenance/business-snapshot');
    return JSON.stringify(snapshot, null, 2);
  },

  async exportKnowledgeData(): Promise<string> {
    const [notes, presetTags] = await Promise.all([
      getNoteList(),
      getPresetTagList(),
    ]);

    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      knowledge: {
        notes,
        presetTags,
      },
    }, null, 2);
  },

  async exportLocalSettings(): Promise<string> {
    const auth = await fetchAuthMe().catch(() => null);

    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      userSettings: {
        profile: auth ? JSON.stringify({
          name: auth.data.user.displayName || '个人用户',
          email: auth.data.user.email || '',
          bio: auth.data.user.bio || '',
        }) : null,
        theme: localStorage.getItem(LOCAL_THEME_KEY),
        notificationSettings: localStorage.getItem(LOCAL_NOTIFICATION_SETTINGS_KEY),
      },
    }, null, 2);
  },

  async importBusinessData(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);

      await requestApi('/api/maintenance/business-snapshot', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      await Promise.all([
        financeApi.refresh(),
        taskApi.refresh(),
      ]);
      await refreshKnowledgeAuthorityData();
      return true;
    } catch (error) {
      console.error('[Maintenance API] Business import failed:', error);
      return false;
    }
  },

  async importKnowledgeData(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);

      await requestApi('/api/maintenance/business-snapshot', {
        method: 'POST',
        body: JSON.stringify({
          knowledge: data.knowledge || data,
        }),
      });

      await refreshKnowledgeAuthorityData();
      return true;
    } catch (error) {
      console.error('[Maintenance API] Knowledge import failed:', error);
      return false;
    }
  },

  async importLocalSettings(jsonString: string): Promise<boolean> {
    try {
      const data = JSON.parse(jsonString);
      const settings = data.userSettings && typeof data.userSettings === 'object'
        ? data.userSettings as Record<string, unknown>
        : data;

      if (typeof settings.profile === 'string') {
        try {
          const parsed = JSON.parse(settings.profile) as { name?: unknown; email?: unknown; bio?: unknown };
          await updateAuthMe({
            displayName: typeof parsed.name === 'string' ? parsed.name : '个人用户',
            email: typeof parsed.email === 'string' ? parsed.email : null,
            bio: typeof parsed.bio === 'string' ? parsed.bio : '',
          });
        } catch {
          // Ignore invalid legacy profile payloads.
        }
      }

      if (typeof settings.theme === 'string') {
        localStorage.setItem(LOCAL_THEME_KEY, settings.theme);
      }

      if (typeof settings.notificationSettings === 'string') {
        localStorage.setItem(LOCAL_NOTIFICATION_SETTINGS_KEY, settings.notificationSettings);
      }

      return true;
    } catch (error) {
      console.error('[Maintenance API] Local settings import failed:', error);
      return false;
    }
  },

  async clearKnowledgeData(): Promise<void> {
    await requestApi('/api/maintenance/reset', {
      method: 'POST',
      body: JSON.stringify({ scope: 'knowledge' }),
    });

    await refreshKnowledgeAuthorityData();
  },

  clearLocalSettings(): void {
    localStorage.removeItem(LOCAL_THEME_KEY);
    localStorage.removeItem(LOCAL_NOTIFICATION_SETTINGS_KEY);
    localStorage.removeItem(LOCAL_SECURITY_PIN_KEY);
  },

  async clearAll(): Promise<void> {
    await requestApi<{ success: boolean; resetAt: string }>('/api/maintenance/reset', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await Promise.all([
      financeApi.refresh(),
      taskApi.refresh(),
    ]);
    await refreshKnowledgeAuthorityData();
    maintenanceApi.clearLocalSettings();
  },

  async getStats(): Promise<{
    finance: number;
    tasks: number;
    knowledgeNotes: number;
    knowledgePresetTags: number;
    totalSize: number;
  }> {
    const [finance, tasks, notes, presetTags] = await Promise.all([
      financeApi.getAll(),
      taskApi.getAll(),
      getNoteList(),
      getPresetTagList(),
    ]);

    const statsSnapshot = {
      finance,
      tasks,
      knowledge: {
        notes,
        presetTags,
      },
    };

    return {
      finance: finance.length,
      tasks: tasks.length,
      knowledgeNotes: notes.length,
      knowledgePresetTags: presetTags.length,
      totalSize: JSON.stringify(statsSnapshot).length + getLocalSettingsUsage().used,
    };
  },
};
