import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';

const credential = new DefaultAzureCredential();
const scope = 'https://cognitiveservices.azure.com/.default';
const baseUrl = `${config.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/${config.AZURE_OPENAI_API_VERSION}`;
const query = config.AZURE_OPENAI_API_QUERY.startsWith('?')
  ? config.AZURE_OPENAI_API_QUERY
  : `?${config.AZURE_OPENAI_API_QUERY}`;
function withQuery(path: string) {
  return `${baseUrl}${path}${path.includes('?') ? `&${config.AZURE_OPENAI_API_QUERY}` : query}`;
}

let cachedBearer:
  | {
      token: string;
      expiresOnTimestamp: number;
    }
  | null = null;

async function authHeaders(): Promise<Record<string, string>> {
  if (config.AZURE_OPENAI_API_KEY) {
    return { 'api-key': config.AZURE_OPENAI_API_KEY };
  }

  const now = Date.now();
  if (cachedBearer && cachedBearer.expiresOnTimestamp - now > 120000) {
    return { Authorization: `Bearer ${cachedBearer.token}` };
  }

  const tokenResponse = await credential.getToken(scope);
  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure AD token for Azure OpenAI.');
  }

  cachedBearer = {
    token: tokenResponse.token,
    expiresOnTimestamp: tokenResponse.expiresOnTimestamp ?? now + 15 * 60 * 1000
  };

  return { Authorization: `Bearer ${tokenResponse.token}` };
}

function buildMessage(role: 'system' | 'user' | 'assistant' | 'developer', text: string) {
  return {
    role,
    content: [
      {
        type: 'input_text',
        text
      }
    ]
  };
}

function sanitizeRequest<T extends Record<string, any>>(body: T) {
  const clone: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      clone[key] = value;
    }
  }
  return clone as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders();
  const response = await fetch(withQuery(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure OpenAI request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.json() as Promise<T>;
}

export interface ResponseTextFormat {
  type: 'text' | 'json_schema' | 'json_object';
  name?: string;
  schema?: Record<string, unknown>;
  strict?: boolean;
  description?: string;
}

export interface ResponsePayload {
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'developer'; content: string }>;
  temperature?: number;
  max_output_tokens?: number;
  model?: string;
  textFormat?: ResponseTextFormat;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: Record<string, unknown> | 'none';
  parallel_tool_calls?: boolean;
  previous_response_id?: string;
  store?: boolean;
  background?: boolean;
  include?: string[];
  truncation?: 'auto' | 'none';
  // Advanced streaming options pass-through
  stream_options?: { include_usage?: boolean };
  // Optional raw fields for direct mapping
  instructions?: string | Array<Record<string, unknown>>;
  input?: Array<Record<string, unknown>>;
}

export async function createResponse(payload: ResponsePayload) {
  const request = sanitizeRequest({
    model: payload.model ?? config.AZURE_OPENAI_GPT_DEPLOYMENT,
    max_output_tokens: payload.max_output_tokens,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
    parallel_tool_calls: payload.parallel_tool_calls,
    previous_response_id: payload.previous_response_id,
    store: payload.store,
    background: payload.background,
    include: payload.include,
    truncation: payload.truncation,
    input:
      payload.input ?? payload.messages.map((msg) => buildMessage(msg.role, msg.content)),
    instructions: payload.instructions,
    text:
      payload.textFormat !== undefined
        ? {
            format: sanitizeRequest(payload.textFormat)
          }
        : undefined
  });

  return postJson<{
    output_text?: string;
    output?: Array<{ type: string; role?: string; content?: Array<{ type: string; text?: string }> }>;
  }>('/responses', request);
}

export async function createResponseStream(payload: ResponsePayload) {
  const headers = await authHeaders();
  const body = sanitizeRequest({
    model: payload.model ?? config.AZURE_OPENAI_GPT_DEPLOYMENT,
    max_output_tokens: payload.max_output_tokens,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
    parallel_tool_calls: payload.parallel_tool_calls,
    stream: true,
    stream_options: payload.stream_options,
    previous_response_id: payload.previous_response_id,
    store: payload.store,
    background: payload.background,
    include: payload.include,
    truncation: payload.truncation,
    input:
      payload.input ?? payload.messages.map((msg) => buildMessage(msg.role, msg.content)),
    instructions: payload.instructions,
    text:
      payload.textFormat !== undefined
        ? {
            format: sanitizeRequest(payload.textFormat)
          }
        : undefined
  });

  const response = await fetch(withQuery('/responses'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...headers
    },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`Azure OpenAI streaming failed: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.body.getReader();
}

export async function createEmbeddings(inputs: string[] | string, model?: string) {
  // Use separate endpoint for embeddings if configured
  const embeddingEndpoint = config.AZURE_OPENAI_EMBEDDING_ENDPOINT || config.AZURE_OPENAI_ENDPOINT;
  const embeddingApiKey = config.AZURE_OPENAI_EMBEDDING_API_KEY || config.AZURE_OPENAI_API_KEY;
  const embeddingBaseUrl = `${embeddingEndpoint.replace(/\/+$/, '')}/openai/${config.AZURE_OPENAI_API_VERSION}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (embeddingApiKey) {
    headers['api-key'] = embeddingApiKey;
  } else {
    const tokenResponse = await credential.getToken(scope);
    if (!tokenResponse?.token) {
      throw new Error('Failed to obtain Azure AD token for Azure OpenAI.');
    }
    headers['Authorization'] = `Bearer ${tokenResponse.token}`;
  }

  const response = await fetch(
    `${embeddingBaseUrl}/embeddings${embeddingBaseUrl.includes('?') ? `&${config.AZURE_OPENAI_API_QUERY}` : query}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model ?? config.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
        input: inputs
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Azure OpenAI request failed: ${response.status} ${response.statusText} - ${text}`);
  }

  return response.json() as Promise<{
    data: Array<{ embedding: number[] }>;
  }>;
}

// Helpers for stateful operations
export async function retrieveResponse(responseId: string, include?: string[]) {
  const headers = await authHeaders();
  const includeQuery = include?.length
    ? `?${include.map((i) => `include[]=${encodeURIComponent(i)}`).join('&')}`
    : '';
  const url = withQuery(`/responses/${encodeURIComponent(responseId)}${includeQuery}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure OpenAI retrieve failed: ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
}

export async function deleteResponse(responseId: string) {
  const headers = await authHeaders();
  const res = await fetch(withQuery(`/responses/${encodeURIComponent(responseId)}`), {
    method: 'DELETE',
    headers
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure OpenAI delete failed: ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json().catch(() => ({}));
}

export async function listInputItems(responseId: string) {
  const headers = await authHeaders();
  const res = await fetch(withQuery(`/responses/${encodeURIComponent(responseId)}/input_items`), {
    headers
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Azure OpenAI input items failed: ${res.status} ${res.statusText} - ${text}`);
  }
  return res.json();
}
