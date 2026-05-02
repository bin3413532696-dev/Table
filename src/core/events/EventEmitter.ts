/**
 * 统一事件发射器
 * 替代原有的三套独立订阅系统
 */

import { EventTopic, EventTopics, DataType, DataChangeTopics } from './topics';

type Listener<T = void> = (data: T) => void;

/**
 * 统一事件发射器类
 */
class EventEmitterClass {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  /**
   * 订阅事件
   */
  subscribe<T = void>(topic: EventTopic, listener: Listener<T>): () => void {
    if (!this.listeners.has(topic.key)) {
      this.listeners.set(topic.key, new Set());
    }
    this.listeners.get(topic.key)!.add(listener as Listener<unknown>);

    return () => {
      this.listeners.get(topic.key)?.delete(listener as Listener<unknown>);
    };
  }

  /**
   * 发射事件
   */
  emit<T = void>(topic: EventTopic, data?: T): void {
    const topicListeners = this.listeners.get(topic.key);
    if (topicListeners) {
      topicListeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`[EventEmitter] Listener error for ${topic.key}:`, error);
        }
      });
    }
  }

  /**
   * 一次性订阅
   */
  once<T = void>(topic: EventTopic, listener: Listener<T>): () => void {
    let unsubscribe: (() => void) | null = null;

    const wrappedListener: Listener<T> = (data) => {
      listener(data);
      if (unsubscribe) {
        unsubscribe();
      }
    };

    unsubscribe = this.subscribe(topic, wrappedListener);
    return unsubscribe;
  }

  /**
   * 清除某个主题的所有监听器
   */
  clear(topic: EventTopic): void {
    this.listeners.delete(topic.key);
  }

  /**
   * 清除所有监听器
   */
  clearAll(): void {
    this.listeners.clear();
  }

  /**
   * 获取某个主题的监听器数量
   */
  listenerCount(topic: EventTopic): number {
    return this.listeners.get(topic.key)?.size || 0;
  }
}

/**
 * 全局事件发射器实例
 */
export const eventEmitter = new EventEmitterClass();

/**
 * 订阅数据变更事件
 */
export function subscribeDataChange(
  type: DataType,
  listener: () => void
): () => void {
  const topic = DataChangeTopics[type];
  return eventEmitter.subscribe(topic, listener);
}

/**
 * 发射数据变更事件
 */
export function emitDataChange(type: DataType): void {
  const topic = DataChangeTopics[type];
  eventEmitter.emit(topic);
}

/**
 * 订阅同步状态变更
 */
export function subscribeSyncStatus(
  listener: (status: 'started' | 'completed' | 'failed') => void
): () => void {
  const unsubscribers = [
    eventEmitter.subscribe(EventTopics.SYNC_STARTED, () => listener('started')),
    eventEmitter.subscribe(EventTopics.SYNC_COMPLETED, () => listener('completed')),
    eventEmitter.subscribe(EventTopics.SYNC_FAILED, () => listener('failed')),
  ];

  return () => {
    unsubscribers.forEach(unsub => unsub());
  };
}

/**
 * 向后兼容：导出原有接口签名
 */

// 兼容 db/index.ts 的 subscribe
export type CollectionType = 'finance' | 'tasks';
export type LegacyListener = (collection: CollectionType) => void;

export function subscribe(listener: LegacyListener): () => void {
  const unsubscribers = [
    eventEmitter.subscribe(EventTopics.FINANCE_CHANGED, () => listener('finance')),
    eventEmitter.subscribe(EventTopics.TASKS_CHANGED, () => listener('tasks')),
  ];

  return () => {
    unsubscribers.forEach(unsub => unsub());
  };
}


