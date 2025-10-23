import { DefaultAzureCredential } from '@azure/identity';
import { config, isDevelopment } from '../config/app.js';

const credential = new DefaultAzureCredential();

/**
 * Sanitize Azure error messages to prevent information disclosure in production
 */
function sanitizeAzureError(status: number, statusText: string, body: string): string {
  if (isDevelopment) {
    return `${status} ${statusText} - ${body}`;
  }
  // In production, only expose status code and generic message
  return `${status} ${statusText}`;
}
const scope = 'https://cognitiveservices.azure.com/.default';
const baseUrl = `${config.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/${config.AZURE_OPENAI_API_VERSION}`;
const normalizedQuery = config.AZURE_OPENAI_API_QUERY.replace(/^\?+/, '');
const query = normalizedQuery ? `?${normalizedQuery}` : '';
function withQuery(path: string) {
  if (!normalizedQuery) {
    return `${baseUrl}${path}`;
  }
  return `${baseUrl}${path}${path.includes('?') ? `&${normalizedQuery}` : query}`;
}

let cachedBearer:
  | {
      token: string;
      expiresOnTimestamp: number;
    }
  | null = null;
let openaiTokenRefreshPromise: Promise<{ token: string; expiresOnTimestamp: number }> | null = null;

function isTokenExpiringSoon(cached: { expiresOnTimestamp: number }): boolean {
  const now = Date.now();
  return cached.expiresOnTimestamp - now <= 120000;
}

async function refreshOpenAIToken(): Promise<{ token: string; expiresOnTimestamp: number }> {
  const tokenResponse = await credential.getToken(scope);
  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure AD token for Azure OpenAI.');
  }

  const now = Date.now();
  const newToken = {
    token: tokenResponse.token,
    expiresOnTimestamp: tokenResponse.expiresOnTimestamp ?? now + 15 * 60 * 1000
  };

  cachedBearer = newToken;
  return newToken;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (config.AZURE_OPENAI_API_KEY) {
    return { 'api-key': config.AZURE_OPENAI_API_KEY };
  }

  // Check if we have a valid cached token
  if (cachedBearer && !isTokenExpiringSoon(cachedBearer)) {
    return { Authorization: `Bearer ${cachedBearer.token}` };
  }

  // If a refresh is already in progress, wait for it
  if (openaiTokenRefreshPromise) {
    const token = await openaiTokenRefreshPromise;
    return { Authorization: `Bearer ${token.token}` };
  }

  // Start a new refresh and cache the promise
  openaiTokenRefreshPromise = refreshOpenAIToken().finally(() => {
    openaiTokenRefreshPromise = null;
  });

  const token = await openaiTokenRefreshPromise;
  return { Authorization: `Bearer ${token.token}` };
}

async function embeddingAuthHeaders(): Promise<Record<string, string>> {
  if (config.AZURE_OPENAI_EMBEDDING_API_KEY) {
    return { 'api-key': config.AZURE_OPENAI_EMBEDDING_API_KEY };
  }
  if (config.AZURE_OPENAI_API_KEY) {
    return { 'api-key': config.AZURE_OPENAI_API_KEY };
  }
  return authHeaders();
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

const TEMPERATURE_UNSUPPORTED_PREFIXES = ['gpt-5', 'o1', 'o3', 'o4'];

function temperatureSupported(model: string | undefined, hasReasoningConfig: boolean) {
  if (hasReasoningConfig) {
    return false;
  }
  if (!model) {
    return true;
  }

  const candidates = new Set<string>();
  candidates.add(model);
  if (model === config.AZURE_OPENAI_GPT_DEPLOYMENT) {
    candidates.add(config.AZURE_OPENAI_GPT_MODEL_NAME);
  }

  for (const candidate of candidates) {
    const normalized = candidate.trim().toLowerCase();
    if (TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      return false;
    }
  }

  return true;
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
    const sanitizedError = sanitizeAzureError(response.status, response.statusText, text);
    throw new Error(`Azure OpenAI request failed: ${sanitizedError}`);
  }

  return response.json() as Promise<T>;
}

// Discriminated union matching OpenAI.ResponseTextFormatConfiguration
export type ResponseTextFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      name: string; // Required for json_schema
      schema: Record<string, unknown>; // Required for json_schema
      description?: string;
      strict?: boolean; // default: false
    };

export interface ReasoningConfig {
  effort?: 'low' | 'medium' | 'high';
  summary?: 'auto' | 'concise' | 'detailed';
}

