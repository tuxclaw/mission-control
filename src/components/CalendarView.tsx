import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2, Clock, X, CalendarDays } from 'lucide-react';
import type { CalendarEvent, CalendarEventColor, CronJob } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? 'http://localhost:3851';
const STORAGE_KEY = 'mission-control-calendar-events';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const COLOR_OPTIONS: CalendarEventColor[] = ['accent', 'green', 'yellow', 'red', 'purple'];

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getCalendarGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const days: Date[] = [];
  for (let i = startDay - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  const total = getDaysInMonth(year, month);
  for (let d = 1; d <= total; d++) {
    days.push(new Date(year, month, d));
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    const next = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    days.push(next);
  }
  return days;
}

function getNextCronDates(job: CronJob, count: number): string[] {
  const dates: string[] = [];
  if (!job.enabled || !job.state.nextRunAtMs) return dates;
  const intervalMs = job.schedule.everyMs ?? 0;
  let ts = job.state.nextRunAtMs;
  for (let i = 0; i < count; i++) {
    const d = new Date(ts);
    dates.push(toDateStr(d));
    if (intervalMs > 0) {
      ts += intervalMs;
    } else {
      break;
    }
  }
  return dates;
}

function loadLocalEvents(): CalendarEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CalendarEvent[]) : [];
  } catch {
    return [];
  }
}

