import express from 'express';
import cors from 'cors';
import { readFile, readdir } from 'node:fs/promises';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

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
      const match = stdout.match(/(?:primary|current|active)\s*:\s*([^\s]+)/i);
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

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body as { message?: string };
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Missing message field' });
      return;
    }

    const { stdout } = await execFileAsync(
      'openclaw',
      ['agent', '--session-id', 'andys-overview-chat', '--json', '-m', message],
      { timeout: 60000 },
    );

    let content = '(no response)';
    try {
      const parsed = JSON.parse(stdout) as Record<string, unknown>;
      // Try result.payloads[0].text
      const result = parsed.result as Record<string, unknown> | undefined;
      const payloads = result?.payloads as Array<Record<string, unknown>> | undefined;
      if (payloads?.[0]?.text && typeof payloads[0].text === 'string') {
        content = payloads[0].text;
      } else if (typeof parsed.text === 'string') {
        content = parsed.text;
      } else if (typeof parsed.content === 'string') {
        content = parsed.content;
      } else if (typeof result?.text === 'string') {
        content = result.text as string;
      } else {
        content = stdout.trim() || '(no response)';
      }
    } catch {
      content = stdout.trim() || '(no response)';
    }

    res.json({ content, usage: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Chat failed';
    res.status(500).json({ error: msg });
  }
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
    await execFileAsync('openclaw', ['models', 'set', model], { timeout: 15000 });
    const current = await getPrimaryModel();
    res.json({ ok: true, model: current ?? model });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to set model';
    res.status(500).json({ error: msg });
  }
});

// ---- WebSocket chat streaming ----
const wss = new WebSocketServer({ server, path: '/ws/chat' });

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
    abortController = new AbortController();

    try {
      const upstream = await fetch(`${GATEWAY_URL}/api/sessions/main/message`, {
        method: 'POST',
        headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message, stream: true }),
        signal: abortController.signal,
      });

      if (!upstream.ok) {
        const body = await upstream.text().catch(() => '');
        sendWs(ws, {
          type: 'error',
          message: `Gateway error ${upstream.status}${body ? `: ${body}` : ''}`,
        });
        sendWs(ws, { type: 'done' });
        return;
      }

      await handleGatewayStream(ws, upstream);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WebSocket proxy error';
      sendWs(ws, { type: 'error', message: msg });
      sendWs(ws, { type: 'done' });
    } finally {
      inFlight = false;
      abortController = null;
    }
  });
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
  const allowed = ['HEARTBEAT.md', 'AGENTS.md', 'SOUL.md'];
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Andy's Overview running on http://0.0.0.0:${PORT}`);
});
