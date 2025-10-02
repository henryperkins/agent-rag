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
  };
}
