import { useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { useTheme } from './hooks/useTheme';
import { TabBar } from './components/TabBar';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { VitalsBar } from './components/VitalsBar';
import { MissionBoard } from './components/MissionBoard';
import { IdeaBoard } from './components/IdeaBoard';
import { CalendarView } from './components/CalendarView';
import type { TabId } from './types';

export default function App() {
  useTheme(); // Initialize theme on mount
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [selectedAgent, setSelectedAgent] = useState('andy-main');

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
        <Header />
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex-1 flex min-h-0">
          <Sidebar selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} />
          <main className="flex-1 flex flex-col min-h-0">
            {activeTab === 'chat' && <ChatView />}
            {activeTab === 'missions' && <MissionBoard />}
            {activeTab === 'ideas' && <IdeaBoard />}
            {activeTab === 'calendar' && <CalendarView />}
          </main>
        </div>
        <VitalsBar />
      </div>
    </ErrorBoundary>
  );
}
