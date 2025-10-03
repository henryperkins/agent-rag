export type Role = 'user' | 'assistant' | 'system';

export interface AgentMessage {
  role: Role;
  content: string;
}

export interface Citation {
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

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  activity: ActivityStep[];
  metadata?: {
    retrieval_time_ms?: number;
    critic_iterations?: number;
    plan?: unknown;
    trace_id?: string;
    context_budget?: Record<string, number>;
    critic_report?: {
      grounded: boolean;
      coverage?: number;
      action: string;
      issues?: string[];
    };
    web_context?: {
      tokens: number;
      trimmed: boolean;
      text?: string;
      results: Array<{ id?: string; title?: string; url?: string; rank?: number }>;
    };
    critique_history?: Array<{
      attempt: number;
      coverage: number;
      grounded: boolean;
      action: 'accept' | 'revise';
      issues?: string[];
    }>;
    summary_selection?: SummarySelectionStats;
  };
}
