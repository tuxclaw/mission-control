# Andy's Overview ⚡

A sleek, dark-themed dashboard for managing AI agents, missions, ideas, and schedules — built as the command center for [OpenClaw](https://github.com/tuxclaw/openclaw).

![Screenshot Placeholder](docs/screenshot.png)

## Features

- **💬 Chat** — Real-time messaging with your AI agent via the OpenClaw gateway
- **🎯 Mission Board** — Kanban-style board with drag-and-drop, priorities, and agent assignment
- **💡 Idea Board** — AI-generated brainstorming ideas with star/dismiss/convert-to-mission workflow
- **📅 Calendar** — Monthly calendar with manual events and auto-generated cron schedule overlay
- **📊 System Vitals** — Live CPU, RAM, Disk, and GPU monitoring
- **⏰ Cron Manager** — View, toggle, and trigger cron jobs from the gateway
- **🧠 Memory Viewer** — Browse agent memory files (MEMORY.md + daily logs)
- **🌿 Git Panel** — Quick git status, pull, push, and commit
- **🎨 Themes** — Dark, Light, Dracula, and Nord color schemes
- **♿ Accessible** — ARIA labels, keyboard navigation, focus management, WCAG AA contrast

## Tech Stack

- **Frontend:** React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4
- **Backend:** Express 5 (Node.js) — lightweight proxy + system vitals server
- **Icons:** Lucide React
- **State:** React hooks + localStorage (no external state library)

## Setup

### Prerequisites

- Node.js 22+ and npm
- OpenClaw gateway running (for chat & agent features)

### Install

```bash
cd projects/mission-control
npm install
```

### Environment Variables

Create a `.env` file (or set in your shell):

```env
# OpenClaw gateway URL and token (for chat & sessions)
VITE_GATEWAY_URL=http://localhost:18789
VITE_GATEWAY_TOKEN=your-gateway-token

# Vitals server URL (defaults to localhost:3851)
VITE_VITALS_API_URL=http://localhost:3851

# Vitals polling interval in ms (default: 3000)
VITE_VITALS_POLL_MS=3000

# Vitals server port (default: 3851)
VITALS_PORT=3851
```

### Run

Start both the Vite dev server and the vitals backend:

```bash
npm run dev:all
```

Or separately:

```bash
npm run dev      # Vite frontend on :5173
npm run server   # Express backend on :3851
```

### Build

```bash
npm run build
```

## Project Structure

```
src/
├── App.tsx                 # Root layout
├── main.tsx                # Entry point
├── index.css               # Global styles + component CSS
├── themes.ts               # Theme definitions (Dark, Light, Dracula, Nord)
├── types.ts                # Shared TypeScript types
├── components/
│   ├── Header.tsx          # Top bar: logo, clock, theme picker, user
│   ├── TabBar.tsx          # Tab navigation + sidebar toggle
│   ├── Sidebar.tsx         # Agent session list
│   ├── ChatView.tsx        # Chat interface
│   ├── MissionBoard.tsx    # Kanban mission board
│   ├── IdeaBoard.tsx       # Creative time idea board
│   ├── CalendarView.tsx    # Monthly calendar + event detail
│   ├── VitalsBar.tsx       # System vitals + action buttons
│   ├── CronManager.tsx     # Cron job management modal
│   ├── MemoryViewer.tsx    # Memory file browser modal
│   ├── GitPanel.tsx        # Git operations modal
│   ├── ConfirmDialog.tsx   # Reusable confirmation dialog
│   ├── TypingIndicator.tsx # Chat typing animation
│   └── ErrorBoundary.tsx   # React error boundary
├── hooks/
│   ├── useAgents.ts        # Agent session polling
│   ├── useChat.ts          # Chat messaging
│   ├── useClock.ts         # Live clock
│   ├── useCron.ts          # Cron job CRUD
│   ├── useGit.ts           # Git operations
│   ├── useMemory.ts        # Memory file reading
│   ├── useTheme.ts         # Theme persistence
│   └── useVitals.ts        # System vitals polling (visibility-aware)
└── server/
    └── index.ts            # Express backend: vitals, proxy, CRUD APIs
```

## License

MIT