function saveLocalEvents(events: CalendarEvent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

export function CalendarView() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [events, setEvents] = useState<CalendarEvent[]>(() => loadLocalEvents());
  const [cronEvents, setCronEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CalendarEvent | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formTime, setFormTime] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formColor, setFormColor] = useState<CalendarEventColor>('accent');

  const todayStr = toDateStr(today);
  const grid = useMemo(() => getCalendarGrid(year, month), [year, month]);
  const monthLabel = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const fetchServerEvents = useCallback(async () => {
    try {
      const res = await fetch(`${VITALS_API}/api/calendar/events`);
      if (res.ok) {
        const data = (await res.json()) as CalendarEvent[];
        setEvents(data);
        saveLocalEvents(data);
      }
    } catch {
      // Use localStorage fallback
    }
  }, []);

  const fetchCronEvents = useCallback(async () => {
    try {
      const res = await fetch(`${VITALS_API}/api/cron/jobs`);
      if (!res.ok) return;
      const data = (await res.json()) as { jobs: CronJob[] };
      const generated: CalendarEvent[] = [];
      for (const job of data.jobs) {
        const dates = getNextCronDates(job, 30);
        for (const date of dates) {
          generated.push({
            id: `cron-${job.id}-${date}`,
            title: `⏰ ${job.name}`,
            date,
            color: 'purple',
            source: 'cron',
          });
        }
      }
      setCronEvents(generated);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchServerEvents();
    fetchCronEvents();
  }, [fetchServerEvents, fetchCronEvents]);

  const allEvents = useMemo(() => [...events, ...cronEvents], [events, cronEvents]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of allEvents) {
      const list = map.get(ev.date) ?? [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [allEvents]);

  const selectedEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : [];

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDate(todayStr);
  };

  const addEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formDate) return;

    const newEvent: CalendarEvent = {
      id: crypto.randomUUID(),
      title: formTitle.trim(),
      date: formDate,
      time: formTime || undefined,
      description: formDesc.trim() || undefined,
      color: formColor,
      source: 'manual',
    };

    const updated = [...events, newEvent];
    setEvents(updated);
    saveLocalEvents(updated);

    try {
      await fetch(`${VITALS_API}/api/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent),
      });
    } catch { /* localStorage is primary */ }

    setFormTitle('');
    setFormDate('');
    setFormTime('');
    setFormDesc('');
    setFormColor('accent');
    setShowForm(false);
    setSelectedDate(formDate);
  };

  const confirmDeleteEvent = useCallback(async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const updated = events.filter(ev => ev.id !== id);
    setEvents(updated);
    saveLocalEvents(updated);
    setDeleteTarget(null);
    try {
      await fetch(`${VITALS_API}/api/calendar/events/${id}`, { method: 'DELETE' });
    } catch { /* best effort */ }
  }, [deleteTarget, events]);

  return (
    <div className="board board--calendar flex-1 flex flex-col min-h-0" role="tabpanel" id="panel-calendar">
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Event"
        message={`Are you sure you want to delete "${deleteTarget?.title}"?`}
        confirmLabel="Delete"
        danger
        onConfirm={confirmDeleteEvent}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Header */}
      <div className="board__header flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h2 className="board__title text-lg font-semibold">Calendar</h2>
          <p className="board__subtitle text-xs mt-1">Events, schedules, and deadlines.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="cal-today-btn" onClick={goToday} aria-label="Go to today">Today</button>
          <button
            type="button"
            className="board__action-btn flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
            onClick={() => { setShowForm(f => !f); if (!formDate) setFormDate(selectedDate ?? todayStr); }}
            aria-expanded={showForm}
          >
            <Plus size={14} aria-hidden="true" />
            Add event
          </button>
        </div>
      </div>

      {/* Add event form */}
      {showForm && (
        <form className="cal-form px-6 py-4 border-b" onSubmit={addEvent}>
          <div className="cal-form__grid">
            <label className="mission-form__field">
              <span className="mission-form__label">Title</span>
              <input
                className="mission-form__input"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="Team standup"
                required
              />
            </label>
            <label className="mission-form__field">
              <span className="mission-form__label">Date</span>
              <input
                className="mission-form__input"
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                required
              />
            </label>
            <label className="mission-form__field">
              <span className="mission-form__label">Time (optional)</span>
              <input
                className="mission-form__input"
                type="time"
                value={formTime}
                onChange={e => setFormTime(e.target.value)}
              />
            </label>
            <label className="mission-form__field">
              <span className="mission-form__label">Color</span>
              <div className="cal-color-picker" role="radiogroup" aria-label="Event color">
                {COLOR_OPTIONS.map(c => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    className={`cal-color-swatch cal-color-swatch--${c} ${formColor === c ? 'cal-color-swatch--active' : ''}`}
                    onClick={() => setFormColor(c)}
                    aria-label={`Color: ${c}`}
                    aria-checked={formColor === c}
                  />
                ))}
              </div>
            </label>
            <label className="mission-form__field mission-form__field--full">
              <span className="mission-form__label">Description (optional)</span>
              <textarea
                className="mission-form__textarea"
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                placeholder="Notes about this event..."
                rows={2}
              />
            </label>
          </div>
          <div className="mission-form__actions">
            <button type="submit" className="mission-form__submit">Add event</button>
            <button type="button" className="mission-form__cancel" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="cal-body flex-1 flex min-h-0 overflow-hidden">
        {/* Calendar grid */}
        <div className="cal-grid-wrap flex-1 flex flex-col min-h-0 overflow-y-auto px-6 py-4">
          {/* Month nav */}
          <div className="cal-nav">
            <button type="button" className="cal-nav__btn" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <h3 className="cal-nav__label">{monthLabel}</h3>
            <button type="button" className="cal-nav__btn" onClick={nextMonth} aria-label="Next month">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Day headers */}
          <div className="cal-grid cal-grid--header" role="row">
            {DAY_NAMES.map(d => (
              <div key={d} className="cal-day-header" role="columnheader">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="cal-grid cal-grid--days">
            {grid.map(date => {
              const dateStr = toDateStr(date);
              const isCurrentMonth = date.getMonth() === month;
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDate;
              const dayEvents = eventsByDate.get(dateStr) ?? [];

              return (
                <button
                  key={dateStr}
                  type="button"
                  className={[
                    'cal-cell',
                    !isCurrentMonth && 'cal-cell--dimmed',
                    isToday && 'cal-cell--today',
                    isSelected && 'cal-cell--selected',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setSelectedDate(dateStr)}
                  aria-label={`${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''}` : ''}`}
                  aria-pressed={isSelected}
                >
                  <span className="cal-cell__number">{date.getDate()}</span>
                  {dayEvents.length > 0 && (
                    <div className="cal-cell__pills">
                      {dayEvents.slice(0, 3).map(ev => (
                        <span key={ev.id} className={`cal-pill cal-pill--${ev.color}`} title={ev.title} />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="cal-pill-more">+{dayEvents.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <aside className="cal-detail" aria-label="Day events">
          {selectedDate ? (
            <>
              <div className="cal-detail__header">
                <h4 className="cal-detail__date">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                </h4>
                <button type="button" className="panel-icon-btn" onClick={() => setSelectedDate(null)} aria-label="Close detail panel">
                  <X size={14} />
                </button>
              </div>
              <div className="cal-detail__list">
                {selectedEvents.length === 0 && (
                  <div className="cal-detail__empty-state">
                    <CalendarDays size={20} aria-hidden="true" style={{ opacity: 0.4 }} />
                    <p className="cal-detail__empty">No events on this day.</p>
                  </div>
                )}
                {selectedEvents.map(ev => (
                  <div key={ev.id} className={`cal-event-card cal-event-card--${ev.color} card-animate`}>
                    <div className="cal-event-card__top">
                      <span className={`cal-event-dot cal-event-dot--${ev.color}`} />
                      <span className="cal-event-card__title">{ev.title}</span>
                      {ev.source === 'manual' && (
                        <button
                          type="button"
                          className="cal-event-card__delete"
                          onClick={() => setDeleteTarget(ev)}
                          aria-label={`Delete ${ev.title}`}
                          title="Delete event"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    {ev.time && (
                      <div className="cal-event-card__time">
                        <Clock size={11} aria-hidden="true" />
                        {ev.time}
                      </div>
                    )}
                    {ev.description && (
                      <p className="cal-event-card__desc">{ev.description}</p>
                    )}
                    <span className="cal-event-card__source">{ev.source}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="cal-detail__placeholder">
              <p>Select a day to view events</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
