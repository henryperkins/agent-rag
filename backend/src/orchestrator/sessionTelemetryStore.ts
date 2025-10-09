import type {
  ActivityStep,
  ChatResponse,
  CriticReport,
  EvaluationDimension,
  PlanSummary,
  Reference,
  RetrievalDiagnostics,
  RouteMetadata,
  SessionEvaluation,
  SessionTrace,
  SummarySelectionStats,
  WebResult
} from '../../../shared/types.js';

type SessionMode = 'sync' | 'stream';

interface StatusEntry {
  stage: string;
  timestamp: number;
}

interface EventEntry {
  event: string;
  data: unknown;
  timestamp: number;
}

export interface SessionTelemetryRecord {
  sessionId: string;
  mode: SessionMode;
  question?: string;
  startedAt: number;
  completedAt?: number;
  status?: string;
  statusHistory: StatusEntry[];
  plan?: PlanSummary;
  context?: {
    history?: string;
    summary?: string;
    salience?: string;
  };
  toolUsage?: {
    references?: number;
  webResults?: number;
  };
  contextBudget?: Record<string, number>;
  citations?: Reference[];
  activity?: ActivityStep[];
  critic?: CriticReport;
  answer?: string;
  metadata?: ChatResponse['metadata'];
  traceId?: string;
  finalStatus?: string;
  error?: string;
  events: EventEntry[];
  retrieval?: RetrievalDiagnostics;
  trace?: SessionTrace;
  summarySelection?: SummarySelectionStats;
  webContext?: {
    text?: string;
    tokens?: number;
    trimmed?: boolean;
    results?: Array<Pick<WebResult, 'id' | 'title' | 'url' | 'rank'>>;
  };
  route?: RouteMetadata;
  lazySummaryTokens?: number;
  retrievalMode?: string;
  evaluation?: SessionEvaluation;
}

const MAX_RECORDS = 100;
const sessionTelemetry: SessionTelemetryRecord[] = [];

interface SummarySelectionAggregates {
  totalSessions: number;
  modeBreakdown: {
    semantic: number;
    recency: number;
  };
  totalSelected: number;
  totalDiscarded: number;
  errorCount: number;
  scoreRanges: {
    semantic: {
      samples: number;
      minScore: number;
      maxScore: number;
      avgScore: number;
    };
    recency: {
      samples: number;
      minScore: number;
      maxScore: number;
      avgScore: number;
    };
  };
  recentSamples: Array<{
    sessionId: string;
    mode: 'semantic' | 'recency';
    selectedCount: number;
    discardedCount: number;
    usedFallback: boolean;
    timestamp: number;
  }>;
}

const summaryAggregates: SummarySelectionAggregates = {
  totalSessions: 0,
  modeBreakdown: { semantic: 0, recency: 0 },
  totalSelected: 0,
  totalDiscarded: 0,
  errorCount: 0,
  scoreRanges: {
    semantic: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 },
    recency: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 }
  },
  recentSamples: []
};

const MAX_RECENT_SAMPLES = 50;

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_GROUPED_REGEX = /\b(?:\d{4}[ -]?){3}\d{4}\b/g;
const CREDIT_CARD_PLAIN_REGEX = /\b\d{13,16}\b/g;

function redactSensitive(text?: string | null): string | undefined {
  if (!text) {
    return text ?? undefined;
  }
  let sanitized = text;
  sanitized = sanitized.replace(EMAIL_REGEX, '[EMAIL]');
  sanitized = sanitized.replace(SSN_REGEX, '[SSN]');
  sanitized = sanitized.replace(CREDIT_CARD_GROUPED_REGEX, '[CARD]');
  sanitized = sanitized.replace(CREDIT_CARD_PLAIN_REGEX, '[CARD]');
  return sanitized;
}

function sanitizeActivitySteps(steps?: ActivityStep[] | null): ActivityStep[] | undefined {
  if (!Array.isArray(steps) || steps.length === 0) {
    return steps ?? undefined;
  }
  return steps.map((step) => {
    if (!step || typeof step !== 'object') {
      return step;
    }
    const next: ActivityStep = { ...step };
    if (typeof next.description === 'string') {
      next.description = redactSensitive(next.description) ?? next.description;
    }
    return next;
  });
}

function sanitizeEventPayload(event: string, data: unknown): unknown {
  if (event === 'complete' && data && typeof data === 'object') {
    const payload = data as { answer?: string };
    if (typeof payload.answer === 'string') {
      return { ...payload, answer: redactSensitive(payload.answer) };
    }
  }
  if (event === 'tokens' && data && typeof data === 'object') {
    const payload = data as { content?: string };
    if (typeof payload.content === 'string') {
      return { ...payload, content: redactSensitive(payload.content) };
    }
  }
  if (event === 'activity' && data && typeof data === 'object') {
    const payload = data as { steps?: ActivityStep[] };
    return {
      ...payload,
      steps: sanitizeActivitySteps(payload.steps)
    };
  }
  return data;
}

