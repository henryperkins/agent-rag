# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **Agentic RAG (Retrieval-Augmented Generation)** chat application built with:
- **Backend**: Fastify + TypeScript + Azure AI Search + Azure OpenAI
- **Frontend**: React + Vite + TypeScript
- **Shared**: Common types package

The application implements a production-grade orchestrator pattern with planning, retrieval (direct Azure AI Search with hybrid semantic search), web search (Google Custom Search), synthesis, and multi-pass critic evaluation. All LLM interactions use Azure OpenAI Models API with structured outputs.

## Development Commands

### Backend
```bash
cd backend
pnpm install              # Install dependencies
pnpm dev                  # Run dev server (tsx watch on port 8787)
pnpm build                # Compile TypeScript to dist/
pnpm start                # Run production build
pnpm test                 # Run vitest tests
pnpm test:watch           # Run tests in watch mode
pnpm test:coverage        # Run tests with coverage
pnpm lint                 # Lint TypeScript files
```

### Frontend
```bash
cd frontend
pnpm install              # Install dependencies
pnpm dev                  # Run Vite dev server (port 5173)
pnpm build                # Build for production (tsc + vite build)
pnpm preview              # Preview production build
pnpm lint                 # Lint TypeScript/TSX files
```

### Run Tests
- Backend unit tests use **Vitest**
- Run single test file: `pnpm test <filename>`
- Tests located in `backend/src/tests/`

## Architecture

### Unified Orchestrator Pattern
**Core module**: `backend/src/orchestrator/index.ts`

The orchestrator (`runSession`) is the single entry point for both synchronous (`/chat`) and streaming (`/chat/stream`) modes. It handles:

1. **Intent Routing** – Classifies the latest turn (plus recent messages) into FAQ, factual lookup, research, or conversational intents using Azure OpenAI structured outputs. Emits `route` events with the selected model, token cap, and retriever strategy.

2. **Context Pipeline** – Compacts conversation history using `compactHistory()`, merges summaries + salience from memory, applies token budgets per section, and selects summary bullets via Azure OpenAI embeddings.

3. **Planning** – Calls `getPlan()` to analyze the question and decide retrieval strategy using Azure OpenAI structured outputs. Returns a `PlanSummary` with confidence scoring that can override the router’s defaults.

4. **Tool Dispatch** – `dispatchTools()` executes planned actions. Primary path runs direct Azure AI Search hybrid semantic search; fallback lowers the reranker threshold before falling back to pure vector search. When `ENABLE_LAZY_RETRIEVAL` is on, dispatch returns summary-only references first (via `lazyRetrieveTool`) and defers full document hydration until the critic demands more detail. Web search leverages Google Custom Search, and all paths use `withRetry()` resilience wrappers.

5. **Synthesis** – `generateAnswer()` creates responses via Azure OpenAI `/chat/completions`, honoring the routed model and token limits. Streaming mode uses `createResponseStream()`; sync mode calls `answerTool()` directly while accepting critic revision notes.

6. **Multi-Pass Critic Loop** – Evaluates answer quality using structured outputs, retries up to `CRITIC_MAX_RETRIES`, and can trigger lazy retrieval to load full documents when summaries lack coverage. Iterations (including whether full content was used) are recorded in `critiqueHistory`.

7. **Telemetry** – Emits structured `SessionTrace` events plus OpenTelemetry spans. Frontend receives plan/context/tool/route events, summary selection stats, retrieval mode (`direct` vs `lazy`), and lazy summary token counts.

### Context Management
**Files**: `backend/src/orchestrator/compact.ts`, `contextBudget.ts`, `memoryStore.ts`

- **Compaction**: Extracts summaries and salience notes from old turns
- **Memory**: In-memory store persists per-session summaries/salience
- **Budgeting**: `budgetSections()` enforces token caps using `estimateTokens()`

### Configuration
**File**: `backend/src/config/app.ts`

