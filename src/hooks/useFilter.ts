import { useState, useMemo, useCallback } from 'react';

export function useFilter<T>(initialData: T[], filterFn: (item: T, filterValue: string) => boolean) {
  const [filterValue, setFilterValue] = useState('');
  
  const filteredData = useMemo(() => {
    if (!filterValue.trim()) return initialData;
    return initialData.filter(item => filterFn(item, filterValue));
  }, [initialData, filterValue, filterFn]);

  const clearFilter = useCallback(() => {
    setFilterValue('');
  }, []);

  return {
    filterValue,
    setFilterValue,
    filteredData,
    clearFilter,
  };
}

export function useMultiFilter<T>(
  initialData: T[],
  filters: Record<string, (item: T, value: string | boolean) => boolean>
) {
  const [filterValues, setFilterValues] = useState<Record<string, string | boolean>>({});

  const filteredData = useMemo(() => {
    return initialData.filter(item => {
      return Object.entries(filters).every(([key, filterFn]) => {
        const value = filterValues[key];
        if (value === undefined || value === '' || value === false) return true;
        return filterFn(item, value);
      });
    });
  }, [initialData, filterValues, filters]);

  const setFilter = useCallback((key: string, value: string | boolean) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilterValues({});
  }, []);

  return {
    filterValues,
    setFilter,
    filteredData,
    clearFilters,
  };
}
