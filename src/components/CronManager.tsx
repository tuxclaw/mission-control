import { useEffect, useRef, useState } from 'react';
import { X, Play, RefreshCw, AlertTriangle, CheckCircle, Clock, Loader2 } from 'lucide-react';
import { useCron } from '../hooks/useCron';
import type { CronJob } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
}

function formatSchedule(s: CronJob['schedule']): string {
  if (s.kind === 'every' && s.everyMs) {
    const mins = Math.round(s.everyMs / 60000);
    if (mins < 60) return `Every ${mins}m`;
    const hrs = Math.round(mins / 60);
    return `Every ${hrs}h`;
  }
  if (s.kind === 'cron' && s.expr) {
    return `Cron: ${s.expr}${s.tz ? ` (${s.tz.split('/')[1] ?? s.tz})` : ''}`;
  }
  if (s.kind === 'at') return 'One-time';
  return s.kind;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function timeUntil(ms: number): string {
  const diff = ms - Date.now();
  if (diff < 0) return 'overdue';
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `in ${Math.round(diff / 60000)}m`;
  if (diff < 86400000) return `in ${Math.round(diff / 3600000)}h`;
  return `in ${Math.round(diff / 86400000)}d`;
}

function StatusIcon({ status }: { status?: string }) {
  if (status === 'ok') return <CheckCircle size={14} className="status-green" aria-label="Success" />;
  if (status === 'error') return <AlertTriangle size={14} style={{ color: 'var(--red)' }} aria-label="Error" />;
  return <Clock size={14} className="status-muted" aria-label="Idle" />;
}

export function CronManager({ open, onClose }: Props) {
  const { jobs, loading, error, refresh, runJob, toggleJob } = useCron();
  const [runningId, setRunningId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleRun = async (id: string) => {
    setRunningId(id);
    try { await runJob(id); } catch { /* handled by hook */ }
    setRunningId(null);
  };

  if (!open) return null;

  return (
    <div className="panel-overlay" role="dialog" aria-modal="true" aria-label="Cron Job Manager" onClick={onClose}>
      <div
        ref={panelRef}
        className="panel-container panel-slide-in"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 className="panel-title">⏰ Cron Jobs</h2>
          <div className="panel-header-actions">
            <button className="panel-icon-btn" onClick={refresh} aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
            <button className="panel-icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="panel-body">
          {loading && jobs.length === 0 && (
            <div className="panel-empty">
              <Loader2 size={20} className="spin" />
              <span>Loading jobs...</span>
            </div>
          )}
          {error && (
            <div className="panel-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
          {jobs.map((job) => (
            <div key={job.id} className={`cron-job-card ${!job.enabled ? 'cron-job-card--disabled' : ''}`}>
              <div className="cron-job-row">
                <div className="cron-job-info">
                  <StatusIcon status={job.state.lastStatus} />
                  <span className="cron-job-name">{job.name}</span>
                  <span className="cron-job-schedule">{formatSchedule(job.schedule)}</span>
                </div>
                <div className="cron-job-actions">
                  <button
                    className="panel-icon-btn"
                    onClick={() => handleRun(job.id)}
                    disabled={runningId === job.id}
                    aria-label={`Run ${job.name}`}
                  >
                    {runningId === job.id ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
                  </button>
                  <label className="cron-toggle" aria-label={`${job.enabled ? 'Disable' : 'Enable'} ${job.name}`}>
                    <input
                      type="checkbox"
                      checked={job.enabled}
                      onChange={() => toggleJob(job.id, !job.enabled)}
                    />
                    <span className="cron-toggle-track" />
                  </label>
                </div>
              </div>
              <div className="cron-job-meta">
                {job.state.nextRunAtMs && (
                  <span className="cron-job-meta-item">Next: {timeUntil(job.state.nextRunAtMs)}</span>
                )}
                {job.state.lastRunAtMs && (
                  <span className="cron-job-meta-item">Last: {timeAgo(job.state.lastRunAtMs)}</span>
                )}
                {job.state.lastDurationMs != null && (
                  <span className="cron-job-meta-item">{(job.state.lastDurationMs / 1000).toFixed(1)}s</span>
                )}
              </div>
              {job.state.lastError && (
                <div className="cron-job-error">{job.state.lastError}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
