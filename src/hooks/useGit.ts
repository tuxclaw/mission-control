import { useState, useEffect, useCallback } from 'react';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? 'http://localhost:3851';

interface GitStatus {
  entries: string[];
  raw: string;
}

export function useGit() {
  const [status, setStatus] = useState<GitStatus>({ entries: [], raw: '' });
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${VITALS_API}/api/git/status`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: GitStatus = await res.json();
      setStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const pull = useCallback(async () => {
    setPulling(true);
    setError(null);
    try {
      const res = await fetch(`${VITALS_API}/api/git/pull`, { method: 'POST' });
      const data = await res.json();
      setOutput(data.output);
      if (!data.ok) throw new Error(data.output);
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pull failed');
    } finally {
      setPulling(false);
    }
  }, [fetchStatus]);

  const push = useCallback(async () => {
    setPushing(true);
    setError(null);
    try {
      const res = await fetch(`${VITALS_API}/api/git/push`, { method: 'POST' });
      const data = await res.json();
      setOutput(data.output);
      if (!data.ok) throw new Error(data.output);
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  }, [fetchStatus]);

  const commit = useCallback(async (message: string) => {
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`${VITALS_API}/api/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      setOutput(data.output);
      if (!data.ok) throw new Error(data.output);
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }, [fetchStatus]);

  return { status, loading, pulling, pushing, committing, error, output, fetchStatus, pull, push, commit };
}
