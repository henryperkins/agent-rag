export type Role = 'user' | 'assistant' | 'system';
export interface AgentMessage {
    role: Role;
    content: string;
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
}
export interface ActivityStep {
    type: string;
    description: string;
    timestamp?: string;
}
export interface PlanStep {
    action: 'vector_search' | 'web_search' | 'both' | 'answer';
    query?: string;
    k?: number;
}
export interface PlanSummary {
    confidence: number;
    steps: PlanStep[];
}
export interface CriticReport {
    grounded: boolean;
    coverage: number;
    issues?: string[];
    action: 'accept' | 'revise';
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
export interface AgenticRetrievalResponse {
    response: string;
    references: Reference[];
    activity: ActivityStep[];
    lazyReferences?: Reference[];
    summaryTokens?: number;
    mode?: 'direct' | 'lazy' | 'knowledge_agent';
    strategy?: 'direct' | 'knowledge_agent' | 'hybrid';
    knowledgeAgentAnswer?: string;
    fullContentAvailable?: boolean;
    fallbackAttempts?: number;
    minDocumentsRequired?: number;
    fallbackTriggered?: boolean;
    adaptiveStats?: unknown;
    knowledgeAgentGrounding?: KnowledgeAgentGroundingSummary;
    thresholdUsed?: number;
    thresholdHistory?: number[];
}
export interface KnowledgeAgentGroundingSummary {
    mapping: Record<string, string>;
    citationMap: Record<string, string[]>;
    unmatched: string[];
}
export interface WebResult {
    id: string;
    title: string;
    snippet: string;
    url: string;
    body?: string;
    rank?: number;
    relevance?: number;
    fetchedAt: string;
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
        retrieval_time_ms?: number;
        critic_iterations?: number;
        plan?: PlanSummary;
        trace_id?: string;
        context_budget?: Record<string, number>;
        critic_report?: CriticReport;
        web_context?: {
            tokens: number;
            trimmed: boolean;
            text?: string;
            results: Array<{
                id: string;
                title: string;
                url: string;
                rank?: number;
            }>;
        };
        critique_history?: Array<{
            attempt: number;
            coverage: number;
            grounded: boolean;
            action: 'accept' | 'revise';
            issues?: string[];
        }>;
        summary_selection?: SummarySelectionStats;
        retrieval_mode?: 'direct' | 'lazy' | 'knowledge_agent';
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
export interface RetrievalDiagnostics {
    attempted: 'direct' | 'lazy' | 'fallback_vector' | 'knowledge_agent';
    succeeded: boolean;
    retryCount: number;
    documents: number;
    meanScore?: number;
    minScore?: number;
    maxScore?: number;
    thresholdUsed?: number;
    thresholdHistory?: number[];
    fallbackReason?: string;
    escalated?: boolean;
    mode?: 'direct' | 'lazy' | 'knowledge_agent';
    strategy?: 'direct' | 'knowledge_agent' | 'hybrid';
}
export interface SessionTrace {
    sessionId: string;
    mode: 'sync' | 'stream';
    startedAt: string;
    completedAt?: string;
    plan?: PlanSummary;
    planConfidence?: number;
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
    };
    critiqueHistory?: Array<{
        attempt: number;
        grounded: boolean;
        coverage: number;
        action: 'accept' | 'revise';
        issues?: string[];
    }>;
    webContext?: {
        tokens: number;
        trimmed: boolean;
        results: Array<{
            id: string;
            title: string;
            url: string;
            rank?: number;
        }>;
    };
    summarySelection?: SummarySelectionStats;
    events: TraceEvent[];
    knowledgeAgentGrounding?: KnowledgeAgentGroundingSummary;
    rerankerThresholdUsed?: number;
    rerankerThresholdHistory?: number[];
    error?: string;
}
export interface OrchestratorTools {
    retrieve: (args: {
        messages: AgentMessage[];
    }) => Promise<AgenticRetrievalResponse>;
    webSearch: (args: {
        query: string;
        count?: number;
        mode?: 'summary' | 'full';
    }) => Promise<WebSearchResponse>;
    answer: (args: {
        question: string;
        context: string;
        citations?: Reference[];
        revisionNotes?: string[];
    }) => Promise<{
        answer: string;
        citations?: Reference[];
    }>;
    critic: (args: {
        draft: string;
        evidence: string;
        question: string;
    }) => Promise<CriticReport>;
}
//# sourceMappingURL=types.d.ts.map
