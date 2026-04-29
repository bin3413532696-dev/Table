import { useState, useEffect, useMemo, useCallback } from 'react';
import { noteDB, Note } from '../../../db';

export function useNotesSearch(
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const debouncedSearch = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    return async (query: string) => {
      if (timer) clearTimeout(timer);

      return new Promise<void>((resolve) => {
        timer = setTimeout(async () => {
          if (!query.trim()) {
            const allNotes = await noteDB.getAll();
            setNotes(allNotes);
          } else {
            const results = await noteDB.search(query);
            setNotes(results);
          }
          resolve();
        }, 300);
      });
    };
  }, [setNotes]);

  const handleSearch = useCallback(async () => {
    await debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  return {
    searchQuery,
    isSearching,
    setSearchQuery,
    setIsSearching,
    handleSearch,
  };
}
