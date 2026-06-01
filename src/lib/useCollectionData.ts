import { useEffect, useRef, useState } from 'react';
import type { CollectionType } from '../core/events';
import { subscribe } from '../core/events';
import { MESSAGES } from '../core/messages';
import { getErrorMessage } from './api/client';

export function useCollectionData<T>(
  fetcher: () => Promise<T>,
  dependencies: CollectionType[]
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  const depsRef = useRef(dependencies);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    depsRef.current = dependencies;
  }, [dependencies]);

  useEffect(() => {
    let ignore = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const result = await fetcherRef.current();
        if (!ignore) {
          setData(result);
        }
      } catch (loadError) {
        if (!ignore) {
          setError(getErrorMessage(loadError, MESSAGES.common.loadFailed));
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    void load();

    const unsubscribe = subscribe((collection) => {
      if (depsRef.current.includes(collection)) {
        void load();
      }
    });

    return () => {
      ignore = true;
      unsubscribe();
    };
  }, []);

  return { data, loading, error };
}
