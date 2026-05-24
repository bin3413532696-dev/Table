import { useState, useMemo, useCallback, useEffect, useRef } from 'react';

export function useSearch<T>(
  data: T[],
  searchFields: (keyof T)[] = [],
  caseSensitive: boolean = false
) {
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;
    
    const query = caseSensitive ? searchQuery : searchQuery.toLowerCase();
    
    return data.filter(item => {
      return searchFields.some(field => {
        const value = item[field];
        if (value === null || value === undefined) return false;
        const stringValue = String(value);
        return caseSensitive 
          ? stringValue.includes(searchQuery) 
          : stringValue.toLowerCase().includes(query);
      });
    });
  }, [data, searchQuery, searchFields, caseSensitive]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    filteredData,
    clearSearch,
  };
}

export function useDebouncedSearch<T>(
  data: T[],
  searchFields: (keyof T)[] = [],
  delay: number = 300
) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, delay);
    return () => clearTimeout(timer);
  }, [searchQuery, delay]);

  const filteredData = useMemo(() => {
    if (!debouncedQuery.trim()) return data;
    
    const query = debouncedQuery.toLowerCase();
    
    return data.filter(item => {
      return searchFields.some(field => {
        const value = item[field];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(query);
      });
    });
  }, [data, debouncedQuery, searchFields]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    filteredData,
    clearSearch,
  };
}

export function useSearchInput() {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = useCallback(() => {
    setValue('');
    inputRef.current?.focus();
  }, []);

  const focus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return {
    value,
    setValue,
    clear,
    focus,
    inputProps: {
      ref: inputRef,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
    },
  };
}
