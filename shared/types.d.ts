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
export interface AgenticRetrievalResponse {
    response: string;
    references: Reference[];
    activity: ActivityStep[];
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
    };
}
//# sourceMappingURL=types.d.ts.map