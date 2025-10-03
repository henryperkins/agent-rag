import type {
  ActivityStep,
  ChatResponse,
  CriticReport,
  PlanSummary,
  Reference,
  RetrievalDiagnostics,
  SessionTrace,
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
  webContext?: {
    text?: string;
    tokens?: number;
    trimmed?: boolean;
    results?: Array<Pick<WebResult, 'id' | 'title' | 'url' | 'rank'>>;
  };
}

const MAX_RECORDS = 100;
const sessionTelemetry: SessionTelemetryRecord[] = [];

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
  return data;
}

function clone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function pushRecord(record: SessionTelemetryRecord) {
  sessionTelemetry.unshift(record);
  if (sessionTelemetry.length > MAX_RECORDS) {
    sessionTelemetry.length = MAX_RECORDS;
  }
}

function recordEvent(state: SessionTelemetryRecord, event: string, data: unknown, timestamp: number) {
  const sanitized = sanitizeEventPayload(event, data);
  state.events.push({ event, data: clone(sanitized), timestamp });

  switch (event) {
    case 'status': {
      const stage = typeof (sanitized as any)?.stage === 'string' ? (sanitized as any).stage : String(event);
      state.status = stage;
      state.statusHistory.push({ stage, timestamp });
      break;
    }
    case 'context': {
      state.context = {
        history: (sanitized as any)?.history,
        summary: (sanitized as any)?.summary,
        salience: (sanitized as any)?.salience
      };
      break;
    }
    case 'plan': {
      state.plan = clone(sanitized as PlanSummary);
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
      state.activity = clone((sanitized as any)?.steps ?? []);
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
      const payload = sanitized as any;
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
      if (payload?.webContext) {
        state.webContext = clone(payload.webContext);
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
        state.activity = clone(response.activity);
        state.metadata = clone(response.metadata);
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

export function clearSessionTelemetry() {
  sessionTelemetry.length = 0;
}
