export type AgentStatus = 'active' | 'idle' | 'dormant';

export interface Agent {
  id: string;
  name: string;
  model: string;
  status: AgentStatus;
  role: string;
  sessionAge?: string;
  avatar?: string;
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

export interface VitalsSimple {
  cpu: number;
  ram: number;
  disk: number;
  gpu: number;
}

export type TabId = 'chat' | 'missions' | 'ideas' | 'calendar';

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
