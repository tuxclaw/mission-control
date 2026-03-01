import { MessageSquare, Target, Lightbulb, Calendar, Package, PanelLeftClose, PanelLeftOpen, BookOpen, Monitor } from 'lucide-react';
import type { TabId } from '../types';

const tabs: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'missions', label: 'Mission Board', icon: Target },
  { id: 'ideas', label: 'Idea Board', icon: Lightbulb },
  { id: 'learning-log', label: 'Learning Log', icon: BookOpen },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'packages', label: 'Packages', icon: Package },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TabBar({ activeTab, onTabChange, sidebarOpen, onToggleSidebar }: TabBarProps) {
  return (
    <nav className="tabbar flex gap-1 px-4 py-2 border-b" role="tablist" aria-label="Main navigation">
      <button
        type="button"
        className="sidebar-toggle-btn tab-btn flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={sidebarOpen}
      >
        {sidebarOpen ? <PanelLeftClose size={14} aria-hidden="true" /> : <PanelLeftOpen size={14} aria-hidden="true" />}
      </button>
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = id === activeTab;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${id}`}
            onClick={() => onTabChange(id)}
            className={`tab-btn flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer ${active ? 'tab-btn--active' : ''}`}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
