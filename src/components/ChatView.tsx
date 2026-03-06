import { useEffect, useRef, useState, useCallback } from 'react';
import { Bot, Copy, Plus, Send, Smile, Trash2, User } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';

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

const EMOJI_CATEGORIES = [
  {
    key: 'smileys',
    label: 'Smileys',
    emojis: ['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😜', '🤔', '🤗', '😴', '😎', '🥳', '🤯', '😱', '😭', '😤', '🙄', '😈'],
  },
  {
    key: 'gestures',
    label: 'Gestures',
    emojis: ['👍', '👎', '👋', '🤝', '🙏', '💪', '👏', '🤞', '✌️', '🤟', '👊', '🫡', '🫶'],
  },
  {
    key: 'hearts',
    label: 'Hearts',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💗', '💖'],
  },
  {
    key: 'objects',
    label: 'Objects',
    emojis: ['🔥', '⭐', '💡', '🎉', '🎊', '🚀', '💻', '🎯', '📌', '✅', '❌', '⚡', '🏆', '💎', '🔑', '🎵'],
  },
  {
    key: 'nature',
    label: 'Nature',
    emojis: ['🌈', '☀️', '🌙', '⛅', '🌊', '🌸', '🌺', '🍀', '🌿', '🌵', '🌴', '🌻'],
  },
] as const;

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ChatView() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('reconnecting');
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState<(typeof EMOJI_CATEGORIES)[number]['key']>('smileys');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const streamingIdRef = useRef<string | null>(null);
  const shouldReconnectRef = useRef(true);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  const setStreaming = useCallback((id: string | null) => {
    streamingIdRef.current = id;
    setStreamingId(id);
  }, []);

  const persistMessage = useCallback((msg: ChatMsg) => {
    fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp.getTime(),
      }),
    }).catch(() => {});
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
    let persistPayload: ChatMsg | null = null;
    const now = new Date();
    setMessages(prev => {
      const currentId = streamingIdRef.current;
      if (currentId) {
        const existing = prev.find(msg => msg.id === currentId);
        persistPayload = {
          id: currentId,
          role: 'agent',
          content,
          timestamp: existing?.timestamp ?? now,
        };
        return prev.map(msg => msg.id === currentId
          ? { ...msg, content, streaming: false }
          : msg
        );
      }
      const newMsg: ChatMsg = { id: createId(), role: 'agent', content, timestamp: now };
      persistPayload = newMsg;
      return [...prev, newMsg];
    });
    setStreaming(null);
    if (persistPayload) persistMessage(persistPayload);
  };

  const handleDoneRef = useRef(() => {});
  handleDoneRef.current = () => {
    setSending(false);
    const currentId = streamingIdRef.current;
    if (!currentId) return;
    let persistPayload: ChatMsg | null = null;
    setMessages(prev => prev.map(msg => {
      if (msg.id !== currentId) return msg;
      const updated = { ...msg, streaming: false };
      persistPayload = updated;
      return updated;
    }));
    setStreaming(null);
    if (persistPayload) persistMessage(persistPayload);
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

        if (payload.type === 'thinking') {
          setThinking(true);
        }
        if (payload.type === 'token' && typeof payload.token === 'string') {
          setThinking(false);
          handleTokenRef.current(payload.token);
        }
        if (payload.type === 'message' && typeof payload.content === 'string') {
          setThinking(false);
          handleMessageRef.current(payload.content);
        }
        if (payload.type === 'done') {
          setThinking(false);
          handleDoneRef.current();
        }
        if (payload.type === 'error' && typeof payload.message === 'string') {
          setThinking(false);
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
    let active = true;
    fetch('/api/chat/history?limit=100')
      .then(res => res.json())
      .then((data: { messages?: Array<{ msg_id: string; role: 'user' | 'agent'; content: string; timestamp: number }> }) => {
        if (!active || !data?.messages) return;
        setMessages(data.messages.map(msg => ({
          id: msg.msg_id,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
        })));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending, streamingId]);

  useEffect(() => {
    if (!emojiPickerOpen) return;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (emojiPickerRef.current?.contains(target)) return;
      if (emojiButtonRef.current?.contains(target)) return;
      setEmojiPickerOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [emojiPickerOpen]);

  const insertEmoji = (emoji: string) => {
    const inputEl = inputRef.current;
    if (!inputEl) {
      setInput(prev => `${prev}${emoji}`);
      setEmojiPickerOpen(false);
      return;
    }

    const start = inputEl.selectionStart ?? input.length;
    const end = inputEl.selectionEnd ?? input.length;
    const nextValue = `${input.slice(0, start)}${emoji}${input.slice(end)}`;
    setInput(nextValue);
    setEmojiPickerOpen(false);

    requestAnimationFrame(() => {
      inputEl.focus();
      const nextCursor = start + emoji.length;
      inputEl.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const adjustInputHeight = useCallback(() => {
    const inputEl = inputRef.current;
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    const styles = window.getComputedStyle(inputEl);
    const lineHeight = Number.parseFloat(styles.lineHeight || '20');
    const paddingTop = Number.parseFloat(styles.paddingTop || '0');
    const paddingBottom = Number.parseFloat(styles.paddingBottom || '0');
    const maxHeight = lineHeight * 5 + paddingTop + paddingBottom;
    const nextHeight = Math.min(inputEl.scrollHeight, maxHeight);
    inputEl.style.height = `${Math.max(nextHeight, lineHeight + paddingTop + paddingBottom)}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

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
    persistMessage(userMsg);
    wsRef.current.send(JSON.stringify({ message: text }));
  };

  const handleCopyMessage = (msg: ChatMsg) => {
    navigator.clipboard.writeText(msg.content).catch(() => {});
    setCopiedId(msg.id);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  useEffect(() => {
    adjustInputHeight();
  }, [adjustInputHeight, input]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
  }, []);

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
  const activeEmojiSet = EMOJI_CATEGORIES.find(category => category.key === emojiCategory) ?? EMOJI_CATEGORIES[0];

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
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                fetch('/api/chat/new-session', { method: 'POST' })
                  .then(() => {
                    setMessages([]);
                    setStreaming(null);
                    streamingIdRef.current = null;
                    setError(null);
                  })
                  .catch(() => {});
              }}
              aria-label="New session"
              title="Start a new chat session"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'inherit',
                padding: '4px 8px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Plus size={14} />
              New
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm('Clear chat history?')) return;
                fetch('/api/chat/history', { method: 'DELETE' })
                  .then(() => {
                    setMessages([]);
                    setStreaming(null);
                    streamingIdRef.current = null;
                  })
                  .catch(() => {});
              }}
              aria-label="Clear chat history"
              title="Clear chat history"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'inherit',
                padding: '4px 8px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Trash2 size={14} />
              Clear
            </button>
          </div>
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
            style={{
              display: 'flex',
              flexDirection: 'column',
              maxWidth: '85%',
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              gap: 2,
            }}
          >
            <div
              className="chat-bubble"
              style={{
                display: 'flex',
                gap: 8,
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
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
                {msg.role === 'agent' && !msg.streaming ? (
                  <ChatMarkdown content={msg.content} />
                ) : (
                  msg.content
                )}
                {msg.streaming && <span className="chat-stream-cursor" aria-hidden="true" />}
                {msg.role === 'agent' && (
                  <button
                    type="button"
                    className={`chat-msg__copy ${copiedId === msg.id ? 'chat-msg__copy--active' : ''}`}
                    onClick={() => handleCopyMessage(msg)}
                    aria-label="Copy message"
                  >
                    <Copy size={14} />
                    <span className="chat-msg__copy-tooltip">Copied!</span>
                  </button>
                )}
              </div>
            </div>
            <div
              className="chat-timestamp"
              style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              {msg.timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
            </div>
          </div>
        ))}

        {(sending || thinking) && streamingId === null && (
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
            <div className={`chat-msg chat-msg--agent ${thinking ? 'chat-thinking' : ''}`} style={{ padding: '10px 14px', borderRadius: 12 }}>
              <div className={thinking ? 'chat-thinking-indicator' : 'chat-typing-dots'} role="status" aria-label={thinking ? 'Andy is thinking' : 'Andy is typing'}>
                {thinking ? (
                  <>
                    <span className="chat-thinking-pulse" />
                    <span className="chat-thinking-label">Thinking...</span>
                  </>
                ) : (
                  <><span>•</span><span>•</span><span>•</span></>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="chat-input-wrap" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
        {emojiPickerOpen && (
          <div className="emoji-picker" ref={emojiPickerRef} role="dialog" aria-label="Emoji picker">
            <div className="emoji-picker__tabs" role="tablist" aria-label="Emoji categories">
              {EMOJI_CATEGORIES.map(category => (
                <button
                  key={category.key}
                  type="button"
                  role="tab"
                  aria-selected={emojiCategory === category.key}
                  className={`emoji-picker__tab ${emojiCategory === category.key ? 'emoji-picker__tab--active' : ''}`}
                  onClick={() => setEmojiCategory(category.key)}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <div className="emoji-picker__grid" role="grid">
              {activeEmojiSet.emojis.map(emoji => (
                <button
                  key={`${activeEmojiSet.key}-${emoji}`}
                  type="button"
                  className="emoji-picker__emoji"
                  onClick={() => insertEmoji(emoji)}
                  aria-label={`Insert emoji ${emoji}`}
                  role="gridcell"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="chat-input-box" style={{ display: 'flex', gap: 8, alignItems: 'center', borderRadius: 12, padding: '8px 12px' }}>
          <textarea
            className="chat-input"
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) handleSend();
              }
            }}
            placeholder={connected ? 'Message Andy...' : 'Connecting...'}
            spellCheck={true}
            autoComplete="off"
            aria-busy={busy}
            aria-label="Message input"
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 16,
              padding: '4px 0',
              resize: 'none',
            }}
          />
          <button
            ref={emojiButtonRef}
            className={`chat-send-btn chat-emoji-btn ${emojiPickerOpen ? 'chat-emoji-btn--active' : ''}`}
            type="button"
            onClick={() => setEmojiPickerOpen(open => !open)}
            aria-label="Toggle emoji picker"
          >
            <Smile size={18} />
          </button>
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
