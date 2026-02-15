import { useState } from 'react';
import { Cpu, MemoryStick, HardDrive, MonitorSpeaker, Activity, ListTodo, Minimize2, Users, Brain, BarChart3, GitBranch } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useVitals } from '../hooks/useVitals';
import { CronManager } from './CronManager';
import { MemoryViewer } from './MemoryViewer';
import { GitPanel } from './GitPanel';

interface VitalProps {
  icon: LucideIcon;
  label: string;
  value: number;
  color: string;
}

function Vital({ icon: Icon, label, value, color }: VitalProps) {
  return (
    <div className="flex items-center gap-2" role="meter" aria-label={`${label}: ${value}%`} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <Icon size={12} style={{ color }} aria-hidden="true" />
      <span className="vital-label text-xs">{label}</span>
      <div className="vital-track w-16 h-1.5 rounded-full overflow-hidden">
        <div className="vital-fill h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="vital-value text-xs font-mono w-8">{value}%</span>
    </div>
  );
}

type PanelId = 'cron' | 'memory' | 'git' | null;

interface ActionDef {
  icon: LucideIcon;
  label: string;
  panelId?: PanelId;
}

const actions: ActionDef[] = [
  { icon: Activity, label: 'Status', panelId: 'cron' },
  { icon: ListTodo, label: 'Tasks' },
  { icon: Minimize2, label: 'Compact' },
  { icon: Users, label: 'Agents' },
  { icon: Brain, label: 'Memory', panelId: 'memory' },
  { icon: GitBranch, label: 'Git', panelId: 'git' },
  { icon: BarChart3, label: 'Metrics' },
];

export function VitalsBar() {
  const vitals = useVitals();
  const [activePanel, setActivePanel] = useState<PanelId>(null);

  const handleAction = (panelId?: PanelId) => {
    if (panelId) setActivePanel((prev) => (prev === panelId ? null : panelId));
  };

  return (
    <>
      <CronManager open={activePanel === 'cron'} onClose={() => setActivePanel(null)} />
      <MemoryViewer open={activePanel === 'memory'} onClose={() => setActivePanel(null)} />
      <GitPanel open={activePanel === 'git'} onClose={() => setActivePanel(null)} />

      <footer className="vitals-bar border-t" role="contentinfo" aria-label="System vitals">
        {/* Action buttons */}
        <div className="vitals-actions flex items-center gap-1 px-4 py-2 border-b">
          {actions.map(({ icon: Icon, label, panelId }) => (
            <button
              key={label}
              className={`vitals-action-btn flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs cursor-pointer ${activePanel === panelId ? 'vitals-action-btn--active' : ''}`}
              aria-label={label}
              aria-pressed={activePanel === panelId}
              onClick={() => handleAction(panelId as PanelId)}
            >
              <Icon size={12} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {/* Vitals */}
        <div className="vitals-meters flex items-center justify-between px-5 py-2">
          <div className="flex items-center gap-6">
            <Vital icon={Cpu} label="CPU" value={vitals.cpu} color="var(--accent)" />
            <Vital icon={MemoryStick} label="RAM" value={vitals.ram} color="var(--purple)" />
            <Vital icon={HardDrive} label="Disk" value={vitals.disk} color="var(--green)" />
            <Vital icon={MonitorSpeaker} label="GPU" value={vitals.gpu} color="var(--yellow)" />
          </div>
          <div className="vitals-summary flex items-center gap-4 text-xs">
            <span><span className="status-green">●</span> 1 active</span>
            <span><span className="status-yellow">●</span> 1 idle</span>
            <span>● 1 dormant</span>
          </div>
        </div>
      </footer>
    </>
  );
}
