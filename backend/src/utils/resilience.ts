export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryableErrors?: string[];
}

export interface TelemetryData {
  operation: string;
  startTime: number;
  endTime?: number;
  success?: boolean;
  error?: string;
  retries?: number;
}

const telemetryLog: TelemetryData[] = [];

export async function withRetry<T>(operation: string, fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    timeoutMs = 30000,
    retryableErrors = ['ECONNRESET', 'ETIMEDOUT', '429', '503', 'AbortError']
  } = options;

  const telemetry: TelemetryData = {
    operation,
    startTime: Date.now()
  };

  let attempt = 0;
  let lastError: any;

  while (attempt <= maxRetries) {
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
      );

      const result = await Promise.race([fn(), timeout]);

      telemetry.endTime = Date.now();
      telemetry.success = true;
      telemetry.retries = attempt;
      telemetryLog.push(telemetry);

      if (attempt > 0) {
        console.info(`${operation} succeeded after ${attempt} retries.`);
      }

      return result;
    } catch (error: any) {
      lastError = error;
      const isRetryable = retryableErrors.some(
        (code) =>
          error.message?.includes(code) ||
          error.code?.includes(code) ||
          error.status?.toString().includes(code)
      );

      if (!isRetryable || attempt === maxRetries) {
        telemetry.endTime = Date.now();
        telemetry.success = false;
        telemetry.error = error.message;
        telemetry.retries = attempt;
        telemetryLog.push(telemetry);
        throw error;
      }

      attempt++;
      const waitTime = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      console.warn(`${operation} failed (attempt ${attempt}/${maxRetries}). Retrying in ${waitTime}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  throw lastError;
}

export function getTelemetry(): TelemetryData[] {
  return [...telemetryLog];
}

export function clearTelemetry() {
  telemetryLog.length = 0;
}
