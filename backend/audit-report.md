# Backend Audit Report

## Executive Summary

- **Top risks**:
  1. User-supplied `system`/`assistant` roles bypass safety controls.
  2. Web-grounded answers are rejected because citation validation only accepts numeric tags.
  3. Azure Search and knowledge-agent fetches lack abort propagation, leading to hangs.
  4. Federated fallback replaces, rather than merges, knowledge-agent grounding results.
- **Confidence**: High — every backend source file reviewed.

## Detailed Findings

### High – User-controlled system role allows prompt hijack (`backend/src/middleware/sanitize.ts:7`)

The sanitizer only validates the role value and preserves it. A client can POST `/chat` with `role: "system"` to override internal guardrails before retrieval.  
**Remediation**: Normalize all external messages to `user` (or reject non-user roles) and inject a server-owned system prompt so only the service emits governance instructions.

### High – Citation validator rejects web-derived answers (`backend/src/orchestrator/dispatch.ts:100`, `backend/src/utils/citation-validator.ts:24`)

Web snippets are labeled `[Web 1]`, `[Web 2]`, but `validateCitationIntegrity` only accepts `[n]`. When the model cites `[Web 1]`, validation fails and the answer becomes “I do not know. (Citation validation failed)”.  
**Remediation**: Align numbering (use numeric indices everywhere) or expand the validator to translate `[Web n]` into the proper citation entry.

### Medium – Azure search/agent calls can hang indefinitely (`backend/src/azure/searchHttp.ts:69`, `backend/src/azure/lazyRetrieval.ts:89`)

`performSearchRequest` sets no timeout and ignores the `AbortSignal` passed from `withRetry`. Slow upstreams make sessions hang until Fastify’s outer timeout fires, defeating retries and telemetry.  
**Remediation**: Thread an `AbortSignal` into every fetch, race with a timeout, and respect the retry controller provided by `withRetry`.

### Medium – Federated fallback discards knowledge-agent grounding (`backend/src/tools/index.ts:490`)

When knowledge-agent returns fewer than `RETRIEVAL_MIN_DOCS` and federation is enabled, the code returns only federated references, dropping grounding metadata and diagnostics from the agent.  
**Remediation**: Merge federated results with the existing agent references or only short-circuit when the agent produced zero items.

## Duplicated / Divergent Logic Map

- Hybrid fallback logic (reranker relaxation → top-k expansion → vector-only) exists in both `retrieveTool` and `fallbackVectorSearch`, with differing telemetry payloads. Centralize to keep diagnostics consistent.
- Knowledge-agent and lazy retrieval both call `enforceRerankerThreshold` but capture correlation IDs differently, complicating threshold-history analysis.
- Telemetry events emit different JSON shapes depending on caller (`telemetry`, adaptive retrieval, knowledge-agent). Standardize event framing for downstream consumers.

## Telemetry & Monitoring Assessment

- Azure Search logs include structured start/complete events with correlation and request IDs — solid baseline.
- Missing latency metrics for knowledge-agent and adaptive retrieval attempts; no per-attempt timing emitted.
- Synchronous `/chat` responses do not emit token usage, hindering cost tracking compared with SSE mode.
- Telemetry payloads use inconsistent schemas, increasing ingestion complexity.
- Absent abort propagation means timeouts aren’t recorded — once added, log timeout reasons and retry counts.

## Hardening Checklist

1. Enforce server-owned roles (`system`/`assistant`) and reject or downscope client-supplied non-user roles.
2. Synchronize citation numbering or extend validation to handle `[Web n]`, with regression tests.
3. Propagate abort/timeouts through all Azure Search, knowledge-agent, and OpenAI fetches; capture latency metrics.
4. Merge knowledge-agent references with federated/adaptive fallbacks to preserve grounding metadata.
5. Normalize telemetry event schemas and include per-stage latency plus token usage for synchronous responses.
6. Add regression tests covering citation integrity, federated merges, and injected system-role attempts.
