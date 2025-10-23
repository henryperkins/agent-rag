import { performance } from 'node:perf_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { getSearchAuthHeaders } from './searchAuth.js';

export interface SearchRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  allowedStatuses?: number[];
  contentType?: string | null;
  correlationId?: string;
  retryAttempt?: number;
}

export interface SearchRequestResult {
  response: Response;
  durationMs: number;
  requestId?: string;
  correlationId: string;
}

export async function performSearchRequest(
  operation: string,
  url: string,
  options: SearchRequestOptions = {}
): Promise<SearchRequestResult> {
  const {
    method = 'GET',
    body,
    headers = {},
    allowedStatuses = [],
    contentType,
    correlationId: providedCorrelationId,
    retryAttempt
  } = options;

  const authHeaders = await getSearchAuthHeaders();
  const finalHeaders: Record<string, string> = {
    ...authHeaders,
    ...headers
  };

  const init: RequestInit = {
    method,
    headers: finalHeaders
  };

  const correlationId = providedCorrelationId ?? randomUUID();

  if (body !== undefined) {
    const resolvedContentType = contentType ?? 'application/json';
    if (resolvedContentType) {
      finalHeaders['Content-Type'] = resolvedContentType;
    }
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const start = performance.now();
  console.info(
    JSON.stringify({
      event: 'azure.search.request.start',
      operation,
      method,
      url,
      correlationId
    })
  );

  const response = await fetch(url, init);
  const durationMs = Math.round(performance.now() - start);
  const requestId =
    response.headers.get('x-ms-request-id') ??
    response.headers.get('apim-request-id') ??
    undefined;
  const queryHash = createHash('sha256').update(url).digest('hex').slice(0, 16);

  const statusPermitted = response.ok || allowedStatuses.includes(response.status);
  if (!statusPermitted) {
    const errorText = await response.text().catch(() => '');
    // Sanitize error text to prevent secret leakage
    const { sanitizeLogMessage } = await import('../utils/openai.js');
    const sanitizedError = sanitizeLogMessage(errorText);
    console.error(
      JSON.stringify({
        event: 'azure.search.request.error',
        operation,
        status: response.status,
        durationMs,
        error: sanitizedError,
        correlationId,
        requestId,
        retryAttempt: retryAttempt ?? 0,
        queryHash
      })
    );
    const error = new Error(
      `${operation} failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
    (error as { status?: number }).status = response.status;
    (error as { correlationId?: string }).correlationId = correlationId;
    (error as { requestId?: string }).requestId = requestId;
    (error as { body?: string }).body = errorText;
    throw error;
  }

  const logFn = response.ok ? console.info : console.warn;
  logFn(
    JSON.stringify({
      event: 'azure.search.request.completed',
      operation,
      status: response.status,
      durationMs,
      correlationId,
      requestId,
      queryHash
    })
  );

  return { response, durationMs, requestId, correlationId };
}
