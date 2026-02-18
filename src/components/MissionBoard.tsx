import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Flag, UserCircle, CalendarClock, Trash2, Inbox } from 'lucide-react';
import type { Mission, MissionPriority, MissionStatus, Agent } from '../types';
import { useAgents } from '../hooks/useAgents';
import { ConfirmDialog } from './ConfirmDialog';

const STORAGE_KEY = 'andys-overview-missions';
const API = import.meta.env.VITE_VITALS_API_URL ?? '';

const statusOrder: MissionStatus[] = ['todo', 'in-progress', 'done'];

const statusLabels: Record<MissionStatus, string> = {
  todo: 'To Do',
  'in-progress': 'In Progress',
  done: 'Done',
};

const priorityLabels: Record<MissionPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const priorityClassName: Record<MissionPriority, string> = {
  high: 'mission-priority mission-priority--high',
  medium: 'mission-priority mission-priority--medium',
  low: 'mission-priority mission-priority--low',
};

function nextStatus(current: MissionStatus): MissionStatus {
  const index = statusOrder.indexOf(current);
  return statusOrder[(index + 1) % statusOrder.length];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function loadMissionsLocal(): Mission[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Mission[];
  } catch {
    return [];
  }
}

async function loadMissionsFromApi(): Promise<Mission[] | null> {
  try {
    const res = await fetch(`${API}/api/missions`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data as Mission[] : null;
  } catch {
    return null;
  }
}

function saveMissionsToApi(missions: Mission[]): void {
  fetch(`${API}/api/missions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(missions),
  }).catch(() => {/* best-effort */});
}

export function MissionBoard() {
  const { agents } = useAgents();
  const [missions, setMissions] = useState<Mission[]>(() => loadMissionsLocal());
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    loadMissionsFromApi().then(apiMissions => {
      if (apiMissions && apiMissions.length > 0) {
        setMissions(prev => prev.length > 0 ? prev : apiMissions);
      }
    });
  }, []);
  const [isAdding, setIsAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MissionPriority>('medium');
  const [assigneeId, setAssigneeId] = useState('unassigned');
  const [deleteTarget, setDeleteTarget] = useState<Mission | null>(null);
  const [mobileColumn, setMobileColumn] = useState<MissionStatus>('todo');

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<MissionStatus | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after'>('before');
  const columnRefs = useRef<Record<MissionStatus, HTMLDivElement | null>>({
    todo: null,
    'in-progress': null,
    done: null,
  });

  const agentMap = useMemo(() => {
    return agents.reduce<Record<string, Agent>>((acc, agent) => {
      acc[agent.id] = agent;
      return acc;
    }, {});
  }, [agents]);

  useEffect(() => {
    if (assigneeId === 'unassigned' && agents.length > 0) {
      setAssigneeId(agents[0].id);
    }
  }, [agents, assigneeId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(missions));
    saveMissionsToApi(missions);
  }, [missions]);

  const missionsByStatus = useMemo(() => {
    return statusOrder.reduce<Record<MissionStatus, Mission[]>>((acc, status) => {
      acc[status] = missions.filter(mission => mission.status === status);
      return acc;
    }, {} as Record<MissionStatus, Mission[]>);
  }, [missions]);

  const handleAddMission = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const agent = agentMap[assigneeId];
    const assignedAgentName = agent ? agent.name : 'Unassigned';

    const nextMission: Mission = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      description: description.trim(),
      priority,
      status: 'todo',
      assignedAgentId: agent ? agent.id : 'unassigned',
      assignedAgentName,
      createdAt: new Date().toISOString(),
    };

    setMissions(prev => [nextMission, ...prev]);
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAssigneeId(agents[0]?.id ?? 'unassigned');
    setIsAdding(false);
  };

  const handleMoveMission = (missionId: string) => {
    setMissions(prev =>
      prev.map(mission =>
        mission.id === missionId
          ? { ...mission, status: nextStatus(mission.status) }
          : mission,
      ),
    );
  };

  const handleDeleteMission = useCallback((mission: Mission) => {
    setDeleteTarget(mission);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    setMissions(prev => prev.filter(m => m.id !== deleteTarget.id));
    setDeleteTarget(null);
  }, [deleteTarget]);

  const handleDragStart = useCallback((event: React.DragEvent<HTMLDivElement>, missionId: string) => {
    event.dataTransfer.setData('text/plain', missionId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(missionId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverColumn(null);
    setDropTargetId(null);
  }, []);

  const handleColumnDragOver = useCallback((event: React.DragEvent<HTMLElement>, status: MissionStatus) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverColumn(status);

    const listEl = columnRefs.current[status];
    if (!listEl) {
      setDropTargetId(null);
      return;
    }

    const cards = Array.from(listEl.querySelectorAll<HTMLElement>('[data-mission-id]'));
    const y = event.clientY;
    let closestId: string | null = null;
    let pos: 'before' | 'after' = 'before';

    for (const card of cards) {
      const cardId = card.getAttribute('data-mission-id');
      if (cardId === draggingId) continue;
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (y < midY) {
        closestId = cardId;
        pos = 'before';
        break;
      }
      closestId = cardId;
      pos = 'after';
    }

    setDropTargetId(closestId);
    setDropPosition(pos);
  }, [draggingId]);

  const handleColumnDragLeave = useCallback((event: React.DragEvent<HTMLElement>, status: MissionStatus) => {
    const related = event.relatedTarget as Node | null;
    const section = event.currentTarget;
    if (related && section.contains(related)) return;
    if (dragOverColumn === status) {
      setDragOverColumn(null);
      setDropTargetId(null);
    }
  }, [dragOverColumn]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>, targetStatus: MissionStatus) => {
    event.preventDefault();
    const missionId = event.dataTransfer.getData('text/plain');
    if (!missionId) return;

    setMissions(prev => {
      const mission = prev.find(m => m.id === missionId);
      if (!mission) return prev;

      const without = prev.filter(m => m.id !== missionId);
      const updated: Mission = { ...mission, status: targetStatus };

      const columnMissions = without.filter(m => m.status === targetStatus);

      if (dropTargetId) {
        const targetIdx = without.findIndex(m => m.id === dropTargetId);
        if (targetIdx !== -1) {
          const insertIdx = dropPosition === 'after' ? targetIdx + 1 : targetIdx;
          without.splice(insertIdx, 0, updated);
          return [...without];
        }
      }

      if (columnMissions.length === 0) {
        return [...without, updated];
      }
      const lastInColumn = columnMissions[columnMissions.length - 1];
      const lastIdx = without.findIndex(m => m.id === lastInColumn.id);
      without.splice(lastIdx + 1, 0, updated);
      return [...without];
    });

    setDraggingId(null);
    setDragOverColumn(null);
    setDropTargetId(null);
  }, [dropTargetId, dropPosition]);

  return (
    <div className="board board--missions flex-1 flex flex-col min-h-0" role="tabpanel" id="panel-missions">
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Mission"
        message={`Are you sure you want to delete "${deleteTarget?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <div className="board__header flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h2 className="board__title text-lg font-semibold">Mission Board</h2>
          <p className="board__subtitle text-xs mt-1">Track critical work across agents.</p>
        </div>
        <button
          type="button"
          className="board__action-btn flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
          onClick={() => setIsAdding(prev => !prev)}
          aria-expanded={isAdding}
          aria-controls="mission-create"
        >
          <Plus size={14} aria-hidden="true" />
          Add mission
        </button>
      </div>

      {isAdding && (
        <form
          id="mission-create"
          className="mission-form px-6 py-4 border-b"
          onSubmit={handleAddMission}
        >
          <div className="mission-form__grid">
            <label className="mission-form__field">
              <span className="mission-form__label">Title</span>
              <input
                value={title}
                onChange={event => setTitle(event.target.value)}
                className="mission-form__input"
                placeholder="Ship Mission Board UI"
                required
              />
            </label>
            <label className="mission-form__field">
              <span className="mission-form__label">Priority</span>
              <select
                value={priority}
                onChange={event => setPriority(event.target.value as MissionPriority)}
                className="mission-form__select"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="mission-form__field">
              <span className="mission-form__label">Assign agent</span>
              <select
                value={assigneeId}
                onChange={event => setAssigneeId(event.target.value)}
                className="mission-form__select"
              >
                {agents.length === 0 && <option value="unassigned">Unassigned</option>}
                {agents.map(agent => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mission-form__field mission-form__field--full">
              <span className="mission-form__label">Description</span>
              <textarea
                value={description}
                onChange={event => setDescription(event.target.value)}
                className="mission-form__textarea"
                placeholder="Capture the mission details, expected outcome, and constraints."
                rows={3}
              />
            </label>
          </div>
          <div className="mission-form__actions">
            <button type="submit" className="mission-form__submit">Create mission</button>
            <button type="button" className="mission-form__cancel" onClick={() => setIsAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="mission-column-tabs">
        {statusOrder.map(status => (
          <button
            key={status}
            type="button"
            className={`mission-column-tab${mobileColumn === status ? ' mission-column-tab--active' : ''}`}
            onClick={() => setMobileColumn(status)}
          >
            {statusLabels[status]}
            <span className="mission-column-tab__count">{missionsByStatus[status].length}</span>
          </button>
        ))}
      </div>

      <div className="mission-columns flex-1 overflow-y-auto px-6 py-4">
        {statusOrder.map(status => (
          <section
            key={status}
            className={`mission-column${dragOverColumn === status ? ' mission-column--drag-over' : ''}${mobileColumn !== status ? ' mission-column--hidden-mobile' : ''}`}
            aria-label={statusLabels[status]}
            aria-dropeffect="move"
            onDragOver={event => handleColumnDragOver(event, status)}
            onDragLeave={event => handleColumnDragLeave(event, status)}
            onDrop={event => handleDrop(event, status)}
          >
            <div className="mission-column__header">
              <h3 className="mission-column__title">{statusLabels[status]}</h3>
              <span className="mission-column__count">{missionsByStatus[status].length}</span>
            </div>
            <div
              className="mission-column__list"
              ref={el => { columnRefs.current[status] = el; }}
            >
              {missionsByStatus[status].length === 0 && (
                <div className="mission-empty">
                  <Inbox size={20} aria-hidden="true" style={{ opacity: 0.4 }} />
                  <p>No missions here yet</p>
                </div>
              )}
              {missionsByStatus[status].map(mission => (
                <div
                  key={mission.id}
                  data-mission-id={mission.id}
                  className={
                    `mission-card card-animate`
                    + (draggingId === mission.id ? ' mission-card--dragging' : '')
                    + (dropTargetId === mission.id && draggingId !== mission.id
                      ? ` mission-card--drop-target mission-card--drop-target-${dropPosition}`
                      : '')
                  }
                  draggable="true"
                  aria-grabbed={draggingId === mission.id}
                  onDragStart={event => handleDragStart(event, mission.id)}
                  onDragEnd={handleDragEnd}
                  onClick={() => handleMoveMission(mission.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={`${mission.title} — ${priorityLabels[mission.priority]} priority. Click to move to ${statusLabels[nextStatus(mission.status)]}`}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleMoveMission(mission.id);
                    }
                  }}
                >
                  <div className="mission-card__top">
                    <span className={priorityClassName[mission.priority]}>
                      {priorityLabels[mission.priority]}
                    </span>
                    <div className="mission-card__top-actions">
                      <button
                        type="button"
                        className="mission-card__delete"
                        onClick={(e) => { e.stopPropagation(); handleDeleteMission(mission); }}
                        aria-label={`Delete mission: ${mission.title}`}
                        title="Delete mission"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <h4 className="mission-card__title">{mission.title}</h4>
                  <p className="mission-card__description">
                    {mission.description || 'No description provided.'}
                  </p>
                  <div className="mission-card__meta">
                    <span className="mission-meta">
                      <UserCircle size={12} aria-hidden="true" />
                      {mission.assignedAgentName}
                    </span>
                    <span className="mission-meta">
                      <CalendarClock size={12} aria-hidden="true" />
                      {formatDate(mission.createdAt)}
                    </span>
                  </div>
                  <div className="mission-card__footer">
                    <Flag size={12} aria-hidden="true" />
                    Priority {priorityLabels[mission.priority]}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
