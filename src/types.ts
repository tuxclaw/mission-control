export type AgentStatus = 'active' | 'idle' | 'dormant';

export interface Agent {
  id: string;
  name: string;
  model: string;
  status: AgentStatus;
  role: string;
  sessionAge?: string;
  avatar?: string;
  task?: string | null;
  project?: string | null;
  startedAt?: string | null;
  elapsed?: string | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  agentId?: string;
  isStreaming?: boolean;
}

export interface SystemVitals {
  cpu: number;
  ram: { used: number; total: number; percent: number };
  disk: { used: string; total: string; percent: number };
  gpu: { available: boolean; model?: string; vram?: number } | null;
}

export interface SystemCpuCore {
  core: number;
  usage: number;
}

export interface SystemCpu {
  total: number;
  cores: SystemCpuCore[];
}

export interface SystemMemory {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface SystemDisk {
  mount: string;
  total: number;
  used: number;
  avail: number;
  percent: number;
}

export interface SystemGpu {
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

export interface SystemLoadAvg {
  '1m': number;
  '5m': number;
  '15m': number;
}

export interface SystemUptime {
  seconds: number;
  formatted: string;
}

export interface SystemProcess {
  user: string;
  pid: number;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  command: string;
}

export interface SystemContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: string;
  ports: unknown[];
}

export interface SystemStats {
  timestamp: number;
  hostname: string;
  cpuModel: string | null;
  cpu: SystemCpu;
  memory: SystemMemory;
  disk: SystemDisk[];
  gpus: SystemGpu[];
  uptime: SystemUptime;
  loadAvg: SystemLoadAvg;
  processes: SystemProcess[];
  containers: SystemContainer[];
}

export interface SystemHistoryPoint {
  timestamp: number;
  cpu_total: number;
  mem_used: number;
  mem_total: number;
  mem_percent: number;
  disk_percent: number;
  load_1m: number;
  load_5m: number;
  load_15m: number;
}

export interface SystemGpuHistoryPoint {
  timestamp: number;
  busy: number;
  vram_used: number;
  vram_total: number;
  vram_percent: number;
  temp_edge: number | null;
  temp_junction: number | null;
  power_w: number | null;
}

export interface VitalsSimple {
  cpu: number;
  ram: number;
  disk: number;
  gpu: number;
}

export type TabId = 'chat' | 'system' | 'missions' | 'ideas' | 'calendar' | 'packages' | 'learning-log';

export type PackageStatus = 'current' | 'outdated' | 'missing' | 'beta';

export interface PackageInfo {
  name: string;
  rawhide: string;
  stable: string;
  status: PackageStatus;
}

export interface PackageGroup {
  name: string;
  packages: PackageInfo[];
}

export interface PackagesData {
  groups: PackageGroup[];
  lastUpdated: string;
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr?: string; everyMs?: number; tz?: string };
  payload: { kind: string; message?: string; model?: string; timeoutSeconds?: number };
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
  };
}

export interface AgentSession {
  id: string;
  name: string;
  model: string;
  status: AgentStatus;
  role: string;
  sessionAge?: string;
  channel?: string;
}

export type MissionStatus = 'todo' | 'in-progress' | 'done';
export type MissionPriority = 'high' | 'medium' | 'low';

export interface Mission {
  id: string;
  title: string;
  description: string;
  priority: MissionPriority;
  status: MissionStatus;
  assignedAgentId: string;
  assignedAgentName: string;
  createdAt: string;
}

export interface Idea {
  id: string;
  title: string;
  createdAt: string;
  reviewed: boolean;
  converted?: boolean;
}

export interface BrainstormIdea {
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
}

export type IdeaFilter = 'all' | 'starred' | string;

export type CalendarEventColor = 'accent' | 'green' | 'yellow' | 'red' | 'purple';
export type CalendarEventSource = 'manual' | 'cron' | 'mission';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  description?: string;
  color: CalendarEventColor;
  source: CalendarEventSource;
}

export type LearningLogEntryType = 'error' | 'learning' | 'feature';

export interface LearningLogEntry {
  id: string;
  type: LearningLogEntryType;
  category: string;
  text: string;
  date: string;
  source?: string;
  project?: string;
}
