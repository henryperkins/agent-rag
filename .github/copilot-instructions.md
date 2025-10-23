# GitHub Copilot Instructions

**Project**: Agentic RAG Chat Application (v2.0.3)
**Stack**: TypeScript monorepo • Fastify backend • React frontend • Azure AI Services
**Last Updated**: October 23, 2025

---

## Architecture Overview

This is a **production-grade Retrieval-Augmented Generation (RAG)** application built as a pnpm workspace monorepo with three packages:

- **`backend/`** - Fastify server (port 8787) with orchestrator pattern
- **`frontend/`** - Vite + React UI (port 5173) with SSE streaming
- **`shared/`** - Common TypeScript types

### Core Orchestrator Flow

The **unified orchestrator** (`backend/src/orchestrator/index.ts`) runs both sync (`/chat`) and streaming (`/chat/stream`) modes through a single `runSession()` function:

1. **Intent Routing** → Classify query intent (FAQ/factual/research/conversational) and select optimal model
2. **Context Pipeline** → Compact history, apply token budgets, select summaries via embeddings
3. **Planning** → Analyze query with structured outputs (`getPlan()`)
4. **Tool Dispatch** → Execute retrieval (hybrid Azure AI Search with knowledge agent fallback) + web search
5. **Synthesis** → Generate answer via Azure OpenAI Responses API with citations
6. **Multi-Pass Critic** → Evaluate quality, trigger lazy full-doc loading or revision if needed
7. **Telemetry** → Emit structured events (plan/context/tool/critique) with correlation IDs

**Key principle**: The orchestrator is the single source of truth. Routes in `backend/src/routes/` are thin wrappers.

---

## Critical Development Patterns

### 1. Azure Integration (Non-Negotiable)

**Always use DEPLOYMENT NAMES, not model names** in environment variables:

```bash
# ✅ Correct
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-5
INTENT_CLASSIFIER_MODEL=gpt-5

# ❌ Wrong
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-5-2024-08-06
```

**Required API versions**:

- Azure AI Search: `2025-08-01-preview` (defined in `backend/src/config/app.ts`)
- Azure OpenAI: `v1` with query param `api-version=preview` (Responses API)

**Multi-level retrieval fallback** (see `backend/src/tools/index.ts:retrieveTool`):

1. Knowledge agent (if enabled) → Fallback to direct on error/zero results
2. Direct hybrid search (vector + BM25 + L2 semantic reranker) with `RERANKER_THRESHOLD`
3. Lower threshold retry with `RETRIEVAL_FALLBACK_RERANKER_THRESHOLD`
4. Pure vector search as last resort

### 2. Type Safety & Validation

**Shared types** (`shared/types.ts`) are the contract between frontend and backend. Changes must update both:

- Backend emits `ChatResponse` or SSE events (`route`, `plan`, `context`, `tool`, `token`, `critique`, `complete`, `telemetry`)
- Frontend hooks (`useChatStream.ts`, `useChat.ts`) consume these exact types

**Zod schemas** in `backend/src/config/app.ts` validate all environment variables. **Never bypass config loading**—always import `config` from `config/app.ts`.

**Structured outputs** for LLM interactions:

- Planner: `backend/src/orchestrator/schemas.ts:PlanSchema`
- Critic: `backend/src/orchestrator/schemas.ts:CriticSchema`
- Intent classifier: `backend/src/orchestrator/router.ts:IntentClassifierSchema`

### 3. Feature Toggles & Cost Control

**9 runtime-toggleable features** (`backend/src/config/features.ts`):

- `ENABLE_LAZY_RETRIEVAL` (default: `true`, saves 40-50% tokens)
- `ENABLE_INTENT_ROUTING` (default: `true`, saves 20-30% costs)
- `ENABLE_CITATION_TRACKING`, `ENABLE_ADAPTIVE_RETRIEVAL`, `ENABLE_CRAG` (Phase 1 features)
- Others disabled by default for cost control

**Resolution priority**: Config defaults → Session persisted → Request `feature_overrides`
**UI**: `frontend/src/components/FeatureTogglePanel.tsx` provides per-session controls

**Production defaults** achieve **63-69% cost reduction** vs baseline ($150-180/month @ 10K requests).

### 4. Testing Strategy

**Backend** (Vitest, 96 tests):

- **Mock Azure clients** in tests via `vi.mock()` (see `backend/src/tests/orchestrator.test.ts`)
- **Mock external tools** (`retrieveTool`, `webSearchTool`) to isolate orchestrator logic
- **Test paths**: happy path, fallback triggers, critic revisions, lazy loading
- Run: `cd backend && pnpm test` (or `pnpm test:watch`)

**Frontend** (Vitest, 27 tests):

- **Component tests** with React Testing Library
- **Hook tests** for `useChatStream` (SSE event parsing) and `useChat` (sync API)
- Run: `cd frontend && pnpm test`

