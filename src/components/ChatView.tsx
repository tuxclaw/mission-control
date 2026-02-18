import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';

interface Msg {
  id: string;
  role: 'user' | 'agent';
  text: string;
}

export function ChatView() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  async function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMsgs(prev => [...prev, { id: Date.now().toString(), role: 'user', text }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMsgs(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'agent', text: data.content || 'No response' }]);
    } catch (err) {
      setMsgs(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'agent', text: `Error: ${err}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {msgs.length === 0 && !busy && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: 'auto', marginBottom: 'auto' }}>
            Send a message to chat with Andy
          </p>
        )}
        {msgs.map(m => (
          <div key={m.id} style={{
            display: 'flex', gap: 8, maxWidth: '85%',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            flexDirection: m.role === 'user' ? 'row-reverse' : 'row',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: m.role === 'agent' ? 'var(--accent, #06b6d4)' : 'var(--bg-tertiary)',
              color: m.role === 'agent' ? '#000' : 'var(--text-primary)',
              flexShrink: 0,
            }}>
              {m.role === 'agent' ? <Bot size={14} /> : <User size={14} />}
            </div>
            <div style={{
              padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5,
              background: m.role === 'user' ? 'var(--accent, #06b6d4)' : 'var(--bg-secondary)',
              color: m.role === 'user' ? '#000' : 'var(--text-primary)',
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent, #06b6d4)', color: '#000', flexShrink: 0 }}>
              <Bot size={14} />
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--bg-secondary)', color: 'var(--text-muted)', fontSize: 14 }}>
              Thinking...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input bar */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border)', marginBottom: 64 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--bg-secondary)', borderRadius: 12, padding: '8px 12px' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
            placeholder="Message Andy..."
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)',
              fontSize: 16, padding: '4px 0',
            }}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={handleSend}
            style={{
              width: 44, height: 44, minWidth: 44, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: input.trim() && !busy ? 'var(--accent, #06b6d4)' : 'var(--bg-tertiary)',
              color: input.trim() && !busy ? '#000' : 'var(--text-muted)',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              transition: 'transform 0.1s',
            }}
            onPointerDown={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.9)'; }}
            onPointerUp={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
          >
            <Send size={18} />
          </div>
        </div>
      </div>
    </div>
  );
}
