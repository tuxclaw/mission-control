import { useState, useCallback, useRef } from 'react';
import type { ChatMessage } from '../types';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:18789';
const GATEWAY_TOKEN = import.meta.env.VITE_GATEWAY_TOKEN ?? '';

export interface SessionInfo {
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isTyping: boolean;
  error: string | null;
  sessionInfo: SessionInfo;
  send: (text: string) => void;
  clearError: () => void;
}

export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({
    model: null,
    tokensIn: null,
    tokensOut: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  // Fetch session info on first load
  const sessionFetched = useRef(false);
  if (!sessionFetched.current && GATEWAY_TOKEN) {
    sessionFetched.current = true;
    fetch(`${GATEWAY_URL}/api/sessions`, {
      headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
    })
      .then(res => res.ok ? res.json() : null)
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const main = data.find((s: Record<string, unknown>) => s.id === 'main' || s.name === 'main');
          if (main) {
            setSessionInfo(prev => ({
              ...prev,
              model: (main as Record<string, unknown>).model as string ?? prev.model,
            }));
          }
        }
      })
      .catch(() => { /* ignore */ });
  }

  const clearError = useCallback(() => setError(null), []);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setError(null);
    setIsTyping(true);

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`${GATEWAY_URL}/api/sessions/main/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({ message: trimmed }),
      signal: controller.signal,
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Gateway error ${res.status}${body ? `: ${body}` : ''}`);
        }
        return res.json();
      })
      .then((data: Record<string, unknown>) => {
        setIsTyping(false);
        const content =
          (data.response as string) ??
          (data.message as string) ??
          (data.text as string) ??
          (data.content as string) ??
          JSON.stringify(data);

        const agentMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: typeof content === 'string' ? content : JSON.stringify(content),
          timestamp: new Date(),
          agentId: 'andy-main',
        };
        setMessages(prev => [...prev, agentMsg]);

        // Update token usage if present
        if (data.usage && typeof data.usage === 'object') {
          const usage = data.usage as Record<string, number>;
          setSessionInfo(prev => ({
            ...prev,
            tokensIn: (prev.tokensIn ?? 0) + (usage.input_tokens ?? usage.prompt_tokens ?? 0),
            tokensOut: (prev.tokensOut ?? 0) + (usage.output_tokens ?? usage.completion_tokens ?? 0),
          }));
        }
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setIsTyping(false);
        setError(err.message || 'Failed to send message');
      });
  }, []);

  return { messages, isTyping, error, sessionInfo, send, clearError };
}
