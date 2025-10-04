import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

let tracerInitialized = false;

function ensureTracer() {
  if (tracerInitialized) return;

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const serviceName = process.env.OTEL_SERVICE_NAME || 'agentic-orchestrator';
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
  });

  const provider = new NodeTracerProvider({ resource });

  if (endpoint) {
    const exporter = new OTLPTraceExporter({ url: endpoint });
    provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  }

  if (process.env.ENABLE_CONSOLE_TRACING?.toLowerCase() === 'true' || !endpoint) {
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  provider.register();
  tracerInitialized = true;
}

export function getTracer() {
  ensureTracer();
  return trace.getTracer('agentic-orchestrator');
}

export async function traced<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, unknown>) {
  const tracer = getTracer();
  const span = tracer.startSpan(name, attributes ? { attributes } : undefined);
  try {
    return await context.with(trace.setSpan(context.active(), span), fn);
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
}
