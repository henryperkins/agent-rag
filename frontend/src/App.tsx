import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ChatInput } from './components/ChatInput';
import { MessageList } from './components/MessageList';
import { SourcesPanel } from './components/SourcesPanel';
import { ActivityPanel } from './components/ActivityPanel';
// PlanPanel deprecated; migrated to TelemetryDrawer
import { AdminStatsCard } from './components/AdminStatsCard';
import { DocumentUpload } from './components/DocumentUpload';
import { FeatureTogglePanel } from './components/FeatureTogglePanel';
import { SessionHealthDashboard } from './components/SessionHealthDashboard';
import { TelemetryDrawer } from './components/TelemetryDrawer';
import { useChat } from './hooks/useChat';
import { useChatStream } from './hooks/useChatStream';
import type {
  ActivityStep,
  AgentMessage,
  ChatMessage,
  Citation,
  CriticReport,
  FeatureFlag,
  FeatureOverrideMap,
  FeatureSelectionMetadata,
  FeatureSource
} from './types';
import './App.css';
import './styles/design-system.css';
import './styles/components.css';
import './styles/markdown.css';

const SESSION_STORAGE_KEY = 'agent-rag:session-id';
const FEATURE_STORAGE_PREFIX = 'agent-rag:feature-overrides:';
const API_BASE = (import.meta.env.VITE_API_BASE ?? __API_BASE__) as string;

const queryClient = new QueryClient();

