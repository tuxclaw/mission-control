import { useState, useEffect, useCallback } from 'react';
import type { Agent } from '../types';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? '';

const placeholderAgents: Agent[] = [
  { id: 'andy-main', name: 'Andy ⚡', model: 'opus', status: 'active', role: 'Orchestrator' },
  { id: 'buzz', name: 'Buzz 🚀', model: 'codex', status: 'idle', role: 'Coding Agent' },
  { id: 'woody', name: 'Woody 🤠', model: 'codex', status: 'idle', role: 'Coding Agent' },
  { id: 'sarge', name: 'Sarge 🎖️', model: 'opus', status: 'idle', role: 'Code Review' },
  { id: 'jessie', name: 'Jessie 🔍', model: 'sonnet', status: 'idle', role: 'Research' },
];

interface UseAgentsResult {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<Agent[]>(placeholderAgents);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${VITALS_API}/api/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Agent[] = await res.json();
      if (Array.isArray(data)) setAgents(data);
      setError(null);
    } catch (err) {
      // Gracefully fall back to placeholder data
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const id = setInterval(fetchAgents, 10000);
    return () => clearInterval(id);
  }, [fetchAgents]);

  return { agents, loading, error, refetch: fetchAgents };
}