// Spec-compliant includable values from OpenAI.Includable enum
export type Includable =
  | 'code_interpreter_call.outputs'
  | 'computer_call_output.output.image_url'
  | 'file_search_call.results'
  | 'message.input_image.image_url'
  | 'message.output_text.logprobs'
  | 'reasoning.encrypted_content';

// Response interfaces matching #/components/schemas/AzureResponse
export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details: {
    cached_tokens: number;
  };
  output_tokens_details: {
    reasoning_tokens: number;
  };
}

export interface ResponseError {
  code: string;
  message: string;
  param?: string;
  type?: string;
  inner_error?: unknown;
}

export interface IncompleteDetails {
  reason: 'max_output_tokens' | 'content_filter';
}

export interface OutputItem {
  type: string;
  role?: string;
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown; // Allow additional properties for different item types
}

export interface AzureResponseOutput {
  // Identity and status
  id: string;
  object: 'response';
  status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  created_at: number; // Unix timestamp

  // Model and output
  model: string;
  output: OutputItem[];
  output_text?: string | null; // SDK convenience property

  // Usage tracking (critical for cost monitoring)
  usage?: ResponseUsage;

  // Error handling (required per spec)
  error: ResponseError | null;
  incomplete_details: IncompleteDetails | null;

  // Request parameters echoed back (required per spec)
  metadata: Record<string, string> | null;
  temperature: number | null;
  top_p: number | null;
  user: string | null;
  instructions: string | Array<Record<string, unknown>> | null;
  parallel_tool_calls: boolean | null;

  // Optional echoed parameters
  top_logprobs?: number | null;
  previous_response_id?: string | null;
  reasoning?: Record<string, unknown> | null;
  background?: boolean | null;
  max_output_tokens?: number | null;
  max_tool_calls?: number | null;
  text?: {
    format?: ResponseTextFormat;
  };
  tools?: Array<Record<string, unknown>>;
  tool_choice?: 'auto' | 'required' | 'none' | Record<string, unknown>;
  prompt?: Record<string, unknown> | null;
  truncation?: 'auto' | 'disabled' | null;
}

