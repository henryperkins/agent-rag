### Frontend File Structure

```
frontend/
├── package.json
├── pnpm-lock.yaml          # optional, omitted for brevity
├── tsconfig.json
├── vite.config.ts
├── .env.example
├── README.md
├── Dockerfile              # optional, omitted for brevity
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── App.css
    ├── types.ts
    ├── api/
    │   └── client.ts
    ├── hooks/
    │   ├── useChat.ts
    │   └── useChatStream.ts
    └── components/
        ├── ChatInput.tsx
        ├── MessageList.tsx
        ├── SourcesPanel.tsx
        └── ActivityPanel.tsx
```

---

### `frontend/package.json`

```json
{
  "name": "agentic-azure-frontend",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext ts,tsx"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.15",
    "axios": "^1.7.7",
    "clsx": "^2.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hot-toast": "^2.4.1"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "eslint": "^9.11.1",
    "typescript": "^5.6.2",
    "vite": "^5.4.8"
  }
}
```

---

### `frontend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [
    { "path": "./tsconfig.node.json" }
  ]
}
```

---

### `frontend/tsconfig.node.json`

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

---

### `frontend/vite.config.ts`

```typescript
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
      __API_BASE__: JSON.stringify(env.VITE_API_BASE ?? 'http://localhost:8787')
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/chat': {
          target: env.VITE_API_BASE ?? 'http://localhost:8787',
          changeOrigin: true
        },
        '/health': {
          target: env.VITE_API_BASE ?? 'http://localhost:8787',
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    }
  };
});
```

---

### `frontend/.env.example`

```
VITE_API_BASE=http://localhost:8787
VITE_APP_TITLE=Agentic Azure Chat
```

---

### `frontend/README.md`

```markdown
# Agentic Azure Chat Frontend

React + Vite UI for the Agentic Azure AI Search application.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Backend running on `http://localhost:8787` (or configure `VITE_API_BASE`)

## Quick Start

```bash
pnpm install
cp .env.example .env    # adjust API base if needed
pnpm dev
```

Visit http://localhost:5173 to use the chat.

## Scripts

| Command         | Description                               |
| --------------- | ----------------------------------------- |
| `pnpm dev`      | Start Vite dev server                     |
| `pnpm build`    | Type-check and build production bundle    |
| `pnpm preview`  | Preview production build                  |
| `pnpm lint`     | Run ESLint (optional)                     |

## Environment Variables

- `VITE_API_BASE`: Backend base URL (defaults to `http://localhost:8787`)
- `VITE_APP_TITLE`: Custom title (optional)

## Deployment

1. Build assets: `pnpm build`
2. Serve `dist/` with your preferred static host (Azure Static Web Apps, Azure Storage + CDN, etc.)
3. Ensure backend CORS allows your origin.

```

---

### `frontend/src/types.ts`

```typescript
export type Role = 'user' | 'assistant' | 'system';

export interface AgentMessage {
  role: Role;
  content: string;
}

export interface Citation {
  id?: string;
  title?: string;
  content?: string;
  url?: string;
  page_number?: number;
  score?: number;
}

export interface ActivityStep {
  type: string;
  description: string;
  timestamp?: string;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  activity: ActivityStep[];
  metadata?: {
    retrieval_time_ms?: number;
    critic_iterations?: number;
  };
}
```

---

### `frontend/src/api/client.ts`

```typescript
import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE ?? __API_BASE__) as string;

export const apiClient = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});
```

---

### `frontend/src/hooks/useChat.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { apiClient } from '../api/client';
import type { AgentMessage, ChatResponse } from '../types';

export function useChat() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['chat'],
    mutationFn: async (messages: AgentMessage[]) => {
      const { data } = await apiClient.post<ChatResponse>('/chat', { messages });
      return data;
    },
    onSuccess: (data) => {
      if (data.citations.length) {
        toast.success(`Found ${data.citations.length} citations`);
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error ?? error?.message ?? 'Failed to send message';
      toast.error(message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['telemetry'] });
    }
  });
}
```

---

### `frontend/src/hooks/useChatStream.ts`

```typescript
import { useCallback, useRef, useState } from 'react';
import type { ActivityStep, AgentMessage, Citation } from '../types';

interface StreamState {
  isStreaming: boolean;
  status: string;
  answer: string;
  citations: Citation[];
  activity: ActivityStep[];
  critique?: { score?: number; reasoning?: string; action?: string };
  error?: string;
}

export function useChatStream() {
  const [state, setState] = useState<StreamState>({
    isStreaming: false,
    status: 'idle',
    answer: '',
    citations: [],
    activity: []
  });
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({
      isStreaming: false,
      status: 'idle',
      answer: '',
      citations: [],
      activity: []
    });
  }, []);

  const stream = useCallback(async (messages: AgentMessage[]) => {
    reset();

    const controller = new AbortController();
    controllerRef.current = controller;

    setState((prev) => ({ ...prev, isStreaming: true, status: 'starting', answer: '' }));

    try {
      const response = await fetch(`${(import.meta.env.VITE_API_BASE ?? __API_BASE__) as string}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || `Stream failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        let eventType: string | null = null;
        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('event:')) {
            eventType = line.replace('event:', '').trim();
            continue;
          }

          if (line.startsWith('data:')) {
            const data = JSON.parse(line.replace('data:', '').trim());
            switch (eventType) {
              case 'status':
                setState((prev) => ({ ...prev, status: data.stage ?? prev.status }));
                break;
              case 'token':
                setState((prev) => ({ ...prev, answer: prev.answer + (data.content ?? '') }));
                break;
              case 'citations':
                setState((prev) => ({ ...prev, citations: data.citations ?? [] }));
                break;
              case 'activity':
                setState((prev) => ({ ...prev, activity: data.steps ?? [] }));
                break;
              case 'critique':
                setState((prev) => ({ ...prev, critique: data }));
                break;
              case 'error':
                setState((prev) => ({ ...prev, error: data.message, status: 'error' }));
                break;
              case 'complete':
                setState((prev) => ({ ...prev, answer: data.answer ?? prev.answer }));
                break;
              case 'done':
                setState((prev) => ({ ...prev, status: 'complete' }));
                break;
              default:
                break;
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setState((prev) => ({ ...prev, isStreaming: false, status: 'cancelled' }));
      } else {
        setState((prev) => ({ ...prev, isStreaming: false, status: 'error', error: error.message }));
      }
      return;
    }

    setState((prev) => ({ ...prev, isStreaming: false }));
  }, [reset]);

  return {
    ...state,
    stream,
    cancel: () => {
      controllerRef.current?.abort();
    },
    reset
  };
}
```

---

### `frontend/src/components/ChatInput.tsx`

```tsx
import { useState, KeyboardEvent } from 'react';

interface ChatInputProps {
  disabled?: boolean;
  onSend: (message: string) => void;
}

