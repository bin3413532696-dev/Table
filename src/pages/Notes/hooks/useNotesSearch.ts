import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { noteDB, Note } from '../../../db';

export function useNotesSearch(
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const debouncedSearch = useMemo(() => {
    return async (query: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      return new Promise<void>((resolve) => {
        timerRef.current = setTimeout(async () => {
          if (cancelledRef.current) {
            resolve();
            return;
          }

          if (!query.trim()) {
            const allNotes = await noteDB.getAll();
            if (!cancelledRef.current) {
              setNotes(allNotes);
            }
          } else {
            const results = await noteDB.search(query);
            if (!cancelledRef.current) {
              setNotes(results);
            }
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
