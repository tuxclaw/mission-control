import express from 'express';
import cors from 'cors';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import os from 'node:os';
import WebSocket, { WebSocketServer } from 'ws';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const WORKSPACE = process.env.OPENCLAW_WORKSPACE ?? '/home/tux/.openclaw/workspace';
const REPO_ROOT = join(WORKSPACE, 'projects/andys-overview');
const app = express();
const PORT = Number(process.env.VITALS_PORT ?? 3851);
const server = createServer(app);

app.use(cors());
app.use(express.json());

// ---- Gateway proxy (avoids CORS) ----
const GATEWAY_URL = process.env.VITE_GATEWAY_URL ?? 'http://100.90.181.128:18789';
const GATEWAY_TOKEN = process.env.VITE_GATEWAY_TOKEN ?? '';

function gatewayHeaders(extra?: Record<string, string>) {
  return {
    ...(extra ?? {}),
    ...(GATEWAY_TOKEN ? { Authorization: `Bearer ${GATEWAY_TOKEN}` } : {}),
  };
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractGatewayText(payload: Record<string, unknown>): string | null {
  const content =
    (payload.response as string) ??
    (payload.message as string) ??
    (payload.text as string) ??
    (payload.content as string);
  return typeof content === 'string' ? content : null;
}

function truncateStdout(stdout: string, maxLength = 500): string {
  if (stdout.length <= maxLength) return stdout;
  return `${stdout.slice(0, maxLength)}...`;
}

function logAgentParseFallback(stdout: string, reason: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return;
  console.error(`AO chat response parse fallback (${reason}). Raw stdout (truncated):`, truncateStdout(trimmed));
}

function findFallbackString(value: unknown): string | null {
  const stack: Array<{ value: unknown; key?: string }> = [{ value }];
  const seen = new Set<unknown>();
  const strings: string[] = [];
  const contentKeyStrings: string[] = [];
  const contentKeys = new Set(['text', 'content', 'message', 'output', 'response']);

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const { value: currentValue, key } = current;
    if (typeof currentValue === 'string') {
      const trimmed = currentValue.trim();
      if (trimmed) {
        strings.push(trimmed);
        if (key && contentKeys.has(key)) {
          contentKeyStrings.push(trimmed);
        }
      }
      continue;
    }
    if (typeof currentValue !== 'object') continue;
    if (seen.has(currentValue)) continue;
    seen.add(currentValue);

    if (Array.isArray(currentValue)) {
      for (const item of currentValue) stack.push({ value: item });
    } else {
      for (const [childKey, item] of Object.entries(currentValue as Record<string, unknown>)) {
        stack.push({ value: item, key: childKey });
      }
    }
  }

  if (strings.length === 0) return null;
  const contentCandidates = contentKeyStrings.filter((str) => str.length >= 16);
  if (contentCandidates.length > 0) {
    return contentCandidates.sort((a, b) => b.length - a.length)[0] ?? null;
  }
  const longStrings = strings.filter((str) => str.length >= 16);
  const candidates = longStrings.length > 0 ? longStrings : strings;
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

function parseAgentResponse(stdout: string): { content: string; silent: boolean } {
  let content = '(no response)';
  let silent = false;

  const raw = stdout ?? '';
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const result = record.result as Record<string, unknown> | undefined;
    const payloads = result?.payloads as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(payloads) && payloads.length === 0) {
      content = '';
      silent = true;
    } else if (Array.isArray(payloads)) {
      const texts = payloads
        .map((payload) => (typeof payload.text === 'string' ? payload.text : null))
        .filter((text): text is string => text !== null);
      if (texts.length > 0) {
        content = texts.join('\n\n');
      } else if (payloads.some((payload) => typeof payload.mediaUrl === 'string' && payload.mediaUrl)) {
        content = '(media attachment)';
      } else if (typeof record.text === 'string') {
        content = record.text;
      } else if (typeof record.content === 'string') {
        content = record.content;
      } else if (typeof result?.text === 'string') {
        content = result.text as string;
      } else {
        logAgentParseFallback(raw, 'no matching structured fields');
        const fallback = findFallbackString(parsed);
        if (fallback) {
          content = fallback;
        } else if (raw.trim()) {
          content = raw.trim();
        }
      }
    } else if (typeof record.text === 'string') {
      content = record.text;
    } else if (typeof record.content === 'string') {
      content = record.content;
    } else if (typeof result?.text === 'string') {
      content = result.text as string;
    } else {
      logAgentParseFallback(raw, 'no matching structured fields');
      const fallback = findFallbackString(parsed);
      if (fallback) {
        content = fallback;
      } else if (raw.trim()) {
        content = raw.trim();
      }
    }
  } else if (parsed !== null && typeof parsed === 'string') {
    content = parsed;
  } else if (parsed !== null) {
    logAgentParseFallback(raw, 'json without string payload');
    const fallback = findFallbackString(parsed);
    if (fallback) {
      content = fallback;
    } else if (raw.trim()) {
      content = raw.trim();
    }
  } else if (raw.trim()) {
    logAgentParseFallback(raw, 'invalid json');
    content = raw.trim();
  }

  if (content === 'NO_REPLY') {
    content = '';
    silent = true;
  } else if (content.trim() === '') {
    silent = true;
  }

  return { content, silent };
}

function extractUsage(payload: Record<string, unknown>): Record<string, number> | undefined {
  if (!payload.usage || typeof payload.usage !== 'object') return undefined;
  return payload.usage as Record<string, number>;
}

function extractToken(payload: Record<string, unknown>): string | null {
  const direct =
    (payload.token as string) ??
    (payload.text as string) ??
    (payload.content as string) ??
    (payload.delta as string);
  if (typeof direct === 'string' && direct.length > 0) return direct;

  const choices = payload.choices as Array<Record<string, unknown>> | undefined;
  if (choices && choices.length > 0) {
    const delta = choices[0]?.delta as Record<string, unknown> | undefined;
    const deltaText = (delta?.content as string) ?? (choices[0]?.text as string);
    if (typeof deltaText === 'string' && deltaText.length > 0) return deltaText;
  }

  return null;
}

function isEventStream(contentType: string): boolean {
  return contentType.includes('text/event-stream');
}

function isNdjson(contentType: string): boolean {
  return contentType.includes('application/x-ndjson')
    || contentType.includes('application/ndjson')
    || contentType.includes('application/jsonl');
}

