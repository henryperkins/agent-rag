import { describe, expect, it } from 'vitest';
import { extractReasoningSummary } from '../utils/openai.js';

describe('extractReasoningSummary', () => {
  it('captures reasoning delta text while ignoring obfuscation noise', () => {
    const event = {
      type: 'response.reasoning_summary_text.delta',
      delta: 'Consider the known facts.',
      obfuscation: 'A1B2C3'
    };

    expect(extractReasoningSummary(event)).toEqual(['Consider the known facts.']);
  });

  it('extracts reasoning summary parts from response output arrays', () => {
    const response = {
      output: [
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Step one: verify the retrieved evidence.' }]
        }
      ]
    };

    expect(extractReasoningSummary(response)).toEqual(['Step one: verify the retrieved evidence.']);
  });

  it('deduplicates repeated reasoning fragments', () => {
    const payload = {
      summary: ['Check the latest change log.', 'Check the latest change log.']
    };

    expect(extractReasoningSummary(payload)).toEqual(['Check the latest change log.']);
  });

  it('handles reasoning summary part events', () => {
    const event = {
      type: 'response.reasoning_summary_part.added',
      item_id: 'item-1',
      output_index: 0,
      summary_index: 0,
      part: {
        type: 'summary_text',
        text: 'Synthesize the sources before answering.'
      },
      obfuscation: 'XYZ123'
    };

    expect(extractReasoningSummary(event)).toEqual(['Synthesize the sources before answering.']);
  });
});
