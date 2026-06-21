import { useCallback, useEffect, useRef } from 'react';

const STREAM_THROTTLE_MS = 80;

export function useStreamingBuffer(
  onFlush: (messageId: string, chunk: string) => void,
  throttleMs = STREAM_THROTTLE_MS
) {
  const pendingChunksRef = useRef<{ messageId: string; chunks: string[] }>({ messageId: '', chunks: [] });
  const throttleTimerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }

    const pending = pendingChunksRef.current;
    if (pending.chunks.length === 0) {
      return;
    }

    onFlush(pending.messageId, pending.chunks.join(''));
    pending.chunks = [];
  }, [onFlush]);

  const append = useCallback((messageId: string, chunk: string) => {
    const pending = pendingChunksRef.current;
    if (pending.messageId !== messageId && pending.chunks.length > 0) {
      flush();
    }

    pending.messageId = messageId;
    pending.chunks.push(chunk);

    if (!throttleTimerRef.current) {
      throttleTimerRef.current = window.setTimeout(flush, throttleMs);
    }
  }, [flush, throttleMs]);

  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);

  return {
    append,
    flush,
  };
}
