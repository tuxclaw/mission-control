import { useState, useEffect, useCallback } from 'react';
import type { CronJob } from '../types';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? '';
const POLL_MS = 15000;

interface UseCronReturn {
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  runJob: (id: string) => Promise<void>;
  toggleJob: (id: string, enabled: boolean) => Promise<void>;
}

export function useCron(): UseCronReturn {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`${VITALS_API}/api/cron/jobs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { jobs: CronJob[] };
      setJobs(data.jobs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cron jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  const runJob = useCallback(async (id: string) => {
    const res = await fetch(`${VITALS_API}/api/cron/jobs/${id}/run`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchJobs();
  }, [fetchJobs]);

  const toggleJob = useCallback(async (id: string, enabled: boolean) => {
    const res = await fetch(`${VITALS_API}/api/cron/jobs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    fetchJobs();
    const id = setInterval(fetchJobs, POLL_MS);
    return () => clearInterval(id);
  }, [fetchJobs]);

  return { jobs, loading, error, refresh: fetchJobs, runJob, toggleJob };
}
