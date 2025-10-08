# Agent-RAG Enhancements — Implemented vs. Planned

_Last updated: 2025-10-08_

This document consolidates the feature audit across the backend/frontend codebase, **Azure Component Enhancements**, and the **2025 Agentic RAG Techniques Deep Dive**. Items are split between capabilities that currently exist in the repository and enhancements that remain in planning or design-only form.

---

## ✅ Implemented Capabilities (in source today)

- **Responses API Integration**
  - `/responses` client wrappers with managed identity fallback (`backend/src/azure/openaiClient.ts`).
  - Streaming SSE parsing, usage telemetry, and optional response storage flag (`backend/src/orchestrator/index.ts`, `backend/src/tools/index.ts`).

- **Retrieval Pipeline**
  - Hybrid Azure AI Search with vector + semantic reranking and lazy retrieval summaries (`backend/src/azure/directSearch.ts`, `backend/src/azure/lazyRetrieval.ts`, `backend/src/tools/index.ts`).
  - Reciprocal Rank Fusion with optional semantic boost (`backend/src/orchestrator/reranker.ts`).
  - Query decomposition with sub-query execution and critic-driven lazy hydration (`backend/src/orchestrator/queryDecomposition.ts`, `backend/src/orchestrator/index.ts`).

- **Context & Memory**
  - History compaction, semantic summary selection, salience tracking (`backend/src/orchestrator/compact.ts`, `backend/src/orchestrator/summarySelector.ts`).
  - Persistent semantic memory store driven by SQLite + embedding similarity (`backend/src/orchestrator/semanticMemoryStore.ts`).

- **Quality Control**
  - Multi-pass critic loop with revision guidance and streaming retry support (`backend/src/orchestrator/index.ts`).
  - SSE timeout guard and input sanitization updates (per `backend/src/server.ts`, `backend/src/middleware/sanitize.ts`).

- **Frontend & Telemetry**
  - SSE streaming client with plan/activity panels and newly surfaced search highlights (`frontend/src/components/SourcesPanel.tsx`).
  - Session telemetry recorder, OpenTelemetry spans, and structured `SessionTrace` payloads (`backend/src/orchestrator/sessionTelemetryStore.ts`, `backend/src/orchestrator/telemetry.ts`).

---

## 🛠️ Planned / Design-Only Enhancements (not in code yet)

### From _docs/azure-component-enhancements.md_

- **Multi-Stage Synthesis Pipeline**
  - `multiStageSynthesis` extract → compress → synthesize flow.
  - Scratchpad reasoning module (`orchestrator/scratchpad.ts`) and prompt enrichment.
  - Ensemble answer generation with parallel strategy selection.

- **Adaptive Retrieval Upgrades**
  - Quality-scored query reformulation (`retrieveWithAdaptiveRefinement`).
  - Citation usage tracker feeding semantic memory analytics.
  - Multi-index federated search and associated config flags.

- **Web Search Enhancements**
  - Multi-source academic search (Semantic Scholar/arXiv).
  - Domain authority/semantic quality filtering (`webQualityFilter.ts`).
  - Incremental web loading with coverage-based batching.

### From _docs/2025-agentic-rag-techniques-deepdive.md_

- **Self-RAG Reflection Tokens**
  - `[ISREL]`, `[ISSUP]`, `[ISUSE]` gating, and full reflection-tuned critic/generator flow.

- **Corrective RAG (CRAG)**
  - Retrieval evaluator grading, knowledge strip refinement, and automated web fallback.

- **HyDE Retrieval**
  - Hypothetical answer generation with answer-to-answer embedding search.

- **Advanced Roadmap**
  - RAPTOR hierarchical summarization trees.
  - GraphRAG knowledge graph construction & queries.
  - Multi-modal ingestion (vision-enabled embeddings, table extraction).

---

### Notes

- Planned items remain referenced only in documentation and do **not** have corresponding modules, feature flags, or tests in the repository.
- Implemented capabilities above are verified against current source files and covered by the backend Vitest suite (`cd backend && pnpm test`).
