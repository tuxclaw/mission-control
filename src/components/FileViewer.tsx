import { useEffect, useRef, useState, useCallback } from 'react';
import { X, RefreshCw, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const VITALS_API = import.meta.env.VITE_VITALS_API_URL ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  icon: LucideIcon;
  filename: string;
}

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/```[\s\S]*?```/g, (m) => {
      const code = m.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      return `<pre><code>${code}</code></pre>`;
    })
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

export function FileViewer({ open, onClose, title, icon: Icon, filename }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchFile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${VITALS_API}/api/workspace-file/${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { content: string };
      setContent(data.content);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filename]);

  useEffect(() => {
    if (open) {
      fetchFile();
      panelRef.current?.focus();
    }
  }, [open, fetchFile]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="panel-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        ref={panelRef}
        className="panel-container panel-slide-in"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 className="panel-title"><Icon size={16} style={{ display: 'inline', marginRight: 6 }} />{title}</h2>
          <div className="panel-header-actions">
            <button className="panel-icon-btn" onClick={fetchFile} aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
            <button className="panel-icon-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="panel-body">
          {loading && (
            <div className="panel-empty">
              <Loader2 size={20} className="spin" />
              <span>Loading...</span>
            </div>
          )}
          {error && <div className="panel-error">{error}</div>}
          {content && !loading && (
            <div
              className="memory-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}
          {!content && !loading && !error && (
            <div className="panel-empty">
              <span>File is empty</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
