import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, AlertCircle, Cpu, X } from 'lucide-react';
import { TypingIndicator } from './TypingIndicator';
import { useChat } from '../hooks/useChat';

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatTokens(n: number | null): string {
  if (n === null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function ChatView() {
  const { messages, isTyping, isStreaming, error, connectionStatus, sessionInfo, send, clearError } = useChat();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    send(text);
    setInput('');
    inputRef.current?.focus();
  }, [input, isStreaming, send]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const hasInput = input.trim().length > 0;
  const connectionClass = connectionStatus === 'connected'
    ? 'chat-connection-dot--connected'
    : connectionStatus === 'reconnecting'
      ? 'chat-connection-dot--reconnecting'
      : 'chat-connection-dot--disconnected';

  return (
    <div className="flex-1 flex flex-col min-h-0" role="tabpanel" id="panel-chat">
      {/* Session info bar */}
      {sessionInfo.model && (
        <div className="chat-session-bar flex items-center gap-3 px-4 py-1.5 text-[11px] border-b" aria-label="Session information">
          <Cpu size={12} className="chat-session-bar__icon" aria-hidden="true" />
          <span className="chat-session-bar__model">{sessionInfo.model}</span>
          {sessionInfo.tokensIn !== null && (
            <span className="chat-session-bar__tokens">
              ↑{formatTokens(sessionInfo.tokensIn)} ↓{formatTokens(sessionInfo.tokensOut)}
            </span>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="chat-error flex items-center gap-2 px-4 py-2 text-sm" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="chat-error__dismiss" aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages flex-1 overflow-y-auto p-4 flex flex-col gap-3" role="log" aria-label="Chat messages" aria-live="polite">
        {messages.length === 0 && !isTyping && (
          <div className="flex-1 flex items-center justify-center">
            <p className="chat-empty-hint text-sm">Send a message to start chatting with Andy.</p>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`chat-bubble flex gap-3 max-w-[75%] ${msg.role === 'user' ? 'self-end flex-row-reverse' : ''}`}>
            <div className={`chat-avatar w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1 ${msg.role === 'agent' ? 'chat-avatar--agent' : 'chat-avatar--user'}`}
              aria-hidden="true">
              {msg.role === 'agent'
                ? <Bot size={14} className="chat-avatar__icon" />
                : <User size={14} className="chat-avatar__icon" />}
            </div>
            <div className="chat-bubble__body">
              <div className={`chat-msg px-4 py-2.5 rounded-xl text-sm leading-relaxed ${msg.role === 'agent' ? 'chat-msg--agent' : 'chat-msg--user'}`}>
                <span>{msg.content}</span>
                {msg.role === 'agent' && msg.isStreaming && (
                  <span className="chat-stream-cursor" aria-hidden="true" />
                )}
              </div>
              <div className="chat-timestamp chat-timestamp--hover text-[10px] mt-1 px-1" aria-label={`Sent at ${formatTime(msg.timestamp)}`}>
                {formatTime(msg.timestamp)}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="chat-bubble flex gap-3">
            <div className="chat-avatar chat-avatar--agent w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1" aria-hidden="true">
              <Bot size={14} className="chat-avatar__icon" />
            </div>
            <div className="chat-msg chat-msg--agent px-4 py-2.5 rounded-xl">
              <TypingIndicator />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="chat-input-wrap p-4 border-t">
        <div className="chat-input-box flex gap-2 items-center rounded-xl px-4 py-2">
          <span
            className={`chat-connection-dot ${connectionClass}`}
            aria-label={`Connection ${connectionStatus}`}
            role="img"
          />
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Andy..."
            className="chat-input flex-1 bg-transparent outline-none text-sm placeholder-gray-500"
            aria-label="Message input"
            disabled={isStreaming}
          />
          <button
            onClick={handleSend}
            disabled={!hasInput || isStreaming}
            className={`chat-send-btn p-2 rounded-lg cursor-pointer ${hasInput && !isStreaming ? 'chat-send-btn--active' : 'chat-send-btn--disabled'}`}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
