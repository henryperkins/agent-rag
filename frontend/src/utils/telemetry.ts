export function normalizeTelemetryEvent(data: Record<string, unknown> | undefined) {
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
  if (data.knowledge_agent_grounding && !data.knowledgeAgentGrounding) {
    normalized.knowledgeAgentGrounding = data.knowledge_agent_grounding;
  }
  if (data.reranker_threshold_used && !data.rerankerThresholdUsed) {
    normalized.rerankerThresholdUsed = data.reranker_threshold_used;
  }
  if (data.reranker_threshold_history && !data.rerankerThresholdHistory) {
    normalized.rerankerThresholdHistory = data.reranker_threshold_history;
  }
  if (data.critique_history && !data.critiqueHistory) {
    normalized.critiqueHistory = data.critique_history;
  }
  if (data.retrieval_latency_ms !== undefined && data.retrievalLatencyMs === undefined) {
    normalized.retrievalLatencyMs = data.retrieval_latency_ms;
  }
  if (data.trace_id && !data.traceId) {
    normalized.traceId = data.trace_id;
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
