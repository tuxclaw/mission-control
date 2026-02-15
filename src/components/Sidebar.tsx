import { memo } from 'react';
import { Bot, ChevronRight } from 'lucide-react';
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
  return (
    <button
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(agent.id)}
      className={`agent-btn w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left cursor-pointer ${selected ? 'agent-btn--selected' : ''}`}
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
        <div className="agent-role text-xs mt-0.5">
          {agent.role}
          {agent.sessionAge && <span> · {agent.sessionAge}</span>}
        </div>
      </div>

      {selected && <ChevronRight size={14} className="status-muted" aria-hidden="true" />}
    </button>
  );
});

interface SidebarProps {
  selectedAgent: string;
  onSelectAgent: (id: string) => void;
}

export function Sidebar({ selectedAgent, onSelectAgent }: SidebarProps) {
  const { agents } = useAgents();
  const activeCount = agents.filter(a => a.status === 'active').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;
  const dormantCount = agents.filter(a => a.status === 'dormant').length;

  return (
    <aside className="sidebar w-64 flex flex-col border-r overflow-hidden" role="complementary" aria-label="Agent list">
      <div className="sidebar__header px-4 py-3 border-b flex items-center justify-between">
        <span className="sidebar__label text-xs font-semibold uppercase tracking-wider">Agents</span>
        <span className="sidebar__count text-xs px-2 py-0.5 rounded-full">{activeCount} active</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1" role="listbox" aria-label="Agent sessions">
        {agents.map((agent: Agent) => (
          <AgentItem
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedAgent}
            onSelect={onSelectAgent}
          />
        ))}
      </div>

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