Environment variables validated with Zod schema:
- **Azure endpoints**: Search, OpenAI (GPT deployment + Embedding deployment)
- **Google Search**: `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`, `GOOGLE_SEARCH_ENDPOINT`
- **Retrieval**: `RAG_TOP_K`, `RERANKER_THRESHOLD`, `RETRIEVAL_MIN_DOCS`, `RETRIEVAL_FALLBACK_RERANKER_THRESHOLD`
- **Context limits**: `CONTEXT_HISTORY_TOKEN_CAP`, `CONTEXT_SUMMARY_TOKEN_CAP`, `CONTEXT_SALIENCE_TOKEN_CAP`, `CONTEXT_MAX_SUMMARY_ITEMS`, `CONTEXT_MAX_SALIENCE_ITEMS`, `CONTEXT_MAX_RECENT_TURNS`
- **Critic**: `CRITIC_MAX_RETRIES`, `CRITIC_THRESHOLD`
- **Web**: `WEB_CONTEXT_MAX_TOKENS`, `WEB_RESULTS_MAX`, `WEB_SEARCH_MODE`
- **Security**: `RATE_LIMIT_MAX_REQUESTS`, `REQUEST_TIMEOUT_MS`, `CORS_ORIGIN`
- **Features**: `ENABLE_SEMANTIC_SUMMARY` (semantic vs recency summaries), `ENABLE_INTENT_ROUTING`, `ENABLE_LAZY_RETRIEVAL`, intent routing model + token caps, lazy retrieval thresholds (`LAZY_SUMMARY_MAX_CHARS`, `LAZY_PREFETCH_COUNT`, `LAZY_LOAD_THRESHOLD`)

### Routes
**File**: `backend/src/routes/index.ts`

- `POST /chat` - Synchronous chat (returns full response)
- `POST /chat/stream` - SSE streaming chat (real-time events)
- Both delegate to `runSession()` orchestrator

### Tools
**File**: `backend/src/tools/index.ts`

1. **retrieveTool**: Direct Azure AI Search integration with multi-level fallback
   - **Primary**: Hybrid semantic search (vector + BM25 + L2 semantic reranking) with `RERANKER_THRESHOLD`
   - **Fallback 1**: Same hybrid search with `RETRIEVAL_FALLBACK_RERANKER_THRESHOLD` (lower)
   - **Fallback 2**: Pure vector search (`vectorSearch()`) if semantic ranking fails
   - Implementation: `backend/src/azure/directSearch.ts`
   - Query builder pattern for flexible query construction

2. **lazyRetrieveTool**: Summary-first Azure AI Search helper
   - Implementation: `backend/src/azure/lazyRetrieval.ts`
   - Returns summary-only references with `loadFull` callbacks for critic-triggered hydration
   - Reports summary token usage for cost telemetry and falls back to `retrieveTool` on error

3. **webSearchTool**: Google Custom Search JSON API integration
   - Implementation: `backend/src/tools/webSearch.ts`
   - Modes: `summary` (snippets only) or `full` (fetch page bodies)
   - Token-budgeted context assembly with `WEB_CONTEXT_MAX_TOKENS`
   - Supports pagination and result ranking

4. **answerTool**: Synthesis with optional revision guidance
   - Uses Azure OpenAI `/chat/completions` endpoint
   - Accepts `revisionNotes` for critic-driven improvements
   - Returns answer + citations with inline references ([1], [2], etc.)

### Frontend Architecture
**Main file**: `frontend/src/App.tsx`

- **Hooks**:
  - `useChatStream`: Handles SSE events, collects plan/context/citations/critique
  - `useChat`: Sync mode API wrapper

- **Components**:
  - `PlanPanel`: Displays plan, context budget, critique history timeline
  - `ActivityPanel`: Shows retrieval/tool activity steps
  - `SourcesPanel`: Citation display
  - `MessageList`: Chat history
  - `ChatInput`: User input with mode toggle

- **Critique History UI** (`frontend/src/components/PlanPanel.tsx:33-60`):
  - Timeline view of all critic iterations
  - Color-coded badges (✓ Accepted / ↻ Revise)
  - Coverage percentage, grounded status, issue lists

## Important Patterns

### Error Handling
- All Azure calls wrapped in `withRetry()` (`backend/src/utils/resilience.ts`)
- Multi-level fallbacks: Hybrid search (high threshold) → Hybrid search (low threshold) → Pure vector search → Lazy summaries fallback to direct search on error
- Graceful degradation: Returns empty context if all retrieval fails
- Azure OpenAI structured outputs with fallback to heuristic mode if JSON schema validation fails

-### Streaming Architecture
- Orchestrator emits typed events: `status`, `route`, `plan`, `context`, `tool`, `tokens`, `critique`, `complete`, `telemetry`, `trace`, `done`
- Frontend subscribes via EventSource and updates UI reactively
- Critic iterations tracked but only final answer tokens streamed

### Type Safety
- Shared types in `shared/types.ts` used by both frontend/backend
- Zod validation for environment config
- Compile TypeScript before running production

