import { useCallback, useRef, useState } from 'react';
import type {
  ActivityStep,
  AgentMessage,
  AgenticRetrievalDiagnostics,
  Citation,
  FeatureOverrideMap,
  FeatureSelectionMetadata,
  RetrievalDiagnostics,
  RouteMetadata,
  SessionEvaluation,
  SummarySelectionStats
} from '../types';

export interface StatusHistoryItem {
  stage: string;
  ts: number;
}

export interface CritiqueAttempt {
  attempt: number;
  grounded: boolean;
  coverage: number;
  action: 'accept' | 'revise';
  issues?: string[];
}

interface TelemetryState extends Record<string, unknown> {
  summarySelection?: SummarySelectionStats;
}

interface StreamState {
  isStreaming: boolean;
  status: string;
  answer: string;
  citations: Citation[];
  activity: ActivityStep[];
  insights: ActivityStep[];
  statusHistory: StatusHistoryItem[];
  critique?: { score?: number; reasoning?: string; action?: string };
  critiqueHistory: CritiqueAttempt[];
  plan?: any;
  context?: { history?: string; summary?: string; salience?: string };
  telemetry?: TelemetryState;
  trace?: Record<string, unknown>;
  webContext?: {
    text?: string;
    tokens?: number;
    trimmed?: boolean;
    results?: Array<{ id?: string; title?: string; url?: string; rank?: number }>;
  };
  route?: RouteMetadata;
  retrievalMode?: string;
  lazySummaryTokens?: number;
  retrieval?: RetrievalDiagnostics;
  diagnostics?: AgenticRetrievalDiagnostics;
  responses?: Array<{ attempt: number; responseId?: string }>;
  evaluation?: SessionEvaluation;
  error?: string;
  features?: FeatureSelectionMetadata;
}

function normalizeTelemetryEvent(data: Record<string, unknown> | undefined) {
  if (!data) {
    return {} as Record<string, unknown>;
  }

  const normalized: Record<string, unknown> = { ...data };

  if (data.context_budget && !data.contextBudget) {
    normalized.contextBudget = data.context_budget;
  }
  if (data.summary_selection && !data.summarySelection) {
    normalized.summarySelection = data.summary_selection;
  }
  if (data.web_context && !data.webContext) {
    normalized.webContext = data.web_context;
  }
  if (data.query_decomposition && !data.queryDecomposition) {
    normalized.queryDecomposition = data.query_decomposition;
  }
  if (data.retrieval_mode && !data.retrievalMode) {
    normalized.retrievalMode = data.retrieval_mode;
  }
  if (data.lazy_summary_tokens !== undefined && data.lazySummaryTokens === undefined) {
    normalized.lazySummaryTokens = data.lazy_summary_tokens;
  }
  if (data.semantic_memory && !data.semanticMemory) {
    normalized.semanticMemory = data.semantic_memory;
  }
  if (data.retrieval && !normalized.retrieval) {
    const retrieval = data.retrieval as Record<string, unknown>;
    normalized.retrieval = {
      ...retrieval,
      fallbackReason: retrieval.fallback_reason ?? retrieval.fallbackReason
    };
  }
  if (data.diagnostics && !normalized.diagnostics) {
    const diagnostics = data.diagnostics as Record<string, unknown>;
    normalized.diagnostics = {
      correlationId: diagnostics.correlation_id ?? diagnostics.correlationId,
      knowledgeAgent: diagnostics.knowledge_agent ?? diagnostics.knowledgeAgent,
      fallbackAttempts: diagnostics.fallback_attempts ?? diagnostics.fallbackAttempts
    };
  }
  if (data.responses && Array.isArray(data.responses)) {
    normalized.responses = data.responses;
  }
  if ((data as any).adaptive_retrieval && !(normalized as any).adaptiveRetrieval) {
    (normalized as any).adaptiveRetrieval = (data as any).adaptive_retrieval;
  }
  if (data.metadata && typeof data.metadata === 'object') {
    const metadata = data.metadata as Record<string, unknown>;
    if (metadata.route && !normalized.route) {
      normalized.route = metadata.route;
    }
    if (metadata.evaluation && !normalized.evaluation) {
      normalized.evaluation = metadata.evaluation;
    }
  }

  return normalized;
}

