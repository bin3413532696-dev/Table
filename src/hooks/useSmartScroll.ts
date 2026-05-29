import { useRef, useCallback, useEffect, useState } from 'react';

/** Distance (px) from the bottom within which we consider the user "near bottom". */
const NEAR_BOTTOM_THRESHOLD = 100;

/** Throttle for scroll events during streaming to reduce CPU usage. */
const SCROLL_THROTTLE_MS = 80;

type ScrollMode = 'always' | 'near-bottom' | 'off';

interface SmartScrollState {
  userNearBottom: boolean;
  newMessagesBelow: boolean;
  isProgrammaticScroll: boolean;
}

interface SmartScrollOptions {
  scrollMode?: ScrollMode;
  isProcessing?: boolean;
}

export function useSmartScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
  options: SmartScrollOptions = {}
) {
  const { scrollMode = 'near-bottom', isProcessing = false } = options;

  const [state, setState] = useState<SmartScrollState>({
    userNearBottom: true,
    newMessagesBelow: false,
    isProgrammaticScroll: false,
  });

  const lastScrollTopRef = useRef(0);
  const programmaticTargetRef = useRef(0);
  const scrollThrottleTimerRef = useRef<number | null>(null);
  const hasAutoScrolledRef = useRef(false);

  // 滚动事件处理 - 区分用户滚动和程序滚动
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const scrollTop = Math.max(0, container.scrollTop);

    // 节流：减少高频滚动事件处理
    if (scrollThrottleTimerRef.current) {
      return;
    }
    scrollThrottleTimerRef.current = window.setTimeout(() => {
      scrollThrottleTimerRef.current = null;
    }, SCROLL_THROTTLE_MS);

    // 忽略程序触发的滚动事件
    // 只有 scrollTop 在程序滚动目标之上时才处理（用户向上滚动）
    if (
      state.isProgrammaticScroll &&
      scrollTop >= programmaticTargetRef.current - container.clientHeight
    ) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - scrollTop - container.clientHeight;
    const userNearBottom = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;

    setState((prev) => ({
      ...prev,
      userNearBottom,
      // 用户滚动回底部时清除新消息提示
      newMessagesBelow: userNearBottom ? false : prev.newMessagesBelow,
    }));
  }, [state.isProgrammaticScroll]);

  // 触发滚动到底部
  const scrollToBottom = useCallback((smooth = true) => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    // 判断是否应该跟随滚动
    const manualScroll = false;
    const effectiveForce = !hasAutoScrolledRef.current;
    const shouldStick =
      manualScroll ||
      scrollMode === 'always' ||
      (scrollMode === 'near-bottom' &&
        (effectiveForce || state.userNearBottom || distanceFromBottom < NEAR_BOTTOM_THRESHOLD));

    if (!shouldStick) {
      // 用户向上滚动时，标记有新消息在下方
      setState((prev) => ({ ...prev, newMessagesBelow: true }));
      return;
    }

    if (effectiveForce) {
      hasAutoScrolledRef.current = true;
    }

    // 检查是否应该禁用动画（用户偏好减少动画）
    const smoothEnabled =
      smooth &&
      (typeof window === 'undefined' ||
        typeof window.matchMedia !== 'function' ||
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const scrollTop = container.scrollHeight;
    programmaticTargetRef.current = scrollTop;

    // 标记程序滚动开始
    setState((prev) => ({
      ...prev,
      isProgrammaticScroll: true,
      newMessagesBelow: false,
      userNearBottom: true,
    }));

    // 使用 requestAnimationFrame 确保渲染完成后滚动
    requestAnimationFrame(() => {
      container.scrollTo({
        top: scrollTop,
        behavior: smoothEnabled ? 'smooth' : 'auto',
      });

      // 清除程序滚动标记
      requestAnimationFrame(() => {
        setState((prev) => ({ ...prev, isProgrammaticScroll: false }));
      });
    });
  }, [containerRef, scrollMode, state.userNearBottom]);

  // 监听消息变化时自动滚动
  useEffect(() => {
    if (isProcessing && state.userNearBottom) {
      scrollToBottom(true);
    }
  }, [isProcessing, state.userNearBottom, scrollToBottom]);

  // 重置滚动状态（用于新会话）
  const resetScrollState = useCallback(() => {
    hasAutoScrolledRef.current = false;
    setState({
      userNearBottom: true,
      newMessagesBelow: false,
      isProgrammaticScroll: false,
    });
    lastScrollTopRef.current = 0;
    programmaticTargetRef.current = 0;
  }, []);

  // 清理
  useEffect(() => {
    return () => {
      if (scrollThrottleTimerRef.current) {
        clearTimeout(scrollThrottleTimerRef.current);
      }
    };
  }, []);

  return {
    handleScroll,
    scrollToBottom,
    resetScrollState,
    scrollState: state,
  };
}