function sendWs(ws: WebSocket, payload: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

async function handleGatewayStream(ws: WebSocket, res: Response) {
  const contentType = res.headers.get('content-type') ?? '';
  const useSse = isEventStream(contentType);
  const useNdjson = isNdjson(contentType);

  if (!res.body || (!useSse && !useNdjson)) {
    const text = await res.text();
    const json = safeJsonParse(text);
    if (json) {
      const content = extractGatewayText(json) ?? text;
      sendWs(ws, { type: 'message', content, usage: extractUsage(json) });
    } else {
      sendWs(ws, { type: 'message', content: text });
    }
    sendWs(ws, { type: 'done' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handlePayload = (payloadText: string) => {
    const trimmed = payloadText.trim();
    if (!trimmed) return;
    if (trimmed === '[DONE]') {
      sendWs(ws, { type: 'done' });
      return;
    }
    const payload = safeJsonParse(trimmed);
    if (payload) {
      const token = extractToken(payload) ?? extractGatewayText(payload);
      if (token) sendWs(ws, { type: 'token', token, usage: extractUsage(payload) });
      return;
    }
    sendWs(ws, { type: 'token', token: trimmed });
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    if (useSse) {
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = rawEvent
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\s?/, ''));
        if (dataLines.length > 0) {
          handlePayload(dataLines.join('\n'));
        }
        idx = buffer.indexOf('\n\n');
      }
    } else if (useNdjson) {
      let lineIdx = buffer.indexOf('\n');
      while (lineIdx !== -1) {
        const line = buffer.slice(0, lineIdx);
        buffer = buffer.slice(lineIdx + 1);
        handlePayload(line);
        lineIdx = buffer.indexOf('\n');
      }
    }
  }

  if (buffer.trim()) {
    handlePayload(buffer);
  }

  sendWs(ws, { type: 'done' });
}

function extractModelName(model?: string): string {
  if (!model) return 'unknown';
  const trimmed = model.trim();
  if (!trimmed) return 'unknown';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

function extractPrimaryModel(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const candidates: Array<unknown> = [
    record.resolvedDefault,
    record.defaultModel,
    record.primary,
    record.model,
    record.current,
    record.active,
    (record.models as Record<string, unknown> | undefined)?.primary,
    (record.models as Record<string, unknown> | undefined)?.current,
    (record.models as Record<string, unknown> | undefined)?.active,
    (record.defaults as Record<string, unknown> | undefined)?.primary,
    (record.defaults as Record<string, unknown> | undefined)?.model,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  const models = record.models;
  if (Array.isArray(models)) {
    const active = models.find((m) => (m as Record<string, unknown>)?.active === true)
      ?? models.find((m) => (m as Record<string, unknown>)?.primary === true);
    const activeModel = (active as Record<string, unknown> | undefined)?.model;
    if (typeof activeModel === 'string' && activeModel.trim()) return activeModel.trim();
  }
  return null;
}

async function getPrimaryModel(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('openclaw', ['models', 'status', '--json'], { timeout: 8000 });
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return extractPrimaryModel(parsed);
  } catch {
    try {
      const { stdout } = await execFileAsync('openclaw', ['models', 'status'], { timeout: 8000 });
      const match = stdout.match(/(?:primary|current|active|default)\s*:\s*([^\s]+)/i);
      return match?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

function formatSessionAge(createdAt?: string): string | undefined {
  if (!createdAt) return undefined;
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return undefined;
  const diffMs = Math.max(0, Date.now() - createdMs);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function sessionStatus(lastActivityAt?: string): 'active' | 'idle' | 'dormant' {
  if (!lastActivityAt) return 'dormant';
  const lastMs = new Date(lastActivityAt).getTime();
  if (Number.isNaN(lastMs)) return 'dormant';
  const diffMs = Math.max(0, Date.now() - lastMs);
  if (diffMs < 5 * 60 * 1000) return 'active';
  if (diffMs < 30 * 60 * 1000) return 'idle';
  return 'dormant';
}

function sessionRole(kind?: string): string {
  if (kind === 'main') return 'Main Agent';
  if (kind === 'subagent') return 'Sub-Agent';
  if (kind === 'cron') return 'Cron Job';
  return kind ?? 'Agent';
}

function formatSessionName(key?: string): string {
  if (!key) return 'Unknown';
  const cleaned = key.replace(/[_-]+/g, ' ').trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : key;
}

function formatExecError(err: unknown): string {
  if (!err) return 'Unknown error';
  const info = err as { message?: string; stdout?: string; stderr?: string };
  return [info.message, info.stdout, info.stderr].filter(Boolean).join('\n').trim();
}

// ---- Chat session management ----
const CHAT_SESSION_KEY = 'chat.session_id';
let chatSessionId = `ao-chat-${Date.now()}`;

function loadChatSessionId(): string | null {
  if (!systemDb) return null;
  const result = systemDb.exec('SELECT value FROM system_config WHERE key = ?', [CHAT_SESSION_KEY]);
  const value = result.length > 0 ? result[0].values[0]?.[0] : null;
  return typeof value === 'string' && value.trim() ? value : null;
}

function persistChatSessionId(sessionId: string) {
  if (!systemDb) return;
  systemDb.run(
    'INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)',
    [CHAT_SESSION_KEY, sessionId],
  );
  saveSystemDb();
}

function formatExportDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function formatIsoTimestamp(value: number): string {
  return new Date(value).toISOString();
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function roleLabel(role: string): string {
  if (role === 'user') return 'User';
  if (role === 'agent') return 'Andy';
  return role;
}

app.get('/api/chat/session', (_req, res) => {
  res.json({ sessionId: chatSessionId });
});

app.post('/api/chat/new-session', (_req, res) => {
  chatSessionId = `ao-chat-${Date.now()}`;
  persistChatSessionId(chatSessionId);
  res.json({ ok: true, sessionId: chatSessionId });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body as { message?: string };
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Missing message field' });
      return;
    }

    const { stdout } = await execFileAsync(
      'openclaw',
      ['agent', '--session-id', chatSessionId, '--json', '-m', message],
      { timeout: 60000 },
    );

    const { content, silent } = parseAgentResponse(stdout);

    res.json({ content, silent, usage: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Chat failed';
    res.status(500).json({ error: msg });
  }
});

app.get('/api/chat/history', (req, res) => {
  if (!systemDb) {
    res.json({ messages: [] });
    return;
  }

  const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
  const beforeRaw = typeof req.query.before === 'string' ? Number.parseInt(req.query.before, 10) : null;
  const before = Number.isFinite(beforeRaw) ? beforeRaw : null;

  let sql = 'SELECT msg_id, role, content, timestamp FROM chat_messages';
  const params: Array<string | number> = [];
  if (before !== null) {
    sql += ' WHERE timestamp < ?';
    params.push(before);
  }
  sql += ' ORDER BY timestamp ASC LIMIT ?';
  params.push(limit);

  const result = systemDb.exec(sql, params);
  const messages = result.length > 0
    ? result[0].values.map((row) => ({
      msg_id: row[0] as string,
      role: row[1] as string,
      content: row[2] as string,
      timestamp: row[3] as number,
    }))
    : [];

  res.json({ messages });
});

app.get('/api/chat/export', (req, res) => {
  const formatRaw = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'md';
  const format = formatRaw === 'csv' ? 'csv' : 'md';

  const messages = systemDb
    ? (() => {
      const result = systemDb.exec('SELECT role, content, timestamp FROM chat_messages ORDER BY timestamp ASC');
      return result.length > 0
        ? result[0].values.map((row) => ({
          role: row[0] as string,
          content: row[1] as string,
          timestamp: row[2] as number,
        }))
        : [];
    })()
    : [];

  const exportDate = formatExportDate();

  if (format === 'csv') {
    const header = 'timestamp,role,content';
    const rows = messages.map((msg) => {
      const timestamp = formatIsoTimestamp(msg.timestamp);
      return [escapeCsv(timestamp), escapeCsv(msg.role), escapeCsv(msg.content)].join(',');
    });
    const body = [header, ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=chat-export-${exportDate}.csv`);
    res.send(body);
    return;
  }

  const lines: string[] = [];
  for (const msg of messages) {
    lines.push(`### [${formatIsoTimestamp(msg.timestamp)}] **${roleLabel(msg.role)}**`);
    lines.push(msg.content ?? '');
    lines.push('');
  }
  const body = lines.join('\n');
  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename=chat-export-${exportDate}.md`);
  res.send(body);
});

app.post('/api/chat/messages', (req, res) => {
  if (!systemDb) {
    res.status(500).json({ error: 'System DB unavailable' });
    return;
  }

  const { msg_id, role, content, timestamp } = req.body as {
    msg_id?: string;
    role?: string;
    content?: string;
    timestamp?: number;
  };

  if (!msg_id || typeof msg_id !== 'string'
    || !role || typeof role !== 'string'
    || !content || typeof content !== 'string'
    || typeof timestamp !== 'number') {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  systemDb.run(
    'INSERT OR IGNORE INTO chat_messages (msg_id, role, content, timestamp) VALUES (?, ?, ?, ?)',
    [msg_id, role, content, timestamp],
  );
  saveSystemDb();
  res.json({ ok: true });
});

app.delete('/api/chat/history', (_req, res) => {
  if (!systemDb) {
    res.json({ ok: true });
    return;
  }

  systemDb.run('DELETE FROM chat_messages');
  saveSystemDb();
  res.json({ ok: true });
});

// ---- Model Switcher ----
const ALLOWED_MODELS = new Set([
  'anthropic/claude-opus-4-6',
  'openai/gpt-5.2',
  'google/gemini-2.5-pro',
  'ollama/qwen3:30b-a3b',
]);

app.get('/api/models/status', async (_req, res) => {
  try {
    const model = await getPrimaryModel();
    res.json({ model: model ?? 'unknown' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read model status';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/models/set', async (req, res) => {
  try {
    const { model } = req.body as { model?: string };
    if (!model || typeof model !== 'string') {
      res.status(400).json({ error: 'Missing model' });
      return;
    }
    if (!ALLOWED_MODELS.has(model)) {
      res.status(400).json({ error: `Model not allowed: ${model}` });
      return;
    }
    // Pre-flight: ensure Ollama container is running for local models
    if (model.startsWith('ollama/')) {
      try {
        const { stdout: status } = await execFileAsync('systemctl', ['--user', 'is-active', 'ollama-rocm.service'], { timeout: 5000 });
        if (status.trim() !== 'active') {
          await execFileAsync('systemctl', ['--user', 'start', 'ollama-rocm.service'], { timeout: 15000 });
          // Give Ollama a moment to initialize
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch {
        // Service not active — try starting it
        try {
          await execFileAsync('systemctl', ['--user', 'start', 'ollama-rocm.service'], { timeout: 15000 });
          await new Promise((r) => setTimeout(r, 2000));
        } catch (startErr) {
          const msg = startErr instanceof Error ? startErr.message : 'Failed to start Ollama';
          res.status(500).json({ error: `Ollama pre-flight failed: ${msg}` });
          return;
        }
      }
    }
    await execFileAsync('openclaw', ['models', 'set', model], { timeout: 15000 });
    const current = await getPrimaryModel();
    res.json({ ok: true, model: current ?? model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to set model';
    res.status(500).json({ error: msg });
  }
});

// ---- WebSocket chat streaming ----
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  let inFlight = false;
  let abortController: AbortController | null = null;

  ws.on('close', () => {
    abortController?.abort();
    abortController = null;
  });

  ws.on('message', async (raw) => {
    if (inFlight) {
      sendWs(ws, { type: 'error', message: 'Message already in progress.' });
      return;
    }

    const text = raw.toString();
    let message = text;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.message === 'string') {
        message = parsed.message;
      } else if (typeof parsed.content === 'string') {
        message = parsed.content;
      }
    } catch {
      // treat as raw message
    }

    if (!message || typeof message !== 'string') {
      sendWs(ws, { type: 'error', message: 'Missing message.' });
      return;
    }

    inFlight = true;

    try {
      const { spawn } = await import('child_process');
      const child = spawn('openclaw', [
        'agent', '--session-id', chatSessionId, '--json', '-m', message,
      ], { timeout: 120000 });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const onWsClose = () => { child.kill(); };
      ws.on('close', onWsClose);

      await new Promise<void>((resolve) => {
        child.on('close', (code) => {
          ws.removeListener('close', onWsClose);

          if (code !== 0) {
            sendWs(ws, { type: 'error', message: stderr.trim() || `Agent exited with code ${code}` });
            sendWs(ws, { type: 'done' });
            resolve();
            return;
          }

          const { content, silent } = parseAgentResponse(stdout);

          if (!silent) {
            sendWs(ws, { type: 'message', content });
          }
          sendWs(ws, { type: 'done' });
          resolve();
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WebSocket proxy error';
      sendWs(ws, { type: 'error', message: msg });
      sendWs(ws, { type: 'done' });
    } finally {
      inFlight = false;
    }
  });
});

// ---- Squad Agents API (dynamic status) ----
const AGENTS_STATUS_FILE = join(WORKSPACE, 'agents/status.json');

interface AgentStatusEntry {
  status: 'active' | 'idle';
  task: string | null;
  project: string | null;
  startedAt: string | null;
  pid?: number | null;
  sessionKey?: string | null;
  lastRun?: string | null;
}

interface AgentStatusFile {
  agents: Record<string, AgentStatusEntry>;
  updatedAt: string | null;
}

const SQUAD_ROSTER = [
  { id: 'andy-main', name: 'Andy ⚡', defaultModel: 'opus', role: 'Orchestrator', engine: 'openclaw' },
  { id: 'buzz', name: 'Buzz 🚀', defaultModel: 'codex', role: 'Coding Agent', engine: 'codex' },
  { id: 'woody', name: 'Woody 🤠', defaultModel: 'codex', role: 'Coding Agent', engine: 'codex' },
  { id: 'sarge', name: 'Sarge 🎖️', defaultModel: 'opus', role: 'Code Review', engine: 'subagent' },
  { id: 'trixie', name: 'Trixie 🎨', defaultModel: 'opus', role: 'UI/Design', engine: 'subagent' },
  { id: 'jessie', name: 'Jessie 🔍', defaultModel: 'sonnet', role: 'Research', engine: 'subagent' },
  { id: 'slink', name: 'Slink 🐕', defaultModel: 'sonnet', role: 'Trading Monitor', engine: 'cron' },
];

async function loadAgentStatus(): Promise<AgentStatusFile> {
  try {
    const raw = await readFile(AGENTS_STATUS_FILE, 'utf-8');
    return JSON.parse(raw) as AgentStatusFile;
  } catch {
    return { agents: {}, updatedAt: null };
  }
}

async function hasRunningCodexProcess(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-a', '-f', 'codex'], { timeout: 3000 });
    return stdout.trim().length > 0;
  } catch {
    // No codex processes running — that's fine
    return false;
  }
}

function formatElapsed(startedAt: string | null): string | null {
  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const diffMs = Math.max(0, Date.now() - startMs);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

app.get('/api/agents', async (_req, res) => {
  try {
    const [statusFile, andyModel, hasCodexRunning] = await Promise.all([
      loadAgentStatus(),
      getPrimaryModel(),
      hasRunningCodexProcess(),
    ]);

    const modelStr = andyModel ? extractModelName(andyModel) : 'opus';

    const agents = SQUAD_ROSTER.map((roster) => {
      const statusEntry = statusFile.agents[roster.id];

      // Andy is always active if main session exists
      if (roster.id === 'andy-main') {
        return {
          id: roster.id,
          name: roster.name,
          model: modelStr,
          status: 'active' as const,
          role: roster.role,
          task: null,
          project: null,
          startedAt: null,
          elapsed: null,
        };
      }

      // Determine status from file + process verification
      let status: 'active' | 'idle' = statusEntry?.status ?? 'idle';
      let task = statusEntry?.task ?? null;
      let project = statusEntry?.project ?? null;
      let startedAt = statusEntry?.startedAt ?? null;

      // For Codex agents (Buzz/Woody): rely on status file, only auto-downgrade
      // if a startedAt exists and there have been no codex processes for 30+ minutes.
      if (roster.engine === 'codex' && status === 'active') {
        const startMs = startedAt ? new Date(startedAt).getTime() : NaN;
        const elapsed = Number.isNaN(startMs) ? 0 : Date.now() - startMs;

        if (startedAt && !hasCodexRunning && elapsed > 30 * 60 * 1000) {
          // No codex running for 30+ minutes after start — likely done
          status = 'idle';
          task = null;
          project = null;
          startedAt = null;
        }
      }

      return {
        id: roster.id,
        name: roster.name,
        model: roster.defaultModel,
        status,
        role: roster.role,
        task,
        project,
        startedAt,
        elapsed: status === 'active' ? formatElapsed(startedAt) : null,
      };
    });

    res.json(agents);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load agents';
    res.status(500).json({ error: msg });
  }
});

app.put('/api/agents/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as Partial<AgentStatusEntry>;
    const statusFile = await loadAgentStatus();

    if (!statusFile.agents[id]) {
      statusFile.agents[id] = {
        status: 'idle',
        task: null,
        project: null,
        startedAt: null,
      };
    }

    const entry = statusFile.agents[id]!;
    if (body.status !== undefined) entry.status = body.status;
    if (body.task !== undefined) entry.task = body.task;
    if (body.project !== undefined) entry.project = body.project;
    if (body.startedAt !== undefined) entry.startedAt = body.startedAt;
    if (body.pid !== undefined) entry.pid = body.pid;
    if (body.sessionKey !== undefined) entry.sessionKey = body.sessionKey;
    statusFile.updatedAt = new Date().toISOString();

    await writeFile(AGENTS_STATUS_FILE, JSON.stringify(statusFile, null, 2));
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update agent status';
    res.status(500).json({ error: msg });
  }
});

app.get('/api/sessions', async (_req, res) => {
  try {
    const upstream = await fetch(`${GATEWAY_URL}/api/agents/main/sessions`, {
      headers: gatewayHeaders(),
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Gateway HTTP ${upstream.status}` });
      return;
    }
    const raw = await upstream.json() as unknown;
    const sessions = Array.isArray(raw)
      ? raw
      : (raw as { sessions?: unknown[] }).sessions ?? [];

    const agents = (sessions as Array<Record<string, unknown>>).map((session) => {
      const sessionKey = typeof session.sessionKey === 'string' ? session.sessionKey : '';
      const kind = typeof session.kind === 'string' ? session.kind : undefined;
      const model = typeof session.model === 'string' ? session.model : undefined;
      const createdAt = typeof session.createdAt === 'string' ? session.createdAt : undefined;
      const lastActivityAt = typeof session.lastActivityAt === 'string' ? session.lastActivityAt : undefined;
      const id = sessionKey || crypto.randomUUID();
      return {
        id,
        name: formatSessionName(sessionKey || id),
        model: extractModelName(model),
        status: sessionStatus(lastActivityAt),
        role: sessionRole(kind),
        sessionAge: formatSessionAge(createdAt),
      };
    });

    res.json(agents);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Proxy error';
    res.status(502).json({ error: msg });
  }
});

// ---- CPU usage from /proc/stat ----
let prevIdle = 0;
let prevTotal = 0;

async function getCpuPercent(): Promise<number> {
  try {
    const stat = await readFile('/proc/stat', 'utf-8');
    const line = stat.split('\n')[0]; // "cpu  user nice system idle ..."
    if (!line) return 0;
    const parts = line.split(/\s+/).slice(1).map(Number);
    const idle = parts[3] ?? 0;
    const total = parts.reduce((a, b) => a + b, 0);

    const diffIdle = idle - prevIdle;
    const diffTotal = total - prevTotal;
    prevIdle = idle;
    prevTotal = total;

    if (diffTotal === 0) return 0;
    return Math.round(((diffTotal - diffIdle) / diffTotal) * 100);
  } catch {
    return 0;
  }
}

// ---- RAM from /proc/meminfo ----
async function getRamPercent(): Promise<number> {
  try {
    const info = await readFile('/proc/meminfo', 'utf-8');
    const get = (key: string): number => {
      const match = info.match(new RegExp(`${key}:\\s+(\\d+)`));
      return match ? Number(match[1]) : 0;
    };
    const total = get('MemTotal');
    const available = get('MemAvailable');
    if (total === 0) return 0;
    return Math.round(((total - available) / total) * 100);
  } catch {
    return 0;
  }
}

// ---- Disk from df ----
async function getDiskPercent(): Promise<number> {
  try {
    const { stdout } = await execAsync('df -h /var/home 2>/dev/null || df -h / 2>/dev/null');
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return 0;
    const parts = lines[1]!.split(/\s+/);
    const useStr = parts[4]?.replace('%', '') ?? '0';
    return Number(useStr);
  } catch {
    return 0;
  }
}

// ---- GPU via Ollama ----
async function getGpuPercent(): Promise<number> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch('http://localhost:11434/api/ps', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return 0;
    const data = await res.json() as { models?: Array<{ size_vram?: number; size?: number }> };
    if (!data.models || data.models.length === 0) return 0;
    // If models are loaded, estimate some usage
    const model = data.models[0]!;
    if (model.size_vram && model.size && model.size > 0) {
      return Math.round((model.size_vram / model.size) * 100);
    }
    return data.models.length > 0 ? 15 : 0;
  } catch {
    return 0;
  }
}

// ---- System stats (SysDash) ----
interface CpuTimes {
  name: string;
  idle: number;
  active: number;
  total: number;
}

interface CpuUsage {
  total: number;
  cores: Array<{ core: number; usage: number }>;
}

interface MemoryStats {
  total: number;
  used: number;
  free: number;
  percent: number;
}

interface DiskStats {
  mount: string;
  total: number;
  used: number;
  avail: number;
  percent: number;
}

interface GpuStats {
  card: string;
  model: string | null;
  busy: number;
  vramTotal: number;
  vramUsed: number;
  vramPercent: number;
  tempEdge: number | null;
  tempJunction: number | null;
  tempMem: number | null;
  fanRpm: number | null;
  powerW: number | null;
  powerCapW: number | null;
  sclkMhz: number;
  mclkMhz: number;
}

interface LoadAvgStats {
  '1m': number;
  '5m': number;
  '15m': number;
}

interface UptimeStats {
  seconds: number;
  formatted: string;
}

interface ProcessStats {
  user: string;
  pid: number;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  command: string;
}

interface ContainerStats {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  ports: unknown[];
}

interface SystemStats {
  timestamp: number;
  hostname: string;
  cpuModel: string | null;
  cpu: CpuUsage;
  memory: MemoryStats;
  disk: DiskStats[];
  gpus: GpuStats[];
  uptime: UptimeStats;
  loadAvg: LoadAvgStats;
  processes: ProcessStats[];
  containers: ContainerStats[];
}

interface SqlRow {
  [key: string]: number | string | null;
}

let prevCpuTimes: { total: CpuTimes | null; cores: CpuTimes[] } | null = null;
let cachedCpuModel: string | null = null;

function parseProcStat(content: string) {
  const lines = content.trim().split('\n');
  const cores: CpuTimes[] = [];
  let total: CpuTimes | null = null;

  for (const line of lines) {
    if (!line.startsWith('cpu')) continue;
    const parts = line.trim().split(/\s+/);
    const name = parts[0] ?? '';
    const nums = parts.slice(1).map(Number);
    const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
    const active = (nums[0] ?? 0) + (nums[1] ?? 0) + (nums[2] ?? 0)
      + (nums[5] ?? 0) + (nums[6] ?? 0) + (nums[7] ?? 0);
    const totalTime = idle + active;
    const entry = { name, idle, active, total: totalTime };
    if (name === 'cpu') {
      total = entry;
    } else {
      cores.push(entry);
    }
  }

  return { total, cores };
}

function calcUsage(prev: CpuTimes, curr: CpuTimes) {
  const totalDelta = curr.total - prev.total;
  if (totalDelta <= 0) return 0;
  const idleDelta = curr.idle - prev.idle;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
}

async function getCpuModel(): Promise<string | null> {
  if (cachedCpuModel) return cachedCpuModel;
  try {
    const content = await readFile('/proc/cpuinfo', 'utf-8');
    const match = content.match(/model name\s*:\s*(.+)/);
    if (match?.[1]) cachedCpuModel = match[1].trim();
  } catch {
    cachedCpuModel = null;
  }
  return cachedCpuModel;
}

function computeCpuResult(prev: { total: CpuTimes | null; cores: CpuTimes[] }, curr: { total: CpuTimes | null; cores: CpuTimes[] }): CpuUsage {
  if (!prev.total || !curr.total) return { total: 0, cores: [] };
  const totalUsage = calcUsage(prev.total, curr.total);
  const coreUsages = curr.cores.map((core, i) => ({
    core: i,
    usage: calcUsage(prev.cores[i] ?? core, core),
  }));
  return { total: totalUsage, cores: coreUsages };
}

async function getCpuUsage(): Promise<CpuUsage> {
  const content = await readFile('/proc/stat', 'utf-8');
  const current = parseProcStat(content);

  if (!prevCpuTimes) {
    prevCpuTimes = current;
    await new Promise((resolve) => setTimeout(resolve, 200));
    const content2 = await readFile('/proc/stat', 'utf-8');
    const next = parseProcStat(content2);
    prevCpuTimes = current;
    const result = computeCpuResult(current, next);
    prevCpuTimes = next;
    return result;
  }

  const result = computeCpuResult(prevCpuTimes, current);
  prevCpuTimes = current;
  return result;
}

function getMemory(): MemoryStats {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    used,
    free,
    percent: Math.round((used / total) * 1000) / 10,
  };
}

async function getDisk(): Promise<DiskStats[]> {
  try {
    const { stdout } = await execFileAsync('df', ['-B1', '--output=size,used,avail,pcent,target'], { timeout: 5000 });
    const lines = stdout.trim().split('\n').slice(1);
    const disks: DiskStats[] = [];
    const validMounts = ['/var/home', '/boot', '/tmp', '/'];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const mount = parts[4] ?? '';
      if (!validMounts.some((m) => mount === m)) continue;
      if (Number(parts[0]) < 1073741824) continue;
      disks.push({
        mount,
        total: Number(parts[0]),
        used: Number(parts[1]),
        avail: Number(parts[2]),
        percent: Number.parseFloat(parts[3] ?? '0'),
      });
    }
    return disks;
  } catch {
    return [];
  }
}

function getUptime(): UptimeStats {
  const upSec = os.uptime();
  const days = Math.floor(upSec / 86400);
  const hours = Math.floor((upSec % 86400) / 3600);
  const mins = Math.floor((upSec % 3600) / 60);
  const secs = Math.floor(upSec % 60);
  return {
    seconds: upSec,
    formatted: `${days}d ${hours}h ${mins}m ${secs}s`,
  };
}

async function getTopProcesses(): Promise<ProcessStats[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['aux', '--sort=-pcpu'], { timeout: 5000 });
    const lines = stdout.trim().split('\n').slice(1, 11);
    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        user: parts[0] ?? '',
        pid: Number(parts[1] ?? 0),
        cpu: Number.parseFloat(parts[2] ?? '0'),
        mem: Number.parseFloat(parts[3] ?? '0'),
        vsz: Number(parts[4] ?? 0),
        rss: Number(parts[5] ?? 0),
        command: parts.slice(10).join(' ').substring(0, 80),
      };
    });
  } catch {
    return [];
  }
}

