import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/app.js';
import type { AgentMessage } from '../../../shared/types.js';
import { selectRetrievalStrategy, shouldPreferKnowledgeAgent } from '../retrieval/selectStrategy.js';

const baseMessages: AgentMessage[] = [
  { role: 'user', content: 'Hello world' }
];

function makeConfig(strategy: AppConfig['RETRIEVAL_STRATEGY']): AppConfig {
  return {
    RETRIEVAL_STRATEGY: strategy
    // The rest of AppConfig properties are not needed for these unit tests.
  } as AppConfig;
}

describe('selectRetrievalStrategy', () => {
  it('returns direct for direct strategy regardless of messages', () => {
    const config = makeConfig('direct');
    expect(selectRetrievalStrategy(config, baseMessages)).toBe('direct');
    expect(selectRetrievalStrategy(config, [])).toBe('direct');
  });

  it('falls back to direct when no conversational context is available', () => {
    const config = makeConfig('hybrid');
    expect(selectRetrievalStrategy(config)).toBe('direct');
    expect(selectRetrievalStrategy(config, [])).toBe('direct');
  });

  it('respects configured strategy when context is available', () => {
    expect(selectRetrievalStrategy(makeConfig('hybrid'), baseMessages)).toBe('hybrid');
    expect(selectRetrievalStrategy(makeConfig('knowledge_agent'), baseMessages)).toBe('knowledge_agent');
  });
});

describe('shouldPreferKnowledgeAgent', () => {
  it('returns false for direct strategy', () => {
    expect(shouldPreferKnowledgeAgent(makeConfig('direct'), baseMessages)).toBe(false);
  });

  it('returns false when messages are missing', () => {
    expect(shouldPreferKnowledgeAgent(makeConfig('hybrid'), undefined)).toBe(false);
  });

  it('returns true when hybrid or knowledge agent have context', () => {
    expect(shouldPreferKnowledgeAgent(makeConfig('hybrid'), baseMessages)).toBe(true);
    expect(shouldPreferKnowledgeAgent(makeConfig('knowledge_agent'), baseMessages)).toBe(true);
  });
});
