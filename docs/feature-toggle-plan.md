# Feature Toggle Enablement Plan

## Status: ✅ COMPLETED

**Last Updated**: 2025-10-11

All backend override infrastructure and frontend UI controls have been implemented and tested. Users can now toggle features per session via the UI, with selections persisted in localStorage and communicated to the backend via the `feature_overrides` request parameter.

---

## Implementation Summary

### What Was Delivered

**Backend** (`backend/src/config/features.ts`):

- ✅ Feature resolution logic with priority: config defaults → persisted session → request overrides
- ✅ `sanitizeFeatureOverrides()` validation to prevent malicious payloads
- ✅ `resolveFeatureToggles()` with source tracking (config/persisted/override)
- ✅ Integration with `/chat` and `/chat/stream` routes via `feature_overrides` payload field
- ✅ Session persistence of resolved features (`sessionStore.saveFeatures()`)
- ✅ Unit tests: 3 tests passing (`backend/src/tests/features.test.ts`)

**Frontend** (`frontend/src/components/FeatureTogglePanel.tsx`):

- ✅ UI panel with 9 toggles, descriptions, and source badges (Default/Session/Override)
- ✅ Dependency management (semantic boost requires web reranking)
- ✅ localStorage persistence per session (`agent-rag:feature-overrides:{sessionId}`)
- ✅ Integration with `useChat` and `useChatStream` hooks
- ✅ Component tests: toggle interactions, dependency disablement (`__tests__/FeatureTogglePanel.test.tsx`)

**Shared Types** (`shared/types.ts`):

- ✅ `FeatureFlag` union type (9 flags)
- ✅ `FeatureOverrideMap` for request payloads
- ✅ `FeatureSource` ('config' | 'persisted' | 'override')
- ✅ `FeatureSelectionMetadata` for response metadata
- ✅ `ChatRequestPayload.feature_overrides` field

### How It Works

1. **User toggles feature in UI** → State updates, saves to localStorage
2. **Next message sent** → `useChat`/`useChatStream` include `feature_overrides` in request body
3. **Backend receives request** → `sanitizeFeatureOverrides()` validates, resolves with persisted session state
4. **Orchestrator runs** → Uses resolved feature gates (`resolveFeatureToggles().gates`)
5. **Response includes metadata** → `response.metadata.features` shows resolved values + sources
6. **Frontend updates state** → Reflects backend resolution, displays source badges

---

## Original Overview (Context)

This document originally outlined the plan to (1) verify each feature end-to-end and (2) expose runtime toggles in the user experience. The analysis was based solely on the repository source code.

## Flag Inventory

The following 9 flags are implemented with full backend/frontend toggle support. Most default to `false` in `backend/src/config/app.ts` (check config for current defaults):

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

All listed modules are fully implemented; the flags exist to prevent extra cost/latency by default. **UI controls are now available** for all 9 flags.

---

## Usage Instructions

### For End Users

1. **Access the Feature Panel**: The FeatureTogglePanel appears in the main UI (integrated into `App.tsx`)
2. **Toggle features**: Click checkboxes to enable/disable features per session
3. **Persistence**: Selections are saved to localStorage per session and survive page reloads
4. **Dependencies**: Some features (e.g., semantic boost) require prerequisites (web reranking). Dependent toggles are disabled unless prerequisites are active.
5. **Visibility**: Source badges show whether the current value comes from config defaults, session persistence, or request overrides

### For Developers

**Backend API**:

```typescript
// POST /chat or /chat/stream
{
  "messages": [...],
  "sessionId": "optional-id",
  "feature_overrides": {
    "ENABLE_LAZY_RETRIEVAL": true,
    "ENABLE_INTENT_ROUTING": true
  }
}

// Response includes resolution metadata
response.metadata.features = {
  resolved: { ENABLE_LAZY_RETRIEVAL: true, ... },
  sources: { ENABLE_LAZY_RETRIEVAL: 'override', ... },
  overrides: { ENABLE_LAZY_RETRIEVAL: true },
  persisted: { ... }
}
```

**Programmatic Resolution**:

```typescript
import { resolveFeatureToggles } from './config/features.js';

const result = resolveFeatureToggles({
  overrides: { ENABLE_LAZY_RETRIEVAL: true },
  persisted: { ENABLE_SEMANTIC_MEMORY: true },
});

// Use result.gates in orchestrator logic
if (result.gates.lazyRetrieval) {
  /* ... */
}
```

