import { useState, useMemo, useCallback } from 'react';

type SortOrder = 'asc' | 'desc';

export interface SortOption<T> {
  key: string;
  label: string;
  sortFn: (a: T, b: T) => number;
}

export function useSort<T>(
  data: T[],
  options: SortOption<T>[],
  defaultKey?: string
) {
  const [sortKey, setSortKey] = useState<string>(defaultKey || (options[0]?.key || ''));
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const sortedData = useMemo(() => {
    if (!sortKey || data.length === 0) return data;
    
    const option = options.find(opt => opt.key === sortKey);
    if (!option) return data;

    const sorted = [...data].sort(option.sortFn);
    return sortOrder === 'asc' ? sorted : sorted.reverse();
  }, [data, sortKey, sortOrder, options]);

  const toggleOrder = useCallback(() => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  }, []);

  const setSort = useCallback((key: string) => {
    if (key === sortKey) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  }, [sortKey]);

  return {
    sortKey,
    sortOrder,
    sortedData,
    setSort,
    toggleOrder,
    currentOption: options.find(opt => opt.key === sortKey),
  };
}

export function useSimpleSort<T>(
  data: T[],
  sortField: keyof T,
  defaultOrder: SortOrder = 'desc'
) {
  const [order, setOrder] = useState<SortOrder>(defaultOrder);

  const sortedData = useMemo(() => {
    if (data.length === 0) return data;
    
    return [...data].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        return order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      
      if (typeof valA === 'number' && typeof valB === 'number') {
        return order === 'asc' ? valA - valB : valB - valA;
      }
      
      if (valA instanceof Date && valB instanceof Date) {
        return order === 'asc' ? valA.getTime() - valB.getTime() : valB.getTime() - valA.getTime();
      }
      
      return 0;
    });
  }, [data, sortField, order]);

  const toggleOrder = useCallback(() => {
    setOrder(prev => prev === 'asc' ? 'desc' : 'asc');
  }, []);

  return {
    order,
    sortedData,
    toggleOrder,
    setOrder,
  };
}
