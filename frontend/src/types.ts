// Re-export all shared types
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
  SessionTrace,
  SessionEvaluation,
  OrchestratorTools,
  RouteMetadata,
  LazyReference,
  LazyRetrievalResponse
} from '../../shared/types.js';
