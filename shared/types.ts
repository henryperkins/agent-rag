export type Role = 'user' | 'assistant' | 'system';

export interface AgentMessage {
  role: Role;
  content: string;
}

export type FeatureFlag =
  | 'ENABLE_MULTI_INDEX_FEDERATION'
  | 'ENABLE_LAZY_RETRIEVAL'
  | 'ENABLE_SEMANTIC_SUMMARY'
  | 'ENABLE_INTENT_ROUTING'
  | 'ENABLE_SEMANTIC_MEMORY'
  | 'ENABLE_QUERY_DECOMPOSITION'
  | 'ENABLE_WEB_RERANKING'
  | 'ENABLE_SEMANTIC_BOOST'
  | 'ENABLE_RESPONSE_STORAGE'
  | 'ENABLE_ADAPTIVE_RETRIEVAL'
  | 'ENABLE_HYBRID_WEB_RETRIEVAL';

export type FeatureOverrideMap = Partial<Record<FeatureFlag, boolean>>;

export type FeatureSource = 'config' | 'persisted' | 'override';

export interface FeatureSelectionMetadata {
  resolved: Record<FeatureFlag, boolean>;
  overrides?: FeatureOverrideMap;
  persisted?: FeatureOverrideMap;
  sources?: Record<FeatureFlag, FeatureSource>;
}

export interface ChatRequestPayload {
  messages: AgentMessage[];
  sessionId?: string;
  feature_overrides?: FeatureOverrideMap;
}

export interface Reference {
  id?: string;
  title?: string;
  content?: string;
  chunk?: string;
  url?: string;
  page_number?: number;
  pageNumber?: number;
  score?: number;
  sourceIndex?: string;
  sourceType?: string;
  metadata?: Record<string, unknown>;
  highlights?: Record<string, string[]>;
  captions?: Array<{ text: string; highlights?: string }>;
}

export interface LazyReference extends Reference {
  summary?: string;
  isSummary?: boolean;
  loadFull?: () => Promise<string>;
}

export interface LazyRetrievalResponse {
  references: LazyReference[];
  summaryTokens: number;
  fullContentAvailable: boolean;
}

export interface KnowledgeAgentDiagnostic {
  correlationId: string;
  attempted: boolean;
  fallbackTriggered: boolean;
  requestId?: string;
  statusCode?: number;
  errorMessage?: string;
  failurePhase?: 'invocation' | 'zero_results' | 'partial_results';
  grounding?: KnowledgeAgentGroundingSummary;
}

export interface AgenticRetrievalDiagnostics {
  correlationId?: string;
  knowledgeAgent?: KnowledgeAgentDiagnostic;
  fallbackAttempts?: number;
  knowledgeAgentSummaryProvided?: boolean;
  retryCount?: number;
  coverageChecklistCount?: number;
  contextSectionLabels?: string[];
}

export interface ActivityStep {
  type: string;
  description: string;
  timestamp?: string;
}

export interface PlanStep {
  action: 'vector_search' | 'web_search' | 'both' | 'browser_agent' | 'answer';
  query?: string;
  k?: number;
}

export interface PlanSummary {
  confidence: number;
  steps: PlanStep[];
  reasoningSummary?: string;
}

// F-003: Model resolution tracking
export interface ModelResolutionMetadata {
  source: 'route_config' | 'env_override' | 'fallback_default';
  overridden: boolean;
}

export interface RouteMetadata {
  intent: string;
  confidence: number;
  reasoning: string;
  insights?: string[];
  model: string; // Deprecated: use configuredModel instead
  configuredModel?: string; // F-003: Model from route config
  actualModel?: string; // F-003: Resolved deployment name
  modelResolution?: ModelResolutionMetadata; // F-003: Resolution tracking
  retrieverStrategy: string;
  maxTokens: number;
}

export interface CriticReport {
  grounded: boolean;
  coverage: number;
  issues?: string[];
  action: 'accept' | 'revise';
  forced?: boolean;
  reasoningSummary?: string;
}

export interface SummarySelectionStats {
  mode: 'semantic' | 'recency';
  totalCandidates: number;
  selectedCount: number;
  discardedCount: number;
  usedFallback: boolean;
  maxScore?: number;
  minScore?: number;
  meanScore?: number;
  maxSelectedScore?: number;
  minSelectedScore?: number;
  error?: string;
}

