import { useEffect, useRef, useState } from 'react';
import { Cpu, ChevronDown } from 'lucide-react';

const API = import.meta.env.VITE_VITALS_API_URL ?? '';

type ModelOption = {
  id: string;
  label: string;
  detail: string;
};

const MODEL_OPTIONS: ModelOption[] = [
  { id: 'anthropic/claude-opus-4-6', label: 'Opus', detail: 'anthropic/claude-opus-4-6' },
  { id: 'openai/gpt-5.2', label: 'GPT-5.2', detail: 'openai/gpt-5.2' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', detail: 'google/gemini-2.5-pro' },
  { id: 'ollama/qwen3:30b-a3b', label: 'Local 30B', detail: 'ollama/qwen3:30b-a3b' },
];

function resolveLabel(model: string | null): string {
  if (!model) return 'Model';
  const match = MODEL_OPTIONS.find((option) => option.id === model);
  return match?.label ?? model;
}

export function ModelSwitcher() {
  const [open, setOpen] = useState(false);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadStatus() {
      try {
        const res = await fetch(`${API}/api/models/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { model?: string };
        if (mounted) {
          setCurrentModel(typeof data.model === 'string' ? data.model : null);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load model status');
      }
    }
    loadStatus();
    return () => { mounted = false; };
  }, []);

  async function handleSelect(option: ModelOption) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/models/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: option.id }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `HTTP ${res.status}`);
      }
      const data = await res.json() as { model?: string };
      setCurrentModel(typeof data.model === 'string' ? data.model : option.id);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch model');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="model-selector" ref={dropdownRef}>
      <button
        className="model-selector__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${resolveLabel(currentModel)}. Click to change model.`}
        disabled={loading}
        type="button"
      >
        <Cpu size={14} aria-hidden="true" />
        <span className="model-selector__label">{loading ? 'Switching...' : resolveLabel(currentModel)}</span>
        <ChevronDown size={12} aria-hidden="true" className={`model-selector__chevron${open ? ' model-selector__chevron--open' : ''}`} />
      </button>
      {open && (
        <ul className="model-selector__dropdown" role="listbox" aria-label="Select model">
          {MODEL_OPTIONS.map((option) => (
            <li key={option.id} role="option" aria-selected={option.id === currentModel}>
              <button
                className={`model-selector__option${option.id === currentModel ? ' model-selector__option--active' : ''}`}
                onClick={() => handleSelect(option)}
                disabled={loading}
              >
                <span className="model-selector__option-label">{option.label}</span>
                <span className="model-selector__option-detail">{option.detail}</span>
              </button>
            </li>
          ))}
          {error && (
            <li className="model-selector__error" role="alert">
              {error}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
