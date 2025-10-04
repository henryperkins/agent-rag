import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { SourcesPanel } from './components/SourcesPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { PlanPanel } from './components/PlanPanel';
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
    const updated = [...messages, { role: 'user' as const, content }];
    setMessages(updated);

    if (mode === 'stream') {
      await stream.stream(updated);
      setMessages((prev) => [...prev, { role: 'assistant' as const, content: stream.answer }]);
      stream.reset();
      return;
    }

    const response = await chatMutation.mutateAsync(updated);
    setMessages((prev) => [...prev, { role: 'assistant' as const, content: response.answer }]);
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

  const planDetails = mode === 'stream' ? stream.plan : chatMutation.data?.metadata?.plan;
  const contextSnapshot = mode === 'stream' ? stream.contextSnapshot : undefined;
  const telemetryDetails = mode === 'stream'
    ? stream.telemetry
    : chatMutation.data?.metadata
      ? {
          plan: chatMutation.data.metadata.plan,
          contextBudget: chatMutation.data.metadata.context_budget,
          critic: chatMutation.data.metadata.critic_report,
          webContext: chatMutation.data.metadata.web_context,
          summarySelection: chatMutation.data.metadata.summary_selection,
          evaluation: chatMutation.data.metadata.evaluation
        }
      : undefined;
  const traceDetails = mode === 'stream' ? stream.trace : undefined;
  const webContextDetails = mode === 'stream' ? stream.webContext : chatMutation.data?.metadata?.web_context;
  const critiqueHistory = mode === 'stream'
    ? stream.critiqueHistory
    : chatMutation.data?.metadata?.critique_history;
  const routeDetails = mode === 'stream' ? stream.route : chatMutation.data?.metadata?.route;
  const retrievalMode = mode === 'stream' ? stream.retrievalMode : chatMutation.data?.metadata?.retrieval_mode;
  const lazySummaryTokens = mode === 'stream' ? stream.lazySummaryTokens : chatMutation.data?.metadata?.lazy_summary_tokens;
  const evaluationDetails = mode === 'stream' ? stream.evaluation : chatMutation.data?.metadata?.evaluation;

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
          <PlanPanel
            plan={planDetails}
            context={contextSnapshot}
            telemetry={telemetryDetails}
            trace={traceDetails}
            webContext={webContextDetails}
            critiqueHistory={critiqueHistory}
            route={routeDetails}
            retrievalMode={retrievalMode}
            lazySummaryTokens={lazySummaryTokens}
            evaluation={evaluationDetails}
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
