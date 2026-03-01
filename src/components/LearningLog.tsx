import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Loader2, Plus, X } from 'lucide-react';
import type { LearningLogEntry, LearningLogEntryType } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

const typeLabels: Record<LearningLogEntryType, string> = {
  error: 'Errors',
  learning: 'Learnings',
  feature: 'Features',
};

const typeOrder: LearningLogEntryType[] = ['error', 'learning', 'feature'];

function formatEntryDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function LearningLog() {
  const [entries, setEntries] = useState<LearningLogEntry[]>([]);
  const [activeTypes, setActiveTypes] = useState<LearningLogEntryType[]>(() => [...typeOrder]);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formType, setFormType] = useState<LearningLogEntryType>('learning');
  const [formCategory, setFormCategory] = useState('');
  const [formText, setFormText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/learning-log`);
      if (!res.ok) throw new Error('Failed to load learning log');
      const data = await res.json() as { entries?: LearningLogEntry[] };
      const nextEntries = Array.isArray(data.entries) ? data.entries : [];
      setEntries(nextEntries);
      setLastSynced(new Date());
    } catch {
      setError('Failed to load learning log. Is the server running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const counts = useMemo(() => {
    return typeOrder.reduce<Record<LearningLogEntryType, number>>((acc, type) => {
      acc[type] = entries.filter(entry => entry.type === type).length;
      return acc;
    }, { error: 0, learning: 0, feature: 0 });
  }, [entries]);

  const activeTypeSet = useMemo(() => new Set(activeTypes), [activeTypes]);

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => activeTypeSet.has(entry.type));
  }, [entries, activeTypeSet]);

  const groupedEntries = useMemo(() => {
    const map = new Map<string, LearningLogEntry[]>();
    for (const entry of filteredEntries) {
      const key = entry.category || 'Uncategorized';
      const existing = map.get(key) ?? [];
      existing.push(entry);
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .map(([category, items]) => {
        const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
        return [category, sorted] as const;
      })
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredEntries]);

  const toggleType = (type: LearningLogEntryType) => {
    setActiveTypes(prev => {
      const set = new Set(prev);
      if (set.has(type)) {
        if (set.size === 1) return prev;
        set.delete(type);
      } else {
        set.add(type);
      }
      return Array.from(set);
    });
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const category = formCategory.trim();
    const text = formText.trim();
    if (!category || !text) {
      setFormError('Category and entry text are required.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/learning-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: formType, category, text }),
      });
      if (!res.ok) throw new Error('Failed to save entry');
      const created = await res.json() as LearningLogEntry;
      setEntries(prev => [created, ...prev]);
      setLastSynced(new Date());
      setFormCategory('');
      setFormText('');
      setFormType('learning');
      setIsAdding(false);
    } catch {
      setFormError('Failed to save entry. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="learning-log" role="tabpanel" id="panel-learning-log">
      <header className="learning-log__header">
        <div>
          <h2 className="learning-log__title">
            <BookOpen size={18} aria-hidden="true" />
            Learning Log
          </h2>
          <p className="learning-log__subtitle">Patterns, mistakes, and shipped features captured for future runs.</p>
        </div>
        <div className="learning-log__header-actions">
          {lastSynced && (
            <span className="learning-log__synced">Synced just now · {formatTime(lastSynced)}</span>
          )}
          <button
            type="button"
            className="learning-log__add-btn"
            onClick={() => setIsAdding(true)}
          >
            <Plus size={14} aria-hidden="true" />
            + Add Entry
          </button>
        </div>
      </header>

      <div className="learning-log__filters" role="group" aria-label="Filter learning log by type">
        {typeOrder.map(type => {
          const active = activeTypeSet.has(type);
          return (
            <button
              key={type}
              type="button"
              className={`learning-log__filter ${active ? 'learning-log__filter--active' : ''}`}
              onClick={() => toggleType(type)}
              aria-pressed={active}
            >
              {typeLabels[type]} ({counts[type]})
            </button>
          );
        })}
      </div>

      {error && <p className="learning-log__error">{error}</p>}

      <div className="learning-log__content">
        {loading ? (
          <div className="learning-log__loading">
            <Loader2 size={18} className="spin" aria-hidden="true" />
            Loading learning log...
          </div>
        ) : groupedEntries.length === 0 ? (
          <p className="learning-log__empty">No entries match the selected filters.</p>
        ) : (
          <div className="learning-log__categories">
            {groupedEntries.map(([category, items]) => {
              const open = expandedCategories.has(category);
              const panelId = `learning-log-${slugify(category)}`;
              return (
                <div key={category} className={`learning-log__category ${open ? 'learning-log__category--open' : ''}`}>
                  <button
                    type="button"
                    className="learning-log__category-header"
                    onClick={() => toggleCategory(category)}
                    aria-expanded={open}
                    aria-controls={panelId}
                  >
                    <div className="learning-log__category-title">
                      <span>{category}</span>
                      <span className="learning-log__category-count">{items.length} entries</span>
                    </div>
                    <ChevronDown size={16} aria-hidden="true" className="learning-log__category-chevron" />
                  </button>
                  <div id={panelId} className="learning-log__category-body" aria-hidden={!open}>
                    <ul className="learning-log__entry-list">
                      {items.map(entry => (
                        <li key={entry.id} className="learning-log__entry">
                          <div className="learning-log__entry-meta">
                            <span className="learning-log__badge">{formatEntryDate(entry.date)}</span>
                            <span className="learning-log__badge learning-log__badge--source">{entry.source || 'manual'}</span>
                          </div>
                          <p className="learning-log__entry-text">{entry.text}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isAdding && (
        <div
          className="panel-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Add Learning Log Entry"
          onClick={() => setIsAdding(false)}
        >
          <div className="learning-log__panel panel-container panel-slide-in" onClick={event => event.stopPropagation()}>
            <div className="learning-log__panel-header">
              <h3>Add Learning Log Entry</h3>
              <button type="button" className="learning-log__panel-close" onClick={() => setIsAdding(false)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <form className="learning-log__form" onSubmit={handleSubmit}>
              <label className="learning-log__label" htmlFor="learning-log-type">
                Type
              </label>
              <select
                id="learning-log-type"
                className="learning-log__select"
                value={formType}
                onChange={event => setFormType(event.target.value as LearningLogEntryType)}
              >
                <option value="error">Error</option>
                <option value="learning">Learning</option>
                <option value="feature">Feature</option>
              </select>

              <label className="learning-log__label" htmlFor="learning-log-category">
                Category
              </label>
              <input
                id="learning-log-category"
                className="learning-log__input"
                value={formCategory}
                onChange={event => setFormCategory(event.target.value)}
                placeholder="e.g. Agent Workflow"
              />

              <label className="learning-log__label" htmlFor="learning-log-text">
                Entry
              </label>
              <textarea
                id="learning-log-text"
                className="learning-log__textarea"
                rows={4}
                value={formText}
                onChange={event => setFormText(event.target.value)}
                placeholder="Capture the learning or error in detail..."
              />

              {formError && <p className="learning-log__form-error">{formError}</p>}

              <div className="learning-log__form-actions">
                <button type="button" className="learning-log__ghost-btn" onClick={() => setIsAdding(false)}>
                  Cancel
                </button>
                <button type="submit" className="learning-log__submit-btn" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
