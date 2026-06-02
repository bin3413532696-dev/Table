import assert from 'node:assert/strict';
import test from 'node:test';
import { getStoredRagEnabled, RAG_ENABLED_KEY } from '../../src/agent/storage';

type StorageMock = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function installWindow(initialValues: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialValues));
  const localStorage: StorageMock = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };

  const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const originalLocalStorage = (globalThis as typeof globalThis & { localStorage?: unknown }).localStorage;

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorage,
  });

  return {
    restore() {
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: originalWindow,
        });
      }

      if (originalLocalStorage === undefined) {
        Reflect.deleteProperty(globalThis, 'localStorage');
      } else {
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          value: originalLocalStorage,
        });
      }
    },
  };
}

test('getStoredRagEnabled defaults to enabled when no preference is stored', () => {
  const env = installWindow();

  try {
    assert.equal(getStoredRagEnabled(), true);
  } finally {
    env.restore();
  }
});

test('getStoredRagEnabled respects an explicit disabled preference', () => {
  const env = installWindow({ [RAG_ENABLED_KEY]: 'false' });

  try {
    assert.equal(getStoredRagEnabled(), false);
  } finally {
    env.restore();
  }
});
