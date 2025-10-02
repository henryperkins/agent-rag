import type { AgentMessage } from '../../../shared/types.js';

export type PlanAction = 'retrieve' | 'answer' | 'web_search';

export interface PlanResult {
  action: PlanAction;
  reasoning: string;
}

export async function decidePlan(messages: AgentMessage[]): Promise<PlanResult> {
  if (messages.length === 0) {
    return { action: 'answer', reasoning: 'No user input provided.' };
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return { action: 'answer', reasoning: 'Most recent turn is not a user question.' };
  }

  const text = last.content.toLowerCase();
  const needsRetrieval =
    text.includes('?') ||
    /^(what|how|why|when|where|who|tell|explain|describe|give)/.test(text) ||
    text.length > 40;

  if (needsRetrieval) {
    return { action: 'retrieve', reasoning: 'Question likely requires knowledge grounding.' };
  }

  if (text.includes('search the web') || text.includes('latest') || text.includes('current')) {
    return { action: 'web_search', reasoning: 'User explicitly requested web results.' };
  }

  return { action: 'answer', reasoning: 'Simple prompt that can be answered directly.' };
}
