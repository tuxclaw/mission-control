import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lightbulb, Star, X, ArrowUpRight, Sparkles, Loader2, Filter } from 'lucide-react';
import type { BrainstormIdea, IdeaFilter, Mission } from '../types';

const IDEA_STORAGE_KEY = 'mission-control-brainstorm-ideas';
const MISSION_STORAGE_KEY = 'mission-control-missions';
const API_BASE = import.meta.env.VITE_API_URL ?? '';

function loadIdeas(): BrainstormIdea[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(IDEA_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BrainstormIdea[]) : [];
  } catch {
    return [];
  }
}

function saveIdeas(ideas: BrainstormIdea[]) {
  window.localStorage.setItem(IDEA_STORAGE_KEY, JSON.stringify(ideas));
}

function loadMissions(): Mission[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(MISSION_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Mission[]) : [];
  } catch {
    return [];
  }
}

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function FeasibilityStars({ score }: { score: number }) {
  return (
    <span className="idea-feasibility" aria-label={`Feasibility: ${score} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < score ? 'idea-star--filled' : 'idea-star--empty'}>★</span>
      ))}
    </span>
  );
}

export function IdeaBoard() {
  const [ideas, setIdeas] = useState<BrainstormIdea[]>(() => loadIdeas());
  const [filter, setFilter] = useState<IdeaFilter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { saveIdeas(ideas); }, [ideas]);

  useEffect(() => {
    fetch(`${API_BASE}/api/ideas`)
      .then(r => r.ok ? r.json() : Promise.reject('Failed'))
      .then((serverIdeas: BrainstormIdea[]) => {
        if (serverIdeas.length > 0) {
          setIdeas(prev => {
            const existing = new Set(prev.map(i => i.id));
            const merged = [...prev];
            for (const idea of serverIdeas) {
              if (!existing.has(idea.id)) merged.push(idea);
            }
            return merged;
          });
        }
      })
      .catch(() => { /* server offline is fine */ });
  }, []);

  const visibleIdeas = useMemo(() => ideas.filter(i => !i.dismissed), [ideas]);
  const totalCount = visibleIdeas.length;
  const starredCount = useMemo(() => visibleIdeas.filter(i => i.starred).length, [visibleIdeas]);

  const agents = useMemo(() => {
    const set = new Set(ideas.map(i => i.agentName));
    return Array.from(set).sort();
  }, [ideas]);

  const filtered = useMemo(() => {
    return ideas.filter(i => {
      if (i.dismissed) return false;
      if (filter === 'starred') return i.starred;
      if (filter !== 'all') return i.agentName === filter;
      return true;
    });
  }, [ideas, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, BrainstormIdea[]>();
    for (const idea of filtered) {
      const key = idea.sessionDate.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(idea);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const handleCreativeTime = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/creative-time`, { method: 'POST' });
      if (!res.ok) throw new Error('Creative Time failed');
      const newIdeas: BrainstormIdea[] = await res.json();
      setIdeas(prev => {
        const existing = new Set(prev.map(i => i.id));
        const merged = [...prev];
        for (const idea of newIdeas) {
          if (!existing.has(idea.id)) merged.push(idea);
        }
        return merged;
      });
      for (const idea of newIdeas) {
        fetch(`${API_BASE}/api/ideas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(idea),
        }).catch(() => {});
      }
    } catch {
      setError('Failed to run Creative Time. Is the server running?');
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleStar = useCallback((id: string) => {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, starred: !i.starred } : i));
    fetch(`${API_BASE}/api/ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: !ideas.find(i => i.id === id)?.starred }),
    }).catch(() => {});
  }, [ideas]);

  const dismiss = useCallback((id: string) => {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, dismissed: true } : i));
    fetch(`${API_BASE}/api/ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    }).catch(() => {});
  }, []);

  const convertToMission = useCallback((idea: BrainstormIdea) => {
    const missions = loadMissions();
    const newMission: Mission = {
      id: crypto.randomUUID(),
      title: idea.title,
      description: idea.description,
      priority: idea.feasibility >= 4 ? 'high' : idea.feasibility >= 2 ? 'medium' : 'low',
      status: 'todo',
      assignedAgentId: 'unassigned',
      assignedAgentName: 'Unassigned',
      createdAt: new Date().toISOString(),
    };
    window.localStorage.setItem(MISSION_STORAGE_KEY, JSON.stringify([newMission, ...missions]));
    dismiss(idea.id);
  }, [dismiss]);

  return (
    <div className="board board--ideas flex-1 flex flex-col min-h-0" role="tabpanel" id="panel-ideas">
      <div className="board__header flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h2 className="board__title text-lg font-semibold flex items-center gap-2">
            <Sparkles size={18} aria-hidden="true" />
            Creative Time — Idea Board
            <span className="idea-count">{totalCount} ideas</span>
            {starredCount > 0 && <span className="idea-count idea-count--starred">★ {starredCount}</span>}
          </h2>
          <p className="board__subtitle text-xs mt-1">AI-generated ideas from daily brainstorming sessions</p>
        </div>
        <button
          type="button"
          className="creative-time-btn"
          onClick={handleCreativeTime}
          disabled={loading}
          aria-label="Run Creative Time now"
        >
          {loading ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
          {loading ? 'Brainstorming…' : 'Run Creative Time Now'}
        </button>
      </div>

      {error && (
        <div className="idea-error" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="idea-filters px-6 py-3 border-b flex items-center gap-2">
        <Filter size={14} className="idea-filters__icon" aria-hidden="true" />
        <button
          type="button"
          className={`idea-filter-btn ${filter === 'all' ? 'idea-filter-btn--active' : ''}`}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        >
          All
        </button>
        <button
          type="button"
          className={`idea-filter-btn ${filter === 'starred' ? 'idea-filter-btn--active' : ''}`}
          onClick={() => setFilter('starred')}
          aria-pressed={filter === 'starred'}
        >
          ★ Starred
        </button>
        {agents.map(agent => (
          <button
            key={agent}
            type="button"
            className={`idea-filter-btn ${filter === agent ? 'idea-filter-btn--active' : ''}`}
            onClick={() => setFilter(agent)}
            aria-pressed={filter === agent}
          >
            {agent}
          </button>
        ))}
      </div>

      <div className="idea-list flex-1 overflow-y-auto px-6 py-4">
        {filtered.length === 0 && (
          <div className="idea-empty">
            <Lightbulb size={24} aria-hidden="true" />
            <p>{filter === 'starred' ? 'No starred ideas yet. Star your favorites!' : 'No ideas yet. Creative Time runs daily at 2:00 PM Pacific. 🧠'}</p>
          </div>
        )}

        {grouped.map(([date, dateIdeas]) => (
          <div key={date} className="idea-session-group">
            <h3 className="idea-session-date">{formatSessionDate(date)}</h3>
            <div className="idea-session-cards">
              {dateIdeas.map(idea => (
                <div key={idea.id} className="idea-card card-animate">
                  <div className="idea-card__header">
                    <h4 className="idea-card__title">{idea.title}</h4>
                    <div className="idea-card__actions">
                      <button
                        type="button"
                        className={`idea-star-btn ${idea.starred ? 'idea-star-btn--active' : ''}`}
                        onClick={() => toggleStar(idea.id)}
                        aria-label={idea.starred ? 'Unstar idea' : 'Star idea'}
                        aria-pressed={idea.starred}
                      >
                        <Star size={14} fill={idea.starred ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        className="idea-dismiss-btn"
                        onClick={() => dismiss(idea.id)}
                        aria-label={`Dismiss idea: ${idea.title}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  <p className="idea-card__description">{idea.description}</p>

                  <div className="idea-card__techstack">
                    {idea.techStack.map(tech => (
                      <span key={tech} className="idea-tech-badge">{tech}</span>
                    ))}
                  </div>

                  <div className="idea-card__footer">
                    <FeasibilityStars score={idea.feasibility} />
                    <span className="idea-card__agent">
                      {idea.agentName}
                      <span className="idea-agent-model">{idea.agentModel}</span>
                    </span>
                    <span className="idea-card__time">{formatTime(idea.createdAt)}</span>
                  </div>

                  <button
                    type="button"
                    className="idea-convert-btn"
                    onClick={() => convertToMission(idea)}
                    aria-label={`Convert "${idea.title}" to a mission`}
                  >
                    <ArrowUpRight size={12} aria-hidden="true" />
                    Convert to Mission
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
