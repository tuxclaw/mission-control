import { memo, useState } from 'react';
import { Bot, ChevronRight, ChevronDown, X } from 'lucide-react';
import type { Agent, AgentStatus } from '../types';
import { useAgents } from '../hooks/useAgents';

const statusColorClass: Record<AgentStatus, string> = {
  active: 'status-green',
  idle: 'status-yellow',
  dormant: 'status-muted',
};

const statusBgMap: Record<AgentStatus, string> = {
  active: 'var(--green)',
  idle: 'var(--yellow)',
  dormant: 'var(--text-muted)',
};

interface AgentItemProps {
  agent: Agent;
  selected: boolean;
  onSelect: (id: string) => void;
}

const AgentItem = memo(function AgentItem({ agent, selected, onSelect }: AgentItemProps) {
  const isWorking = agent.status === 'active' && agent.task;

  return (
    <button
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(agent.id)}
      className={`agent-btn w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left cursor-pointer ${selected ? 'agent-btn--selected' : ''} ${agent.status === 'active' ? 'agent-btn--active' : ''}`}
    >
      <div className="relative">
        <div className={`agent-avatar w-9 h-9 rounded-lg flex items-center justify-center ${agent.status === 'active' ? 'agent-avatar--active' : 'agent-avatar--inactive'}`}>
          <Bot size={16} aria-hidden="true" />
        </div>
        <div
          className={`agent-status-dot absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${agent.status === 'active' ? 'pulse-active' : ''}`}
          style={{ background: statusBgMap[agent.status] }}
          aria-label={`Status: ${agent.status}`}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{agent.name}</span>
          <span className="agent-model-badge text-[10px] px-1.5 py-0.5 rounded font-mono">{agent.model}</span>
        </div>
        {isWorking ? (
          <div className="agent-task text-xs mt-0.5">
            <span className="agent-task__label truncate" title={agent.task ?? ''}>{agent.task}</span>
            {agent.project && <span className="agent-task__project"> · {agent.project}</span>}
            {agent.elapsed && <span className="agent-task__elapsed"> · {agent.elapsed}</span>}
          </div>
        ) : (
          <div className="agent-role text-xs mt-0.5">
            {agent.role}
            {agent.sessionAge && <span> · {agent.sessionAge}</span>}
          </div>
        )}
      </div>

      {selected && <ChevronRight size={14} className="status-muted" aria-hidden="true" />}
    </button>
  );
});

interface AgentGroupProps {
  label: string;
  agents: Agent[];
  count: number;
  selectedAgent: string;
  onSelectAgent: (id: string) => void;
  defaultOpen: boolean;
  statusColor: string;
}

function AgentGroup({ label, agents, count, selectedAgent, onSelectAgent, defaultOpen, statusColor }: AgentGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <div className="agent-group">
      <button
        onClick={() => setOpen(o => !o)}
        className="agent-group__header w-full flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider cursor-pointer hover:opacity-80"
        aria-expanded={open}
        aria-label={`${label} agents, ${count}`}
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{label}</span>
        </div>
        <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ color: statusColor }}>{count}</span>
      </button>
      {open && (
        <div className="px-2 pb-1 flex flex-col gap-1" role="listbox" aria-label={`${label} agent sessions`}>
          {agents.map((agent: Agent) => (
            <AgentItem key={agent.id} agent={agent} selected={agent.id === selectedAgent} onSelect={onSelectAgent} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  selectedAgent: string;
  onSelectAgent: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ selectedAgent, onSelectAgent, collapsed, onToggle }: SidebarProps) {
  const { agents } = useAgents();
  const activeCount = agents.filter(a => a.status === 'active').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;
  const dormantCount = agents.filter(a => a.status === 'dormant').length;

  if (collapsed) {
    return (
      <aside
        className="sidebar sidebar--collapsed flex flex-col items-center border-r cursor-pointer"
        role="complementary"
        aria-label="Agent list (collapsed)"
        onClick={onToggle}
        title="Expand agents"
      >
        <div className="py-3 px-1">
          <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
        </div>
        {agents.filter(a => a.status === 'active').map(agent => (
          <div
            key={agent.id}
            className="agent-avatar--collapsed w-8 h-8 rounded-lg flex items-center justify-center my-1"
            title={agent.name}
            style={{ background: 'var(--bg-tertiary)' }}
          >
            <Bot size={14} style={{ color: 'var(--accent-primary)' }} />
          </div>
        ))}
      </aside>
    );
  }

  return (
    <aside className="sidebar w-64 flex flex-col border-r overflow-hidden" role="complementary" aria-label="Agent list">
      <div className="sidebar__header px-4 py-3 border-b flex items-center justify-between">
        <span className="sidebar__label text-xs font-semibold uppercase tracking-wider">Agents</span>
        <button
          onClick={onToggle}
          className="sidebar__close-btn p-1.5 rounded-lg cursor-pointer"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          style={{ color: 'var(--text-muted)' }}
        >
          <X size={16} />
        </button>
      </div>
      <AgentGroup
        label="Active"
        agents={agents.filter(a => a.status === 'active')}
        count={activeCount}
        selectedAgent={selectedAgent}
        onSelectAgent={onSelectAgent}
        defaultOpen={true}
        statusColor="var(--green)"
      />
      <AgentGroup
        label="Idle"
        agents={agents.filter(a => a.status === 'idle')}
        count={idleCount}
        selectedAgent={selectedAgent}
        onSelectAgent={onSelectAgent}
        defaultOpen={true}
        statusColor="var(--yellow)"
      />
      <AgentGroup
        label="Dormant"
        agents={agents.filter(a => a.status === 'dormant')}
        count={dormantCount}
        selectedAgent={selectedAgent}
        onSelectAgent={onSelectAgent}
        defaultOpen={false}
        statusColor="var(--text-muted)"
      />

      <div className="sidebar__footer p-3 border-t">
        <div className="flex justify-between text-xs">
          <span>Sessions</span>
          <div className="flex gap-3">
            <span className={statusColorClass.active}>● {activeCount}</span>
            <span className={statusColorClass.idle}>● {idleCount}</span>
            <span>● {dormantCount}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