export function ChatInput({ disabled, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-input">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about the Earth at Night dataset…"
        disabled={disabled}
        rows={3}
      />
      <button onClick={handleSend} disabled={disabled || !value.trim()}>
        {disabled ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
```

---

### `frontend/src/components/MessageList.tsx`

```tsx
import clsx from 'clsx';
import type { AgentMessage } from '../types';

interface MessageListProps {
  messages: AgentMessage[];
  streamingAnswer?: string;
  isStreaming?: boolean;
}

export function MessageList({ messages, streamingAnswer, isStreaming }: MessageListProps) {
  const combined = streamingAnswer && streamingAnswer.length
    ? [...messages, { role: 'assistant', content: streamingAnswer }]
    : messages;

  if (combined.length === 0) {
    return (
      <div className="empty-state">
        <h2>Welcome!</h2>
        <p>Ask about NASA’s Earth at Night study, and I’ll cite the supporting sources.</p>
        <ul>
          <li>“Why is the Phoenix street grid so bright at night?”</li>
          <li>“Summarize the main findings from the Earth at Night dataset.”</li>
          <li>“How does NASA gather nighttime imagery?”</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="messages-container">
      {combined.map((message, index) => (
        <div
          key={`${message.role}-${index}`}
          className={clsx('message', `message-${message.role}`)}
        >
          <div className="message-avatar">
            {message.role === 'assistant' ? '🤖' : message.role === 'user' ? '👤' : '🛠️'}
          </div>
          <div className="message-body">
            <div className="message-role">{message.role}</div>
            <div className="message-content">{message.content}</div>
            {isStreaming && index === combined.length - 1 && (
              <span className="typing-indicator">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

### `frontend/src/components/SourcesPanel.tsx`

```tsx
import type { Citation } from '../types';

interface SourcesPanelProps {
  citations: Citation[];
  isStreaming?: boolean;
}

export function SourcesPanel({ citations, isStreaming }: SourcesPanelProps) {
  return (
    <aside className="sidebar">
      <header>
        <h3>Sources</h3>
        <span className="badge">{citations.length}</span>
      </header>

      {citations.length === 0 ? (
        <p className="sidebar-empty">
          {isStreaming ? 'Collecting references…' : 'No citations yet.'}
        </p>
      ) : (
        <ul className="sources-list">
          {citations.map((citation, index) => (
            <li key={citation.id ?? index} className="source-item">
              <div className="source-title">
                <span className="source-index">[{index + 1}]</span>
                <span>{citation.title ?? `Reference ${index + 1}`}</span>
              </div>
              {citation.page_number && (
                <div className="source-meta">Page {citation.page_number}</div>
              )}
              {citation.score !== undefined && (
                <div className="source-meta">Score {citation.score.toFixed(3)}</div>
              )}
              <p className="source-snippet">
                {citation.content?.slice(0, 160)}
                {citation.content && citation.content.length > 160 ? '…' : ''}
              </p>
              {citation.url && (
                <a href={citation.url} target="_blank" rel="noreferrer" className="source-link">
                  View source →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

---

### `frontend/src/components/ActivityPanel.tsx`

```tsx
import type { ActivityStep } from '../types';

interface ActivityPanelProps {
  activity: ActivityStep[];
  status: string;
  critique?: { score?: number; reasoning?: string; action?: string };
}

export function ActivityPanel({ activity, status, critique }: ActivityPanelProps) {
  return (
    <section className="activity-panel">
      <header>
        <h3>Activity</h3>
        <span className="status">Status: {status}</span>
      </header>

      {activity.length === 0 ? (
        <p className="sidebar-empty">No retrieval activity yet.</p>
      ) : (
        <ol className="activity-timeline">
          {activity.map((step, index) => (
            <li key={`${step.type}-${index}`}>
              <div className="activity-type">{step.type}</div>
              <div className="activity-description">{step.description}</div>
              {step.timestamp && <div className="activity-time">{step.timestamp}</div>}
            </li>
          ))}
        </ol>
      )}

      {critique && (
        <div className="critique-card">
          <h4>Quality Check</h4>
          <p><strong>Action:</strong> {critique.action ?? 'n/a'}</p>
          {critique.score !== undefined && <p><strong>Score:</strong> {critique.score.toFixed(2)}</p>}
          {critique.reasoning && <p className="critique-reason">{critique.reasoning}</p>}
        </div>
      )}
    </section>
  );
}
```

---

### `frontend/src/App.tsx`

```tsx
import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { SourcesPanel } from './components/SourcesPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { useChat } from './hooks/useChat';
import { useChatStream } from './hooks/useChatStream';
import type { AgentMessage } from './types';
import './App.css';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChatApp />
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}

function ChatApp() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [mode, setMode] = useState<'sync' | 'stream'>('sync');

  const chatMutation = useChat();
  const stream = useChatStream();

  const handleSend = async (content: string) => {
    const updated = [...messages, { role: 'user', content }];
    setMessages(updated);

    if (mode === 'stream') {
      await stream.stream(updated);
      setMessages((prev) => [...prev, { role: 'assistant', content: stream.answer }]);
      stream.reset();
      return;
    }

    const response = await chatMutation.mutateAsync(updated);
    setMessages((prev) => [...prev, { role: 'assistant', content: response.answer }]);
  };

  const sidebar = useMemo(
    () => ({
      citations:
        mode === 'stream'
          ? stream.citations
          : chatMutation.data?.citations ?? [],
      activity:
        mode === 'stream'
          ? stream.activity
          : chatMutation.data?.activity ?? [],
      status:
        mode === 'stream'
          ? stream.status
          : chatMutation.isPending
            ? 'loading'
            : 'idle',
      critique: mode === 'stream' ? stream.critique : undefined
    }),
    [mode, stream, chatMutation.data, chatMutation.isPending]
  );

  const isBusy =
    chatMutation.isPending || stream.isStreaming || sidebar.status === 'starting';

  return (
    <div className="layout">
      <header className="app-header">
        <div>
          <h1>{import.meta.env.VITE_APP_TITLE ?? 'Agentic Azure Chat'}</h1>
          <p>Grounded answers with transparent citations powered by Azure AI Search.</p>
        </div>
        <div className="mode-toggle">
          <span>Mode:</span>
          <button
            className={mode === 'sync' ? 'active' : ''}
            onClick={() => setMode('sync')}
            disabled={isBusy}
          >
            Standard
          </button>
          <button
            className={mode === 'stream' ? 'active' : ''}
            onClick={() => setMode('stream')}
            disabled={isBusy}
          >
            Streaming
          </button>
        </div>
      </header>

      <main className="main-content">
        <section className="chat-panel">
          <MessageList
            messages={messages}
            streamingAnswer={mode === 'stream' ? stream.answer : undefined}
            isStreaming={mode === 'stream' ? stream.isStreaming : chatMutation.isPending}
          />
          <ChatInput disabled={isBusy} onSend={handleSend} />
        </section>

        <section className="sidebar-panel">
          <SourcesPanel
            citations={sidebar.citations}
            isStreaming={mode === 'stream' ? stream.isStreaming : chatMutation.isPending}
          />
          <ActivityPanel
            activity={sidebar.activity}
            status={sidebar.status}
            critique={sidebar.critique}
          />
        </section>
      </main>

      <footer className="app-footer">
        <span>Version {__APP_VERSION__}</span>
        <span>API: {(import.meta.env.VITE_API_BASE ?? __API_BASE__) as string}</span>
      </footer>
    </div>
  );
}
```

---

### `frontend/src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

### `frontend/src/App.css`

```css
:root {
  color-scheme: light;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background-color: #f3f4f6;
  color: #111827;
}

body,
html,
#root {
  margin: 0;
  padding: 0;
  height: 100%;
}

.layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-header {
  padding: 24px 32px;
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  gap: 24px;
}

.app-header h1 {
  margin: 0 0 8px;
  font-size: 28px;
}

.app-header p {
  margin: 0;
  color: #6b7280;
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-toggle button {
  border: 1px solid #d1d5db;
  background: #f9fafb;
  padding: 8px 14px;
  border-radius: 999px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.mode-toggle button.active {
  background: #2563eb;
  color: white;
  border-color: transparent;
}

.mode-toggle button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.main-content {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 16px;
  padding: 24px 32px;
}

.chat-panel {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.message-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #eef2ff;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.message-body {
  background: #f9fafb;
  border-radius: 12px;
  padding: 12px 16px;
  max-width: 75%;
  position: relative;
}

.message-user .message-body {
  background: #2563eb;
  color: white;
}

.message-role {
  text-transform: uppercase;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 6px;
  color: #6b7280;
}

.message-user .message-role {
  color: rgba(255, 255, 255, 0.8);
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.6;
}

.typing-indicator {
  display: inline-flex;
  gap: 6px;
  margin-top: 8px;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: typing 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.6; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.empty-state {
  flex: 1;
  padding: 48px;
  text-align: center;
  color: #6b7280;
}

.empty-state h2 {
  margin-bottom: 12px;
  color: #111827;
}

.empty-state ul {
  list-style: none;
  padding: 0;
  margin: 24px 0 0;
}

.empty-state li {
  margin: 8px 0;
}

.chat-input {
  border-top: 1px solid #e5e7eb;
  padding: 16px 24px;
  background: #f9fafb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-input textarea {
  width: 100%;
  border-radius: 12px;
  border: 1px solid #d1d5db;
  padding: 12px 14px;
  font-family: inherit;
  font-size: 16px;
  resize: none;
  min-height: 80px;
}

.chat-input textarea:focus {
  outline: 3px solid rgba(37, 99, 235, 0.2);
  border-color: #2563eb;
}

.chat-input button {
  align-self: flex-end;
  background: #2563eb;
  color: white;
  border: none;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease;
}

.chat-input button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.sidebar-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar,
.activity-panel {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 20px;
}

.sidebar header,
.activity-panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.sidebar h3,
.activity-panel h3 {
  margin: 0;
  font-size: 16px;
}

.badge {
  background: #2563eb;
  color: white;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
}

.sidebar-empty {
  color: #6b7280;
  font-size: 14px;
}

.sources-list,
.activity-timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
}

.source-item {
  padding: 12px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
}

.source-title {
  display: flex;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 6px;
}

.source-index {
  color: #2563eb;
}

.source-meta {
  font-size: 12px;
  color: #6b7280;
  margin-bottom: 4px;
}

.source-snippet {
  font-size: 13px;
  line-height: 1.5;
  color: #4b5563;
}

.source-link {
  display: inline-flex;
  margin-top: 8px;
  font-size: 13px;
  color: #2563eb;
}

.activity-timeline li {
  border-left: 2px solid #e5e7eb;
  padding-left: 12px;
  position: relative;
}

.activity-timeline li::before {
  content: '';
  width: 12px;
  height: 12px;
  background: #2563eb;
  border-radius: 50%;
  position: absolute;
  left: -7px;
  top: 4px;
}

.activity-type {
  color: #2563eb;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.activity-description {
  font-size: 13px;
  color: #4b5563;
}

.activity-time {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 2px;
}

.status {
  font-size: 12px;
  color: #6b7280;
}

.critique-card {
  margin-top: 16px;
  padding: 12px;
  background: #eff6ff;
  border-radius: 12px;
  border: 1px solid #bfdbfe;
}

.critique-card h4 {
  margin: 0 0 6px;
}

.critique-reason {
  font-size: 13px;
  color: #1e3a8a;
}

.app-footer {
  padding: 16px 32px;
  background: white;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  color: #6b7280;
  font-size: 13px;
}

@media (max-width: 1080px) {
  .main-content {
    grid-template-columns: 1fr;
  }

  .sidebar-panel {
    flex-direction: column;
  }
}

@media (max-width: 720px) {
  .app-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .app-footer {
    flex-direction: column;
    gap: 4px;
  }
}
```

---

This frontend bundle mirrors the updated backend contract, supports synchronous and streaming chat modes, surfaces citations and activity data, and is ready to deploy against the preview-aligned service.

#### Sources:

[^1]: [[Azure Cognitive Search REST API 2025-10-01 Preview Specification]]
[^2]: [[Agentic Retrieval Chat App with Azure AI]]
[^3]: [[Agentic Chat App Backend with Azure Search]]
[^4]: [[Agentic Chat App Using Azure AI Search]]
[^5]: [[Agentic Chat App with Azure AI Phased Plan]]
[^6]: [[Agentic Chat App with Azure AI Integration]]
[^7]: [[Agentic Retrieval Chat App Plan]]

---

## Backend File Tree

```
backend/
├── package.json
├── pnpm-lock.yaml             # optional, not shown
├── tsconfig.json
├── .env.example
├── Dockerfile                 # optional, not shown
├── README.md                  # optional, not shown
├── scripts/
│   ├── setup.ts
│   └── cleanup.ts
└── src/
    ├── server.ts
    ├── config/
    │   └── app.ts
    ├── azure/
    │   ├── indexSetup.ts
    │   ├── agenticRetrieval.ts
    │   ├── fallbackRetrieval.ts
    │   └── openaiClient.ts
    ├── tools/
    │   ├── index.ts
    │   └── webSearch.ts
    ├── agents/
    │   ├── planner.ts
    │   ├── advancedPlanner.ts
    │   ├── critic.ts
    │   └── enhancedCritic.ts
    ├── services/
    │   ├── chatService.ts
    │   ├── enhancedChatService.ts
    │   └── chatStreamService.ts
    ├── routes/
    │   ├── index.ts
    │   └── chatStream.ts
    ├── middleware/
    │   └── sanitize.ts
    ├── utils/
    │   └── resilience.ts
    └── tests/                 # helpers & specs (examples shown earlier)
```

All management-plane calls, agent provisioning, and retrieval requests are aligned with the `2025-10-01-preview` contract described in the specification.[^1]

---

### `backend/package.json`

```json
{
  "name": "agentic-azure-backend",
  "version": "2.0.0",
  "type": "module",
  "description": "Backend for the Agentic Azure AI Search chat application",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "setup": "tsx scripts/setup.ts",
    "cleanup": "tsx scripts/cleanup.ts",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@azure/identity": "^4.2.0",
    "@azure/search-documents": "^12.4.0",
    "@fastify/cors": "^9.0.2",
    "@fastify/rate-limit": "^9.1.0",
    "@types/node": "^22.7.4",
    "fastify": "^4.28.1",
    "openai": "^4.26.0",
    "pino": "^9.3.2",
    "pino-pretty": "^11.2.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/pino-pretty": "^10.3.3",
    "@vitest/coverage-v8": "^2.1.3",
    "eslint": "^9.11.1",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.3"
  }
}
```

---

### `backend/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "rootDir": "./src",
    "outDir": "./dist",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "strict": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  },
  "include": ["src/**/*", "scripts/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

### `backend/.env.example`

```env
PROJECT_NAME=agentic-azure-chat
NODE_ENV=development
PORT=8787

AZURE_SEARCH_ENDPOINT=https://YOUR-SEARCH-SERVICE.search.windows.net
AZURE_SEARCH_API_VERSION=2025-10-01-preview
AZURE_SEARCH_INDEX_NAME=earth_at_night
AZURE_KNOWLEDGE_AGENT_NAME=earth-knowledge-agent

AZURE_OPENAI_ENDPOINT=https://YOUR-OPENAI-RESOURCE.openai.azure.com
AZURE_OPENAI_API_VERSION=v1
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large
AZURE_OPENAI_API_KEY=

AZURE_BING_SUBSCRIPTION_KEY=
AZURE_BING_ENDPOINT=https://api.bing.microsoft.com/v7.0/search

RAG_TOP_K=5
RERANKER_THRESHOLD=2.5
MAX_DOCS_FOR_RERANKER=100

ENABLE_CRITIC=true
CRITIC_MAX_RETRIES=1
CRITIC_THRESHOLD=0.8

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=10
REQUEST_TIMEOUT_MS=30000

CORS_ORIGIN=http://localhost:5173
LOG_LEVEL=info
```

---

### `backend/scripts/setup.ts`

```typescript
import { createIndexAndIngest, createKnowledgeAgent } from '../src/azure/indexSetup.js';

async function main() {
  console.log('='.repeat(64));
  console.log('Azure AI Search setup (2025-10-01-preview contract)');
  console.log('='.repeat(64));

  try {
    console.log('\nStep 1: Creating search index & ingesting sample data...');
    await createIndexAndIngest();

    console.log('\nStep 2: Creating knowledge agent (ARM envelope)...');
    await createKnowledgeAgent();

    console.log('\nSetup complete ✅');
    console.log('Run the server with: pnpm dev');
  } catch (error: any) {
    console.error('\nSetup failed ❌');
    console.error(error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

---

### `backend/scripts/cleanup.ts`

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import { SearchIndexClient } from '@azure/search-documents';
import { config } from '../src/config/app.js';

async function deleteKnowledgeAgent() {
  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken('https://search.azure.com/.default');

  if (!tokenResponse?.token) {
    console.warn('No token acquired; skipping agent deletion');
    return;
  }

  const url = `${config.AZURE_SEARCH_ENDPOINT}/agents/${config.AZURE_KNOWLEDGE_AGENT_NAME}?api-version=${config.AZURE_SEARCH_API_VERSION}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${tokenResponse.token}`
    }
  });

  if (response.ok || response.status === 404) {
    console.log(`🗑️  Knowledge agent '${config.AZURE_KNOWLEDGE_AGENT_NAME}' deleted (or not found).`);
  } else {
    console.warn(`⚠️  Failed to delete agent: ${response.status} ${response.statusText}`);
  }
}

async function deleteIndex() {
  const credential = new DefaultAzureCredential();
  const indexClient = new SearchIndexClient(config.AZURE_SEARCH_ENDPOINT, credential);

  try {
    await indexClient.deleteIndex(config.AZURE_SEARCH_INDEX_NAME);
    console.log(`🗑️  Search index '${config.AZURE_SEARCH_INDEX_NAME}' deleted.`);
  } catch (error: any) {
    if (error.statusCode === 404) {
      console.log(`ℹ️  Index '${config.AZURE_SEARCH_INDEX_NAME}' already deleted.`);
    } else {
      console.warn(`⚠️  Failed to delete index: ${error.message}`);
    }
  }
}

async function main() {
  console.log('='.repeat(40));
  console.log('Cleanup Azure resources');
  console.log('='.repeat(40));

  await deleteKnowledgeAgent();
  await deleteIndex();

  console.log('\nCleanup complete ✅');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

---

### `backend/src/config/app.ts`

```typescript
import { z } from 'zod';

const envSchema = z.object({
  PROJECT_NAME: z.string().default('agentic-azure-chat'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),

  AZURE_SEARCH_ENDPOINT: z.string().url(),
  AZURE_SEARCH_API_VERSION: z.string().default('2025-10-01-preview'),
  AZURE_SEARCH_INDEX_NAME: z.string().default('earth_at_night'),
  AZURE_KNOWLEDGE_AGENT_NAME: z.string().default('earth-knowledge-agent'),

  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_API_VERSION: z.string().default('v1'),
  AZURE_OPENAI_GPT_DEPLOYMENT: z.string().default('gpt-4o-mini'),
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().default('text-embedding-3-large'),
  AZURE_OPENAI_API_KEY: z.string().optional(),

  AZURE_BING_SUBSCRIPTION_KEY: z.string().optional(),
  AZURE_BING_ENDPOINT: z.string().url().default('https://api.bing.microsoft.com/v7.0/search'),

  RAG_TOP_K: z.coerce.number().default(5),
  RERANKER_THRESHOLD: z.coerce.number().default(2.5),
  MAX_DOCS_FOR_RERANKER: z.coerce.number().default(100),

  ENABLE_CRITIC: z.coerce.boolean().default(true),
  CRITIC_MAX_RETRIES: z.coerce.number().default(1),
  CRITIC_THRESHOLD: z.coerce.number().default(0.8),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export type AppConfig = z.infer<typeof envSchema>;

export const config = envSchema.parse(process.env);
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
```

---

### `backend/src/azure/openaiClient.ts`

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';

const credential = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const baseUrl = `${config.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/${config.AZURE_OPENAI_API_VERSION}`;

let cachedBearer:
  | {
      token: string;
      expiresOnTimestamp: number;
    }
  | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  if (config.AZURE_OPENAI_API_KEY) {
    return { 'api-key': config.AZURE_OPENAI_API_KEY };
  }

  const now = Date.now();
  if (cachedBearer && cachedBearer.expiresOnTimestamp - now > 120000) {
    return { Authorization: `Bearer ${cachedBearer.token}` };
  }

  const tokenResponse = await credential.getToken(scope);
  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure AD token for Azure OpenAI.');
  }

  cachedBearer = {
    token: tokenResponse.token,
    expiresOnTimestamp: tokenResponse.expiresOnTimestamp ?? now + 15 * 60 * 1000
  };

  return { Authorization: `Bearer ${tokenResponse.token}` };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure OpenAI request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function createChatCompletion(payload: {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  model?: string;
}) {
  return postJson<{
    choices: Array<{ message?: { content?: string } }>;
  }>('/chat/completions', {
    model: payload.model ?? config.AZURE_OPENAI_GPT_DEPLOYMENT,
    messages: payload.messages,
    temperature: payload.temperature ?? 0.7,
    max_tokens: payload.max_tokens ?? 800
  });
}

export async function createChatCompletionStream(payload: {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  model?: string;
}) {
  const headers = await authHeaders();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify({
      model: payload.model ?? config.AZURE_OPENAI_GPT_DEPLOYMENT,
      messages: payload.messages,
      temperature: payload.temperature ?? 0.7,
      stream: true
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`Azure OpenAI streaming failed: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.body.getReader();
}

export async function createEmbeddings(inputs: string[] | string, model?: string) {
  return postJson<{
    data: Array<{ embedding: number[] }>;
  }>('/embeddings', {
    model: model ?? config.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
    input: inputs
  });
}
```

---

### `backend/src/azure/indexSetup.ts`

```typescript
import { SearchClient, SearchIndexClient } from '@azure/search-documents';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';
import { createEmbeddings } from './openaiClient.js';

const SAMPLE_DATA_URL =
  'https://raw.githubusercontent.com/Azure-Samples/azure-search-sample-data/refs/heads/main/nasa-e-book/earth-at-night-json/documents.json';

interface RawDocument {
  id?: string;
  page_chunk?: string;
  content?: string;
  page_number?: number;
  [key: string]: any;
}

interface ProcessedDocument {
  id: string;
  page_chunk: string;
  page_embedding_text_3_large: number[];
  page_number: number;
}

export async function createIndexAndIngest(): Promise<void> {
  const credential = new DefaultAzureCredential();
  const indexClient = new SearchIndexClient(config.AZURE_SEARCH_ENDPOINT, credential);

  const indexDefinition = {
    name: config.AZURE_SEARCH_INDEX_NAME,
    fields: [
      {
        name: 'id',
        type: 'Edm.String',
        key: true,
        filterable: true,
        sortable: true,
        facetable: true
      },
      {
        name: 'page_chunk',
        type: 'Edm.String',
        searchable: true,
        analyzer: 'standard.lucene'
      },
      {
        name: 'page_embedding_text_3_large',
        type: 'Collection(Edm.Single)',
        searchable: true,
        vectorSearchDimensions: 3072,
        vectorSearchProfileName: 'hnsw_profile'
      },
      {
        name: 'page_number',
        type: 'Edm.Int32',
        filterable: true,
        sortable: true,
        facetable: true
      }
    ],
    vectorSearch: {
      algorithms: [
        {
          name: 'hnsw_algorithm',
          kind: 'hnsw',
          hnswParameters: {
            metric: 'cosine',
            m: 4,
            efConstruction: 400,
            efSearch: 500
          }
        }
      ],
      profiles: [
        {
          name: 'hnsw_profile',
          algorithm: 'hnsw_algorithm',
          vectorizer: 'openai_vectorizer'
        }
      ],
      vectorizers: [
        {
          name: 'openai_vectorizer',
          kind: 'azureOpenAI',
          azureOpenAIParameters: {
            resourceUri: config.AZURE_OPENAI_ENDPOINT,
            deploymentId: config.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
            modelName: 'text-embedding-3-large',
            authIdentity: null
          }
        }
      ]
    },
    semanticSearch: {
      configurations: [
        {
          name: 'default',
          prioritizedFields: {
            contentFields: [{ name: 'page_chunk' }]
          }
        }
      ]
    }
  };

  await indexClient.createOrUpdateIndex(indexDefinition as any);

  const response = await fetch(SAMPLE_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch sample data: ${response.status} ${response.statusText}`);
  }
  const rawDocs = (await response.json()) as RawDocument[];

  const searchClient = new SearchClient<ProcessedDocument>(
    config.AZURE_SEARCH_ENDPOINT,
    config.AZURE_SEARCH_INDEX_NAME,
    credential
  );

  const batchSize = 10;
  const embeddedDocs: ProcessedDocument[] = [];

  for (let i = 0; i < rawDocs.length; i += batchSize) {
    const batch = rawDocs.slice(i, i + batchSize);
    const texts = batch.map((doc) => doc.page_chunk || doc.content || '');

    const embeddingResponse = await createEmbeddings(texts);
    const embeddings = embeddingResponse.data.map((item) => item.embedding);

    const processedBatch: ProcessedDocument[] = batch.map((doc, idx) => ({
      id: doc.id || `doc_${i + idx + 1}`,
      page_chunk: texts[idx],
      page_embedding_text_3_large: embeddings[idx],
      page_number: doc.page_number ?? i + idx + 1
    }));

    embeddedDocs.push(...processedBatch);

    if (i + batchSize < rawDocs.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const uploadBatchSize = 100;
  for (let i = 0; i < embeddedDocs.length; i += uploadBatchSize) {
    const uploadBatch = embeddedDocs.slice(i, i + uploadBatchSize);
    const result = await searchClient.mergeOrUploadDocuments(uploadBatch);

    const failures = result.results.filter((r) => !r.succeeded);
    if (failures.length > 0) {
      const message = failures.map((f) => f.errorMessage).join('; ');
      throw new Error(`One or more documents failed to ingest: ${message}`);
    }
  }
}

export async function createKnowledgeAgent(): Promise<void> {
  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken('https://search.azure.com/.default');
  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure Search token');
  }

  const agentResourceName = config.AZURE_KNOWLEDGE_AGENT_NAME;
  const url = `${config.AZURE_SEARCH_ENDPOINT}/agents/${agentResourceName}?api-version=${config.AZURE_SEARCH_API_VERSION}`;

  const agentDefinition = {
    properties: {
      description: 'Knowledge agent for Earth at Night dataset',
      targetIndexes: [
        {
          name: config.AZURE_SEARCH_INDEX_NAME,
          fieldMappings: {
            contentFields: ['page_chunk'],
            vectorFields: ['page_embedding_text_3_large']
          }
        }
      ]
    }
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenResponse.token}`
    },
    body: JSON.stringify(agentDefinition)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create agent: ${response.status} ${response.statusText} - ${errorText}`);
  }
}
```

---

### `backend/src/azure/agenticRetrieval.ts`

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import type { AgentMessage, AgenticRetrievalResponse, Reference } from '../../../shared/types.js';

export interface AgenticRetrievalParams {
  searchEndpoint: string;
  apiVersion: string;
  agentName: string;
  indexName: string;
  messages: AgentMessage[];
  rerankerThreshold?: number;
  maxDocsForReranker?: number;
  includeReferenceSourceData?: boolean;
}

export async function runAgenticRetrieval(params: AgenticRetrievalParams): Promise<AgenticRetrievalResponse> {
  const {
    searchEndpoint,
    apiVersion,
    agentName,
    indexName,
    messages,
    rerankerThreshold = 2.5,
    maxDocsForReranker = 100,
    includeReferenceSourceData = true
  } = params;

  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken('https://search.azure.com/.default');
  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure Search token for authentication');
  }

  const agentMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: [{ type: 'text' as const, text: m.content }]
    }));

  const requestBody = {
    messages: agentMessages,
    targetIndexes: [
      {
        name: indexName,
        parameters: {
          rerankerThreshold,
          maxDocuments: maxDocsForReranker,
          includeReferenceSourceData
        }
      }
    ]
  };

  const url = `${searchEndpoint}/agents/${agentName}/retrieve?api-version=${apiVersion}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenResponse.token}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Retrieval failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  let responseText = '';
  if (typeof data.response === 'string') {
    responseText = data.response;
  } else if (Array.isArray(data.response)) {
    responseText = data.response
      .map((item: any) => {
        if (item?.content && Array.isArray(item.content)) {
          return item.content.map((c: any) => c.text ?? '').join('\n');
        }
        return '';
      })
      .join('\n');
  }

  const references: Reference[] = (data.references ?? []).map((ref: any, idx: number) => ({
    id: ref.id ?? `ref_${idx}`,
    title: ref.title ?? `Reference ${idx + 1}`,
    content: ref.content ?? ref.chunk ?? ref.page_chunk ?? '',
    page_number: ref.pageNumber ?? ref.page_number,
    score: ref.score ?? ref['@search.score'],
    url: ref.url
  }));

  return {
    response: responseText,
    references,
    activity: data.activity ?? []
  };
}
```

---

### `backend/src/azure/fallbackRetrieval.ts`

```typescript
import { DefaultAzureCredential } from '@azure/identity';
import { SearchClient } from '@azure/search-documents';
import type { AgentMessage, AgenticRetrievalResponse, Reference } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { createEmbeddings } from './openaiClient.js';

export async function fallbackVectorSearch(messages: AgentMessage[]): Promise<AgenticRetrievalResponse> {
  const credential = new DefaultAzureCredential();
  const searchClient = new SearchClient<any>(
    config.AZURE_SEARCH_ENDPOINT,
    config.AZURE_SEARCH_INDEX_NAME,
    credential
  );

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found for fallback search.');
  }

  const embeddingResponse = await createEmbeddings(lastUserMessage.content);
  const queryVector = embeddingResponse.data[0].embedding;

  const searchResults = await searchClient.search(lastUserMessage.content, {
    vectorSearchOptions: {
      queries: [
        {
          kind: 'vector',
          vector: queryVector,
          kNearestNeighborsCount: config.RAG_TOP_K,
          fields: ['page_embedding_text_3_large']
        }
      ]
    },
    select: ['id', 'page_chunk', 'page_number'],
    top: config.RAG_TOP_K
  });

  const references: Reference[] = [];
  let combinedText = '';

  for await (const result of searchResults.results) {
    const doc = result.document;
    references.push({
      id: doc.id,
      title: doc.page_number ? `Page ${doc.page_number}` : doc.id,
      content: doc.page_chunk,
      page_number: doc.page_number,
      score: result.score
    });
    combinedText += `${doc.page_chunk}\n\n`;
  }

  return {
    response: combinedText.trim(),
    references,
    activity: [
      {
        type: 'fallback_search',
        description: 'Direct vector/semantic search used because Knowledge Agent retrieval was unavailable.',
        timestamp: new Date().toISOString()
      }
    ]
  };
}
```

---

### `backend/src/tools/index.ts`

```typescript
import { withRetry } from '../utils/resilience.js';
import { runAgenticRetrieval } from '../azure/agenticRetrieval.js';
import { fallbackVectorSearch } from '../azure/fallbackRetrieval.js';
import { webSearchTool } from './webSearch.js';
import { createChatCompletion } from '../azure/openaiClient.js';
import { config } from '../config/app.js';
import type { AgentMessage, Reference } from '../../../shared/types.js';

export const toolSchemas = {
  agentic_retrieve: {
    type: 'function' as const,
    function: {
      name: 'agentic_retrieve',
      description: 'Retrieve grounded data using Azure AI Search Knowledge Agent (with semantic & vector search).',
      parameters: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            description: 'Conversation history for context-aware retrieval'
          }
        },
        required: ['messages']
      }
    }
  },
  web_search: {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web using Bing for up-to-date information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          count: { type: 'number', default: 5 }
        },
        required: ['query']
      }
    }
  },
  answer: {
    type: 'function' as const,
    function: {
      name: 'answer',
      description: 'Generate a final answer from retrieved context with citations.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          context: { type: 'string' },
          citations: { type: 'array', items: { type: 'object' } }
        },
        required: ['question', 'context']
      }
    }
  }
};

export async function agenticRetrieveTool(args: { messages: AgentMessage[] }) {
  try {
    return await withRetry('agentic-retrieval', () =>
      runAgenticRetrieval({
        searchEndpoint: config.AZURE_SEARCH_ENDPOINT,
        apiVersion: config.AZURE_SEARCH_API_VERSION,
        agentName: config.AZURE_KNOWLEDGE_AGENT_NAME,
        indexName: config.AZURE_SEARCH_INDEX_NAME,
        messages: args.messages,
        rerankerThreshold: config.RERANKER_THRESHOLD,
        maxDocsForReranker: config.MAX_DOCS_FOR_RERANKER,
        includeReferenceSourceData: true
      })
    );
  } catch (error) {
    console.warn('Knowledge Agent retrieval failed; switching to fallback search.');
    return await fallbackVectorSearch(args.messages);
  }
}

export { webSearchTool };

export async function answerTool(args: { question: string; context: string; citations?: Reference[] }) {
  const response = await createChatCompletion({
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant. Respond using only the provided context. Cite sources inline as [1], [2], etc. Say "I do not know" when the answer is not grounded.'
      },
      {
        role: 'user',
        content: `Question: ${args.question}\n\nContext:\n${args.context}`
      }
    ],
    temperature: 0.3,
    max_tokens: 600
  });

  const answer = response.choices?.[0]?.message?.content ?? 'I do not know.';
  return { answer, citations: args.citations ?? [] };
}
```

---

### `backend/src/tools/webSearch.ts`

```typescript
import { config } from '../config/app.js';

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  displayUrl?: string;
}

export async function webSearchTool(args: { query: string; count?: number }) {
  const { query, count = 5 } = args;

  if (!config.AZURE_BING_SUBSCRIPTION_KEY) {
    throw new Error('Bing Search API key not configured. Set AZURE_BING_SUBSCRIPTION_KEY.');
  }

  const url = new URL(config.AZURE_BING_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', count.toString());
  url.searchParams.set('responseFilter', 'Webpages');

  let retries = 0;
  const maxRetries = 3;

  while (retries <= maxRetries) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Ocp-Apim-Subscription-Key': config.AZURE_BING_SUBSCRIPTION_KEY
        },
        signal: AbortSignal.timeout(10000)
      });

      if (response.status === 429 && retries < maxRetries) {
        retries++;
        const wait = Math.min(1000 * Math.pow(2, retries), 8000);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bing API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const results: WebSearchResult[] =
        data.webPages?.value?.map((item: any) => ({
          title: item.name,
          snippet: item.snippet,
          url: item.url,
          displayUrl: item.displayUrl
        })) ?? [];

      return { results };
    } catch (error: any) {
      if (retries < maxRetries && (error.name === 'AbortError' || error.message.includes('ECONN'))) {
        retries++;
        const wait = Math.min(1000 * Math.pow(2, retries), 8000);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      throw error;
    }
  }

  return { results: [] };
}
```

---

### `backend/src/agents/planner.ts`

```typescript
import type { AgentMessage } from '../../../shared/types.js';

export type PlanAction = 'retrieve' | 'answer' | 'web_search';

export interface PlanResult {
  action: PlanAction;
  reasoning: string;
}

export async function decidePlan(messages: AgentMessage[]): Promise<PlanResult> {
  if (messages.length === 0) {
    return { action: 'answer', reasoning: 'No user input provided.' };
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return { action: 'answer', reasoning: 'Most recent turn is not a user question.' };
  }

  const text = last.content.toLowerCase();
  const needsRetrieval =
    text.includes('?') ||
    /^(what|how|why|when|where|who|tell|explain|describe|give)/.test(text) ||
    text.length > 40;

  if (needsRetrieval) {
    return { action: 'retrieve', reasoning: 'Question likely requires knowledge grounding.' };
  }

  if (text.includes('search the web') || text.includes('latest') || text.includes('current')) {
    return { action: 'web_search', reasoning: 'User explicitly requested web results.' };
  }

  return { action: 'answer', reasoning: 'Simple prompt that can be answered directly.' };
}
```

---

### `backend/src/agents/advancedPlanner.ts`

```typescript
import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';
import type { AgentMessage } from '../../../shared/types.js';

const SYSTEM_PROMPT = `You are a routing agent that chooses the best action for a user query.
Actions:
- retrieve: consult the knowledge base (preferred for factual questions)
- answer: respond directly without retrieval (greetings, acknowledgements)
- web_search: use Bing for current events or when knowledge base is insufficient

Consider recent conversation context and output JSON:
{"action":"retrieve|answer|web_search","reasoning":"...","confidence":0.0-1.0}`;

export interface AdvancedPlanResult {
  action: 'retrieve' | 'answer' | 'web_search';
  reasoning: string;
  confidence: number;
}

export async function decideAdvancedPlan(messages: AgentMessage[]): Promise<AdvancedPlanResult> {
  if (messages.length === 0) {
    return { action: 'answer', reasoning: 'Empty conversation.', confidence: 1 };
  }

  const credential = new DefaultAzureCredential();
  const client = new AzureOpenAI({
    endpoint: config.AZURE_OPENAI_ENDPOINT,
    apiVersion: config.AZURE_OPENAI_API_VERSION,
    azureADTokenProvider: async () => {
      const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
      return tokenResponse?.token ?? '';
    }
  });

  const history = messages
    .slice(-5)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const completion = await client.chat.completions.create({
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      temperature: 0.3,
      max_tokens: 150,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: history }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as AdvancedPlanResult;

    return {
      action: parsed.action ?? 'retrieve',
      reasoning: parsed.reasoning ?? 'Default to retrieval.',
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5))
    };
  } catch (error) {
    console.error('Advanced planner error:', error);
    const last = messages[messages.length - 1];
    const needsRetrieval =
      last.content.includes('?') ||
      /^(what|how|why|when|where|who)/i.test(last.content);
    return {
      action: needsRetrieval ? 'retrieve' : 'answer',
      reasoning: 'Fallback heuristic used due to planner failure.',
      confidence: 0.5
    };
  }
}
```

---

### `backend/src/agents/critic.ts`

```typescript
import { createChatCompletion } from '../azure/openaiClient.js';
import { config } from '../config/app.js';

const CRITIC_PROMPT = `You are a quality critic. Score the draft answer (0-1) on groundedness to context.
If score < 0.8, suggest revisions. Output JSON: {"score": number, "reasoning": string, "action": "accept"|"revise", "suggestions": string[] }`;

export interface Critique {
  score: number;
  reasoning: string;
  action: 'accept' | 'revise';
  suggestions?: string[];
}

export async function critiqueDraft(draft: string, context: string, question: string): Promise<Critique> {
  const response = await createChatCompletion({
    messages: [
      { role: 'system', content: 'You are an impartial quality reviewer.' },
      {
        role: 'user',
        content: `${CRITIC_PROMPT}\n\nQuestion: ${question}\nContext: ${context}\nDraft: ${draft}`
      }
    ],
    temperature: 0.0,
    max_tokens: 300
  });

  const raw = response.choices?.[0]?.message?.content ?? '{}';
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Critique;
    return {
      score: Math.max(0, Math.min(1, parsed.score ?? 0)),
      reasoning: parsed.reasoning ?? 'No reasoning provided.',
      action: parsed.action === 'accept' ? 'accept' : 'revise',
      suggestions: parsed.suggestions
    };
  } catch {
    return {
      score: 0.8,
      reasoning: 'Critic parsing failed; accepting draft.',
      action: 'accept'
    };
  }
}
```

---

### `backend/src/agents/enhancedCritic.ts`

```typescript
import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';
import type { ActivityStep, Reference } from '../../../shared/types.js';

const PROMPT = `You are a quality critic evaluating AI-generated answers.

Score on:
1. Groundedness
2. Completeness
3. Citation quality
4. Accuracy

Return JSON: {"score":0-1,"reasoning":"...","action":"accept"|"revise","suggestions":["..."]}`;

export interface EnhancedCritique {
  score: number;
  reasoning: string;
  action: 'accept' | 'revise';
  suggestions?: string[];
}

export async function enhancedCritiqueDraft(
  draft: string,
  context: string,
  question: string,
  activity: ActivityStep[],
  references: Reference[]
): Promise<EnhancedCritique> {
  const credential = new DefaultAzureCredential();
  const client = new AzureOpenAI({
    endpoint: config.AZURE_OPENAI_ENDPOINT,
    apiVersion: config.AZURE_OPENAI_API_VERSION,
    azureADTokenProvider: async () => {
      const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
      return tokenResponse?.token ?? '';
    }
  });

  const activitySummary =
    activity.length > 0
      ? `\n\nRetrieval Activity:\n${activity.map((a) => `- ${a.type}: ${a.description}`).join('\n')}`
      : '';

  const referenceSummary =
    references.length > 0
      ? `\n\nTop References:\n${references
          .slice(0, 3)
          .map((r, i) => `[${i + 1}] ${r.title ?? 'Untitled'} (score: ${r.score ?? 'N/A'})`)
          .join('\n')}`
      : '';

  const userPrompt = `Question: ${question}\n\nContext: ${context}${referenceSummary}${activitySummary}\n\nDraft Answer: ${draft}`;

  try {
    const response = await client.chat.completions.create({
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: userPrompt }
      ]
    });

    const raw = response.choices?.[0]?.message?.content ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as EnhancedCritique;

    return {
      score: Math.max(0, Math.min(1, parsed.score ?? 0)),
      reasoning: parsed.reasoning ?? 'No reasoning provided.',
      action: parsed.action === 'accept' || (parsed.score ?? 0) >= config.CRITIC_THRESHOLD ? 'accept' : 'revise',
      suggestions: parsed.suggestions
    };
  } catch (error) {
    console.error('Enhanced critic error:', error);
    return {
      score: 0.8,
      reasoning: 'Critic evaluation failed; accepting draft.',
      action: 'accept'
    };
  }
}
```

---

### `backend/src/services/chatService.ts`

```typescript
import { decidePlan } from '../agents/planner.js';
import { agenticRetrieveTool, answerTool } from '../tools/index.js';
import { critiqueDraft } from '../agents/critic.js';
import { config } from '../config/app.js';
import type { AgentMessage, ChatResponse } from '../../../shared/types.js';

export async function handleChat(messages: AgentMessage[]): Promise<ChatResponse> {
  if (!messages?.length) {
    throw new Error('Messages array is required.');
  }

  const plan = await decidePlan(messages);
  let result = await agenticRetrieveTool({ messages });

  if (plan.action === 'answer') {
    const last = messages[messages.length - 1];
    const context = '';
    result = {
      response: (await answerTool({ question: last.content, context })).answer,
      references: [],
      activity: []
    };
  }

  const citations = result.references ?? [];
  const activity = result.activity ?? [];

  let finalAnswer = typeof result.response === 'string' ? result.response : 'No response generated.';

  if (config.ENABLE_CRITIC && plan.action === 'retrieve') {
    const question = messages[messages.length - 1].content;
    const context = citations.map((c) => c.content).join('\n\n');
    let iterations = 0;

    for (; iterations <= config.CRITIC_MAX_RETRIES; iterations++) {
      const critique = await critiqueDraft(finalAnswer, context, question);
      if (critique.action === 'accept') {
        break;
      }
      if (iterations < config.CRITIC_MAX_RETRIES && critique.suggestions?.length) {
        finalAnswer = `${finalAnswer}\n\n[Revision note: ${critique.suggestions.join('; ')}]`;
      }
    }
  }

  return {
    answer: finalAnswer,
    citations,
    activity,
    metadata: {
      retrieval_time_ms: undefined,
      critic_iterations: undefined
    }
  };
}
```

---

### `backend/src/services/enhancedChatService.ts`

```typescript
import { decideAdvancedPlan } from '../agents/advancedPlanner.js';
import { agenticRetrieveTool } from '../tools/index.js';
import { answerTool } from '../tools/index.js';
import { enhancedCritiqueDraft } from '../agents/enhancedCritic.js';
import { config } from '../config/app.js';
import type { AgentMessage, ChatResponse } from '../../../shared/types.js';

export async function handleEnhancedChat(messages: AgentMessage[]): Promise<ChatResponse> {
  const plan = await decideAdvancedPlan(messages);

  let retrieval = await agenticRetrieveTool({ messages });

  if (plan.action === 'answer') {
    const last = messages[messages.length - 1];
    retrieval = {
      response: (await answerTool({ question: last.content, context: '' })).answer,
      references: [],
      activity: []
    };
  }

  const citations = retrieval.references ?? [];
  const activity = retrieval.activity ?? [];
  let answer = typeof retrieval.response === 'string' ? retrieval.response : 'No response generated.';
  let criticIterations = 0;

  if (config.ENABLE_CRITIC && plan.action === 'retrieve') {
    const question = messages[messages.length - 1].content;
    const context = citations.map((c) => c.content).join('\n\n');

    for (let retry = 0; retry <= config.CRITIC_MAX_RETRIES; retry++) {
      criticIterations++;
      const critique = await enhancedCritiqueDraft(answer, context, question, activity, citations);
      if (critique.action === 'accept') {
        break;
      }
      if (retry < config.CRITIC_MAX_RETRIES && critique.suggestions?.length) {
        answer = `${answer}\n\n[Quality check ❗ ${critique.suggestions.join('; ')}]`;
      }
    }
  }

  return {
    answer,
    citations,
    activity,
    metadata: {
      retrieval_time_ms: undefined,
      critic_iterations: criticIterations
    }
  };
}
```

---

### `backend/src/services/chatStreamService.ts`

```typescript
import { agenticRetrieveTool, answerTool } from '../tools/index.js';
import { enhancedCritiqueDraft } from '../agents/enhancedCritic.js';
import { config } from '../config/app.js';
import { createChatCompletionStream } from '../azure/openaiClient.js';
import type { AgentMessage } from '../../../shared/types.js';

type EventSender = (event: string, data: any) => void;

export async function handleChatStream(messages: AgentMessage[], sendEvent: EventSender) {
  sendEvent('status', { stage: 'planning' });

  const retrieval = await agenticRetrieveTool({ messages });
  const citations = retrieval.references ?? [];
  const activity = retrieval.activity ?? [];

  sendEvent('citations', { citations });
  sendEvent('activity', { steps: activity });
  sendEvent('status', { stage: 'generating' });

  const question = messages[messages.length - 1].content;
  const context = citations.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');

  const reader = await createChatCompletionStream({
    messages: [
      {
        role: 'system',
        content:
          'Respond using only the provided context. Cite sources inline as [1], [2], etc. If uncertain, say "I do not know."'
      },
      {
        role: 'user',
        content: `Question: ${question}\n\nContext:\n${context}`
      }
    ],
    temperature: 0.4
  });

  let fullAnswer = '';
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;

      const delta = JSON.parse(payload);
      const content = delta.choices?.[0]?.delta?.content;
      if (content) {
        fullAnswer += content;
        sendEvent('token', { content });
      }
    }
  }

  if (config.ENABLE_CRITIC) {
    sendEvent('status', { stage: 'reviewing' });
    const critique = await enhancedCritiqueDraft(fullAnswer, context, question, activity, citations);
    sendEvent('critique', critique);
  }

  sendEvent('complete', { answer: fullAnswer });
  sendEvent('done', { status: 'complete' });
}
```

---

### `backend/src/routes/chatStream.ts`

```typescript
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AgentMessage } from '../../../shared/types.js';
import { handleChatStream } from '../services/chatStreamService.js';

export async function setupStreamRoute(app: FastifyInstance) {
  app.post<{ Body: { messages: AgentMessage[] } }>('/chat/stream', async (request, reply) => {
    const { messages } = request.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array required.' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked'
    });

    const sendEvent = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await handleChatStream(messages, sendEvent);
    } catch (error: any) {
      sendEvent('error', { message: error.message });
    } finally {
      reply.raw.end();
    }
  });
}
```

---

### `backend/src/routes/index.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import type { AgentMessage } from '../../../shared/types.js';
import { handleEnhancedChat } from '../services/enhancedChatService.js';
import { setupStreamRoute } from './chatStream.js';
import { isDevelopment } from '../config/app.js';
import { getTelemetry, clearTelemetry } from '../utils/resilience.js';

export async function registerRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString()
  }));

  app.post<{ Body: { messages: AgentMessage[] } }>('/chat', async (request, reply) => {
    const { messages } = request.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array required.' });
    }

    try {
      const response = await handleEnhancedChat(messages);
      return response;
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Internal server error', message: error.message });
    }
  });

  await setupStreamRoute(app);

  if (isDevelopment) {
    app.get('/admin/telemetry', async () => ({ telemetry: getTelemetry() }));
    app.post('/admin/telemetry/clear', async () => {
      clearTelemetry();
      return { status: 'cleared' };
    });
  }
}
```

---

### `backend/src/middleware/sanitize.ts`

```typescript
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

const HTML_TAG_REGEX = /<[^>]*>/g;
const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_MESSAGES = 50;

export function sanitizeInput(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
  const body = request.body as any;

  if (body?.messages) {
    if (!Array.isArray(body.messages)) {
      reply.code(400).send({ error: 'Messages must be an array.' });
      return;
    }

    if (body.messages.length > MAX_MESSAGES) {
      reply.code(400).send({ error: `Too many messages. Maximum ${MAX_MESSAGES}.` });
      return;
    }

    body.messages = body.messages.map((msg: any) => {
      if (typeof msg.content !== 'string') {
        throw new Error('Message content must be a string.');
      }

      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`);
      }

      let sanitized = msg.content.replace(SCRIPT_REGEX, '');
      sanitized = sanitized.replace(HTML_TAG_REGEX, '');
      sanitized = sanitized.replace(/\s+/g, ' ').trim();

      return {
        role: msg.role,
        content: sanitized
      };
    });
  }

  done();
}
```

---

### `backend/src/utils/resilience.ts`

```typescript
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryableErrors?: string[];
}

export interface TelemetryData {
  operation: string;
  startTime: number;
  endTime?: number;
  success?: boolean;
  error?: string;
  retries?: number;
}

const telemetryLog: TelemetryData[] = [];

export async function withRetry<T>(operation: string, fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    timeoutMs = 30000,
    retryableErrors = ['ECONNRESET', 'ETIMEDOUT', '429', '503', 'AbortError']
  } = options;

  const telemetry: TelemetryData = {
    operation,
    startTime: Date.now()
  };

  let attempt = 0;
  let lastError: any;

  while (attempt <= maxRetries) {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
      );

      const result = await Promise.race([fn(), timeout]);

      telemetry.endTime = Date.now();
      telemetry.success = true;
      telemetry.retries = attempt;
      telemetryLog.push(telemetry);

      if (attempt > 0) {
        console.info(`${operation} succeeded after ${attempt} retries.`);
      }

      return result;
    } catch (error: any) {
      lastError = error;
      const isRetryable = retryableErrors.some(
        (code) =>
          error.message?.includes(code) ||
          error.code?.includes(code) ||
          error.status?.toString().includes(code)
      );

      if (!isRetryable || attempt === maxRetries) {
        telemetry.endTime = Date.now();
        telemetry.success = false;
        telemetry.error = error.message;
        telemetry.retries = attempt;
        telemetryLog.push(telemetry);
        throw error;
      }

      attempt++;
      const waitTime = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.warn(`${operation} failed (attempt ${attempt}/${maxRetries}). Retrying in ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw lastError;
}

export function getTelemetry(): TelemetryData[] {
  return [...telemetryLog];
}

export function clearTelemetry() {
  telemetryLog.length = 0;
}
```

---

### `backend/src/server.ts`

```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config, isDevelopment } from './config/app.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { registerRoutes } from './routes/index.js';

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      : undefined
  }
});

await app.register(cors, {
  origin: config.CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
});

await app.register(rateLimit, {
  max: config.RATE_LIMIT_MAX_REQUESTS,
  timeWindow: config.RATE_LIMIT_WINDOW_MS,
  errorResponseBuilder: () => ({
    error: 'Too many requests',
    message: 'Please try again later.'
  })
});

app.addHook('preHandler', sanitizeInput);

app.addHook('onRequest', async (request, reply) => {
  const timer = setTimeout(() => {
    reply.code(408).send({ error: 'Request timeout' });
  }, config.REQUEST_TIMEOUT_MS);

  reply.raw.on('close', () => clearTimeout(timer));
  reply.raw.on('finish', () => clearTimeout(timer));
});

await registerRoutes(app);

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down gracefully.`);
    await app.close();
    process.exit(0);
  });
});

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`🚀 Backend running on http://localhost:${config.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
```

---

All backend components above incorporate the preview-contract requirements captured in the note—specifically the ARM payload envelope when creating agents and the `targetIndexes[].parameters` retrieval payload.[^1] This ensures compatibility with the 2025-10-01 Preview specification while maintaining the rest of the production-ready pipeline.

#### Sources
[^1]: [[Azure Cognitive Search REST API 2025-10-01 Preview Specification]]
