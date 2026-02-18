import { MessageSquare, Target, Lightbulb, Calendar } from 'lucide-react';
import type { TabId } from '../types';

const tabs: { id: TabId; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'missions', label: 'Missions', icon: Target },
  { id: 'ideas', label: 'Ideas', icon: Lightbulb },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
];

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav" role="tablist" aria-label="Main navigation">
      {tabs.map(({ id, label, icon: Icon }) => {
        const active = id === activeTab;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => onTabChange(id)}
            className={`bottom-nav__item ${active ? 'bottom-nav__item--active' : ''}`}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="bottom-nav__label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
