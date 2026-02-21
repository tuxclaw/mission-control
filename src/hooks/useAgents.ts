import { useState, useEffect, useCallback } from 'react';
import type { Agent } from '../types';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? '';

/** Map full model IDs to short display labels */
function modelLabel(model: string): string {
  const map: Record<string, string> = {
    'anthropic/claude-opus-4-6': 'opus',
    'anthropic/claude-sonnet-4-20250514': 'sonnet',
    'openai/gpt-5.2': 'gpt-5.2',
    'google/gemini-2.5-pro': 'gemini',
    'ollama/qwen3:30b-a3b': 'local-30b',
  };
  return map[model] ?? model.split('/').pop() ?? model;
}

function buildPlaceholders(andyModel: string): Agent[] {
  return [
    { id: 'andy-main', name: 'Andy ⚡', model: modelLabel(andyModel), status: 'active', role: 'Orchestrator' },
    { id: 'buzz', name: 'Buzz 🚀', model: 'codex', status: 'idle', role: 'Coding Agent' },
    { id: 'woody', name: 'Woody 🤠', model: 'codex', status: 'idle', role: 'Coding Agent' },
    { id: 'sarge', name: 'Sarge 🎖️', model: 'opus', status: 'idle', role: 'Code Review' },
    { id: 'trixie', name: 'Trixie 🎨', model: 'claude', status: 'idle', role: 'UI/Design' },
    { id: 'jessie', name: 'Jessie 🔍', model: 'sonnet', status: 'idle', role: 'Research' },
  ];
}

interface UseAgentsResult {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<Agent[]>(buildPlaceholders('opus'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch current model for Andy's tag
      let andyModel = 'opus';
      try {
        const modelRes = await fetch(`${VITALS_API}/api/models/status`);
        if (modelRes.ok) {
          const modelData = await modelRes.json() as { model?: string };
          if (typeof modelData.model === 'string' && modelData.model !== 'unknown') {
            andyModel = modelData.model;
          }
        }
      } catch { /* use default */ }

      // Try to fetch live session data
      const res = await fetch(`${VITALS_API}/api/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Agent[] = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        // Update Andy's model tag in live data too
        const updated = data.map((a) =>
          a.id === 'andy-main' ? { ...a, model: modelLabel(andyModel) } : a
        );
        setAgents(updated);
      } else {
        setAgents(buildPlaceholders(andyModel));
      }
      setError(null);
    } catch (err) {
      // Still update Andy's model even on session fetch failure
      try {
        const modelRes = await fetch(`${VITALS_API}/api/models/status`);
        if (modelRes.ok) {
          const modelData = await modelRes.json() as { model?: string };
          if (typeof modelData.model === 'string' && modelData.model !== 'unknown') {
            setAgents(buildPlaceholders(modelData.model));
          }
        }
      } catch { /* keep current state */ }
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
