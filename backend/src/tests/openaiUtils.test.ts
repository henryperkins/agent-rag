import { describe, it, expect } from 'vitest';
import { extractOutputText } from '../utils/openai.js';

describe('extractOutputText', () => {
  it('returns the output_text field when present', () => {
    const response = { output_text: 'plain text response' };
    expect(extractOutputText(response)).toBe('plain text response');
  });

  it('collects message content text from output items', () => {
    const response = {
      output: [
        {
          type: 'message',
          content: [
            { type: 'output_text', text: 'first ' },
            { type: 'text', text: 'second' }
          ]
        }
      ]
    };

    expect(extractOutputText(response)).toBe('first second');
  });

  it('serializes output_json content found within items', () => {
    const response = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_json',
              json: { grounded: true, coverage: 0.95 }
            }
          ]
        }
      ]
    };

    expect(extractOutputText(response)).toBe(JSON.stringify({ grounded: true, coverage: 0.95 }));
  });

  it('serializes top-level output_json payloads', () => {
    const response = {
      output_json: { grounded: false, coverage: 0.1 }
    };

    expect(extractOutputText(response)).toBe(JSON.stringify({ grounded: false, coverage: 0.1 }));
  });

  it('collects JSON found in tool call arguments', () => {
    const response = {
      output: [
        {
          type: 'tool_call',
          arguments: '{"confidence":"correct"}'
        }
      ]
    };

    expect(extractOutputText(response)).toBe('{"confidence":"correct"}');
  });

  it('serializes parsed content payloads', () => {
    const response = {
      output: [
        {
          type: 'tool_result',
          parsed: { confidence: 'ambiguous', action: 'refine_documents' }
        }
      ]
    };

    expect(extractOutputText(response)).toBe(
      JSON.stringify({ confidence: 'ambiguous', action: 'refine_documents' })
    );
  });
});