**Coverage target**: >80% (use `pnpm test:coverage`)

---

## Build & Development Workflow

### Essential Commands

```bash
# Monorepo root
pnpm install          # Install all workspaces
./start.sh            # Start both backend + frontend with concurrently

# Backend only
cd backend
pnpm dev              # tsx watch on port 8787
pnpm build            # Compile to dist/
pnpm test:watch       # Watch mode for tests
pnpm lint --fix       # ESLint with auto-fix

# Frontend only
cd frontend
pnpm dev              # Vite on port 5173
pnpm build            # tsc + vite build to dist/
```

### Pre-Commit Hooks (Husky)

**Automated via lint-staged**:

- Backend `.ts` files → `cd backend && pnpm lint --fix`
- Frontend `.ts/.tsx` files → `cd frontend && pnpm lint --fix`
- Markdown/JSON/YAML → `prettier --write`

**Commitlint**: Enforces conventional commits (e.g., `feat:`, `fix:`, `docs:`)

---

## Critical File Reference

### Must-Read Before Editing

| File Path                                        | When to Consult                  | Key Sections                                                        |
| ------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------- |
| `backend/src/orchestrator/index.ts` (1646 lines) | Any orchestrator changes         | `runSession()` (main entry), critic loop, telemetry emission        |
| `backend/src/orchestrator/dispatch.ts`           | Tool routing, retrieval logic    | `dispatchTools()`, lazy retrieval orchestration, fallback handling  |
| `backend/src/config/app.ts`                      | Adding env vars or feature flags | Zod schema (envSchema), feature toggles, token budgets              |
| `shared/types.ts` (480 lines)                    | Changing API contracts           | `ChatResponse`, `AgenticRetrievalDiagnostics`, `FeatureOverrideMap` |
| `backend/src/tools/index.ts`                     | Retrieval behavior changes       | `retrieveTool` (multi-level fallback), `lazyRetrieveTool`           |
| `CLAUDE.md`                                      | Understanding conventions        | Architecture summary, recent changes log                            |
| `AGENTS.md`                                      | Coding standards                 | Naming conventions, commit guidelines, module organization          |

### Key Services

- **Azure AI Search**: `backend/src/azure/directSearch.ts` (hybrid semantic search), `backend/src/azure/knowledgeAgent.ts` (agent invocation)
- **OpenAI Client**: `backend/src/azure/openaiClient.ts` (Responses API with streaming)
- **Lazy Retrieval**: `backend/src/azure/lazyRetrieval.ts` (summary-first loading)
- **Context Management**: `backend/src/orchestrator/compact.ts` (history compaction), `backend/src/orchestrator/contextBudget.ts` (token budgeting)

---

## Domain-Specific Knowledge

### Diagnostics & Observability

**Correlation IDs** are critical for tracing:

- Generated in `backend/src/orchestrator/dispatch.ts` for knowledge agent calls
- Propagated through `AgenticRetrievalDiagnostics` → `RetrievalDiagnostics` → frontend telemetry
- Displayed in `TelemetryDrawer` Plan tab with copy-to-clipboard

**Telemetry types** (see `shared/types.ts`):

- `SessionTrace`: Full request lifecycle metadata
- `PlanSummary`: Planner output with reasoning summaries
- `RetrievalDiagnostics`: Knowledge agent status, fallback counts, correlation IDs
- `CriticReport`: Evaluation scores (grounding, coverage, quality)

### Lazy Retrieval Mechanics

**Summary-first approach** to save tokens:

1. `lazyRetrieveTool` returns references with `summary` field (max `LAZY_SUMMARY_MAX_CHARS`)
2. Critic evaluates if summaries suffice (`coverage` score)
3. If `action: 'revise'` and `coverage < threshold`, load full content via `loadFull()` callbacks
4. Track `summaryTokens` vs full content in telemetry

**Config**: `ENABLE_LAZY_RETRIEVAL=true`, `LAZY_PREFETCH_COUNT=20`, `LAZY_LOAD_THRESHOLD=0.5`

### Intent Routing

**Classifier output** (structured JSON via `router.ts:classifyIntent`):

- Intent: `faq | factual | research | conversational`
- Reasoning: Why this intent was selected
- Confidence: 0.0-1.0 score

**Routing profiles** map intents → models/token caps:

- FAQ: Uses `MODEL_FAQ` (default: gpt-5), lower tokens
- Research: Uses `MODEL_RESEARCH` (default: gpt-5), higher tokens
- Overridden by planner if `plan.confidence` > threshold

**Cost impact**: FAQ queries routed to cheaper models save 20-30% vs always using GPT-5.

---

## Common Pitfalls & How to Avoid

### ❌ Don't: Hardcode field names from Azure AI Search

**Why**: Index schemas vary per deployment. The codebase uses `earth_at_night` index by default, but users may have custom fields.

