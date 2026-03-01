import { useState, useCallback } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { useTheme } from './hooks/useTheme';
import { TabBar } from './components/TabBar';
import { BottomNav } from './components/BottomNav';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/ChatView';
import { VitalsBar } from './components/VitalsBar';
import { MissionBoard } from './components/MissionBoard';
import { IdeaBoard } from './components/IdeaBoard';
import { CalendarView } from './components/CalendarView';
import { PackagesView } from './components/PackagesView';
import { LearningLog } from './components/LearningLog';
import type { TabId } from './types';

export default function App() {
  useTheme();
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [selectedAgent, setSelectedAgent] = useState('andy-main');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);

  return (
    <ErrorBoundary>
      <div className="app-shell h-screen flex flex-col">
        <Header onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} />
        <TabBar activeTab={activeTab} onTabChange={setActiveTab} sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
        <div className="flex-1 flex min-h-0">
          {sidebarOpen && <Sidebar selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} collapsed={false} onToggle={toggleSidebar} />}
          <main className="flex-1 flex flex-col min-h-0">
            {activeTab === 'chat' && <ChatView />}
            {activeTab === 'missions' && <MissionBoard />}
            {activeTab === 'ideas' && <IdeaBoard />}
            {activeTab === 'learning-log' && <LearningLog />}
            {activeTab === 'calendar' && <CalendarView />}
            {activeTab === 'packages' && <PackagesView />}
          </main>
        </div>
        <VitalsBar />
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
    </ErrorBoundary>
  );
}
