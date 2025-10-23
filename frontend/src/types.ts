import type { AgentMessage as SharedAgentMessage, Reference } from '../../shared/types.js';

export type {
  Role,
  AgentMessage,
  Reference as Citation, // Alias for frontend compatibility
  ActivityStep,
  PlanStep,
  PlanSummary,
  CriticReport,
  SummarySelectionStats,
  EvaluationDimension,
  ChatResponse,
  WebResult,
  WebSearchResponse,
  AgenticRetrievalResponse,
  TraceEvent,
  RetrievalDiagnostics,
  AgenticRetrievalDiagnostics,
  KnowledgeAgentDiagnostic,
  SessionTrace,
  SessionEvaluation,
  OrchestratorTools,
  RouteMetadata,
  LazyReference,
  LazyRetrievalResponse,
  FeatureFlag,
  FeatureOverrideMap,
  FeatureSelectionMetadata,
  FeatureSource,
  ChatRequestPayload
} from '../../shared/types.js';

export interface ChatMessage extends SharedAgentMessage {
  id: string;
  citations?: Reference[];
  kind?: 'thought';
}
