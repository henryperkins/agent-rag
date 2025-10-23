import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { answerTool } from '../tools/index.js';

vi.mock('../azure/openaiClient.js', () => ({
  createResponse: vi.fn()
}));

const openaiClient = await import('../azure/openaiClient.js');
const createResponse = openaiClient.createResponse as Mock;

describe('answerTool citation validation', () => {
  beforeEach(() => {
    createResponse.mockReset();
  });

  it('returns fallback when citations are provided without markers', async () => {
    createResponse.mockResolvedValue({
      output_text: 'Citation free response'
    });

    const result = await answerTool({
      question: 'What is Azure AI Search?',
      context: 'Context about Azure AI Search.',
      citations: [{ id: '1', content: 'Azure AI Search enables retrieval.' }]
    });

    expect(result.answer).toBe('I do not know. (No grounded citations available)');
  });

  it('returns answer when citations are valid and referenced', async () => {
    createResponse.mockResolvedValue({
      output_text: 'Azure AI Search indexes content for discovery. [1]'
    });

    const result = await answerTool({
      question: 'What is Azure AI Search?',
      context: 'Context about Azure AI Search.',
      citations: [{ id: '1', content: 'Azure AI Search enables retrieval.' }]
    });

    expect(result.answer).toBe('Azure AI Search indexes content for discovery. [1]');
  });

  it('falls back when citation markers reference missing entries', async () => {
    createResponse.mockResolvedValue({
      output_text: 'Azure AI Search indexes content for discovery. [2]'
    });

    const result = await answerTool({
      question: 'What is Azure AI Search?',
      context: 'Context about Azure AI Search.',
      citations: [{ id: '1', content: 'Azure AI Search enables retrieval.' }]
    });

    expect(result.answer).toBe('I do not know. (Citation validation failed)');
  });

  it('falls back when cited reference lacks usable content', async () => {
    createResponse.mockResolvedValue({
      output_text: 'Azure AI Search indexes content for discovery. [1]'
    });

    const result = await answerTool({
      question: 'What is Azure AI Search?',
      context: 'Context about Azure AI Search.',
      citations: [{ id: '1', content: '   ' }]
    });

    expect(result.answer).toBe('I do not know. (Citation validation failed)');
  });
});
