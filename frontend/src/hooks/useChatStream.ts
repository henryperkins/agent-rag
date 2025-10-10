import { useCallback, useRef, useState } from 'react';
import type {
  ActivityStep,
  AgentMessage,
  Citation,
  RetrievalDiagnostics,
  RouteMetadata,
  SessionEvaluation,
  SummarySelectionStats
} from '../types';

interface CritiqueAttempt {
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
  responses?: Array<{ attempt: number; responseId?: string }>;
  evaluation?: SessionEvaluation;
  error?: string;
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
  if (data.responses && Array.isArray(data.responses)) {
    normalized.responses = data.responses;
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
    critiqueHistory: [],
    telemetry: {},
    evaluation: undefined
  });
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({
      isStreaming: false,
      status: 'idle',
      answer: '',
      citations: [],
      activity: [],
      critiqueHistory: [],
      telemetry: {},
      evaluation: undefined
    });
  }, []);

  const stream = useCallback(async (messages: AgentMessage[], sessionId: string) => {
    reset();

    const controller = new AbortController();
    controllerRef.current = controller;

    setState((prev) => ({ ...prev, isStreaming: true, status: 'starting', answer: '' }));

    let finalAnswer = '';

    try {
      const response = await fetch(`${(import.meta.env.VITE_API_BASE ?? __API_BASE__) as string}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, sessionId }),
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
              case 'token': {
                const rawContent = data.content ?? '';
                const tokenSegment = typeof rawContent === 'string' ? rawContent : String(rawContent);
                finalAnswer += tokenSegment;
                setState((prev) => ({ ...prev, answer: prev.answer + tokenSegment }));
                break;
              }
              case 'citations':
                setState((prev) => ({ ...prev, citations: data.citations ?? [] }));
                break;
              case 'activity':
                setState((prev) => ({ ...prev, activity: data.steps ?? [] }));
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
                    responses?: Array<{ attempt: number; responseId?: string }>;
                    evaluation?: SessionEvaluation;
                  };
                  const {
                    route: nextRoute,
                    retrievalMode: nextRetrievalMode,
                    lazySummaryTokens: nextLazyTokens,
                    retrieval: nextRetrieval,
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
      return finalAnswer;
    }

    setState((prev) => ({ ...prev, isStreaming: false }));
    return finalAnswer;
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
    responses: state.responses,
    evaluation: state.evaluation
  };
}
