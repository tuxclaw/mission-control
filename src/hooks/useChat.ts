import { useState, useCallback, useRef } from 'react';
import type { ChatMessage } from '../types';

const API = import.meta.env.VITE_VITALS_API_URL ?? '';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export interface SessionInfo {
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isTyping: boolean;
  isStreaming: boolean;
  error: string | null;
  connectionStatus: ConnectionStatus;
  sessionInfo: SessionInfo;
  send: (text: string) => void;
  clearError: () => void;
}

export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({ model: null, tokensIn: null, tokensOut: null });
  const inFlightRef = useRef(false);

  const clearError = useCallback(() => setError(null), []);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || inFlightRef.current) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setError(null);
    setIsTyping(true);
    setIsStreaming(true);
    inFlightRef.current = true;

    fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: trimmed }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Error ${res.status}: ${body}`);
        }
        return res.json();
      })
      .then((data: { content: string; usage?: Record<string, number> }) => {
        const agentMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: data.content || '(empty response)',
          timestamp: new Date(),
          agentId: 'andy-main',
        };
        setMessages(prev => [...prev, agentMsg]);
        if (data.usage) {
          setSessionInfo(prev => ({
            ...prev,
            tokensIn: (prev.tokensIn ?? 0) + (data.usage?.input ?? data.usage?.prompt_tokens ?? 0),
            tokensOut: (prev.tokensOut ?? 0) + (data.usage?.output ?? data.usage?.completion_tokens ?? 0),
          }));
        }
      })
      .catch((err: Error) => {
        setError(err.message || 'Failed to send message');
      })
      .finally(() => {
        setIsTyping(false);
        setIsStreaming(false);
        inFlightRef.current = false;
      });
  }, []);

  return { messages, isTyping, isStreaming, error, connectionStatus: 'connected', sessionInfo, send, clearError };
}
