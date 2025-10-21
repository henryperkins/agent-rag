import { SpanStatusCode } from '@opentelemetry/api';
import { getTracer } from '../orchestrator/telemetry.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryableErrors?: string[];
}

/**
 * Wraps an operation with retry logic and dual-timeout enforcement.
 *
 * Defense-in-depth timeout strategy:
 * 1. AbortController signal - passed to operation for clean cancellation
 * 2. Promise.race timeout - fallback if operation ignores signal
 *
 * This ensures timeout enforcement even when operations don't respect AbortSignal.
 *
 * @param operation - Operation name for logging/telemetry
 * @param fn - Function to retry, optionally accepts AbortSignal parameter
 * @param options - Retry configuration
 */
export async function withRetry<T>(
  operation: string,
  fn: (signal?: AbortSignal) => Promise<T>,
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
        // Create AbortController for this attempt
        const controller = new AbortController();
        let timeoutId: NodeJS.Timeout | undefined;

        try {
          // Dual timeout strategy:
          // 1. AbortController - for operations that respect signals
          // 2. Promise.race - for operations that ignore signals
          const timeout = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              controller.abort(); // Cancel operation if it supports AbortSignal
              reject(new Error(`Operation timeout after ${timeoutMs}ms`));
            }, timeoutMs);
          });

          // Pass signal to operation (backward compatible - operation can ignore it)
          const result = await Promise.race([fn(controller.signal), timeout]);

          // Clear timeout if operation completed successfully
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          if (attempt > 0) {
            console.info(`${operation} succeeded after ${attempt} retries.`);
            span.addEvent('retry.success', { attempt });
          }

          span.setAttribute('retry.attempts', attempt);
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (error: any) {
          // Clean up timeout if operation failed
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          lastError = error;

          // Check if error is retryable
          const isTimeoutError = error.message?.includes('timeout') || error.name === 'AbortError';
          const isRetryable =
            isTimeoutError ||
            retryableErrors.some(
              (code) =>
                error.message?.includes(code) ||
                error.code?.includes(code) ||
                error.status?.toString().includes(code)
            );

          span.addEvent('retry.failure', {
            attempt,
            message: error?.message ?? String(error),
            isTimeout: isTimeoutError
          });

          if (!isRetryable || attempt === maxRetries) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message });
            throw error;
          }

          attempt += 1;
          const waitTime = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
          span.addEvent('retry.wait', { attempt, waitTime });
          console.warn(
            `${operation} failed (attempt ${attempt}/${maxRetries})${isTimeoutError ? ' [TIMEOUT]' : ''}. Retrying in ${waitTime}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      throw lastError;
    } finally {
      span.end();
    }
  });
}