async function getContainers(): Promise<ContainerStats[]> {
  try {
    const { stdout } = await execFileAsync('podman', ['ps', '--format', 'json'], { timeout: 10000 });
    const containers = JSON.parse(stdout || '[]') as Array<Record<string, unknown>>;
    return containers.map((c) => {
      const names = (c.Names ?? c.names) as string[] | undefined;
      const name = names?.[0]
        ?? (c.Name as string | undefined)
        ?? (c.name as string | undefined)
        ?? '';
      return {
        id: ((c.Id as string | undefined) ?? (c.id as string | undefined) ?? '').substring(0, 12),
        name,
        image: (c.Image as string | undefined) ?? (c.image as string | undefined) ?? '',
        status: (c.Status as string | undefined) ?? (c.status as string | undefined) ?? (c.State as string | undefined) ?? '',
        state: (c.State as string | undefined) ?? (c.state as string | undefined) ?? '',
        created: (c.Created as string | undefined) ?? (c.created as string | undefined) ?? (c.CreatedAt as string | undefined) ?? '',
        ports: (c.Ports as unknown[] | undefined) ?? (c.ports as unknown[] | undefined) ?? [],
      };
    });
  } catch {
    return [];
  }
}

async function getGpus(): Promise<GpuStats[]> {
  const gpus: GpuStats[] = [];
  try {
    const cards = (await readdir('/sys/class/drm')).filter((d) => /^card\d+$/.test(d));
    for (const card of cards) {
      const base = `/sys/class/drm/${card}/device`;
      try {
        const vramTotal = Number.parseInt(await readFile(`${base}/mem_info_vram_total`, 'utf-8').catch(() => '0'), 10);
        if (vramTotal < 1073741824) continue;

        const gpuBusy = Number.parseInt(await readFile(`${base}/gpu_busy_percent`, 'utf-8').catch(() => '0'), 10);
        const vramUsed = Number.parseInt(await readFile(`${base}/mem_info_vram_used`, 'utf-8').catch(() => '0'), 10);

        const temps: Record<string, number> = {};
        try {
          const hwmonDirs = await readdir(`${base}/hwmon`);
          for (const hw of hwmonDirs) {
            const hwPath = `${base}/hwmon/${hw}`;
            for (const suffix of ['edge', 'junction', 'mem']) {
              for (let i = 1; i <= 5; i += 1) {
                try {
                  const label = (await readFile(`${hwPath}/temp${i}_label`, 'utf-8')).trim();
                  if (label === suffix) {
                    const val = Number.parseInt(await readFile(`${hwPath}/temp${i}_input`, 'utf-8'), 10);
                    temps[suffix] = Math.round(val / 1000);
                  }
                } catch {
                  // skip
                }
              }
            }
            try {
              temps.fanRpm = Number.parseInt(await readFile(`${hwPath}/fan1_input`, 'utf-8'), 10);
            } catch {
              // no fan
            }
            try {
              temps.powerW = Math.round(Number.parseInt(await readFile(`${hwPath}/power1_average`, 'utf-8'), 10) / 1000000);
              temps.powerCapW = Math.round(Number.parseInt(await readFile(`${hwPath}/power1_cap`, 'utf-8'), 10) / 1000000);
            } catch {
              // no power
            }
          }
        } catch {
          // no hwmon
        }

        let sclkMhz = 0;
        let mclkMhz = 0;
        try {
          const sclk = await readFile(`${base}/pp_dpm_sclk`, 'utf-8');
          const activeS = sclk.split('\n').find((line) => line.includes('*'));
          if (activeS) sclkMhz = Number.parseInt(activeS.match(/(\d+)Mhz/)?.[1] ?? '0', 10);
        } catch {
          // no sclk
        }
        try {
          const mclk = await readFile(`${base}/pp_dpm_mclk`, 'utf-8');
          const activeM = mclk.split('\n').find((line) => line.includes('*'));
          if (activeM) mclkMhz = Number.parseInt(activeM.match(/(\d+)Mhz/)?.[1] ?? '0', 10);
        } catch {
          // no mclk
        }

        let gpuModel: string | null = null;
        try {
          const uevent = await readFile(`${base}/uevent`, 'utf-8');
          const pciSlot = uevent.match(/PCI_SLOT_NAME=(.+)/)?.[1];
          if (pciSlot) {
            const { stdout } = await execFileAsync('lspci', ['-s', pciSlot], { timeout: 3000 });
            const match = stdout.match(/\[([^\]]*(?:Radeon|GeForce|Intel|Arc)[^\]]*)\]/)
              || stdout.match(/:\s*.+?\]\s*(.+?)(?:\s*\(rev|$)/);
            if (match?.[1]) {
              gpuModel = match[1].split('/')[0]?.trim() ?? null;
            }
          }
        } catch {
          gpuModel = null;
        }

        gpus.push({
          card,
          model: gpuModel,
          busy: gpuBusy,
          vramTotal,
          vramUsed,
          vramPercent: Math.round((vramUsed / vramTotal) * 1000) / 10,
          tempEdge: temps.edge ?? null,
          tempJunction: temps.junction ?? null,
          tempMem: temps.mem ?? null,
          fanRpm: temps.fanRpm ?? null,
          powerW: temps.powerW ?? null,
          powerCapW: temps.powerCapW ?? null,
          sclkMhz,
          mclkMhz,
        });
      } catch {
        // skip card
      }
    }
  } catch {
    // no GPUs
  }
  return gpus;
}

