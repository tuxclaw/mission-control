import { useState, useEffect, useCallback, useRef } from 'react';
import type { VitalsSimple } from '../types';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? 'http://localhost:3851';
const POLL_MS = Number(import.meta.env.VITE_VITALS_POLL_MS ?? 3000);
const POLL_MS_HIDDEN = 30000; // 30s when tab not visible

const fallback: VitalsSimple = { cpu: 0, ram: 0, disk: 0, gpu: 0 };

export function useVitals(): VitalsSimple {
  const [vitals, setVitals] = useState<VitalsSimple>(fallback);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchVitals = useCallback(async () => {
    try {
      const res = await fetch(`${VITALS_API}/api/vitals`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VitalsSimple = await res.json();
      setVitals(data);
    } catch {
      // Keep last known values; server may be down
    }
  }, []);

  useEffect(() => {
    const startPolling = (ms: number) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchVitals, ms);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        startPolling(POLL_MS_HIDDEN);
      } else {
        fetchVitals();
        startPolling(POLL_MS);
      }
    };

    fetchVitals();
    startPolling(POLL_MS);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchVitals]);

  return vitals;
}