export interface EvaluationDimension {
  metric: string;
  score: number;
  threshold: number;
  passed: boolean;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface RagEvaluationSnapshot {
  retrieval?: EvaluationDimension;
  documentRetrieval?: EvaluationDimension;
  groundedness?: EvaluationDimension;
  groundednessPro?: EvaluationDimension;
  relevance?: EvaluationDimension;
  responseCompleteness?: EvaluationDimension;
}

export interface QualityEvaluationSnapshot {
  coherence?: EvaluationDimension;
  fluency?: EvaluationDimension;
  qa?: EvaluationDimension;
}

export type SafetyEvaluationCategory =
  | 'hate_and_unfairness'
  | 'sexual'
  | 'violence'
  | 'self_harm'
  | 'content_safety'
  | 'protected_materials'
  | 'code_vulnerability'
  | 'ungrounded_attributes'
  | 'indirect_attack';

export interface SafetyEvaluationSnapshot {
  flagged: boolean;
  categories: SafetyEvaluationCategory[];
  reason?: string;
  evidence?: Record<string, unknown>;
}

export interface AgentEvaluationSnapshot {
  intentResolution?: EvaluationDimension;
  toolCallAccuracy?: EvaluationDimension;
  taskAdherence?: EvaluationDimension;
}

export interface SessionEvaluationSummary {
  status: 'pass' | 'needs_review';
  failingMetrics: string[];
  generatedAt: string;
}

export interface SessionEvaluation {
  rag?: RagEvaluationSnapshot;
  quality?: QualityEvaluationSnapshot;
  safety?: SafetyEvaluationSnapshot;
  agent?: AgentEvaluationSnapshot;
  summary: SessionEvaluationSummary;
}

export interface AgenticRetrievalResponse {
  response: string;
  references: Reference[];
  activity: ActivityStep[];
  lazyReferences?: LazyReference[];
  summaryTokens?: number;
  mode?: 'direct' | 'lazy' | 'knowledge_agent' | 'hybrid_kb_web' | 'web_only';
  strategy?: 'direct' | 'knowledge_agent' | 'hybrid';
  knowledgeAgentAnswer?: string;
  fullContentAvailable?: boolean;
  fallbackAttempts?: number;
  minDocumentsRequired?: number;
  fallbackTriggered?: boolean;
  adaptiveStats?: AdaptiveRetrievalStats;
  diagnostics?: AgenticRetrievalDiagnostics;
  knowledgeAgentGrounding?: KnowledgeAgentGroundingSummary;
  thresholdUsed?: number;
  thresholdHistory?: number[];
  coverageChecklistCount?: number;
  contextSectionLabels?: string[];
  knowledgeAgentSummaryProvided?: boolean;
  freshnessAnalysis?: any;
  mergeStats?: Record<string, any>;
}

export interface KnowledgeAgentGroundingSummary {
  mapping: Record<string, string>;
  citationMap: Record<string, string[]>;
  unmatched: string[];
}

export interface HyperbrowserLink {
  url: string;
  text?: string;
}

export interface HyperbrowserFact {
  claim?: string;
  context?: string;
}

export interface WebResult {
  id?: string;
  title: string;
  snippet: string;
  url: string;
  body?: string;
  content?: string;
  html?: string;
  links?: HyperbrowserLink[];
  screenshot?: string;
  keyPoints?: string[];
  facts?: HyperbrowserFact[];
  metadata?: Record<string, unknown> | null;
  scrapedAt?: string;
  extractedAt?: string;
  rank?: number;
  relevance?: number;
  fetchedAt?: string;
  // Academic paper fields
  source?: string; // 'Semantic Scholar', 'arXiv', 'Google', etc.
  authors?: string;
  publishedDate?: string;
  citationCount?: number;
  influentialCitationCount?: number;
  authorityScore?: number; // 0-1 normalized score
  venue?: string;
  category?: string;
  isOpenAccess?: boolean;
  pdfUrl?: string;
}

export interface WebSearchResponse {
  results: WebResult[];
  contextText?: string;
  tokens?: number;
  trimmed?: boolean;
}

export interface ChatResponse {
  answer: string;
  citations: Reference[];
  activity: ActivityStep[];
  metadata?: {
    features?: FeatureSelectionMetadata;
    retrieval_time_ms?: number;
    critic_iterations?: number;
    plan?: PlanSummary;
    trace_id?: string;
    traceId?: string;
    context_budget?: Record<string, number>;
    contextBudget?: Record<string, number>;
    critic_report?: CriticReport;
    web_context?: {
      tokens: number;
      trimmed: boolean;
      text?: string;
      results: Array<{ id: string; title: string; url: string; rank?: number }>;
    };
    webContext?: {
      tokens: number;
      trimmed: boolean;
      text?: string;
      results: Array<{ id: string; title: string; url: string; rank?: number }>;
    };
    critique_history?: Array<{
      attempt: number;
      coverage: number;
      grounded: boolean;
      action: 'accept' | 'revise';
      issues?: string[];
      usedFullContent?: boolean;
      forced?: boolean;
    }>;
    critiqueHistory?: Array<{
      attempt: number;
      coverage: number;
      grounded: boolean;
      action: 'accept' | 'revise';
      issues?: string[];
      usedFullContent?: boolean;
      forced?: boolean;
    }>;
    summary_selection?: SummarySelectionStats;
    summarySelection?: SummarySelectionStats;
    route?: RouteMetadata;
    retrieval_mode?: 'direct' | 'lazy' | 'knowledge_agent' | 'hybrid_kb_web' | 'web_only';
    retrievalMode?: 'direct' | 'lazy' | 'knowledge_agent' | 'hybrid_kb_web' | 'web_only';
    lazy_summary_tokens?: number;
    lazySummaryTokens?: number;
    retrieval?: RetrievalDiagnostics;
    diagnostics?: AgenticRetrievalDiagnostics;
    responses?: Array<{ attempt: number; responseId?: string }>;
    semantic_memory?: {
      recalled: number;
      entries: Array<{
        id: number;
        type: string;
        similarity?: number;
        preview?: string;
      }>;
    };
    semanticMemory?: {
      recalled: number;
      entries: Array<{
        id: number;
        type: string;
        similarity?: number;
        preview?: string;
      }>;
    };
    query_decomposition?: {
      active: boolean;
      complexityScore?: number;
      subQueries?: Array<{
        id: number;
        query: string;
        dependencies: number[];
      }>;
      synthesisPrompt?: string;
    };
    queryDecomposition?: {
      active: boolean;
      complexityScore?: number;
      subQueries?: Array<{
        id: number;
        query: string;
        dependencies: number[];
      }>;
      synthesisPrompt?: string;
    };
    // Adaptive Query Reformulation telemetry snapshot (snake_case for API consistency)
    adaptive_retrieval?: AdaptiveRetrievalStats;
    adaptiveRetrieval?: AdaptiveRetrievalStats;
    knowledge_agent_grounding?: KnowledgeAgentGroundingSummary;
    knowledgeAgentGrounding?: KnowledgeAgentGroundingSummary;
    reranker_threshold_used?: number;
    reranker_threshold_history?: number[];
    rerankerThresholdUsed?: number;
    rerankerThresholdHistory?: number[];
    retrieval_latency_ms?: number;
    retrievalLatencyMs?: number;
    evaluation?: SessionEvaluation;
  };
}

export interface TraceEvent {
  time: string;
  stage: string;
  data?: unknown;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms?: number;
  error?: string;
}

// F-002: Extended attempted mode to include hybrid_kb_web
export type RetrievalAttemptedMode = 'direct' | 'lazy' | 'fallback_vector' | 'knowledge_agent' | 'hybrid_kb_web';

// F-002: Canonical retrieval kind for unified classification
export type RetrievalKind =
  | 'knowledge_agent_only'
  | 'knowledge_agent_web_fallback'
  | 'direct_hybrid'
  | 'lazy_hybrid'
  | 'pure_vector'
  | 'web_only';

// F-001: Citation validation diagnostics
export interface CitationDiagnostics {
  totalCitations: number;
  usedCitations: Set<number>;
  unusedCitations: number[];
  unusedRatio: number;
  sourceBreakdown?: {
    retrieval: { total: number; used: number };
    web: { total: number; used: number };
  };
}

// F-005: Threshold metadata for observability
export interface ThresholdMetadata {
  thresholdApplied: boolean;
  thresholdValue: number;
  preFilterCount: number;
  postFilterCount: number;
}

export interface RetrievalDiagnostics {
  attempted: RetrievalAttemptedMode; // F-002: Use new type
  succeeded: boolean;
  retryCount: number;
  documents: number;
  meanScore?: number;
  minScore?: number;
  maxScore?: number;
  thresholdUsed?: number;
  thresholdHistory?: number[];
  fallbackReason?: string;
  fallback_reason?: string;
  escalated?: boolean;
  mode?: 'direct' | 'lazy' | 'knowledge_agent' | 'hybrid_kb_web' | 'web_only';
  summaryTokens?: number;
  strategy?: 'direct' | 'knowledge_agent' | 'hybrid';
  kind?: RetrievalKind; // F-002: Canonical classification
  highlightedDocuments?: number;
  fallbackAttempts?: number;
  minDocumentsRequired?: number;
  fallbackTriggered?: boolean;
  correlationId?: string;
  knowledgeAgent?: KnowledgeAgentDiagnostic;
  coverageChecklistCount?: number;
  contextSectionLabels?: string[];
  knowledgeAgentSummaryProvided?: boolean;
  latencyMs?: number;
  citationDiagnostics?: CitationDiagnostics; // F-001: Citation usage tracking
  thresholdMetadata?: ThresholdMetadata; // F-005: Threshold filtering metadata
}

export interface SessionTrace {
  sessionId: string;
  mode: 'sync' | 'stream';
  startedAt: string;
  completedAt?: string;
  plan?: PlanSummary;
  planConfidence?: number;
  route?: RouteMetadata;
  contextBudget?: {
    history_tokens: number;
    summary_tokens: number;
    salience_tokens: number;
    web_tokens?: number;
  };
  retrieval?: RetrievalDiagnostics;
  critic?: {
    grounded: boolean;
    coverage?: number;
    action: string;
    iterations: number;
    issues?: string[];
    reasoningSummary?: string;
  };
  critiqueHistory?: Array<{
    attempt: number;
    grounded: boolean;
    coverage: number;
    action: 'accept' | 'revise';
    issues?: string[];
    usedFullContent?: boolean;
    forced?: boolean;
  }>;
  responses?: Array<{ attempt: number; responseId?: string }>;
  webContext?: {
    tokens: number;
    trimmed: boolean;
    results: Array<{ id: string; title: string; url: string; rank?: number }>;
  };
  summarySelection?: SummarySelectionStats;
  events: TraceEvent[];
  semanticMemory?: {
    recalled: number;
    entries: Array<{
      id: number;
      type: string;
      similarity?: number;
      preview?: string;
    }>;
  };
  queryDecomposition?: {
    active: boolean;
    complexityScore?: number;
    subQueries?: Array<{
      id: number;
      query: string;
      dependencies: number[];
    }>;
    synthesisPrompt?: string;
  };
  error?: string;
  evaluation?: SessionEvaluation;
  knowledgeAgentGrounding?: KnowledgeAgentGroundingSummary;
  rerankerThresholdUsed?: number;
  rerankerThresholdHistory?: number[];
}

export interface OrchestratorTools {
  retrieve: (args: {
    query: string;
    filter?: string;
    top?: number;
    messages?: AgentMessage[];
    features?: FeatureOverrideMap;
  }) => Promise<AgenticRetrievalResponse>;
  lazyRetrieve?: (args: { query: string; filter?: string; top?: number }) => Promise<AgenticRetrievalResponse>;
  webSearch: (args: {
    query: string;
    count?: number;
    mode?: 'summary' | 'full' | 'hyperbrowser_scrape' | 'hyperbrowser_extract';
  }) => Promise<WebSearchResponse>;
  answer: (args: {
    question: string;
    context: string;
    citations?: Reference[];
    revisionNotes?: string[];
    model?: string;
    maxTokens?: number;
    systemPrompt?: string;
    temperature?: number;
    previousResponseId?: string;
    features?: FeatureOverrideMap;
    sessionId?: string;
    userId?: string;
    intent?: string;
  }) => Promise<{ answer: string; citations?: Reference[]; responseId?: string; reasoningSummary?: string; usage?: unknown }>;
  critic: (args: { draft: string; evidence: string; question: string }) => Promise<CriticReport>;
}

// Adaptive Query Reformulation telemetry
export interface AdaptiveRetrievalAttempt {
  attempt: number;
  query: string; // redacted sample OK when emitted externally
  quality: {
    coverage: number;
    diversity: number;
    authority: number;
    freshness: number;
  };
  latency_ms?: number;
}

export interface AdaptiveRetrievalStats {
  enabled: boolean;
  attempts: number;
  triggered: boolean;
  trigger_reason: 'coverage' | 'diversity' | 'both' | null;
  thresholds: { coverage: number; diversity: number };
  initial_quality: {
    coverage: number;
    diversity: number;
    authority: number;
    freshness: number;
  };
  final_quality: {
    coverage: number;
    diversity: number;
    authority: number;
    freshness: number;
  };
  reformulations_count: number;
  reformulations_sample: string[];
  latency_ms_total?: number;
  per_attempt: AdaptiveRetrievalAttempt[];
}

// F-001: Citation metadata for tracking enumeration and sources
export interface CitationMetadata {
  citationMap: Map<number, { source: 'retrieval' | 'web'; index: number }>;
  totalCount: number;
}

// F-006: Citation telemetry events
export type CitationTelemetryEvent =
  | { type: 'citation_validation_pending'; bufferLength: number; reason: string }
  | { type: 'citation_validation_failure'; error: string; diagnostics: any }
  | { type: 'citation_usage_warning'; unusedRatio: number; unusedCount: number; sourceBreakdown?: any };
