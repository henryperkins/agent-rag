import { trace, context } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';

let tracerInitialized = false;

function ensureTracer() {
  if (tracerInitialized) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    // No tracing backend configured; use default no-op tracer.
    tracerInitialized = true;
    return;
  }

  const provider = new NodeTracerProvider();
  const exporter = new OTLPTraceExporter({ url: endpoint });
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();
  tracerInitialized = true;
}

export function getTracer() {
  ensureTracer();
  return trace.getTracer('agentic-orchestrator');
}

export async function traced<T>(name: string, fn: () => Promise<T>) {
  const tracer = getTracer();
  const span = tracer.startSpan(name);
  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: 2, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
}
