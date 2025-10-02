import type {
  ActivityStep,
  ChatResponse,
  CriticReport,
  PlanSummary,
  Reference,
  RetrievalDiagnostics,
  SessionTrace
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
}

const MAX_RECORDS = 100;
const sessionTelemetry: SessionTelemetryRecord[] = [];

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
  state.events.push({ event, data: clone(data), timestamp });

  switch (event) {
    case 'status': {
      const stage = typeof (data as any)?.stage === 'string' ? (data as any).stage : String(event);
      state.status = stage;
      state.statusHistory.push({ stage, timestamp });
      break;
    }
    case 'context': {
      state.context = {
        history: (data as any)?.history,
        summary: (data as any)?.summary,
        salience: (data as any)?.salience
      };
      break;
    }
    case 'plan': {
      state.plan = clone(data as PlanSummary);
      break;
    }
    case 'tool': {
      state.toolUsage = {
        references: (data as any)?.references,
        webResults: (data as any)?.webResults
      };
      break;
    }
    case 'citations': {
      state.citations = clone((data as any)?.citations ?? []);
      break;
    }
    case 'activity': {
      state.activity = clone((data as any)?.steps ?? []);
      break;
    }
    case 'critique': {
      state.critic = clone(data as CriticReport);
      break;
    }
    case 'telemetry': {
      const payload = data as any;
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
      break;
    }
    case 'trace': {
      const payload = data as { session?: SessionTrace };
      if (payload?.session) {
        state.trace = clone(payload.session);
      }
      break;
    }
    case 'complete': {
      if ((data as any)?.answer) {
        state.answer = (data as any).answer;
      }
      break;
    }
    case 'done': {
      if ((data as any)?.status) {
        state.finalStatus = (data as any).status;
      }
      break;
    }
    case 'error': {
      state.error = (data as any)?.message ?? 'Unknown error';
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
    question,
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
        state.answer = response.answer;
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
