import { useEffect, useRef } from 'react';
import { X, RefreshCw, FileText, BookOpen, Loader2 } from 'lucide-react';
import { useMemory } from '../hooks/useMemory';

interface Props {
  open: boolean;
  onClose: () => void;
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

export function MemoryViewer({ open, onClose }: Props) {
  const { content, files, selectedFile, loading, error, selectFile, refresh } = useMemory();
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

  const handleBack = () => {
    selectFile(null);
    refresh();
  };

  if (!open) return null;

  return (
    <div className="panel-overlay" role="dialog" aria-modal="true" aria-label="Memory Viewer" onClick={onClose}>
      <div
        ref={panelRef}
        className="panel-container panel-slide-in"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header">
          <h2 className="panel-title">🧠 {selectedFile ?? 'MEMORY.md'}</h2>
          <div className="panel-header-actions">
            {selectedFile && (
              <button className="panel-icon-btn" onClick={handleBack} aria-label="Back to MEMORY.md">
                <BookOpen size={14} />
              </button>
            )}
            <button className="panel-icon-btn" onClick={refresh} aria-label="Refresh">
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

          {!selectedFile && !loading && (
            <div className="memory-files">
              <h3 className="memory-files-title">Daily Files</h3>
              <div className="memory-file-list">
                {files.map((f) => (
                  <button
                    key={f}
                    className="memory-file-btn"
                    onClick={() => selectFile(f)}
                    aria-label={`Open ${f}`}
                  >
                    <FileText size={13} aria-hidden="true" />
                    <span>{f}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {content && !loading && (
            <div
              className="memory-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
