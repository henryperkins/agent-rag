function stringifyJson(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function collectText(node: any, buffer: string[]) {
  if (!node) {
    return;
  }

  if (typeof node === 'string') {
    buffer.push(node);
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  if (typeof node.output_text === 'string' && node.output_text.length > 0) {
    buffer.push(node.output_text);
  }

  if (typeof node.text === 'string' && node.text.length > 0) {
    buffer.push(node.text);
  }

  if (node.type === 'output_json' || node.type === 'json') {
    const jsonPayload = node.json ?? node.output_json ?? node.data;
    const jsonString = stringifyJson(jsonPayload);
    if (jsonString) {
      buffer.push(jsonString);
    }
  } else if (node.output_json !== undefined) {
    const jsonString = stringifyJson(node.output_json);
    if (jsonString) {
      buffer.push(jsonString);
    }
  }

  if (node.arguments !== undefined) {
    const args = node.arguments;
    if (typeof args === 'string') {
      if (args.trim().length > 0) {
        buffer.push(args);
      }
    } else {
      const serialized = stringifyJson(args);
      if (serialized) {
        buffer.push(serialized);
      }
    }
  }

  if (node.parsed !== undefined) {
    const parsedString = stringifyJson(node.parsed);
    if (parsedString) {
      buffer.push(parsedString);
    }
  }

  if (Array.isArray((node as { content?: unknown[] }).content)) {
    for (const part of (node as { content: unknown[] }).content) {
      collectText(part, buffer);
    }
  }
}

export function extractOutputText(response: any): string {
  if (!response) {
    return '';
  }

  if (typeof response.output_text === 'string' && response.output_text.length > 0) {
    return response.output_text;
  }

  if (response.output_json !== undefined) {
    const jsonString = stringifyJson(response.output_json);
    if (jsonString) {
      return jsonString;
    }
  }

  const buffer: string[] = [];

  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      collectText(item, buffer);
    }
  } else {
    collectText(response, buffer);
  }

  return buffer.join('');
}

function normalizeReasoningText(value: string): string | null {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return null;
  }

  const lower = collapsed.toLowerCase();
  if (
    lower === 'summary_text' ||
    lower === 'reasoning' ||
    lower === 'insight' ||
    lower.startsWith('response.reasoning')
  ) {
    return null;
  }

  // Skip strings that are effectively numeric/marker noise
  if (!/[a-z]/i.test(collapsed) && collapsed.length <= 3) {
    return null;
  }

  return collapsed;
}

function pushSummaryText(value: unknown, summaries: string[], seen: Set<string>) {
  if (typeof value !== 'string') {
    return;
  }
  const normalized = normalizeReasoningText(value);
  if (!normalized || seen.has(normalized)) {
    return;
  }
  seen.add(normalized);
  summaries.push(normalized);
}

function collectReasoning(node: any, summaries: string[], seen: Set<string>) {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) collectReasoning(item, summaries, seen);
    return;
  }

  if (typeof node === 'string') {
    pushSummaryText(node, summaries, seen);
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;

  if (record.summary !== undefined) {
    const summary = record.summary;
    if (typeof summary === 'string') {
      pushSummaryText(summary, summaries, seen);
    } else if (Array.isArray(summary)) {
      for (const part of summary) {
        if (!part) {
          continue;
        }
        if (typeof part === 'string') {
          pushSummaryText(part, summaries, seen);
        } else if (typeof part === 'object') {
          const text = (part as { text?: unknown }).text;
          if (typeof text === 'string') {
            pushSummaryText(text, summaries, seen);
          } else {
            collectReasoning(part, summaries, seen);
          }
        }
      }
    } else if (summary && typeof summary === 'object') {
      collectReasoning(summary, summaries, seen);
    }
  }

  if (typeof record.text === 'string') {
    pushSummaryText(record.text, summaries, seen);
  }

  if (typeof record.delta === 'string') {
    pushSummaryText(record.delta, summaries, seen);
  } else if (record.delta && typeof record.delta === 'object') {
    collectReasoning(record.delta, summaries, seen);
  }

  if (record.reasoning !== undefined && record.reasoning !== record) {
    collectReasoning(record.reasoning, summaries, seen);
  }

  if (typeof (record as { thought?: unknown }).thought === 'string') {
    pushSummaryText((record as { thought: string }).thought, summaries, seen);
  }

  if (record.thinking !== undefined) {
    collectReasoning(record.thinking, summaries, seen);
  }

  if (record.steps !== undefined) {
    collectReasoning(record.steps, summaries, seen);
  }

  if (record.part !== undefined && record.part !== record) {
    collectReasoning(record.part, summaries, seen);
  }

  const skipKeys = new Set([
    'summary',
    'delta',
    'reasoning',
    'text',
    'part',
    'thought',
    'thinking',
    'steps',
    'type',
    'obfuscation',
    'item_id',
    'output_index',
    'content_index',
    'summary_index',
    'id',
    'event_id',
    'index',
    'role'
  ]);

  for (const [key, value] of Object.entries(record)) {
    if (skipKeys.has(key)) {
      continue;
    }
    collectReasoning(value, summaries, seen);
  }
}

export function extractReasoningSummary(response: any): string[] | undefined {
  if (!response) {
    return undefined;
  }
  const summaries: string[] = [];
  const seen = new Set<string>();
  collectReasoning(response, summaries, seen);
  return summaries.length > 0 ? summaries : undefined;
}
