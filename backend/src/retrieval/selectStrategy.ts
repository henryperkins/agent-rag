import type { AgentMessage } from '../../../shared/types.js';
import type { AppConfig } from '../config/app.js';

export type RetrievalStrategy = AppConfig['RETRIEVAL_STRATEGY'];

function hasConversationalContext(messages?: AgentMessage[] | null): boolean {
  return Array.isArray(messages) && messages.length > 0;
}

export function selectRetrievalStrategy(config: AppConfig, messages?: AgentMessage[] | null): RetrievalStrategy {
  const configured = config.RETRIEVAL_STRATEGY;
  if ((configured === 'knowledge_agent' || configured === 'hybrid') && hasConversationalContext(messages)) {
    return configured;
  }
  return 'direct';
}

export function shouldPreferKnowledgeAgent(config: AppConfig, messages?: AgentMessage[] | null): boolean {
  const strategy = selectRetrievalStrategy(config, messages);
  return strategy === 'knowledge_agent' || strategy === 'hybrid';
}
