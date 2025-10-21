import { performance } from 'node:perf_hooks';
import { getSearchAuthHeaders } from './searchAuth.js';

export interface SearchRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  allowedStatuses?: number[];
  contentType?: string | null;
}

export interface SearchRequestResult {
  response: Response;
  durationMs: number;
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
    contentType
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
      url
    })
  );

  const response = await fetch(url, init);
  const durationMs = Math.round(performance.now() - start);

  const statusPermitted = response.ok || allowedStatuses.includes(response.status);
  if (!statusPermitted) {
    const errorText = await response.text().catch(() => '');
    console.error(
      JSON.stringify({
        event: 'azure.search.request.error',
        operation,
        status: response.status,
        durationMs,
        error: errorText
      })
    );
    throw new Error(
      `${operation} failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
    );
  }

  const logFn = response.ok ? console.info : console.warn;
  logFn(
    JSON.stringify({
      event: 'azure.search.request.completed',
      operation,
      status: response.status,
      durationMs
    })
  );

  return { response, durationMs };
}
