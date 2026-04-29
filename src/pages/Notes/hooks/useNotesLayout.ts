import { useState, useRef, useEffect, useCallback } from 'react';

export function useNotesLayout() {
  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(300);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const leftResizeRef = useRef<HTMLDivElement>(null);
  const rightResizeRef = useRef<HTMLDivElement>(null);
  const isResizingLeft = useRef(false);
  const isResizingRight = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingLeft.current) {
        const newWidth = e.clientX;
        if (newWidth >= 200 && newWidth <= 400) {
          setLeftWidth(newWidth);
        }
      }
      if (isResizingRight.current) {
        const containerWidth = window.innerWidth;
        const newWidth = containerWidth - e.clientX;
        if (newWidth >= 200 && newWidth <= 500) {
          setRightWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      isResizingLeft.current = false;
      isResizingRight.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startResizeLeft = useCallback(() => { isResizingLeft.current = true; }, []);
  const startResizeRight = useCallback(() => { isResizingRight.current = true; }, []);

  return {
    leftWidth,
    rightWidth,
    leftCollapsed,
    rightCollapsed,
    setLeftCollapsed,
    setRightCollapsed,
    leftResizeRef,
    rightResizeRef,
    startResizeLeft,
    startResizeRight,
  };
}
