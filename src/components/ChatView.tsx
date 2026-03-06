import { useEffect, useRef, useState, useCallback } from 'react';
import { Bot, Send, User } from 'lucide-react';

interface ChatMsg {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  streaming?: boolean;
}

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

const WS_URL = 'ws://localhost:3851/ws/chat';
const MAX_RECONNECT_ATTEMPTS = 20;

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('reconnecting');
  const [sending, setSending] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const streamingIdRef = useRef<string | null>(null);
  const shouldReconnectRef = useRef(true);
  const endRef = useRef<HTMLDivElement | null>(null);

  const setStreaming = useCallback((id: string | null) => {
    streamingIdRef.current = id;
    setStreamingId(id);
  }, []);

  // -- Ref-wrapped handlers to avoid stale closures in WS listeners --
  const handleTokenRef = useRef((_token: string) => {});
  handleTokenRef.current = (token: string) => {
    setSending(false);
    setMessages(prev => {
      const currentId = streamingIdRef.current;
      if (!currentId) {
        const id = createId();
        setStreaming(id);
        return [...prev, { id, role: 'agent' as const, content: token, timestamp: new Date(), streaming: true }];
      }
      return prev.map(msg => msg.id === currentId
        ? { ...msg, content: msg.content + token, streaming: true }
        : msg
      );
    });
  };

  const handleMessageRef = useRef((_content: string) => {});
  handleMessageRef.current = (content: string) => {
    setSending(false);
    setMessages(prev => {
      const currentId = streamingIdRef.current;
      if (currentId) {
        return prev.map(msg => msg.id === currentId
          ? { ...msg, content, streaming: false }
          : msg
        );
      }
      return [...prev, { id: createId(), role: 'agent' as const, content, timestamp: new Date() }];
    });
    setStreaming(null);
  };

  const handleDoneRef = useRef(() => {});
  handleDoneRef.current = () => {
    setSending(false);
    const currentId = streamingIdRef.current;
    if (!currentId) return;
    setMessages(prev => prev.map(msg => msg.id === currentId
      ? { ...msg, streaming: false }
      : msg
    ));
    setStreaming(null);
  };

  const handleErrorRef = useRef((_message: string) => {});
  handleErrorRef.current = (message: string) => {
    setError(message);
    setSending(false);
    const currentId = streamingIdRef.current;
    if (currentId) {
      setMessages(prev => prev.map(msg => msg.id === currentId
        ? { ...msg, streaming: false }
        : msg
      ));
      setStreaming(null);
    }
  };

  // -- WebSocket connection (inside useEffect to avoid stale closure issues) --
  useEffect(() => {
    let ws: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current) return;
      const attempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = attempt;

      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        setConnectionState('disconnected');
        return;
      }

      const delay = Math.min(5000, 500 * Math.pow(2, attempt - 1));
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }

      setConnectionState('reconnecting');
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (!shouldReconnectRef.current) return;
        reconnectAttemptRef.current = 0;
        setConnected(true);
        setConnectionState('connected');
      });

      ws.addEventListener('message', event => {
        if (!shouldReconnectRef.current) return;
        let payload: { type?: string; token?: string; content?: string; message?: string } | null = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!payload?.type) return;

        if (payload.type === 'token' && typeof payload.token === 'string') {
          handleTokenRef.current(payload.token);
        }
        if (payload.type === 'message' && typeof payload.content === 'string') {
          handleMessageRef.current(payload.content);
        }
        if (payload.type === 'done') {
          handleDoneRef.current();
        }
        if (payload.type === 'error' && typeof payload.message === 'string') {
          handleErrorRef.current(payload.message);
        }
      });

      ws.addEventListener('close', () => {
        if (!shouldReconnectRef.current) return;
        setConnected(false);
        setConnectionState('reconnecting');
        setSending(false);
        if (streamingIdRef.current) {
          setMessages(prev => prev.map(msg => msg.id === streamingIdRef.current
            ? { ...msg, streaming: false }
            : msg
          ));
          streamingIdRef.current = null;
          setStreamingId(null);
        }
        scheduleReconnect();
      });

      // error always fires before close — let close handle all cleanup
      ws.addEventListener('error', () => {});
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      ws?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, streamingId]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    // Fix #4: guard against sending while busy
    if (sending || streamingIdRef.current !== null) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Connection lost. Reconnecting...');
      return;
    }

    setError(null);
    setInput('');
    setSending(true);
    const userMsg: ChatMsg = {
      id: createId(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    wsRef.current.send(JSON.stringify({ message: text }));
  };

  const busy = sending || streamingId !== null;
  const canSend = input.trim().length > 0 && connected && !busy;
  const connectionLabel = connected
    ? 'Connected'
    : connectionState === 'reconnecting'
      ? 'Reconnecting...'
      : 'Disconnected';
  const connectionDotClass = connected
    ? 'chat-connection-dot--connected'
    : connectionState === 'reconnecting'
      ? 'chat-connection-dot--reconnecting'
      : 'chat-connection-dot--disconnected';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, flex: 1 }}>
      <div className="chat-messages" role="log" aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          className="chat-session-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 12,
          }}
        >
          <span className={`chat-connection-dot ${connectionDotClass}`} aria-label={connectionLabel} />
          <span className="chat-session-bar__model">{connectionLabel}</span>
          <span className="chat-session-bar__tokens">WebSocket</span>
        </div>

        {error && (
          <div className="chat-error" role="alert" style={{ padding: '8px 12px', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>{error}</span>
            <button className="chat-error__dismiss" type="button" onClick={() => setError(null)} aria-label="Dismiss error">Dismiss</button>
          </div>
        )}

        {messages.length === 0 && !busy && (
          <div className="chat-empty-hint" style={{ textAlign: 'center', marginTop: 'auto', marginBottom: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, color: 'var(--accent-dim)' }}>
              <Bot size={20} aria-hidden="true" />
            </div>
            <div>Say hi to Andy. I am here whenever you are.</div>
          </div>
        )}

        {messages.map(msg => (
          <div
            key={msg.id}
            className="chat-bubble"
            style={{
              display: 'flex',
              gap: 8,
              maxWidth: '85%',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            }}
          >
            <div
              className={`chat-avatar ${msg.role === 'agent' ? 'chat-avatar--agent' : 'chat-avatar--user'}`}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span className="chat-avatar__icon">
                {msg.role === 'agent' ? <Bot size={14} /> : <User size={14} />}
              </span>
            </div>
            <div
              className={`chat-msg ${msg.role === 'agent' ? 'chat-msg--agent' : 'chat-msg--user'} ${msg.streaming ? 'chat-msg--streaming' : ''}`}
              style={{ padding: '10px 14px', borderRadius: 12, fontSize: 14, lineHeight: 1.5 }}
            >
              {msg.content}
              {msg.streaming && <span className="chat-stream-cursor" aria-hidden="true" />}
            </div>
          </div>
        ))}

        {sending && streamingId === null && (
          <div className="chat-bubble" style={{ display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
            <div
              className="chat-avatar chat-avatar--agent"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span className="chat-avatar__icon">
                <Bot size={14} />
              </span>
            </div>
            <div className="chat-msg chat-msg--agent" style={{ padding: '10px 14px', borderRadius: 12 }}>
              <div className="chat-typing-dots" role="status" aria-label="Andy is typing">
                <span>•</span><span>•</span><span>•</span>
              </div>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="chat-input-wrap" style={{ padding: 12, borderTop: '1px solid var(--border)', marginBottom: 64 }}>
        <div className="chat-input-box" style={{ display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 12px' }}>
          <input
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (canSend) handleSend();
              }
            }}
            placeholder={connected ? 'Message Andy...' : 'Connecting...'}
            aria-busy={busy}
            aria-label="Message input"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 16, padding: '4px 0' }}
          />
          <button
            className={`chat-send-btn ${canSend ? 'chat-send-btn--active' : 'chat-send-btn--disabled'}`}
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
