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

function collectReasoning(node: any, summaries: string[]) {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectReasoning(item, summaries);
    }
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  if (node.type === 'reasoning' && Array.isArray(node.summary)) {
    for (const part of node.summary) {
      if (part && typeof part === 'object') {
        const text = (part as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim().length > 0) {
          summaries.push(text.trim());
        }
      }
    }
  }

  for (const value of Object.values(node)) {
    collectReasoning(value, summaries);
  }
}

export function extractReasoningSummary(response: any): string[] | undefined {
  if (!response) {
    return undefined;
  }
  const summaries: string[] = [];
  collectReasoning(response, summaries);
  return summaries.length > 0 ? summaries : undefined;
}
