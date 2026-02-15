import { useState, useEffect, useCallback } from 'react';
import type { VitalsSimple } from '../types';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? 'http://localhost:3851';
const POLL_MS = Number(import.meta.env.VITE_VITALS_POLL_MS ?? 3000);

const fallback: VitalsSimple = { cpu: 0, ram: 0, disk: 0, gpu: 0 };

export function useVitals(): VitalsSimple {
  const [vitals, setVitals] = useState<VitalsSimple>(fallback);

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
    fetchVitals();
    const id = setInterval(fetchVitals, POLL_MS);
    return () => clearInterval(id);
  }, [fetchVitals]);

  return vitals;
}
