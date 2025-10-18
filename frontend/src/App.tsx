import { useCallback, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { SourcesPanel } from './components/SourcesPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { PlanPanel } from './components/PlanPanel';
import { AdminStatsCard } from './components/AdminStatsCard';
import { DocumentUpload } from './components/DocumentUpload';
import { FeatureTogglePanel } from './components/FeatureTogglePanel';
import { useChat } from './hooks/useChat';
import { useChatStream } from './hooks/useChatStream';
import type {
  AgentMessage,
  FeatureFlag,
  FeatureOverrideMap,
  FeatureSelectionMetadata,
  FeatureSource
} from './types';
import './App.css';

const SESSION_STORAGE_KEY = 'agent-rag:session-id';
const FEATURE_STORAGE_PREFIX = 'agent-rag:feature-overrides:';
const API_BASE = (import.meta.env.VITE_API_BASE ?? __API_BASE__) as string;

const queryClient = new QueryClient();

const FEATURE_FLAGS: FeatureFlag[] = [
  'ENABLE_MULTI_INDEX_FEDERATION',
  'ENABLE_LAZY_RETRIEVAL',
  'ENABLE_SEMANTIC_SUMMARY',
  'ENABLE_INTENT_ROUTING',
  'ENABLE_SEMANTIC_MEMORY',
  'ENABLE_QUERY_DECOMPOSITION',
  'ENABLE_WEB_RERANKING',
  'ENABLE_SEMANTIC_BOOST',
  'ENABLE_RESPONSE_STORAGE'
];

function sanitizeFeatureMap(map?: FeatureOverrideMap | null): FeatureOverrideMap {
  const sanitized: FeatureOverrideMap = {};
  for (const flag of FEATURE_FLAGS) {
    sanitized[flag] = map?.[flag] === true;
  }
  return sanitized;
}

function loadStoredFeatureSelections(sessionId: string): FeatureOverrideMap {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(`${FEATURE_STORAGE_PREFIX}${sessionId}`);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as FeatureOverrideMap;
    return sanitizeFeatureMap(parsed);
  } catch (error) {
    console.warn('Failed to load stored feature toggles', error);
    return {};
  }
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChatApp />
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}

function ChatApp() {
  const [sessionId] = useState<string>(() => {
    const generator =
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? () => crypto.randomUUID()
        : () => Math.random().toString(36).slice(2)) as () => string;

    if (typeof window === 'undefined') {
      return generator();
    }

    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const next = generator();
    window.localStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  });

  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [mode, setMode] = useState<'sync' | 'stream'>('sync');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [featureSelections, setFeatureSelections] = useState<FeatureOverrideMap>(() =>
    loadStoredFeatureSelections(sessionId)
  );
  const [featureSources, setFeatureSources] = useState<Partial<Record<FeatureFlag, FeatureSource>>>({});

  const chatMutation = useChat();
  const stream = useChatStream();

  const persistFeatureSelections = useCallback(
    (next: FeatureOverrideMap) => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(`${FEATURE_STORAGE_PREFIX}${sessionId}`, JSON.stringify(next));
      } catch (error) {
        console.warn('Failed to persist feature toggles', error);
      }
    },
    [sessionId]
  );

  const applyFeatureMetadata = useCallback(
    (metadata?: FeatureSelectionMetadata) => {
      if (!metadata?.resolved) {
        return;
      }
      const sanitized = sanitizeFeatureMap(metadata.resolved);
      setFeatureSelections(sanitized);
      setFeatureSources(metadata.sources ?? {});
      persistFeatureSelections(sanitized);
    },
    [persistFeatureSelections]
  );

  const handleFeatureToggle = useCallback(
    (flag: FeatureFlag, value: boolean) => {
      setFeatureSelections((prev) => {
        const next = { ...prev, [flag]: value };
        if (flag === 'ENABLE_WEB_RERANKING' && value === false) {
          next.ENABLE_SEMANTIC_BOOST = false;
        }
        const sanitized = sanitizeFeatureMap(next);
        persistFeatureSelections(sanitized);
        return sanitized;
      });
      setFeatureSources((prev) => {
        const next: Partial<Record<FeatureFlag, FeatureSource>> = { ...prev, [flag]: 'override' };
        if (flag === 'ENABLE_WEB_RERANKING' && value === false) {
          next.ENABLE_SEMANTIC_BOOST = 'override';
        }
        return next;
      });
    },
    [persistFeatureSelections]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      try {
        const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
        if (!response.ok) {
          if (response.status === 404) {
            return;
          }
          throw new Error(`Failed to load session history (${response.status})`);
        }

        const data = await response.json();
        if (!cancelled && Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load session history', error);
        }
      } finally {
        if (!cancelled) {
          setLoadingHistory(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (stream.features) {
      applyFeatureMetadata(stream.features);
    }
  }, [stream.features, applyFeatureMetadata]);

  const handleSend = async (content: string) => {
    if (loadingHistory) {
      return;
    }

    const updated = [...messages, { role: 'user' as const, content }];
    setMessages(updated);

    if (mode === 'stream') {
      const answer = await stream.stream(updated, sessionId, featureSelections);
      setMessages((prev) => [...prev, { role: 'assistant' as const, content: answer }]);
      return;
    }

    const response = await chatMutation.mutateAsync({
      messages: updated,
      sessionId,
      feature_overrides: featureSelections
    });
    setMessages((prev) => [...prev, { role: 'assistant' as const, content: response.answer }]);
    applyFeatureMetadata(response.metadata?.features);
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
    chatMutation.isPending || stream.isStreaming || sidebar.status === 'starting' || loadingHistory;

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
  const retrievalDetails = mode === 'stream' ? stream.retrieval : chatMutation.data?.metadata?.retrieval;
  const responsesDetails = mode === 'stream' ? stream.responses : chatMutation.data?.metadata?.responses;
  const evaluationDetails = mode === 'stream' ? stream.evaluation : chatMutation.data?.metadata?.evaluation;
  const featureMetadata = mode === 'stream' ? stream.features : chatMutation.data?.metadata?.features;

  return (
    <div className="layout">
      <header className="app-header">
        <div className="header-info">
          <h1>{import.meta.env.VITE_APP_TITLE ?? 'Agentic Azure Chat'}</h1>
          <p>Grounded answers with transparent citations powered by Azure AI Search.</p>
        </div>
        <div className="header-actions">
          <DocumentUpload onUploaded={(message) => setMessages((prev) => [...prev, message])} />
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
          <FeatureTogglePanel
            selections={featureSelections}
            sources={featureSources}
            disabled={isBusy}
            onToggle={handleFeatureToggle}
          />
          <AdminStatsCard />
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
            retrieval={retrievalDetails}
            responses={responsesDetails}
            evaluation={evaluationDetails}
            features={featureMetadata}
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
