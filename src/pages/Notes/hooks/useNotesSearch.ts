import { useState, useEffect, useCallback, useRef } from 'react';
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

  const performSearch = useCallback(async (query: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      if (cancelledRef.current) return;

      setIsSearching(true);

      try {
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
      } finally {
        if (!cancelledRef.current) {
          setIsSearching(false);
        }
      }
    }, 300);
  }, [setNotes]);

  useEffect(() => {
    performSearch(searchQuery);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [searchQuery, performSearch]);

  return {
    searchQuery,
    isSearching,
    setSearchQuery,
    setIsSearching,
    handleSearch: () => performSearch(searchQuery),
  };
}