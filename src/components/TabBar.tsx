import { MessageSquare, Target, Lightbulb, Calendar } from 'lucide-react';
import type { TabId } from '../types';

const tabs: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'missions', label: 'Mission Board', icon: Target },
  { id: 'ideas', label: 'Idea Board', icon: Lightbulb },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <nav className="tabbar flex gap-1 px-4 py-2 border-b" role="tablist" aria-label="Main navigation">
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
