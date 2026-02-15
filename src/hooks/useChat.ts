import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage } from '../types';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? 'http://localhost:18789';
const GATEWAY_TOKEN = import.meta.env.VITE_GATEWAY_TOKEN ?? '';
const WS_URL = import.meta.env.VITE_CHAT_WS_URL ?? 'ws://localhost:3851/ws/chat';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

type GatewayUsage = Record<string, number>;
type WsIncoming =
  | { type: 'token'; token: string; usage?: GatewayUsage }
  | { type: 'message'; content: string; usage?: GatewayUsage }
  | { type: 'done'; usage?: GatewayUsage }
  | { type: 'error'; message: string };

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

function extractGatewayContent(data: Record<string, unknown>): string {
  const content =
    (data.response as string) ??
    (data.message as string) ??
    (data.text as string) ??
    (data.content as string);
  if (typeof content === 'string') return content;
  return JSON.stringify(data);
}

function updateUsage(prev: SessionInfo, usage?: GatewayUsage): SessionInfo {
  if (!usage) return prev;
  return {
    ...prev,
    tokensIn: (prev.tokensIn ?? 0) + (usage.input_tokens ?? usage.prompt_tokens ?? 0),
    tokensOut: (prev.tokensOut ?? 0) + (usage.output_tokens ?? usage.completion_tokens ?? 0),
  };
}

export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>({
    model: null,
    tokensIn: null,
    tokensOut: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectWebSocketRef = useRef<() => void>(() => {});
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  const streamingMessageIdRef = useRef<string | null>(null);

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

  const endStreaming = useCallback((usage?: GatewayUsage) => {
    if (streamingMessageIdRef.current) {
      const id = streamingMessageIdRef.current;
      setMessages(prev => prev.map(msg => (
        msg.id === id ? { ...msg, isStreaming: false } : msg
      )));
      streamingMessageIdRef.current = null;
    }
    setIsTyping(false);
    setIsStreaming(false);
    if (usage) {
      setSessionInfo(prev => updateUsage(prev, usage));
    }
  }, []);

  const appendToken = useCallback((token: string) => {
    if (!token) return;
    setIsTyping(false);
    setIsStreaming(true);

    if (!streamingMessageIdRef.current) {
      const id = crypto.randomUUID();
      streamingMessageIdRef.current = id;
      const agentMsg: ChatMessage = {
        id,
        role: 'agent',
        content: token,
        timestamp: new Date(),
        agentId: 'andy-main',
        isStreaming: true,
      };
      setMessages(prev => [...prev, agentMsg]);
      return;
    }

    const id = streamingMessageIdRef.current;
    setMessages(prev => prev.map(msg => (
      msg.id === id ? { ...msg, content: `${msg.content}${token}` } : msg
    )));
  }, []);

  const handleFullMessage = useCallback((content: string, usage?: GatewayUsage) => {
    setIsTyping(false);
    setIsStreaming(false);
    const agentMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'agent',
      content,
      timestamp: new Date(),
      agentId: 'andy-main',
    };
    setMessages(prev => [...prev, agentMsg]);
    if (usage) {
      setSessionInfo(prev => updateUsage(prev, usage));
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    if (reconnectTimerRef.current !== null) return;
    reconnectAttemptRef.current += 1;
    const delay = Math.min(1000 * (2 ** (reconnectAttemptRef.current - 1)), 8000);
    setConnectionStatus('reconnecting');
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectWebSocketRef.current();
    }, delay);
  }, []);

  const connectWebSocket = useCallback(() => {
    if (typeof WebSocket === 'undefined') {
      setConnectionStatus('disconnected');
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    setConnectionStatus(prev => (prev === 'connected' ? prev : 'reconnecting'));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      setConnectionStatus('connected');
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnectionStatus('disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      let payload: WsIncoming | null = null;
      if (typeof event.data === 'string') {
        try {
          payload = JSON.parse(event.data) as WsIncoming;
        } catch {
          payload = { type: 'token', token: event.data };
        }
      }

      if (!payload) return;
      if (payload.type === 'token') {
        appendToken(payload.token);
        if (payload.usage) {
          setSessionInfo(prev => updateUsage(prev, payload.usage));
        }
        return;
      }
      if (payload.type === 'message') {
        handleFullMessage(payload.content, payload.usage);
        return;
      }
      if (payload.type === 'done') {
        endStreaming(payload.usage);
        return;
      }
      if (payload.type === 'error') {
        endStreaming();
        setError(payload.message || 'WebSocket error');
      }
    };
  }, [appendToken, endStreaming, handleFullMessage, scheduleReconnect]);

  useEffect(() => {
    connectWebSocketRef.current = connectWebSocket;
  }, [connectWebSocket]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connectWebSocket();
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connectWebSocket]);

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
    setIsStreaming(true);
    streamingMessageIdRef.current = null;

    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', message: trimmed }));
      return;
    }

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
        setIsStreaming(false);
        handleFullMessage(extractGatewayContent(data), data.usage as GatewayUsage | undefined);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setIsTyping(false);
        setIsStreaming(false);
        setError(err.message || 'Failed to send message');
      });
  }, [handleFullMessage]);

  return { messages, isTyping, isStreaming, error, connectionStatus, sessionInfo, send, clearError };
}