function normalizeTelemetryPayload(payload: Record<string, any>): Record<string, any> {
  const normalized = { ...payload };

  if (normalized.context_budget && !normalized.contextBudget) {
    normalized.contextBudget = normalized.context_budget;
  }
  if (normalized.summary_selection && !normalized.summarySelection) {
    normalized.summarySelection = normalized.summary_selection;
  }
  if (normalized.web_context && !normalized.webContext) {
    normalized.webContext = normalized.web_context;
  }
  if (normalized.query_decomposition && !normalized.queryDecomposition) {
    normalized.queryDecomposition = normalized.query_decomposition;
  }
  if (normalized.retrieval_mode && !normalized.retrievalMode) {
    normalized.retrievalMode = normalized.retrieval_mode;
  }
  if (normalized.lazy_summary_tokens !== undefined && normalized.lazySummaryTokens === undefined) {
    normalized.lazySummaryTokens = normalized.lazy_summary_tokens;
  }
  if (normalized.semantic_memory && !normalized.semanticMemory) {
    normalized.semanticMemory = normalized.semantic_memory;
  }
  if (normalized.metadata?.route && !normalized.route) {
    normalized.route = normalized.metadata.route;
  }
  if (normalized.metadata?.evaluation && !normalized.evaluation) {
    normalized.evaluation = normalized.metadata.evaluation;
  }

  return normalized;
}

function sanitizeEvaluation(evaluation?: SessionEvaluation | null): SessionEvaluation | undefined {
  if (!evaluation) {
    return evaluation ?? undefined;
  }

  const sanitizeDimension = (dimension?: EvaluationDimension | null): EvaluationDimension | undefined => {
    if (!dimension) {
      return undefined;
    }
    const next = { ...dimension } as EvaluationDimension;
    next.reason = typeof next.reason === 'string' ? redactSensitive(next.reason) ?? next.reason : next.reason;
    if (next.evidence) {
      next.evidence = clone(next.evidence);
    }
    return next;
  };

  const stripUndefined = <T extends Record<string, unknown>>(obj: T | undefined): T | undefined => {
    if (!obj) {
      return undefined;
    }
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        next[key] = value;
      }
    }
    return Object.keys(next).length ? (next as T) : undefined;
  };

  const rag = evaluation.rag
    ? stripUndefined({
        retrieval: sanitizeDimension(evaluation.rag.retrieval),
        documentRetrieval: sanitizeDimension(evaluation.rag.documentRetrieval),
        groundedness: sanitizeDimension(evaluation.rag.groundedness),
        groundednessPro: sanitizeDimension(evaluation.rag.groundednessPro),
        relevance: sanitizeDimension(evaluation.rag.relevance),
        responseCompleteness: sanitizeDimension(evaluation.rag.responseCompleteness)
      })
    : undefined;

  const quality = evaluation.quality
    ? stripUndefined({
        coherence: sanitizeDimension(evaluation.quality.coherence),
        fluency: sanitizeDimension(evaluation.quality.fluency),
        qa: sanitizeDimension(evaluation.quality.qa)
      })
    : undefined;

  const agent = evaluation.agent
    ? stripUndefined({
        intentResolution: sanitizeDimension(
          (evaluation.agent as any).intentResolution ?? (evaluation.agent as any).intent_resolution
        ),
        toolCallAccuracy: sanitizeDimension(
          (evaluation.agent as any).toolCallAccuracy ?? (evaluation.agent as any).tool_call_accuracy
        ),
        taskAdherence: sanitizeDimension(
          (evaluation.agent as any).taskAdherence ?? (evaluation.agent as any).task_adherence
        )
      })
    : undefined;

  const sanitized: SessionEvaluation = {
    rag,
    quality,
    agent,
    safety: evaluation.safety
      ? {
          flagged: evaluation.safety.flagged,
          categories: Array.isArray(evaluation.safety.categories)
            ? [...evaluation.safety.categories]
            : [],
          reason:
            typeof evaluation.safety.reason === 'string'
              ? redactSensitive(evaluation.safety.reason) ?? evaluation.safety.reason
              : evaluation.safety.reason,
          evidence: evaluation.safety.evidence ? clone(evaluation.safety.evidence) : undefined
        }
      : undefined,
    summary: {
      status: evaluation.summary.status,
      failingMetrics: [...evaluation.summary.failingMetrics],
      generatedAt: evaluation.summary.generatedAt
    }
  };

  return sanitized;
}