function getLoadAvg(): LoadAvgStats {
  const loads = os.loadavg();
  return {
    '1m': Math.round(loads[0] * 100) / 100,
    '5m': Math.round(loads[1] * 100) / 100,
    '15m': Math.round(loads[2] * 100) / 100,
  };
}

async function collectSystemStats(): Promise<SystemStats> {
  const [cpu, disk, processes, containers, gpus, cpuModelName] = await Promise.all([
    getCpuUsage(),
    getDisk(),
    getTopProcesses(),
    getContainers(),
    getGpus(),
    getCpuModel(),
  ]);

  return {
    timestamp: Date.now(),
    hostname: os.hostname(),
    cpuModel: cpuModelName,
    cpu,
    memory: getMemory(),
    disk,
    gpus,
    uptime: getUptime(),
    loadAvg: getLoadAvg(),
    processes,
    containers,
  };
}

let systemDb: Database | null = null;
let systemDbPath: string | null = null;
let systemSql: SqlJsStatic | null = null;
let systemSaveTimer: NodeJS.Timeout | null = null;
let lastSystemPrune = 0;

async function initSystemDb(path: string) {
  systemDbPath = path;
  mkdirSync(dirname(path), { recursive: true });
  systemSql = await initSqlJs();

  if (existsSync(path)) {
    const fileBuffer = readFileSync(path);
    systemDb = new systemSql.Database(fileBuffer);
  } else {
    systemDb = new systemSql.Database();
  }

  systemDb.run(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      cpu_total REAL,
      mem_used INTEGER,
      mem_total INTEGER,
      mem_percent REAL,
      disk_percent REAL,
      load_1m REAL,
      load_5m REAL,
      load_15m REAL
    )
  `);

  systemDb.run(`
    CREATE TABLE IF NOT EXISTS gpu_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      card TEXT,
      busy REAL,
      vram_used INTEGER,
      vram_total INTEGER,
      vram_percent REAL,
      temp_edge REAL,
      temp_junction REAL,
      temp_mem REAL,
      power_w REAL,
      fan_rpm INTEGER,
      sclk_mhz INTEGER,
      mclk_mhz INTEGER
    )
  `);

  systemDb.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      msg_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  systemDb.run(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  systemDb.run('CREATE INDEX IF NOT EXISTS idx_chat_messages_ts ON chat_messages(timestamp)');
  systemDb.run('CREATE INDEX IF NOT EXISTS idx_gpu_metrics_ts ON gpu_metrics(timestamp)');
  systemDb.run('CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(timestamp)');

  const storedChatSessionId = loadChatSessionId();
  if (storedChatSessionId) {
    chatSessionId = storedChatSessionId;
  } else {
    persistChatSessionId(chatSessionId);
  }

  pruneSystemDb();
  saveSystemDb();

  systemSaveTimer = setInterval(saveSystemDb, 60000);
}

function saveSystemDb() {
  if (!systemDb || !systemDbPath) return;
  try {
    const data = systemDb.export();
    const buffer = Buffer.from(data);
    writeFileSync(systemDbPath, buffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('System DB save error:', msg);
  }
}

function pruneSystemDb() {
  if (!systemDb) return;
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  systemDb.run('DELETE FROM metrics WHERE timestamp < ?', [cutoff]);
  systemDb.run('DELETE FROM gpu_metrics WHERE timestamp < ?', [cutoff]);
  lastSystemPrune = Date.now();
}

function logSystemMetrics(stats: SystemStats) {
  if (!systemDb) return;

  const rootDisk = stats.disk.find((d) => d.mount === '/var/home')
    ?? stats.disk.find((d) => d.mount === '/')
    ?? stats.disk[0];
  const diskPct = rootDisk ? rootDisk.percent : 0;
  const loadAvg = stats.loadAvg ?? { '1m': 0, '5m': 0, '15m': 0 };

  systemDb.run(
    `INSERT INTO metrics (timestamp, cpu_total, mem_used, mem_total, mem_percent, disk_percent, load_1m, load_5m, load_15m)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      stats.timestamp,
      stats.cpu.total,
      stats.memory.used,
      stats.memory.total,
      stats.memory.percent,
      diskPct,
      loadAvg['1m'],
      loadAvg['5m'],
      loadAvg['15m'],
    ],
  );

  if (stats.gpus) {
    for (const gpu of stats.gpus) {
      systemDb.run(
        `INSERT INTO gpu_metrics (timestamp, card, busy, vram_used, vram_total, vram_percent, temp_edge, temp_junction, temp_mem, power_w, fan_rpm, sclk_mhz, mclk_mhz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          stats.timestamp,
          gpu.card,
          gpu.busy,
          gpu.vramUsed,
          gpu.vramTotal,
          gpu.vramPercent,
          gpu.tempEdge,
          gpu.tempJunction,
          gpu.tempMem,
          gpu.powerW,
          gpu.fanRpm,
          gpu.sclkMhz,
          gpu.mclkMhz,
        ],
      );
    }
  }

  if (!lastSystemPrune || Date.now() - lastSystemPrune > 6 * 60 * 60 * 1000) {
    pruneSystemDb();
  }
}

function mapSqlRows(results: Array<{ columns: string[]; values: Array<Array<number | string | null>> }>): SqlRow[] {
  if (!results.length) return [];
  const columns = results[0]?.columns ?? [];
  const rows = results[0]?.values ?? [];
  return rows.map((row) => {
    const obj: SqlRow = {};
    columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });
}

function getSystemHistory(minutes: number): SqlRow[] {
  if (!systemDb) return [];
  const since = Date.now() - minutes * 60 * 1000;
  const stmt = systemDb.prepare(`
    SELECT timestamp, cpu_total, mem_used, mem_total, mem_percent,
           disk_percent, load_1m, load_5m, load_15m
    FROM metrics
    WHERE timestamp > ?
    ORDER BY timestamp ASC
  `);
  stmt.bind([since]);
  const rows: SqlRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as SqlRow);
  }
  stmt.free();
  const results = rows.length > 0 ? rows : [] as SqlRow[];

  if (minutes > 60) {
    const sampled: SqlRow[] = [];
    let lastTs = 0;
    for (const row of results) {
      const ts = typeof row.timestamp === 'number' ? row.timestamp : Number(row.timestamp ?? 0);
      if (ts - lastTs >= 5 * 60 * 1000) {
        sampled.push(row);
        lastTs = ts;
      }
    }
    return sampled;
  }
  return results;
}

function getSystemGpuHistory(minutes: number, card?: string | null): SqlRow[] {
  if (!systemDb) return [];
  const since = Date.now() - minutes * 60 * 1000;
  const stmt = card
    ? systemDb.prepare(`
        SELECT timestamp, busy, vram_used, vram_total, vram_percent, temp_edge, temp_junction, power_w
        FROM gpu_metrics WHERE timestamp > ? AND card = ? ORDER BY timestamp ASC
      `)
    : systemDb.prepare(`
        SELECT timestamp, busy, vram_used, vram_total, vram_percent, temp_edge, temp_junction, power_w
        FROM gpu_metrics WHERE timestamp > ? ORDER BY timestamp ASC
      `);
  stmt.bind(card ? [since, card] : [since]);
  const rows: SqlRow[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as SqlRow);
  }
  stmt.free();
  if (minutes > 60) {
    const sampled: SqlRow[] = [];
    let lastTs = 0;
    for (const row of rows) {
      const ts = typeof row.timestamp === 'number' ? row.timestamp : Number(row.timestamp ?? 0);
      if (ts - lastTs >= 5 * 60 * 1000) {
        sampled.push(row);
        lastTs = ts;
      }
    }
    return sampled;
  }
  return rows;
}

const systemClients = new Set<WebSocket>();
const systemWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  let pathname = '';
  try {
    ({ pathname } = new URL(request.url ?? '', 'http://localhost'));
  } catch {
    socket.destroy();
    return;
  }

  if (pathname === '/ws/chat') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
    return;
  }

  if (pathname === '/ws/system') {
    systemWss.handleUpgrade(request, socket, head, (ws) => {
      systemWss.emit('connection', ws, request);
    });
    return;
  }

  socket.destroy();
});

systemWss.on('connection', (ws) => {
  systemClients.add(ws);
  collectSystemStats().then((stats) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(stats));
    }
  }).catch(() => {
    // ignore
  });
  ws.on('close', () => systemClients.delete(ws));
  ws.on('error', () => systemClients.delete(ws));
});

async function broadcastSystemStats() {
  try {
    const stats = await collectSystemStats();
    const msg = JSON.stringify(stats);
    for (const ws of systemClients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('System broadcast error:', msg);
  }
  setTimeout(broadcastSystemStats, 2000);
}

async function logSystemStats() {
  try {
    const stats = await collectSystemStats();
    logSystemMetrics(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('System log error:', msg);
  }
  setTimeout(logSystemStats, 30000);
}

app.get('/api/system/history/:period', (req, res) => {
  const { period } = req.params;
  const valid = ['1h', '24h'];
  if (!valid.includes(period)) {
    res.status(400).json({ error: 'Invalid period. Use 1h or 24h' });
    return;
  }
  const minutes = period === '1h' ? 60 : 1440;
  res.json(getSystemHistory(minutes));
});

app.get('/api/system/gpu-history/:period', (req, res) => {
  const { period } = req.params;
  const valid = ['1h', '24h'];
  if (!valid.includes(period)) {
    res.status(400).json({ error: 'Invalid period. Use 1h or 24h' });
    return;
  }
  const minutes = period === '1h' ? 60 : 1440;
  const card = typeof req.query.card === 'string' ? req.query.card : null;
  res.json(getSystemGpuHistory(minutes, card));
});

app.get('/api/vitals', async (_req, res) => {
  try {
    const [cpu, ram, disk, gpu] = await Promise.all([
      getCpuPercent(),
      getRamPercent(),
      getDiskPercent(),
      getGpuPercent(),
    ]);
    res.json({ cpu, ram, disk, gpu });
  } catch {
    res.status(500).json({ error: 'Failed to read vitals' });
  }
});

// ---- Cron API (gateway proxy) ----
app.get('/api/cron/jobs', async (_req, res) => {
  try {
    const raw = await readFile(join(process.env.HOME ?? '/home/tux', '.openclaw/cron/jobs.json'), 'utf-8');
    const data = JSON.parse(raw) as { jobs: Array<Record<string, unknown>> };
    res.json({ jobs: data.jobs ?? [] });
  } catch {
    res.status(500).json({ error: 'Failed to read cron jobs' });
  }
});

app.post('/api/cron/jobs/:id/run', async (req, res) => {
  try {
    const { stdout } = await execAsync(`openclaw cron run ${req.params.id}`);
    res.json({ ok: true, output: stdout.trim() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to run job';
    res.status(500).json({ error: msg });
  }
});

app.patch('/api/cron/jobs/:id', async (req, res) => {
  try {
    const enabled = (req.body as { enabled?: boolean }).enabled;
    const flag = enabled ? '--enable' : '--disable';
    const { stdout } = await execAsync(`openclaw cron edit ${req.params.id} ${flag}`);
    res.json({ ok: true, output: stdout.trim() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update job';
    res.status(500).json({ error: msg });
  }
});

// ---- Chat API (handled above) ----

// ---- Missions API ----

const MISSIONS_FILE = join(REPO_ROOT, 'data/missions.json');

app.get('/api/missions', async (_req, res) => {
  try {
    const raw = await readFile(MISSIONS_FILE, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.json([]);
  }
});

app.put('/api/missions', async (req, res) => {
  try {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(REPO_ROOT, 'data'), { recursive: true });
    await writeFile(MISSIONS_FILE, JSON.stringify(req.body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save' });
  }
});

// ---- Learning Log API ----
const LEARNING_LOG_FILE = join(REPO_ROOT, 'data/learning-log.json');

// mirrors src/types.ts — keep in sync
type LearningLogEntryType = 'error' | 'learning' | 'feature';
type LearningLogEntry = {
  id: string;
  type: LearningLogEntryType;
  category: string;
  text: string;
  date: string;
  source?: string;
  project?: string;
};

type LearningLogData = {
  entries: LearningLogEntry[];
};

async function loadLearningLogFile(): Promise<LearningLogData> {
  try {
    const raw = await readFile(LEARNING_LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as LearningLogData;
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries };
  } catch {
    return { entries: [] };
  }
}

async function saveLearningLogFile(data: LearningLogData): Promise<void> {
  await mkdir(join(LEARNING_LOG_FILE, '..'), { recursive: true });
  await writeFile(LEARNING_LOG_FILE, JSON.stringify(data, null, 2));
}

function isLearningLogEntryType(value: unknown): value is LearningLogEntryType {
  return value === 'error' || value === 'learning' || value === 'feature';
}

app.get('/api/learning-log', async (_req, res) => {
  try {
    const data = await loadLearningLogFile();
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to load learning log' });
  }
});

app.post('/api/learning-log', async (req, res) => {
  try {
    const body = req.body as Partial<LearningLogEntry>;
    if (!body || !isLearningLogEntryType(body.type) || typeof body.category !== 'string' || typeof body.text !== 'string') {
      res.status(400).json({ error: 'Invalid entry' });
      return;
    }
    const data = await loadLearningLogFile();
    const entry: LearningLogEntry = {
      id: crypto.randomUUID(),
      type: body.type,
      category: body.category.trim(),
      text: body.text.trim(),
      date: new Date().toISOString().slice(0, 10),
      source: typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual',
      project: typeof body.project === 'string' && body.project.trim() ? body.project.trim() : 'general',
    };
    data.entries.push(entry);
    await saveLearningLogFile(data);
    res.json(entry);
  } catch {
    res.status(500).json({ error: 'Failed to save entry' });
  }
});

// ---- Memory API ----
app.get('/api/memory', async (_req, res) => {
  try {
    const content = await readFile(join(WORKSPACE, 'MEMORY.md'), 'utf-8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

app.get('/api/memory/files', async (_req, res) => {
  try {
    const dir = join(WORKSPACE, 'memory');
    const entries = await readdir(dir);
    const files = entries.filter((f) => f.endsWith('.md')).sort().reverse();
    res.json({ files });
  } catch {
    res.json({ files: [] });
  }
});

app.get('/api/memory/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    if (filename.includes('..') || filename.includes('/')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const content = await readFile(join(WORKSPACE, 'memory', filename), 'utf-8');
    res.json({ content });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// ---- Workspace Files API (Heartbeat, Rules, Soul) ----
app.get('/api/workspace-file/:name', async (req, res) => {
  const allowed = ['HEARTBEAT.md', 'AGENTS.md', 'SOUL.md', 'CLAWCOM.md'];
  const name = req.params.name;
  if (!allowed.includes(name)) {
    res.status(400).json({ error: 'File not allowed' });
    return;
  }
  try {
    const content = await readFile(join(WORKSPACE, name), 'utf-8');
    res.json({ content });
  } catch {
    res.json({ content: '' });
  }
});

// ---- Ideas API ----
const IDEAS_FILE = join(WORKSPACE, 'projects/andys-overview/data/ideas.json');

async function loadIdeasFile(): Promise<unknown[]> {
  try {
    const raw = await readFile(IDEAS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveIdeasFile(ideas: unknown[]) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(IDEAS_FILE), { recursive: true });
  await writeFile(IDEAS_FILE, JSON.stringify(ideas, null, 2));
}

type BrainstormIdea = {
  id: string;
  title: string;
  description: string;
  techStack: string[];
  feasibility: number;
  agentName: string;
  agentModel: string;
  sessionDate: string;
  starred: boolean;
  dismissed: boolean;
  createdAt: string;
};

function buildMockIdeas(sessionDate: string): BrainstormIdea[] {
  return [
    {
      id: crypto.randomUUID(),
      title: 'GigaShift — Factory Shift Swap App',
      description: 'A mobile-first PWA for Gigafactory workers to swap shifts, claim open slots, and track overtime. Integrates with existing scheduling systems via REST API.',
      techStack: ['React', 'PWA', 'Node.js', 'SQLite', 'Tailwind'],
      feasibility: 4,
      agentName: 'Andy',
      agentModel: 'claude-opus-4',
      sessionDate,
      starred: false,
      dismissed: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: 'dotwatch — Dotfile Change Monitor',
      description: 'A Linux CLI daemon that watches your dotfiles for changes, auto-commits to a git repo, and sends desktop notifications. Never lose a config tweak again.',
      techStack: ['Rust', 'inotify', 'Git', 'D-Bus', 'systemd'],
      feasibility: 5,
      agentName: 'Andy',
      agentModel: 'claude-opus-4',
      sessionDate,
      starred: false,
      dismissed: false,
      createdAt: new Date(Date.now() + 60000).toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: 'BreakRoom — Anonymous Factory Feedback',
      description: 'An anonymous feedback board for factory floor workers to report safety issues, suggest improvements, and vote on ideas without fear of retaliation.',
      techStack: ['Next.js', 'PostgreSQL', 'Tailwind', 'Auth.js'],
      feasibility: 3,
      agentName: 'Sage',
      agentModel: 'gemini-2.5-pro',
      sessionDate,
      starred: false,
      dismissed: false,
      createdAt: new Date(Date.now() + 120000).toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: 'pkgscope — Dependency Audit Dashboard',
      description: 'A self-hosted web dashboard that scans your projects for outdated or vulnerable npm/cargo/pip dependencies and shows a unified risk score with auto-PR capabilities.',
      techStack: ['Go', 'React', 'Docker', 'GitHub API'],
      feasibility: 4,
      agentName: 'Sage',
      agentModel: 'gemini-2.5-pro',
      sessionDate,
      starred: false,
      dismissed: false,
      createdAt: new Date(Date.now() + 180000).toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: 'TermPal — AI Terminal Companion',
      description: 'A lightweight terminal sidebar that watches your shell commands and proactively suggests fixes, alternatives, and documentation links using local LLMs via Ollama.',
      techStack: ['Python', 'Ollama', 'Rich', 'tmux'],
      feasibility: 3,
      agentName: 'Andy',
      agentModel: 'claude-opus-4',
      sessionDate,
      starred: false,
      dismissed: false,
      createdAt: new Date(Date.now() + 240000).toISOString(),
    },
  ];
}

function normalizeIdeas(rawIdeas: unknown[], sessionDate: string): BrainstormIdea[] {
  return rawIdeas.map((idea, idx) => {
    const record = (idea ?? {}) as Record<string, unknown>;
    const createdAt = typeof record.createdAt === 'string'
      ? record.createdAt
      : new Date(Date.now() + idx * 60000).toISOString();
    return {
      id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
      title: typeof record.title === 'string' ? record.title : `Untitled Idea ${idx + 1}`,
      description: typeof record.description === 'string' ? record.description : 'No description provided.',
      techStack: Array.isArray(record.techStack)
        ? record.techStack.map((t) => String(t))
        : [],
      feasibility: typeof record.feasibility === 'number' ? Math.max(1, Math.min(5, Math.round(record.feasibility))) : 3,
      agentName: typeof record.agentName === 'string' ? record.agentName : 'Creative',
      agentModel: typeof record.agentModel === 'string' ? record.agentModel : 'qwen3:8b',
      sessionDate: typeof record.sessionDate === 'string' ? record.sessionDate : sessionDate,
      starred: typeof record.starred === 'boolean' ? record.starred : false,
      dismissed: typeof record.dismissed === 'boolean' ? record.dismissed : false,
      createdAt,
    };
  });
}

function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function generateIdeasWithOllama(sessionDate: string): Promise<BrainstormIdea[] | null> {
  const prompt = [
    'Generate 5 app ideas as JSON only.',
    'Return a JSON array of 5 objects with fields:',
    'id, title, description, techStack (array of strings), feasibility (1-5), agentName, agentModel, sessionDate, starred, dismissed, createdAt.',
    `Set sessionDate to "${sessionDate}". Set starred and dismissed to false.`,
    'No extra text. JSON only.',
  ].join(' ');

  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3:8b',
      prompt,
      stream: false,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { response?: string };
  const text = typeof data.response === 'string' ? data.response : '';
  const parsed = extractJsonArray(text);
  if (!parsed) return null;
  return normalizeIdeas(parsed, sessionDate);
}

app.get('/api/ideas', async (_req, res) => {
  try {
    const ideas = await loadIdeasFile();
    res.json(ideas);
  } catch {
    res.status(500).json({ error: 'Failed to load ideas' });
  }
});

app.post('/api/ideas', async (req, res) => {
  try {
    const ideas = await loadIdeasFile();
    const idea = req.body;
    if (!idea || !idea.id) {
      res.status(400).json({ error: 'Invalid idea' });
      return;
    }
    ideas.push(idea);
    await saveIdeasFile(ideas);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save idea' });
  }
});

app.patch('/api/ideas/:id', async (req, res) => {
  try {
    const ideas = await loadIdeasFile() as Record<string, unknown>[];
    const idx = ideas.findIndex((i) => i.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Idea not found' });
      return;
    }
    Object.assign(ideas[idx]!, req.body);
    await saveIdeasFile(ideas);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

app.post('/api/creative-time', async (_req, res) => {
  const sessionDate = new Date().toISOString();
  let ideas: BrainstormIdea[] | null = null;
  try {
    ideas = await generateIdeasWithOllama(sessionDate);
  } catch {
    ideas = null;
  }
  const finalIdeas = ideas ?? buildMockIdeas(sessionDate);

  // Also persist to file
  try {
    const existing = await loadIdeasFile();
    await saveIdeasFile([...existing, ...finalIdeas]);
  } catch { /* best effort */ }

  res.json(finalIdeas);
});

// ---- Git API ----
app.get('/api/git/status', async (_req, res) => {
  try {
    const { stdout } = await execAsync('git status --porcelain', { cwd: REPO_ROOT });
    const entries = stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean);
    res.json({ entries, raw: stdout });
  } catch (err) {
    res.status(500).json({ error: formatExecError(err) });
  }
});

app.post('/api/git/pull', async (_req, res) => {
  try {
    const { stdout, stderr } = await execAsync('git pull', {
      cwd: REPO_ROOT,
      env: { ...process.env, GIT_SSH_COMMAND: 'ssh -i ~/.ssh/id_ed25519_andy' },
    });
    res.json({ ok: true, output: `${stdout}${stderr ?? ''}`.trim() });
  } catch (err) {
    res.status(500).json({ error: formatExecError(err) });
  }
});

app.post('/api/git/push', async (_req, res) => {
  try {
    const { stdout, stderr } = await execAsync('git push', {
      cwd: REPO_ROOT,
      env: { ...process.env, GIT_SSH_COMMAND: 'ssh -i ~/.ssh/id_ed25519_andy' },
    });
    res.json({ ok: true, output: `${stdout}${stderr ?? ''}`.trim() });
  } catch (err) {
    res.status(500).json({ error: formatExecError(err) });
  }
});

app.post('/api/git/commit', async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message || typeof message !== 'string' || !message.trim()) {
    res.status(400).json({ error: 'Commit message required' });
    return;
  }
  try {
    await execAsync('git add -A', { cwd: REPO_ROOT });
    const { stdout, stderr } = await execAsync(`git commit -m ${JSON.stringify(message)}`, { cwd: REPO_ROOT });
    res.json({ ok: true, output: `${stdout}${stderr ?? ''}`.trim() });
  } catch (err) {
    res.status(500).json({ error: formatExecError(err) });
  }
});

// ---- Calendar Events API ----
const EVENTS_FILE = join(WORKSPACE, 'projects/andys-overview/data/events.json');

async function loadEventsFile(): Promise<unknown[]> {
  try {
    const raw = await readFile(EVENTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveEventsFile(events: unknown[]) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(EVENTS_FILE), { recursive: true });
  await writeFile(EVENTS_FILE, JSON.stringify(events, null, 2));
}

app.get('/api/calendar/events', async (_req, res) => {
  try {
    const events = await loadEventsFile();
    res.json(events);
  } catch {
    res.status(500).json({ error: 'Failed to load events' });
  }
});

app.post('/api/calendar/events', async (req, res) => {
  try {
    const events = await loadEventsFile();
    const event = req.body;
    if (!event || !event.id || !event.title || !event.date) {
      res.status(400).json({ error: 'Invalid event' });
      return;
    }
    events.push(event);
    await saveEventsFile(events);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save event' });
  }
});

app.delete('/api/calendar/events/:id', async (req, res) => {
  try {
    const events = await loadEventsFile() as Record<string, unknown>[];
    const filtered = events.filter((e) => e.id !== req.params.id);
    if (filtered.length === events.length) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    await saveEventsFile(filtered);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// ---- Packages API ----
type PackageStatus = 'current' | 'outdated' | 'missing' | 'beta';

interface PkgInfo {
  name: string;
  rawhide: string;
  stable: string;
  status: PackageStatus;
}

interface PkgGroup {
  name: string;
  packages: PkgInfo[];
}

interface PkgCache {
  groups: PkgGroup[];
  lastUpdated: string;
}

let pkgCache: PkgCache | null = null;
let pkgCacheTime = 0;
const PKG_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const BUILD_SH_URL = 'https://raw.githubusercontent.com/eosdev-x/TuxLinux/main/build_files/build.sh';
const MDAPI_BASE = 'https://mdapi.fedoraproject.org';

function parseBuildSh(script: string): PkgGroup[] {
  const groups: PkgGroup[] = [];
  const lines = script.split('\n');
  let currentGroup = 'Ungrouped';
  const dnfPackages = new Map<string, string[]>();

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect comment headers like "# Terminal & shell" or "## Editor"
    const commentMatch = trimmed.match(/^#+\s+(.+)/);
    if (commentMatch && !trimmed.includes('!/') && !trimmed.includes('set ')) {
      currentGroup = commentMatch[1]!.trim();
      continue;
    }

    // Detect dnf5 install lines
    if (trimmed.includes('dnf5') && trimmed.includes('install')) {
      // Extract package names — everything after "install -y" or "install"
      const afterInstall = trimmed.replace(/.*install\s+(-y\s+)?/, '').replace(/\\$/, '').trim();
      const pkgs = afterInstall.split(/\s+/).filter(p => p && !p.startsWith('-') && !p.startsWith('#'));
      for (const pkg of pkgs) {
        if (!dnfPackages.has(currentGroup)) {
          dnfPackages.set(currentGroup, []);
        }
        dnfPackages.get(currentGroup)!.push(pkg);
      }
      continue;
    }

    // Continuation lines (after backslash) — detect by checking if previous context was dnf
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('dnf') && !trimmed.includes('=')
        && !trimmed.startsWith('if') && !trimmed.startsWith('fi') && !trimmed.startsWith('then')
        && !trimmed.startsWith('echo') && !trimmed.startsWith('curl') && !trimmed.startsWith('sudo')
        && !trimmed.startsWith('rpm') && !trimmed.startsWith('cat') && !trimmed.startsWith('source')
        && !trimmed.startsWith('export') && !trimmed.startsWith('mkdir') && !trimmed.startsWith('cp')
        && !trimmed.startsWith('chmod') && !trimmed.startsWith('chown') && !trimmed.startsWith('ln')
        && !trimmed.startsWith('systemctl') && !trimmed.startsWith('usermod')
        && !trimmed.startsWith('[') && !trimmed.startsWith('done') && !trimmed.startsWith('for')
        && !trimmed.startsWith('do') && !trimmed.startsWith('EOF') && !trimmed.startsWith('copr')
        && dnfPackages.has(currentGroup)) {
      // Might be continuation of a dnf install line
      const pkgs = trimmed.replace(/\\$/, '').split(/\s+/).filter(p => p && !p.startsWith('-') && !p.startsWith('#'));
      if (pkgs.length > 0 && pkgs.every(p => /^[@a-zA-Z0-9]/.test(p))) {
        dnfPackages.get(currentGroup)!.push(...pkgs);
      }
    }
  }

  // Build groups
  for (const [groupName, pkgs] of dnfPackages) {
    if (pkgs.length === 0) continue;
    const uniquePkgs = [...new Set(pkgs)].filter(name => !name.startsWith('@'));
    if (uniquePkgs.length === 0) continue;
    groups.push({
      name: groupName,
      packages: uniquePkgs.map(name => ({
        name,
        rawhide: '--',
        stable: '--',
        status: 'missing' as PackageStatus,
      })),
    });
  }

  // Add non-DNF packages group
  groups.push({
    name: 'Non-DNF Packages',
    packages: [
      { name: 'starship', rawhide: '--', stable: '--', status: 'missing' as PackageStatus },
      { name: 'lazygit', rawhide: '--', stable: '--', status: 'missing' as PackageStatus },
    ],
  });

  return groups;
}

const versionCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function determineStatus(rawhide: string, stable: string): PackageStatus {
  if (rawhide === '--' || stable === '--') return 'missing';
  const preRelease = /alpha|beta|rc|dev|pre/i;
  if (preRelease.test(rawhide) || preRelease.test(stable)) return 'beta';
  if (rawhide === stable) return 'current';
  const comparison = versionCollator.compare(rawhide, stable);
  if (comparison > 0) return 'outdated';
  return 'current';
}

async function fetchPkgVersion(name: string, repo: string): Promise<string> {
  // Skip group packages (start with @)
  if (name.startsWith('@')) return '--';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${MDAPI_BASE}/${repo}/pkg/${name}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return '--';
    const data = await res.json() as { version?: string; release?: string };
    return data.version ?? '--';
  } catch {
    return '--';
  }
}

async function fetchAllPackages(): Promise<PkgCache> {
  // Fetch build.sh
  let script: string;
  try {
    const res = await fetch(BUILD_SH_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    script = await res.text();
  } catch {
    // Fallback: return empty with error note
    return { groups: [], lastUpdated: new Date().toISOString() };
  }

  const groups = parseBuildSh(script);

  // Fetch versions for all packages (with concurrency limit)
  const allPkgs = groups.flatMap(g => g.packages);
  const BATCH_SIZE = 10;

  for (let i = 0; i < allPkgs.length; i += BATCH_SIZE) {
    const batch = allPkgs.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (pkg) => {
      const [rawhide, stable] = await Promise.all([
        fetchPkgVersion(pkg.name, 'rawhide'),
        fetchPkgVersion(pkg.name, 'f43'),
      ]);
      pkg.rawhide = rawhide;
      pkg.stable = stable;
      pkg.status = determineStatus(rawhide, stable);
    }));
  }

  return {
    groups,
    lastUpdated: new Date().toISOString(),
  };
}

app.get('/api/packages', async (_req, res) => {
  try {
    const now = Date.now();
    if (pkgCache && (now - pkgCacheTime) < PKG_CACHE_TTL) {
      res.json(pkgCache);
      return;
    }
    const data = await fetchAllPackages();
    pkgCache = data;
    pkgCacheTime = now;
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch packages';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/packages/refresh', async (_req, res) => {
  try {
    const data = await fetchAllPackages();
    pkgCache = data;
    pkgCacheTime = Date.now();
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to refresh packages';
    res.status(500).json({ error: msg });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---- Serve production build ----
const DIST_DIR = join(REPO_ROOT, 'dist');
app.use(express.static(DIST_DIR));
// SPA fallback — serve index.html for non-API routes
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(DIST_DIR, 'index.html'));
});

async function startSystemMonitor() {
  try {
    await initSystemDb(join(REPO_ROOT, 'data', 'metrics.db'));
    broadcastSystemStats();
    logSystemStats();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('System monitor init error:', msg);
  }
}

startSystemMonitor();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Andy's Overview running on http://0.0.0.0:${PORT}`);
});
