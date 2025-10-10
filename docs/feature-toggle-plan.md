# Feature Toggle Enablement Plan

## Overview

This document captures the current state of advanced features that ship disabled by default and outlines the plan to (1) verify each feature end-to-end and (2) expose runtime toggles in the user experience. The analysis is based solely on the repository source code.

## Flag Inventory

The following flags default to `false` in `backend/src/config/app.ts` and have no front-end controls:

| Flag                            | Primary code path                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ENABLE_MULTI_INDEX_FEDERATION` | `backend/src/tools/index.ts:80-104`, `backend/src/azure/multiIndexSearch.ts:109-180`           |
| `ENABLE_LAZY_RETRIEVAL`         | `backend/src/azure/lazyRetrieval.ts`, `backend/src/tools/index.ts:178-215`                     |
| `ENABLE_SEMANTIC_SUMMARY`       | `backend/src/orchestrator/summarySelector.ts`                                                  |
| `ENABLE_INTENT_ROUTING`         | `backend/src/orchestrator/router.ts:75-138`                                                    |
| `ENABLE_SEMANTIC_MEMORY`        | `backend/src/orchestrator/semanticMemoryStore.ts`, `backend/src/orchestrator/index.ts:822-907` |
| `ENABLE_QUERY_DECOMPOSITION`    | `backend/src/orchestrator/index.ts:606-742`, `backend/src/orchestrator/queryDecomposition.ts`  |
| `ENABLE_WEB_RERANKING`          | `backend/src/orchestrator/dispatch.ts:268-347`                                                 |
| `ENABLE_SEMANTIC_BOOST`         | `backend/src/orchestrator/dispatch.ts:283-305`                                                 |
| `ENABLE_RESPONSE_STORAGE`       | `backend/src/tools/index.ts:240-259`, `backend/src/orchestrator/index.ts:238-252`              |

All listed modules are fully implemented; the flags exist to prevent extra cost/latency by default.

## Flag Readiness & Verification

For each feature, we will extend automated coverage and add integration checks to ensure the code path is production-ready before exposing toggles.

### 1. Multi-index Federation

- **Goal**: Confirm `federatedSearch` is invoked and combines results correctly.
- **Test plan**: New Vitest toggling `config.ENABLE_MULTI_INDEX_FEDERATION` to `true`, stubbing multiple indexes and asserting merged references/activity.
- **Integration**: /chat request with overrides enables the flag and produces `federated_search` activity in response metadata.

### 2. Lazy Retrieval

- **Goal**: Ensure summary-first flow works and full hydration logic is triggered.
- **Test plan**: Add integration test with the flag true, expect `retrieval_mode === 'lazy'`, `lazyReferences`, and `lazy_summary_tokens` in response.
- **Unit**: Expand existing tests to assert `identifyLoadCandidates` and `loadFullContent` are exercised.

### 3. Semantic Summary Selection

- **Goal**: Validate embedding-based summary picker and telemetry output.
- **Test plan**: Extend `summarySelector` tests to assert `summary_selection_stats` events when the flag is true.
- **Integration**: With flag true, run a chat turn and verify metadata `summary_selection` is populated.

### 4. Intent Routing

- **Goal**: Confirm structured intent classification runs when enabled.
- **Test plan**: Unit test mocking `createResponse` and expecting schema invocations when the flag is true.
- **Integration**: Enable flag, send varied questions, assert differing `metadata.route` entries.

### 5. Semantic Memory

- **Goal**: Ensure memory load/upsert is active and persists across turns.
- **Test plan**: Enable flag during tests, ensure `semanticMemoryStore.upsertMemory` is called and `metadata.semantic_memory` events appear.
- **Integration**: Validate that follow-up questions retrieve previous memories when flag true.

### 6. Query Decomposition

- **Goal**: Validate complexity assessment and subquery execution pipeline.
- **Test plan**: Unit test enabling the flag, verifying `executeSubQueries` runs and `decomposition` activity is emitted.
- **Integration**: Chat turn with flag true should include `metadata.plan` detailing subqueries and `decomposition` events.

### 7. Web Reranking & Semantic Boost

- **Goal**: Confirm RRF fusion and optional boost mutate references/web results.
- **Test plan**: Unit test injecting synthetic references/results, toggling `ENABLE_WEB_RERANKING` and `ENABLE_SEMANTIC_BOOST`, and checking output order + `web_context` updates.
- **Integration**: With flag true, send query requiring web results and inspect combined reranked outputs.

### 8. Response Storage

- **Goal**: Ensure stored response IDs and retrieval endpoints function when enabled.
- **Test plan**: Integration test toggling flag, capturing response ID from `/chat/stream`, then fetching via `/responses/:id` and deleting via `/responses/:id`.
- **Regression**: Keep tests asserting no IDs are stored when flag false.

## UI + Backend Enablement Strategy

We will enable per-session overrides and surface them as UI toggles.

### Backend

1. **Request overrides**: Extend `/chat` and `/chat/stream` payloads to accept a `feature_overrides` object. Implement a resolver that prefers overrides over config defaults.
2. **Session persistence**: Store resolved overrides in the session (e.g., `sessionStore`) so subsequent turns in the same session reuse the selection.
3. **Validation & telemetry**: Update route schemas and emit `metadata.features` when overrides are active for traceability.
4. **Testing**: Add integration tests covering sync and stream routes with overrides.

### Frontend

1. **State management**: Track feature selections in React state (with optional localStorage per session).
2. **API requests**: Modify `useChat` and `useChatStream` to include selected overrides when calling the backend.
3. **Settings UI**: Introduce a Settings panel (e.g., near the mode toggle) with switches for the flags. Provide tooltips on cost or dependencies. Hide/show dependent options (e.g., semantic boost only visible when reranking is on).
4. **Plan panel visibility**: Display active feature selections alongside route/retrieval metadata so users can confirm the configuration driving answers.
5. **Component tests**: Add React tests ensuring toggles render and dispatch correct payloads.
6. **E2E tests**: Use Playwright or similar to flip toggles, submit a query, and verify backend metadata reflects the toggled features.

### Rollout Steps

1. Land backend flag override support and default verification tests.
2. Build UI toggles and wire them into requests.
3. Expand integration tests to cover combined backend/frontend behavior.
4. Document toggle usage in README and expose instructions in the UI (e.g., tooltip or help link).

## Next Actions

- Implement verification tests per section above, focusing on high-impact flags first (lazy retrieval, intent routing, query decomposition).
- Add backend override plumbing and frontend controls in parallel branches, merging after tests are in place.
- Update release notes once toggles ship so operators know they can enable features without redeploying.
