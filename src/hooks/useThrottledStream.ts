import { useRef, useCallback, useEffect } from 'react';

/** Throttle interval for streaming content updates to reduce rendering pressure. */
const STREAM_THROTTLE_MS = 80;

interface PendingChunks {
  messageId: string;
  chunks: string[];
}

interface ThrottledStreamOptions {
  onFlush: (messageId: string, combinedChunk: string) => void;
}

export function useThrottledStream(options: ThrottledStreamOptions) {
  const { onFlush } = options;

  const pendingChunksRef = useRef<PendingChunks>({ messageId: '', chunks: [] });
  const throttleTimerRef = useRef<number | null>(null);

  // 节流后的批量更新
  const flushPendingChunks = useCallback(() => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }

    const pending = pendingChunksRef.current;
    if (pending.chunks.length > 0) {
      const combinedChunk = pending.chunks.join('');
      onFlush(pending.messageId, combinedChunk);
      pending.chunks = [];
    }
  }, [onFlush]);

  // 接收新 chunk
  const appendChunk = useCallback((messageId: string, chunk: string) => {
    const pending = pendingChunksRef.current;

    // 如果是新的消息ID，先 flush 旧的
    if (pending.messageId !== messageId && pending.chunks.length > 0) {
      flushPendingChunks();
    }

    // 更新当前消息ID并添加chunk
    pending.messageId = messageId;
    pending.chunks.push(chunk);

    // 设置节流定时器
    if (!throttleTimerRef.current) {
      throttleTimerRef.current = window.setTimeout(
        flushPendingChunks,
        STREAM_THROTTLE_MS
      );
    }
  }, [flushPendingChunks]);

  // 强制立即 flush（用于流结束或等待确认等场景）
  const forceFlush = useCallback(() => {
    flushPendingChunks();
  }, [flushPendingChunks]);

  // 清理
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  return { appendChunk, forceFlush };
}