---

## Flag Readiness & Verification

**Status**: Basic verification complete (unit tests passing). End-to-end integration tests recommended before production enablement.

For each feature, extending automated coverage with integration checks will ensure the code path is production-ready when toggled on.

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

## Implementation Approach (Completed)

### Backend ✅

1. ✅ **Request overrides**: `/chat` and `/chat/stream` accept `feature_overrides` object (`ChatRequestPayload.feature_overrides`)
2. ✅ **Resolution logic**: `resolveFeatureToggles()` implements priority: config defaults → persisted → overrides
3. ✅ **Session persistence**: `sessionStore.saveFeatures()` and `sessionStore.loadFeatures()` store resolved state per session
4. ✅ **Validation**: `sanitizeFeatureOverrides()` strips invalid keys/values
5. ✅ **Telemetry**: `response.metadata.features` includes `resolved`, `sources`, `overrides`, `persisted`
6. ✅ **Testing**: Unit tests in `backend/src/tests/features.test.ts` (3 tests passing)

### Frontend ✅

1. ✅ **State management**: `App.tsx` manages feature selections with localStorage persistence (`agent-rag:feature-overrides:{sessionId}`)
2. ✅ **API integration**: `useChat` and `useChatStream` hooks include `feature_overrides` in request payloads
3. ✅ **UI component**: `FeatureTogglePanel` with 9 toggles, descriptions, dependency handling, source badges
4. ✅ **Metadata visibility**: `PlanPanel` can display resolved features (via `metadata.features`)
5. ✅ **Component tests**: `__tests__/FeatureTogglePanel.test.tsx` covers toggle interactions and dependency logic
6. ⏳ **E2E tests**: Playwright/Cypress tests for full flow not yet implemented (recommended next step)

---

## Recommended Next Actions

### High Priority

1. **E2E Tests**: Add Playwright or Cypress tests verifying:
   - Toggle feature in UI → localStorage persists
   - Send message → backend receives `feature_overrides`
   - Response metadata reflects resolved features
   - Subsequent messages reuse persisted session state

2. **Feature-Specific Integration Tests**: Extend verification per flag (see "Flag Readiness & Verification" sections 1-8 above) to confirm each code path activates correctly when toggled

3. **Documentation Updates**:
   - Update main `README.md` with feature toggle usage examples
   - Add screenshots of FeatureTogglePanel to user documentation

### Medium Priority

4. **Observability**: Emit telemetry events when features are toggled to track adoption
5. **Analytics**: Track which features are enabled most frequently
6. **Performance Monitoring**: Compare latency/cost metrics between default and toggled configurations

### Low Priority

7. **Advanced UI**: Feature presets (e.g., "Cost-optimized", "Quality-first", "Experimental")
8. **Admin API**: Endpoint to query/modify default config values without redeploying

---

## Summary

**Implementation Status**: ✅ **COMPLETE**

All core infrastructure for runtime feature toggles is now live:

- ✅ Backend resolution with sanitization and session persistence
- ✅ Frontend UI with 9 toggles, dependency management, and localStorage
- ✅ Request/response integration via `feature_overrides` payload field
- ✅ Unit and component test coverage

**What Users Can Do Now**:

- Toggle advanced features (lazy retrieval, intent routing, query decomposition, etc.) per session without backend redeployment
- Persist preferences across page reloads
- See which features are active and where values originated (config/session/override)

**Remaining Work** (optional enhancements):

- E2E browser tests for full user workflow
- Per-feature integration tests to verify code paths activate correctly
- Documentation updates (README, screenshots)
- Observability/analytics for feature adoption tracking

**References**:

- Backend: `backend/src/config/features.ts`, `backend/src/tests/features.test.ts`
- Frontend: `frontend/src/components/FeatureTogglePanel.tsx`, `frontend/src/components/__tests__/FeatureTogglePanel.test.tsx`
- Types: `shared/types.ts` (FeatureFlag, FeatureOverrideMap, FeatureSource, FeatureSelectionMetadata)
- Routes: `backend/src/routes/index.ts:34-52`, `backend/src/routes/chatStream.ts:6-36`