**Do**: Read actual field names from `AZURE_SEARCH_INDEX_NAME` schema or make configurable. See `backend/src/azure/directSearch.ts:buildSearchQuery()` for proper field selection.

### ❌ Don't: Bypass the orchestrator for new tools

**Why**: Orchestrator handles telemetry, fallback logic, critic loops, and feature toggles. Direct tool calls lose these benefits.

**Do**: Add tools to `OrchestratorTools` type in `shared/types.ts`, implement in `backend/src/tools/`, integrate via `dispatchTools()`.

### ❌ Don't: Modify SSE event names without updating frontend

**Why**: Frontend hooks parse specific event names (`token`, `plan`, `critique`, etc.). Mismatch causes silent failures.

**Do**: Update `frontend/src/hooks/useChatStream.ts` when changing events emitted in `backend/src/services/chatStreamService.ts`.

### ❌ Don't: Add feature flags without defaults in `config/app.ts`

**Why**: Missing defaults break Zod validation and cause startup failures.

**Do**: Add to `envSchema` with `.default()`, then update `FeatureFlag` type in `shared/types.ts` and `resolveFeatureToggles()` in `config/features.ts`.

---

## Project-Specific Conventions

### Naming Patterns

- **Utilities/services**: kebab-case files (`chunk-resolver.ts`, `citation-tracker.ts`)
- **React components**: PascalCase files (`TelemetryDrawer.tsx`, `SourcesPanel.tsx`)
- **Test files**: Co-located with source or in `backend/src/tests/`, use `.test.ts` suffix

### Module Organization (Monorepo)

- **Backend modules**: Organized by function (orchestrator/, azure/, tools/, config/, utils/)
- **Shared contracts**: All types in `shared/types.ts` (single source of truth)
- **Frontend structure**: Hooks (`hooks/`), components (`components/`), API clients (`api/`)

### Error Handling

**All Azure calls** wrapped in `withRetry()` from `backend/src/utils/resilience.ts`:

- Exponential backoff
- Configurable retries
- Structured error logging

**Graceful degradation**:

- Retrieval: Hybrid → Lower threshold → Pure vector → Empty context
- Lazy retrieval: Summary → Full content → Fallback to direct search
- Streaming: On error, emit `error` event, close stream gracefully

---

## Quick Reference: Start Coding

### Adding a New Retrieval Tool

1. Implement in `backend/src/tools/<tool-name>.ts`
2. Add to `OrchestratorTools` type in `shared/types.ts`
3. Integrate call in `backend/src/orchestrator/dispatch.ts:dispatchTools()`
4. Add tests in `backend/src/tests/<tool-name>.test.ts`
5. Update activity step emissions for frontend visibility

### Modifying Orchestrator Logic

1. Read `docs/unified-orchestrator-context-pipeline.md` for design intent
2. Update `backend/src/orchestrator/index.ts:runSession()` (sync + stream modes)
3. Emit new telemetry events if behavior changes (see `emitEvent()` calls)
4. Update `shared/types.ts` if adding new event types
5. Test both `/chat` and `/chat/stream` endpoints

### Changing Feature Toggle Behavior

1. Update resolution logic in `backend/src/config/features.ts:resolveFeatureToggles()`
2. Add UI controls in `frontend/src/components/FeatureTogglePanel.tsx`
3. Update `FeatureFlag` type in `shared/types.ts` if adding new flag
4. Document cost/quality impact in `README.md` feature flags table

---

## Documentation Hierarchy

**Start here for context**:

1. This file (`.github/copilot-instructions.md`) — Quick orientation
2. `CLAUDE.md` — Detailed developer guide with recent changes
3. `AGENTS.md` — Repository conventions and guidelines
4. `docs/INDEX.md` — Full documentation catalog

**Architecture deep-dives**:

- `docs/architecture-map.md` — System overview with data flow diagrams
- `docs/unified-orchestrator-context-pipeline.md` — Orchestrator design spec

**Implementation tracking**:

- `docs/ROADMAP.md` — Development priorities
- `docs/IMPLEMENTED_VS_PLANNED.md` — Feature inventory
- `docs/TROUBLESHOOTING.md` — Configuration debugging

---

## Questions to Ask Before Proceeding

When implementing changes, validate these assumptions:

1. **Does this require backend AND frontend changes?** (Check `shared/types.ts` for contract changes)
2. **Are Azure deployment names (not model names) used?** (Validate against config schema)
3. **Does this affect telemetry emission?** (Update both sync and stream modes)
4. **Is this feature-toggleable?** (Consider adding to runtime toggles if cost-impactful)
5. **Are tests updated?** (Orchestrator tests mock tools; integration tests use real Azure)
6. **Does this change retrieval behavior?** (Document fallback order and diagnostics)

---

**For questions about unclear sections**: See `docs/TROUBLESHOOTING.md` for common issues or consult `CLAUDE.md` recent changes log (v2.0.0-v2.0.3).
