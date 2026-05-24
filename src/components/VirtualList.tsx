import React, { useRef, useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  containerHeight?: number;
}

export const VirtualList = <T extends { id: string }>({
  items,
  itemHeight,
  renderItem,
  containerHeight = 480
}: VirtualListProps<T>) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [visibleItems, setVisibleItems] = useState<{ item: T; index: number; offset: number }[]>([]);

  const calculateVisibleItems = useCallback((scroll: number) => {
    const startIndex = Math.floor(scroll / itemHeight);
    const endIndex = Math.min(
      startIndex + Math.ceil(containerHeight / itemHeight) + 1,
      items.length
    );

    const visible: { item: T; index: number; offset: number }[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      if (items[i]) {
        visible.push({
          item: items[i],
          index: i,
          offset: i * itemHeight
        });
      }
    }
    return visible;
  }, [items, itemHeight, containerHeight]);

  useEffect(() => {
    setVisibleItems(calculateVisibleItems(scrollTop));
  }, [scrollTop, calculateVisibleItems]);

  useEffect(() => {
    setVisibleItems(calculateVisibleItems(0));
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [items.length, calculateVisibleItems]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = items.length * itemHeight;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      style={{ height: containerHeight }}
    >
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight }} />
      </div>
      
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div style={{ transform: `translateY(${scrollTop}px)` }}>
          <AnimatePresence mode="popLayout">
            {visibleItems.map(({ item, index, offset }) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-auto"
                style={{ 
                  position: 'absolute', 
                  top: offset, 
                  left: 0, 
                  right: 0,
                  height: itemHeight 
                }}
              >
                {renderItem(item, index)}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};