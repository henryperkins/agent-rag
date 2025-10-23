# Backend Audit Findings

## Executive Summary

Top risk is that Azure Knowledge Agent responses lose their “unified grounding” mapping, so citations cannot be trusted when the agent is the primary retriever. Sanitization currently strips all structural whitespace from user prompts, undermining retrieval fidelity and safety checks. **Confidence:** Medium (coverage is broad but not exhaustive runtime validation).

## Detailed Findings

- **High – Knowledge Agent citations lose unified grounding** (`backend/src/azure/knowledgeAgent.ts:70`): the handler only scans `references`, `citations`, and `answer.citations`, but never parses `answer.unified_grounding` / `grounding` strings emitted by the Agent API. Those strings carry the authoritative document-chain IDs. Without parsing, downstream context loses the mapping, so when we rely on agent-only results we cannot verify or redact hallucinated references.  
  _Fix_: parse the unified grounding payload, map IDs to the normalized `Reference` objects, persist the mapping in diagnostics, and surface it to the critic/citation validator before accepting an agent response.
- **Medium – Input sanitization removes structural cues** (`backend/src/middleware/sanitize.ts:52`): collapsing all whitespace via `.replace(/\s+/g, ' ')` erases bulleting, paragraph breaks, and code layout. That harms embedding quality, undermines prompt-injection heuristics, and makes the knowledge agent view a flattened transcript.  
  _Fix_: restrict sanitization to stripping script tags/HTML while preserving newlines and meaningful indentation (for example, normalize CRLF but keep `\n`).
- **Medium – Reranker telemetry misreports thresholds after fallbacks** (`backend/src/orchestrator/index.ts:1112`): `retrievalDiagnostics.thresholdUsed` is always set to `config.RERANKER_THRESHOLD`, even when the fallback pipeline lowers the cutoff to `RETRIEVAL_FALLBACK_RERANKER_THRESHOLD` or zero. This hides degraded retrieval states and blocks alerting on aggressive fallback usage.  
  _Fix_: emit the actual threshold used by `retrieveTool` (propagate through `diagnostics`) and log coverage/threshold deltas per attempt.
- **Low – Divergent directory/bootstrap logic** (`backend/src/services/sessionStore.ts:32`, `backend/src/orchestrator/semanticMemoryStore.ts:39`): both stores maintain their own `ensureDirectory`/SQLite initialization paths. Bugs in one (permissions, journaling) will not be fixed in the other.  
  _Fix_: extract a shared helper for filesystem preparation and SQLite pragmas.

## Duplicated / Divergent Logic Map

- Directory/bootstrap utilities duplicated between `SessionStore` and `SemanticMemoryStore`; extract to a shared module.
- Embedding generation (`generateEmbedding`, `embedTexts`) lives in both `azure/directSearch.ts` and `utils/embeddings.ts` with overlapping caching concerns; consider a single embeddings client to avoid drift.

## Telemetry & Monitoring Assessment

- **Strengths:** structured search logging (`performSearchRequest`) records correlation IDs, latency, and request IDs; CRAG/adaptive retrieval emit telemetry events.
- **Gaps:** reranker metrics and fallback thresholds are not surfaced; knowledge agent attempts lack duration/usage stats; streaming path captures token usage but sync path drops it; no per-step latency for lazy load or query reformulations. Instrument those before relying on automated quality gates.

## Hardening Checklist

- Parse and validate knowledge-agent unified grounding prior to accepting citations.
- Preserve prompt structure during sanitization; add targeted prompt-injection filters instead of global whitespace collapse.
- Surface actual reranker thresholds, coverage, and fallback counts in telemetry (and alert on degradations).
- De-duplicate SQLite/bootstrap helpers and centralize embeddings client configuration.
- Capture token/latency metrics for all retrieval/reformulation steps (lazy load, adaptive retries, web filters) to ensure observability parity.