function clone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function aggregateSummarySelection(stats: SummarySelectionStats, sessionId: string): void {
  summaryAggregates.totalSessions += 1;
  summaryAggregates.modeBreakdown[stats.mode] += 1;
  summaryAggregates.totalSelected += stats.selectedCount;
  summaryAggregates.totalDiscarded += stats.discardedCount;

  if (stats.error) {
    summaryAggregates.errorCount += 1;
  }

  const range = summaryAggregates.scoreRanges[stats.mode];
  if (stats.meanScore !== undefined) {
    range.samples += 1;
    range.minScore = Math.min(range.minScore, stats.minScore ?? stats.meanScore);
    range.maxScore = Math.max(range.maxScore, stats.maxScore ?? stats.meanScore);
    // Running average
    range.avgScore = (range.avgScore * (range.samples - 1) + stats.meanScore) / range.samples;
  }

  // Store recent sample
  summaryAggregates.recentSamples.unshift({
    sessionId,
    mode: stats.mode,
    selectedCount: stats.selectedCount,
    discardedCount: stats.discardedCount,
    usedFallback: stats.usedFallback,
    timestamp: Date.now()
  });

  // Trim old samples
  if (summaryAggregates.recentSamples.length > MAX_RECENT_SAMPLES) {
    summaryAggregates.recentSamples.length = MAX_RECENT_SAMPLES;
  }
}

function pushRecord(record: SessionTelemetryRecord) {
  sessionTelemetry.unshift(record);
  if (sessionTelemetry.length > MAX_RECORDS) {
    sessionTelemetry.length = MAX_RECORDS;
  }
}

function recordEvent(state: SessionTelemetryRecord, event: string, data: unknown, timestamp: number) {
  let sanitized = sanitizeEventPayload(event, data);
  if (event === 'telemetry' && sanitized && typeof sanitized === 'object') {
    const payload = sanitized as { evaluation?: SessionEvaluation };
    if (payload.evaluation) {
      sanitized = { ...payload, evaluation: sanitizeEvaluation(payload.evaluation) };
    }
  }
  state.events.push({ event, data: clone(sanitized), timestamp });

  switch (event) {
    case 'status': {
      const stage = typeof (sanitized as any)?.stage === 'string' ? (sanitized as any).stage : String(event);
      state.status = stage;
      state.statusHistory.push({ stage, timestamp });
      break;
    }
    case 'context': {
      const payload = sanitized as any;
      state.context = {
        history: redactSensitive(payload?.history),
        summary: redactSensitive(payload?.summary),
        salience: redactSensitive(payload?.salience)
      };
      break;
    }
    case 'plan': {
      state.plan = clone(sanitized as PlanSummary);
      break;
    }
    case 'route': {
      state.route = clone(sanitized as RouteMetadata);
      state.metadata = {
        ...(state.metadata ?? {}),
        route: clone(sanitized as RouteMetadata)
      };
      break;
    }
    case 'tool': {
      state.toolUsage = {
        references: (sanitized as any)?.references,
        webResults: (sanitized as any)?.webResults
      };
      break;
    }
    case 'citations': {
      state.citations = clone((sanitized as any)?.citations ?? []);
      break;
    }
    case 'activity': {
      const steps = sanitizeActivitySteps((sanitized as any)?.steps);
      state.activity = steps ? clone(steps) : [];
      break;
    }
    case 'critique': {
      state.critic = clone(sanitized as CriticReport);
      break;
    }
    case 'web_context': {
      const payload = sanitized as any;
      state.webContext = {
        text: payload?.text,
        tokens: payload?.tokens,
        trimmed: payload?.trimmed,
        results: Array.isArray(payload?.results)
          ? payload.results.map((result: any) => ({
              id: result.id,
              title: result.title,
              url: result.url,
              rank: result.rank
            }))
          : undefined
      };
      break;
    }
    case 'telemetry': {
      const payload = sanitized && typeof sanitized === 'object'
        ? normalizeTelemetryPayload(sanitized as Record<string, any>)
        : undefined;

      if (payload?.plan) {
        state.plan = clone(payload.plan);
      }
      if (payload?.contextBudget) {
        state.contextBudget = clone(payload.contextBudget);
      }
      if (payload?.critic) {
        state.critic = clone(payload.critic);
      }
      if (payload?.traceId) {
        state.traceId = payload.traceId;
      }
      if (payload?.retrieval) {
        state.retrieval = clone(payload.retrieval as RetrievalDiagnostics);
      }
      if (payload?.summarySelection) {
        state.summarySelection = clone(payload.summarySelection as SummarySelectionStats);
        // Aggregate statistics for cross-session analysis
        try {
          aggregateSummarySelection(payload.summarySelection as SummarySelectionStats, state.sessionId);
        } catch (error) {
          console.warn('Failed to aggregate summary selection stats:', error);
        }
      }
      if (payload?.webContext) {
        state.webContext = clone(payload.webContext);
      }
      if (payload?.route) {
        state.route = clone(payload.route as RouteMetadata);
        state.metadata = {
          ...(state.metadata ?? {}),
          route: clone(payload.route as RouteMetadata)
        };
      }
      if (payload?.retrievalMode) {
        state.retrievalMode = payload.retrievalMode;
      }
      if (typeof payload?.lazySummaryTokens === 'number') {
        state.lazySummaryTokens = payload.lazySummaryTokens;
      }
      if (payload?.evaluation) {
        state.evaluation = sanitizeEvaluation(payload.evaluation as SessionEvaluation);
      }
      break;
    }
    case 'trace': {
      const payload = sanitized as { session?: SessionTrace };
      if (payload?.session) {
        state.trace = clone(payload.session);
      }
      break;
    }
    case 'complete': {
      if ((sanitized as any)?.answer) {
        state.answer = (sanitized as any).answer;
      }
      break;
    }
    case 'done': {
      if ((sanitized as any)?.status) {
        state.finalStatus = (sanitized as any).status;
      }
      break;
    }
    case 'error': {
      state.error = (sanitized as any)?.message ?? 'Unknown error';
      break;
    }
    default:
      break;
  }
}