function createMessageId(): string {
  const cryptoRef = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toChatMessage(message: AgentMessage, citations?: Citation[]): ChatMessage {
  return {
    id: createMessageId(),
    role: message.role,
    content: message.content,
    citations
  };
}

function toAgentMessages(messages: ChatMessage[]): AgentMessage[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

function activityStepKey(step: ActivityStep): string {
  return `${step.type}:${step.timestamp ?? step.description}`;
}

function toThoughtMessage(step: ActivityStep): ChatMessage {
  const text = (step.description ?? '').trim();
  const content = text.startsWith('💭') ? text : `💭 ${text}`;
  return {
    id: createMessageId(),
    role: 'assistant',
    content,
    kind: 'thought'
  };
}

const FEATURE_FLAGS: FeatureFlag[] = [
  'ENABLE_MULTI_INDEX_FEDERATION',
  'ENABLE_LAZY_RETRIEVAL',
  'ENABLE_ADAPTIVE_RETRIEVAL',
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<'sync' | 'stream'>('sync');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [featureSelections, setFeatureSelections] = useState<FeatureOverrideMap>(() =>
    loadStoredFeatureSelections(sessionId)
  );
  const [featureSources, setFeatureSources] = useState<Partial<Record<FeatureFlag, FeatureSource>>>({});
  const seenInsightKeys = useRef<Set<string>>(new Set());

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

  const appendInsightSteps = useCallback(
    (steps: ActivityStep[] | undefined) => {
      if (!steps || steps.length === 0) {
        return;
      }
      setMessages((prev) => {
        let next: ChatMessage[] | undefined;
        for (const step of steps) {
          if (step.type !== 'insight') {
            continue;
          }
          const key = activityStepKey(step);
          if (seenInsightKeys.current.has(key)) {
            continue;
          }
          seenInsightKeys.current.add(key);
          if (!next) {
            next = [...prev];
          }
          next.push(toThoughtMessage(step));
        }
        return next ?? prev;
      });
    },
    [setMessages]
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

        const data = (await response.json()) as { messages?: AgentMessage[] };
        if (!cancelled && Array.isArray(data.messages)) {
          seenInsightKeys.current.clear();
          setMessages(data.messages.map((message) => toChatMessage(message)));
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

    const userMessage = toChatMessage({ role: 'user', content });
    const updated = [...messages, userMessage];
    setMessages(updated);

    const agentHistory = toAgentMessages(updated);

    if (mode === 'stream') {
      const { answer, citations } = await stream.stream(agentHistory, sessionId, featureSelections);
      setMessages((prev) => [
        ...prev,
        toChatMessage({ role: 'assistant', content: answer }, citations)
      ]);
      return;
    }

    const response = await chatMutation.mutateAsync({
      messages: agentHistory,
      sessionId,
      feature_overrides: featureSelections
    });
    appendInsightSteps(response.activity);
    setMessages((prev) => [
      ...prev,
      toChatMessage({ role: 'assistant', content: response.answer }, response.citations)
    ]);
    applyFeatureMetadata(response.metadata?.features);
  };

  const sidebar = useMemo(() => {
    const rawActivity =
      mode === 'stream'
        ? stream.activity
        : chatMutation.data?.activity ?? [];
    const filteredActivity = rawActivity.filter((step) => step.type !== 'insight');

    return {
      citations:
        mode === 'stream'
          ? stream.citations
          : chatMutation.data?.citations ?? [],
      activity: filteredActivity,
      status:
        mode === 'stream'
          ? stream.status
          : chatMutation.isPending
            ? 'loading'
            : 'idle',
      critique: mode === 'stream' ? stream.critique : undefined
    };
  }, [mode, stream, chatMutation.data, chatMutation.isPending]);

  const isBusy =
    chatMutation.isPending || stream.isStreaming || sidebar.status === 'starting' || loadingHistory;

  const planDetails = mode === 'stream' ? stream.plan : chatMutation.data?.metadata?.plan;
  const telemetryDetails = mode === 'stream'
    ? stream.telemetry
    : chatMutation.data?.metadata
      ? {
          plan: chatMutation.data.metadata.plan,
          contextBudget: chatMutation.data.metadata.context_budget,
          critic: chatMutation.data.metadata.critic_report,
          webContext: chatMutation.data.metadata.web_context,
          summarySelection: chatMutation.data.metadata.summary_selection,
          evaluation: chatMutation.data.metadata.evaluation,
          // Preserve fields needed for SessionHealthDashboard metrics
          retrieval_time_ms: chatMutation.data.metadata.retrieval_time_ms,
          critic_iterations: chatMutation.data.metadata.critic_iterations,
          context_budget: chatMutation.data.metadata.context_budget,
          critic_report: chatMutation.data.metadata.critic_report
        }
      : undefined;
  const traceDetails = mode === 'stream' ? stream.trace : undefined;
  const webContextDetails = mode === 'stream' ? stream.webContext : chatMutation.data?.metadata?.web_context;
  const critiqueHistory = mode === 'stream'
    ? stream.critiqueHistory
    : chatMutation.data?.metadata?.critique_history;
  const routeDetails = mode === 'stream' ? stream.route : chatMutation.data?.metadata?.route;
  const responsesDetails = mode === 'stream' ? stream.responses : chatMutation.data?.metadata?.responses;
  const evaluationDetails = mode === 'stream' ? stream.evaluation : chatMutation.data?.metadata?.evaluation;
  const featureMetadata = mode === 'stream' ? stream.features : chatMutation.data?.metadata?.features;

  useEffect(() => {
    if (mode !== 'stream') {
      return;
    }
    appendInsightSteps(stream.insights);
  }, [mode, stream.insights, appendInsightSteps]);

  const [telemetryOpen, setTelemetryOpen] = useState(false);

  return (
    <div className="layout">
      <header className="app-header">
        <div className="header-info">
          <h1>{import.meta.env.VITE_APP_TITLE ?? 'Agentic Azure Chat'}</h1>
          <p>Grounded answers with transparent citations powered by Azure AI Search.</p>
        </div>
        <div className="header-actions">
          <DocumentUpload
            onUploaded={(message) => setMessages((prev) => [...prev, toChatMessage(message)])}
          />
          <button
            onClick={() => setTelemetryOpen(true)}
            aria-expanded={telemetryOpen}
            className={"response-action-btn"}
          >
            Telemetry
          </button>
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
            citations={sidebar.citations}
          />
          <ChatInput disabled={isBusy} onSend={handleSend} />
        </section>

        <section className="sidebar-panel">
          <SessionHealthDashboard
            metadata={telemetryDetails}
            activity={sidebar.activity}
            isStreaming={mode === 'stream' ? stream.isStreaming : false}
            statusHistory={mode === 'stream' ? stream.statusHistory : undefined}
          />
          <FeatureTogglePanel
            selections={featureSelections}
            sources={featureSources}
            disabled={isBusy}
            onToggle={handleFeatureToggle}
          />
          <AdminStatsCard />
          <SourcesPanel
            messages={messages}
            isStreaming={mode === 'stream' ? stream.isStreaming : chatMutation.isPending}
            streamingCitations={mode === 'stream' ? stream.citations : undefined}
          />
          <ActivityPanel
            activity={sidebar.activity}
            status={sidebar.status}
            critique={sidebar.critique}
            isStreaming={mode === 'stream' ? stream.isStreaming : chatMutation.isPending}
          />
        </section>
      </main>

      <footer className="app-footer">
        <span>Version {__APP_VERSION__}</span>
        <span>API: {(import.meta.env.VITE_API_BASE ?? __API_BASE__) as string}</span>
      </footer>

      <TelemetryDrawer
        open={telemetryOpen}
        onClose={() => setTelemetryOpen(false)}
        data={{
          plan: planDetails,
          contextBudget: telemetryDetails?.contextBudget as Record<string, number> | undefined,
          critic: telemetryDetails?.critic as CriticReport | undefined,
          summarySelection: telemetryDetails?.summarySelection,
          route: routeDetails,
          critiqueHistory: mode === 'stream' ? stream.critiqueHistory : critiqueHistory,
          features: featureMetadata,
          evaluation: evaluationDetails,
          responses: responsesDetails,
          traceId: typeof chatMutation.data?.metadata?.trace_id === 'string'
            ? chatMutation.data.metadata.trace_id
            : undefined,
          trace: traceDetails,
          webContext: webContextDetails
        }}
      />
    </div>
  );
}
