import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { request } from '../lib/api';
import { useStore } from '../state/StoreProvider';

// Tie each result to its URL and session so old requests cannot surface after navigation.
export function useResource<T>(path: string) {
  const { session, setError } = useStore();
  const location = useLocation();
  const key = `${session?.id}:${location.key}:${path}`;
  const [result, setResult] = useState<{ key: string; data?: T }>();
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void request<T>(path, session.id).then(
      (data) => {
        if (!cancelled) setResult({ key, data });
      },
      (error) => {
        if (!cancelled) {
          setError(error.message);
          setResult({ key });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, session, key, setError]);
  return { data: result?.key === key ? result.data : undefined, loading: result?.key !== key };
}
