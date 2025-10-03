# Semantic Summary Selection Plan

This note captures the incremental work required to implement semantic summary selection as called out in `docs/unified-orchestrator-context-pipeline.md` (Phase 2 requirement).

## Enhancements
- **Embedding store**: Persist summary bullet embeddings alongside text in `memoryStore` so similarity can be computed without re-embedding every turn.
  - ✅ Implemented: summary bullets now carry cached embeddings in `memoryStore` to avoid redundant Azure calls.
- **Selection helper**: Introduce `selectRelevantSummaries(query, summaries, maxItems)` using Azure OpenAI embeddings, cosine similarity, and configurable `CONTEXT_MAX_SUMMARY_ITEMS` cap.
- **Context integration**: Update `buildContextSections` to call the helper instead of recency slicing, and fall back to recency when embeddings are unavailable.
- **Feature flag**: Govern rollout with `ENABLE_SEMANTIC_SUMMARY` (default `false`) so behaviour can be toggled post-evaluation.
- **Telemetry**: Emit metrics for selected vs. discarded summaries and similarity thresholds to validate behaviour in `/admin/telemetry`.

## Evaluation Prerequisites
- **Ground-truth pairs**: Assemble evaluation turns where ideal supporting summaries are known (from conversation transcripts or manual annotation).
- **Embedding quality check**: Benchmark chosen embedding model on the evaluation set to confirm semantic relevance improvements over recency slicing.
- **Token budget impact**: Measure additional tokens introduced per turn to ensure budgets (`CONTEXT_SUMMARY_TOKEN_CAP`) remain satisfied.
- **Success criteria**: Define acceptance metrics (e.g., ≥85% of selected summaries overlap with ground-truth set, zero budget overruns) before enabling in production.

## Rollout
- Implement behind feature flag, run against evaluation corpus, review telemetry, then enable by default once criteria met.