export interface SessionRecorder {
  emit: (event: string, data: unknown) => void;
  complete: (response?: ChatResponse) => void;
  fail: (error: Error) => void;
}

export function createSessionRecorder(options: {
  sessionId: string;
  mode: SessionMode;
  question?: string;
  forward?: (event: string, data: unknown) => void;
}): SessionRecorder {
  const { sessionId, mode, question, forward } = options;
  const state: SessionTelemetryRecord = {
    sessionId,
    mode,
    question: redactSensitive(question),
    startedAt: Date.now(),
    statusHistory: [],
    events: []
  };

  return {
    emit(event, data) {
      const timestamp = Date.now();
      recordEvent(state, event, data, timestamp);
      forward?.(event, data);
    },
    complete(response) {
      state.completedAt = Date.now();
      if (response) {
        state.answer = redactSensitive(response.answer);
        state.citations = clone(response.citations);
        const activity = sanitizeActivitySteps(response.activity);
        state.activity = activity ? clone(activity) : [];
        state.metadata = clone(response.metadata);
        if (response.metadata?.summary_selection) {
          state.summarySelection = clone(response.metadata.summary_selection);
        }
        if (response.metadata?.context_budget) {
          state.contextBudget = clone(response.metadata.context_budget);
        }
        if (response.metadata?.critic_report) {
          state.critic = clone(response.metadata.critic_report);
        }
        if (response.metadata?.plan) {
          state.plan = clone(response.metadata.plan);
        }
        if (response.metadata?.trace_id) {
          state.traceId = response.metadata.trace_id;
        }
        if (response.metadata?.web_context) {
          state.webContext = clone(response.metadata.web_context);
        }
        if (response.metadata?.route) {
          state.route = clone(response.metadata.route);
        }
        if (response.metadata?.lazy_summary_tokens !== undefined) {
          state.lazySummaryTokens = response.metadata.lazy_summary_tokens;
        }
        if (response.metadata?.retrieval_mode) {
          state.retrievalMode = response.metadata.retrieval_mode;
        }
        if (response.metadata?.evaluation) {
          state.evaluation = sanitizeEvaluation(response.metadata.evaluation);
        }
      }
      pushRecord(clone(state));
    },
    fail(error) {
      state.completedAt = Date.now();
      state.error = error.message;
      pushRecord(clone(state));
    }
  };
}

export function getSessionTelemetry(): SessionTelemetryRecord[] {
  return sessionTelemetry.map((record) => clone(record));
}

export function getSummaryAggregates(): SummarySelectionAggregates {
  return {
    ...summaryAggregates,
    scoreRanges: {
      semantic: { ...summaryAggregates.scoreRanges.semantic },
      recency: { ...summaryAggregates.scoreRanges.recency }
    },
    modeBreakdown: { ...summaryAggregates.modeBreakdown },
    recentSamples: summaryAggregates.recentSamples.map((s) => ({ ...s }))
  };
}

export function clearSummaryAggregates(): void {
  summaryAggregates.totalSessions = 0;
  summaryAggregates.modeBreakdown = { semantic: 0, recency: 0 };
  summaryAggregates.totalSelected = 0;
  summaryAggregates.totalDiscarded = 0;
  summaryAggregates.errorCount = 0;
  summaryAggregates.scoreRanges = {
    semantic: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 },
    recency: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 }
  };
  summaryAggregates.recentSamples = [];
}

export function clearSessionTelemetry() {
  sessionTelemetry.length = 0;
}