## Key Files Reference

| Path | Purpose |
|------|---------|
| `backend/src/orchestrator/index.ts` | Main orchestration loop with runSession() |
| `backend/src/orchestrator/dispatch.ts` | Tool routing, lazy retrieval orchestration, and web context assembly |
| `backend/src/orchestrator/plan.ts` | Query analysis and strategy planning with structured outputs |
| `backend/src/orchestrator/critique.ts` | Answer evaluation logic with structured outputs |
| `backend/src/orchestrator/compact.ts` | History summarization and salience extraction |
| `backend/src/orchestrator/contextBudget.ts` | Token budgeting with tiktoken |
| `backend/src/orchestrator/memoryStore.ts` | In-memory session persistence for summaries/salience |
| `backend/src/orchestrator/summarySelector.ts` | Semantic similarity-based summary selection |
| `backend/src/orchestrator/schemas.ts` | JSON schemas for planner and critic structured outputs |
| `backend/src/orchestrator/router.ts` | Intent classifier and routing profile definitions |
| `backend/src/tools/index.ts` | Tool implementations (retrieve, webSearch, answer) |
| `backend/src/tools/webSearch.ts` | Google Custom Search JSON API integration |
| `backend/src/azure/directSearch.ts` | Direct Azure AI Search REST API with hybrid semantic search |
| `backend/src/azure/lazyRetrieval.ts` | Summary-first Azure AI Search wrapper with deferred hydration |
| `backend/src/azure/openaiClient.ts` | Azure OpenAI API client (/chat/completions, /embeddings) |
| `backend/src/config/app.ts` | Environment configuration with Zod validation |
| `backend/src/utils/resilience.ts` | Retry logic wrapper (withRetry) |
| `backend/src/utils/session.ts` | Session ID derivation and utilities |
| `frontend/src/hooks/useChatStream.ts` | SSE event handling |
| `frontend/src/components/PlanPanel.tsx` | Observability UI with critique timeline |
| `shared/types.ts` | Shared TypeScript interfaces |

## Design Documentation

Reference these files for architectural context:
- `docs/unified-orchestrator-context-pipeline.md` - Unified orchestrator design spec (updated for direct Azure AI Search)
- `docs/CRITIC_ENHANCEMENTS.md` - Multi-pass critic implementation details
- `docs/architecture-map.md` - System architecture overview
- `docs/enhancement-implementation-guide.md` - Feature implementation guide

## Environment Setup

1. Copy `.env.example` to `.env` (if exists) or create `.env` with:
   ```bash
   # Azure AI Search
   AZURE_SEARCH_ENDPOINT=<your-search-endpoint>
   AZURE_SEARCH_API_KEY=<your-key>
   AZURE_SEARCH_INDEX_NAME=<your-index-name>

   # Azure OpenAI
   AZURE_OPENAI_ENDPOINT=<your-openai-endpoint>
   AZURE_OPENAI_API_KEY=<your-key>
   AZURE_OPENAI_GPT_DEPLOYMENT=<gpt-deployment-name>
   AZURE_OPENAI_EMBEDDING_DEPLOYMENT=<embedding-deployment-name>
   AZURE_OPENAI_GPT_MODEL_NAME=<gpt-4o-2024-08-06>
   AZURE_OPENAI_EMBEDDING_MODEL_NAME=<text-embedding-3-large>

   # Google Custom Search (optional for web search)
   GOOGLE_SEARCH_API_KEY=<your-google-api-key>
   GOOGLE_SEARCH_ENGINE_ID=<your-search-engine-id>

   # ... see backend/src/config/app.ts for full schema
   ```

2. Ensure Azure resources exist:
   - **AI Search service** with index configured for hybrid semantic search
     - Vector fields for embeddings (e.g., `page_embedding_text_3_large`)
     - Text fields for keyword search (e.g., `page_chunk`)
     - Semantic ranking configuration enabled
   - **OpenAI deployment** with GPT model (gpt-4o or gpt-4) and embedding model (text-embedding-3-large)
   - **(Optional)** Google Custom Search API key for web search

3. Install dependencies: `pnpm install` in backend/ and frontend/

## Testing Strategy

- **Unit tests**: Mock tools/Azure clients, test orchestrator logic paths
- **Integration tests**: Test with real Azure services (requires credentials)
- **Manual testing**: Use frontend streaming mode to observe full pipeline
- **Telemetry inspection**: `curl http://localhost:8787/admin/telemetry | jq`
