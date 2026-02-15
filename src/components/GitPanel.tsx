import { useEffect, useRef, useState } from 'react';
import { X, RefreshCw, AlertTriangle, Loader2, ArrowDownToLine, ArrowUpFromLine, CheckCircle } from 'lucide-react';
import { useGit } from '../hooks/useGit';

interface Props {
  open: boolean;
  onClose: () => void;
}

function statusIndicator(entry: string): { label: string; className: string } {
  const code = entry.trim().charAt(0);
  switch (code) {
    case 'M': return { label: 'Modified', className: 'git-status--modified' };
    case 'A': return { label: 'Added', className: 'git-status--added' };
    case 'D': return { label: 'Deleted', className: 'git-status--deleted' };
    case '?': return { label: 'Untracked', className: 'git-status--untracked' };
    case 'R': return { label: 'Renamed', className: 'git-status--modified' };
    case 'C': return { label: 'Copied', className: 'git-status--added' };
    default: return { label: code, className: 'git-status--modified' };
  }
}

export function GitPanel({ open, onClose }: Props) {
  const { status, loading, pulling, pushing, committing, error, output, fetchStatus, pull, push, commit } = useGit();
  const [commitMsg, setCommitMsg] = useState('');
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

  const handleCommit = async () => {
    if (!commitMsg.trim()) return;
    await commit(commitMsg.trim());
    setCommitMsg('');
  };

  if (!open) return null;

  return (
    <div className="panel-overlay" role="dialog" aria-modal="true" aria-label="Git Panel" onClick={onClose}>
      <div
        ref={panelRef}
        className="panel-container panel-slide-in"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 className="panel-title">🌿 Git</h2>
          <div className="panel-header-actions">
            <button className="panel-icon-btn" onClick={fetchStatus} aria-label="Refresh" disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
            <button className="panel-icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="panel-body">
          {error && (
            <div className="panel-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="git-actions">
            <button className="git-action-btn" onClick={pull} disabled={pulling} aria-label="Pull">
              {pulling ? <Loader2 size={14} className="spin" /> : <ArrowDownToLine size={14} />}
              <span>Pull</span>
            </button>
            <button className="git-action-btn" onClick={push} disabled={pushing} aria-label="Push">
              {pushing ? <Loader2 size={14} className="spin" /> : <ArrowUpFromLine size={14} />}
              <span>Push</span>
            </button>
          </div>

          {/* Commit section */}
          <div className="git-commit-section">
            <div className="git-commit-row">
              <input
                className="git-commit-input"
                type="text"
                placeholder="Commit message..."
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCommit(); }}
                aria-label="Commit message"
              />
              <button
                className="git-commit-btn"
                onClick={handleCommit}
                disabled={committing || !commitMsg.trim()}
                aria-label="Commit"
              >
                {committing ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
                <span>Commit</span>
              </button>
            </div>
          </div>

          {/* Status */}
          <div className="git-status-section">
            <h3 className="git-section-title">Changed Files</h3>
            {loading && status.entries.length === 0 && (
              <div className="panel-empty">
                <Loader2 size={20} className="spin" />
                <span>Loading...</span>
              </div>
            )}
            {!loading && status.entries.length === 0 && (
              <p className="git-clean-msg">Working tree clean ✨</p>
            )}
            {status.entries.length > 0 && (
              <ul className="git-file-list" role="list">
                {status.entries.map((entry, i) => {
                  const { label, className } = statusIndicator(entry);
                  const file = entry.trim().slice(2).trim();
                  return (
                    <li key={i} className="git-file-item">
                      <span className={`git-file-badge ${className}`}>{label}</span>
                      <span className="git-file-name">{file}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Output */}
          {output && (
            <div className="git-output-section">
              <h3 className="git-section-title">Output</h3>
              <pre className="git-output">{output}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
