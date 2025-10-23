import { SpanStatusCode } from '@opentelemetry/api';
import { getTracer } from '../orchestrator/telemetry.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryableErrors?: string[];
}

export interface RetryInvocationContext {
  attempt: number;
}

export async function withRetry<T>(
  operation: string,
  fn: (signal: AbortSignal, context?: RetryInvocationContext) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    timeoutMs = 30000,
    retryableErrors = ['ECONNRESET', 'ETIMEDOUT', '429', '503', 'AbortError']
  } = options;

  const tracer = getTracer();

  return tracer.startActiveSpan(`retry:${operation}`, async (span) => {
    span.setAttribute('retry.operation', operation);
    span.setAttribute('retry.max', maxRetries);

    let attempt = 0;
    let lastError: any;

    try {
      while (attempt <= maxRetries) {
        const controller = new AbortController();
        let timeoutId: NodeJS.Timeout | undefined;

        try {
          const timedOperation = fn(controller.signal, { attempt });
          const result = await (timeoutMs && timeoutMs > 0
            ? Promise.race([
                timedOperation,
                new Promise<never>((_, reject) => {
                  timeoutId = setTimeout(() => {
                    controller.abort();
                    const timeoutError = new Error(`${operation} timed out after ${timeoutMs}ms`);
                    (timeoutError as any).code = 'ETIMEDOUT';
                    reject(timeoutError);
                  }, timeoutMs);
                })
              ])
            : timedOperation);

          if (attempt > 0) {
            console.info(`${operation} succeeded after ${attempt} retries.`);
            span.addEvent('retry.success', { attempt });
          }

          span.setAttribute('retry.attempts', attempt);
          span.setStatus({ code: SpanStatusCode.OK });
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          return result;
        } catch (error: any) {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          controller.abort();

          lastError = error;
          const isRetryable = retryableErrors.some(
            (code) =>
              error.message?.includes(code) ||
              error.code?.includes(code) ||
              error.status?.toString().includes(code)
          );

          span.addEvent('retry.failure', {
            attempt,
            message: error?.message ?? String(error)
          });

          if (!isRetryable || attempt === maxRetries) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
            throw error;
          }

          attempt += 1;
          const waitTime = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          span.addEvent('retry.wait', { attempt, waitTime });
          console.warn(`${operation} failed (attempt ${attempt}/${maxRetries}). Retrying in ${waitTime}ms...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      throw lastError;
    } finally {
      span.end();
    }
  });
}