export interface EmbeddingsResponse {
  object: 'list';
  data: Array<{
    object: 'embedding';
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export interface ResponsePayload {
  // Model (optional with default from config)
  model?: string;

  // Core generation parameters
  temperature?: number; // 0-2, default: 1
  top_p?: number; // 0-1, nucleus sampling, default: 1
  max_output_tokens?: number; // int32, nullable

  // Text format configuration
  text?: {
    format?: ResponseTextFormat;
  };

  // Tool configuration
  tools?: Array<Record<string, unknown>>; // Should be OpenAI.Tool but kept flexible for now
  tool_choice?: 'auto' | 'required' | 'none' | Record<string, unknown>; // Supports literals + custom object
  parallel_tool_calls?: boolean; // default: true
  max_tool_calls?: number; // int32, limit tool call iterations

  // Conversation state
  previous_response_id?: string | null;
  instructions?: string | null; // System/developer message
  input?: string | Array<Record<string, unknown>>; // Text or structured items

  // Response configuration
  truncation?: 'auto' | 'disabled'; // Fixed: was 'none', spec only allows 'disabled'
  include?: Includable[]; // Fixed: was string[], now spec-compliant enum
  store?: boolean; // default: true
  background?: boolean; // default: false

  // Advanced parameters
  top_logprobs?: number; // 0-20, int32
  reasoning?: ReasoningConfig | null;
  prompt?: Record<string, unknown> | null; // OpenAI.Prompt object

  // Metadata and tracking
  metadata?: Record<string, string>; // Fixed: values must be strings per spec
  user?: string; // End-user identifier

  // Internal/deprecated (kept for backwards compatibility)
  messages?: Array<{ role: 'system' | 'user' | 'assistant' | 'developer'; content: string }>;
  textFormat?: ResponseTextFormat; // Deprecated: use text.format instead
}

export async function createResponse(payload: ResponsePayload): Promise<AzureResponseOutput> {
  const model = payload.model ?? config.AZURE_OPENAI_GPT_DEPLOYMENT;
  const temperature = temperatureSupported(model, Boolean(payload.reasoning)) ? payload.temperature : undefined;

  const request = sanitizeRequest({
    model,
    temperature,
    top_p: payload.top_p,
    max_output_tokens: payload.max_output_tokens,
    top_logprobs: payload.top_logprobs,
    reasoning: payload.reasoning,
    max_tool_calls: payload.max_tool_calls,
    prompt: payload.prompt,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
    parallel_tool_calls: payload.parallel_tool_calls,
    previous_response_id: payload.previous_response_id,
    store: payload.store,
    background: payload.background,
    include: payload.include,
    truncation: payload.truncation,
    metadata: payload.metadata,
    user: payload.user,
    input:
      payload.input ?? (payload.messages ? payload.messages.map((msg) => buildMessage(msg.role, msg.content)) : undefined),
    instructions: payload.instructions,
    text:
      payload.text?.format !== undefined
        ? {
            format: sanitizeRequest(payload.text.format)
          }
        : payload.textFormat !== undefined
        ? {
            format: sanitizeRequest(payload.textFormat)
          }
        : undefined
  });

  return postJson<AzureResponseOutput>('/responses', request);
}

export async function createResponseStream(payload: ResponsePayload) {
  const headers = await authHeaders();
  const model = payload.model ?? config.AZURE_OPENAI_GPT_DEPLOYMENT;
  const temperature = temperatureSupported(model, Boolean(payload.reasoning)) ? payload.temperature : undefined;

  const body = sanitizeRequest({
    model,
    temperature,
    top_p: payload.top_p,
    max_output_tokens: payload.max_output_tokens,
    top_logprobs: payload.top_logprobs,
    reasoning: payload.reasoning,
    max_tool_calls: payload.max_tool_calls,
    prompt: payload.prompt,
    tools: payload.tools,
    tool_choice: payload.tool_choice,
    parallel_tool_calls: payload.parallel_tool_calls,
    stream: true,
    previous_response_id: payload.previous_response_id,
    store: payload.store,
    background: payload.background,
    include: payload.include,
    truncation: payload.truncation,
    metadata: payload.metadata,
    user: payload.user,
    input:
      payload.input ?? (payload.messages ? payload.messages.map((msg) => buildMessage(msg.role, msg.content)) : undefined),
    instructions: payload.instructions,
    text:
      payload.text?.format !== undefined
        ? {
            format: sanitizeRequest(payload.text.format)
          }
        : payload.textFormat !== undefined
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
    const sanitizedError = sanitizeAzureError(response.status, response.statusText, text);
    throw new Error(`Azure OpenAI streaming failed: ${sanitizedError}`);
  }

  return response.body.getReader();
}

export async function createEmbeddings(
  inputs: string[] | string,
  model?: string,
  options: { signal?: AbortSignal } = {}
) {
  // Use separate endpoint for embeddings if configured
  const embeddingEndpoint = config.AZURE_OPENAI_EMBEDDING_ENDPOINT || config.AZURE_OPENAI_ENDPOINT;
  const embeddingBaseUrl = `${embeddingEndpoint.replace(/\/+$/, '')}/openai/${config.AZURE_OPENAI_API_VERSION}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(await embeddingAuthHeaders())
  };

  const response = await fetch(
    `${embeddingBaseUrl}/embeddings${embeddingBaseUrl.includes('?') ? `&${config.AZURE_OPENAI_API_QUERY}` : query}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model ?? config.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
        input: inputs
      }),
      signal: options.signal
    }
  );

  if (!response.ok) {
    const text = await response.text();
    const sanitizedError = sanitizeAzureError(response.status, response.statusText, text);
    throw new Error(`Azure OpenAI embeddings failed: ${sanitizedError}`);
  }

  return response.json() as Promise<EmbeddingsResponse>;
}

// Helpers for stateful operations
export async function retrieveResponse(responseId: string, include?: string[]): Promise<AzureResponseOutput> {
  const headers = await authHeaders();
  const includeQuery = include?.length
    ? `?${include.map((i) => `include[]=${encodeURIComponent(i)}`).join('&')}`
    : '';
  const url = withQuery(`/responses/${encodeURIComponent(responseId)}${includeQuery}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    const sanitizedError = sanitizeAzureError(res.status, res.statusText, text);
    throw new Error(`Azure OpenAI retrieve failed: ${sanitizedError}`);
  }
  return res.json() as Promise<AzureResponseOutput>;
}

export async function deleteResponse(responseId: string) {
  const headers = await authHeaders();
  const res = await fetch(withQuery(`/responses/${encodeURIComponent(responseId)}`), {
    method: 'DELETE',
    headers
  });
  if (!res.ok) {
    const text = await res.text();
    const sanitizedError = sanitizeAzureError(res.status, res.statusText, text);
    throw new Error(`Azure OpenAI delete failed: ${sanitizedError}`);
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
    const sanitizedError = sanitizeAzureError(res.status, res.statusText, text);
    throw new Error(`Azure OpenAI input items failed: ${sanitizedError}`);
  }
  return res.json();
}