export function useChatStream() {
  const [state, setState] = useState<StreamState>({
    isStreaming: false,
    status: 'idle',
    answer: '',
    citations: [],
    activity: [],
    insights: [],
    statusHistory: [],
    critiqueHistory: [],
    telemetry: {},
    evaluation: undefined
  });
  const controllerRef = useRef<AbortController | null>(null);
  const insightIdsRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    insightIdsRef.current.clear();
    setState({
      isStreaming: false,
      status: 'idle',
      answer: '',
      citations: [],
      activity: [],
      insights: [],
      statusHistory: [],
      critiqueHistory: [],
      telemetry: {},
      evaluation: undefined
    });
  }, []);

  const stream = useCallback(async (messages: AgentMessage[], sessionId: string, featureOverrides?: FeatureOverrideMap) => {
    reset();

    const controller = new AbortController();
    controllerRef.current = controller;

    setState((prev) => ({ ...prev, isStreaming: true, status: 'starting', answer: '', statusHistory: [...prev.statusHistory, { stage: 'starting', ts: Date.now() }] }));

    let finalAnswer = '';
    let finalCitations: Citation[] = [];

    try {
      const response = await fetch('/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, sessionId, feature_overrides: featureOverrides }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || `Stream failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const processEvent = (currentEvent: string | null, rawPayload: string) => {
        const payload = rawPayload.trim();
        if (!currentEvent || !payload) {
          return;
        }

        let data: any;
        try {
          data = JSON.parse(payload);
        } catch (parseError) {
          console.error('Failed to parse SSE data:', payload, parseError);
          return;
        }

        switch (currentEvent) {
          case 'status':
            setState((prev) => ({
              ...prev,
              status: data.stage ?? prev.status,
              statusHistory: data.stage ? [...prev.statusHistory, { stage: String(data.stage), ts: Date.now() }] : prev.statusHistory
            }));
            break;
          case 'token': {
            const rawContent = data.content ?? '';
            const tokenSegment = typeof rawContent === 'string' ? rawContent : String(rawContent);
            finalAnswer += tokenSegment;
            setState((prev) => ({ ...prev, answer: prev.answer + tokenSegment }));
            break;
          }
          case 'citations':
            finalCitations = data.citations ?? [];
            setState((prev) => ({ ...prev, citations: finalCitations }));
            break;
          case 'activity':
            setState((prev) => {
              const incomingSteps: ActivityStep[] = Array.isArray(data.steps) ? data.steps : [];
              if (!incomingSteps.length) {
                return prev;
              }

              const newInsights: ActivityStep[] = [];
              const nonInsights = incomingSteps.filter((step) => {
                if (step.type === 'insight') {
                  const key = `${step.type}:${step.timestamp ?? step.description}`;
                  if (!insightIdsRef.current.has(key)) {
                    insightIdsRef.current.add(key);
                    newInsights.push(step);
                  }
                  return false;
                }
                return true;
              });

              const existingKeys = new Map<string, number>();
              prev.activity.forEach((step, index) => {
                const key = `${step.type}:${step.timestamp ?? step.description}`;
                existingKeys.set(key, index);
              });

              const mergedActivity = [...prev.activity];
              nonInsights.forEach((step) => {
                const key = `${step.type}:${step.timestamp ?? step.description}`;
                if (existingKeys.has(key)) {
                  mergedActivity[existingKeys.get(key)!] = step;
                } else {
                  existingKeys.set(key, mergedActivity.length);
                  mergedActivity.push(step);
                }
              });

              const nextInsights = newInsights.length ? [...prev.insights, ...newInsights] : prev.insights;

              console.log('[DEBUG] useChatStream: Processing activity event:', {
                incomingStepsCount: incomingSteps.length,
                newInsightsCount: newInsights.length,
                totalInsightsAfter: nextInsights.length,
                insightsReferenceChanged: nextInsights !== prev.insights,
                newInsightDescriptions: newInsights.map(i => i.description)
              });

              return {
                ...prev,
                activity: mergedActivity.length ? mergedActivity : prev.activity,
                insights: nextInsights
              };
            });
            break;
          case 'critique':
            setState((prev) => ({
              ...prev,
              critique: data,
              critiqueHistory: [...prev.critiqueHistory, {
                attempt: data.attempt ?? prev.critiqueHistory.length,
                grounded: data.grounded ?? false,
                coverage: data.coverage ?? 0,
                action: data.action ?? 'accept',
                issues: data.issues
              }]
            }));
            break;
          case 'plan':
            setState((prev) => ({ ...prev, plan: data }));
            break;
          case 'context':
            setState((prev) => ({ ...prev, context: data }));
            break;
          case 'route':
            setState((prev) => ({ ...prev, route: data as RouteMetadata }));
            break;
          case 'telemetry':
            setState((prev) => {
              const normalized = normalizeTelemetryEvent(data) as TelemetryState & {
                route?: RouteMetadata;
                retrievalMode?: string;
                lazySummaryTokens?: number;
                retrieval?: RetrievalDiagnostics;
                diagnostics?: AgenticRetrievalDiagnostics;
                responses?: Array<{ attempt: number; responseId?: string }>;
                evaluation?: SessionEvaluation;
              };
              const {
                route: nextRoute,
                retrievalMode: nextRetrievalMode,
                lazySummaryTokens: nextLazyTokens,
                retrieval: nextRetrieval,
                diagnostics: nextDiagnostics,
                responses: nextResponses,
                evaluation: nextEvaluation,
                ...rest
              } = normalized;
              return {
                ...prev,
                telemetry: { ...(prev.telemetry ?? {}), ...rest },
                route: nextRoute ?? prev.route,
                retrievalMode: nextRetrievalMode ?? prev.retrievalMode,
                lazySummaryTokens: nextLazyTokens ?? prev.lazySummaryTokens,
                retrieval: nextRetrieval ?? prev.retrieval,
                diagnostics: nextDiagnostics ?? prev.diagnostics,
                responses: nextResponses ?? prev.responses,
                evaluation: nextEvaluation ?? prev.evaluation
              };
            });
            break;
          case 'web_context':
            setState((prev) => ({
              ...prev,
              webContext: {
                text: data.text,
                tokens: data.tokens,
                trimmed: data.trimmed,
                results: data.results
              }
            }));
            break;
          case 'features':
            setState((prev) => ({
              ...prev,
              features: data as FeatureSelectionMetadata
            }));
            break;
          case 'trace':
            setState((prev) => ({ ...prev, trace: data }));
            break;
          case 'error':
            setState((prev) => ({ ...prev, error: data.message, status: 'error' }));
            break;
          case 'complete': {
            const answerValue = data.answer;
            setState((prev) => ({
              ...prev,
              answer: typeof answerValue === 'string' ? answerValue : prev.answer
            }));
            if (typeof answerValue === 'string') {
              finalAnswer = answerValue;
            }
            break;
          }
          case 'done':
            setState((prev) => ({ ...prev, status: 'complete', statusHistory: [...prev.statusHistory, { stage: 'complete', ts: Date.now() }] }));
            break;
          default:
            break;
        }
      };

      let buffer = '';
      let eventType: string | null = null;
      let dataBuffer = '';

      const processBuffer = () => {
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) {
            line = line.slice(0, -1);
          }

          if (!line) {
            if (dataBuffer.trim()) {
              processEvent(eventType, dataBuffer);
            }
            eventType = null;
            dataBuffer = '';
            newlineIndex = buffer.indexOf('\n');
            continue;
          }

          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim();
            newlineIndex = buffer.indexOf('\n');
            continue;
          }

          if (line.startsWith('data:')) {
            dataBuffer += line.slice(5);
            dataBuffer += '\n';
          }

          newlineIndex = buffer.indexOf('\n');
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          processBuffer();
        }

        buffer += decoder.decode();
        processBuffer();

        if (dataBuffer.trim()) {
          processEvent(eventType, dataBuffer);
          eventType = null;
          dataBuffer = '';
        }
      } finally {
        // Always release the reader lock to prevent memory leaks
        reader.releaseLock();
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setState((prev) => ({ ...prev, isStreaming: false, status: 'cancelled' }));
      } else {
        setState((prev) => ({ ...prev, isStreaming: false, status: 'error', error: error.message }));
      }
      return { answer: finalAnswer, citations: finalCitations };
    }

    setState((prev) => ({ ...prev, isStreaming: false }));
    return { answer: finalAnswer, citations: finalCitations };
  }, [reset]);

  return {
    ...state,
    stream,
    cancel: () => {
      controllerRef.current?.abort();
    },
    reset,
    plan: state.plan,
    contextSnapshot: state.context,
    telemetry: state.telemetry,
    trace: state.trace,
    webContext: state.webContext,
    critiqueHistory: state.critiqueHistory,
    route: state.route,
    retrievalMode: state.retrievalMode,
    lazySummaryTokens: state.lazySummaryTokens,
    retrieval: state.retrieval,
    diagnostics: state.diagnostics,
    responses: state.responses,
    evaluation: state.evaluation
  };
}
