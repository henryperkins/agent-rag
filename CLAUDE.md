# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **Agentic RAG (Retrieval-Augmented Generation)** chat application built with:
- **Backend**: Fastify + TypeScript + Azure AI Search + Azure OpenAI
- **Frontend**: React + Vite + TypeScript
- **Shared**: Common types package

The application implements a production-grade orchestrator pattern with planning, retrieval (Knowledge Agent + fallback vector search), web search, synthesis, and multi-pass critic evaluation.

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

1. **Context Pipeline** (lines 216-243)
   - Compacts conversation history using `compactHistory()`
   - Merges with persistent memory (summaries + salience notes)
   - Applies token budgets per section (history/summary/salience)
   - Token estimation uses model-specific tiktoken encoder

2. **Planning** (lines 251-258)
   - Calls `getPlan()` to analyze question and decide retrieval strategy
   - Returns `PlanSummary` with confidence score and action steps
   - Plans guide tool dispatch (retrieve/web_search/both/answer)

3. **Tool Dispatch** (lines 260-281)
   - `dispatchTools()` executes planned actions
   - Primary: Azure AI Search Knowledge Agent (`agenticRetrieveTool`)
   - Fallback: Vector search if Knowledge Agent fails
   - Web search: Optional Bing integration via `webSearchTool`
   - All tools wrapped in `withRetry()` resilience layer

4. **Synthesis** (lines 74-173)
   - `generateAnswer()` creates response using context + citations
   - Streaming mode: SSE events via `createResponseStream()`
   - Sync mode: Single LLM call via `answerTool()`

5. **Multi-Pass Critic Loop** (lines 312-366)
   - Evaluates answer quality using `evaluateAnswer()`
   - Metrics: `grounded` (bool), `coverage` (0-1), `action` (accept/revise)
   - Retries up to `CRITIC_MAX_RETRIES` with revision guidance
   - Auto-accepts if `coverage >= CRITIC_THRESHOLD`
   - Tracks full iteration history in `critiqueHistory` array

6. **Telemetry** (lines 438-464)
   - Emits structured `SessionTrace` events
   - OpenTelemetry spans for observability
   - Frontend receives: plan, context, tool usage, critique history

### Context Management
**Files**: `backend/src/orchestrator/compact.ts`, `contextBudget.ts`, `memoryStore.ts`

- **Compaction**: Extracts summaries and salience notes from old turns
- **Memory**: In-memory store persists per-session summaries/salience
- **Budgeting**: `budgetSections()` enforces token caps using `estimateTokens()`

### Configuration
**File**: `backend/src/config/app.ts`

Environment variables validated with Zod schema:
- **Azure endpoints**: Search, OpenAI, Bing
- **Retrieval**: `RAG_TOP_K`, `RERANKER_THRESHOLD`, `TARGET_INDEX_MAX_DOCUMENTS`
- **Context limits**: `CONTEXT_HISTORY_TOKEN_CAP`, `CONTEXT_SUMMARY_TOKEN_CAP`, `CONTEXT_SALIENCE_TOKEN_CAP`
- **Critic**: `CRITIC_MAX_RETRIES`, `CRITIC_THRESHOLD`, `ENABLE_CRITIC`
- **Web**: `WEB_CONTEXT_MAX_TOKENS`, `WEB_RESULTS_MAX`, `WEB_SEARCH_MODE`
- **Security**: `RATE_LIMIT_MAX_REQUESTS`, `REQUEST_TIMEOUT_MS`, `CORS_ORIGIN`

### Routes
**File**: `backend/src/routes/index.ts`

- `POST /chat` - Synchronous chat (returns full response)
- `POST /chat/stream` - SSE streaming chat (real-time events)
- Both delegate to `runSession()` orchestrator

### Tools
**File**: `backend/src/tools/index.ts`

1. **agenticRetrieveTool**: Azure AI Search Knowledge Agent with fallback
   - Primary: Knowledge Agent with reranker threshold
   - Retry: Lower threshold if primary fails
   - Fallback: Vector search (`fallbackVectorSearch`) if agent unavailable

2. **webSearchTool**: Bing search integration
   - Modes: `summary` (snippets only) or `full` (fetch page bodies)
   - Token-budgeted context assembly

3. **answerTool**: Synthesis with optional revision guidance
   - Accepts `revisionNotes` for critic-driven improvements
   - Returns answer + citations

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
- Multi-level fallbacks: Knowledge Agent → Lower threshold → Vector search
- Graceful degradation: Returns empty context if all retrieval fails

### Streaming Architecture
- Orchestrator emits typed events: `status`, `plan`, `context`, `tool`, `tokens`, `critique`, `complete`, `telemetry`, `trace`, `done`
- Frontend subscribes via EventSource and updates UI reactively
- Critic iterations tracked but only final answer tokens streamed

### Type Safety
- Shared types in `shared/types.ts` used by both frontend/backend
- Zod validation for environment config
- Compile TypeScript before running production

## Key Files Reference

| Path | Purpose |
|------|---------|
| `backend/src/orchestrator/index.ts` | Main orchestration loop |
| `backend/src/orchestrator/dispatch.ts` | Tool routing and web context assembly |
| `backend/src/orchestrator/plan.ts` | Query analysis and strategy planning |
| `backend/src/orchestrator/critique.ts` | Answer evaluation logic |
| `backend/src/orchestrator/compact.ts` | History summarization |
| `backend/src/tools/index.ts` | Tool implementations |
| `backend/src/tools/webSearch.ts` | Bing integration |
| `backend/src/azure/agenticRetrieval.ts` | Knowledge Agent API calls |
| `backend/src/azure/fallbackRetrieval.ts` | Vector search fallback |
| `backend/src/config/app.ts` | Environment configuration |
| `frontend/src/hooks/useChatStream.ts` | SSE event handling |
| `frontend/src/components/PlanPanel.tsx` | Observability UI |
| `shared/types.ts` | Shared TypeScript interfaces |

## Design Documentation

Reference these files for architectural context:
- `docs/unified-orchestrator-context-pipeline.md` - Original design spec
- `docs/CRITIC_ENHANCEMENTS.md` - Multi-pass critic implementation details
- `context-engineering.md` - Context management best practices

## Environment Setup

1. Copy `.env.example` to `.env` (if exists) or create `.env` with:
   ```bash
   AZURE_SEARCH_ENDPOINT=<your-search-endpoint>
   AZURE_SEARCH_API_KEY=<your-key>
   AZURE_OPENAI_ENDPOINT=<your-openai-endpoint>
   AZURE_OPENAI_API_KEY=<your-key>
   # ... see backend/src/config/app.ts for full schema
   ```

2. Ensure Azure resources exist:
   - AI Search service with index
   - Knowledge Agent configured
   - OpenAI deployment (GPT + embeddings)
   - (Optional) Bing Search API key

3. Install dependencies: `pnpm install` in backend/ and frontend/

## Testing Strategy

- **Unit tests**: Mock tools/Azure clients, test orchestrator logic paths
- **Integration tests**: Test with real Azure services (requires credentials)
- **Manual testing**: Use frontend streaming mode to observe full pipeline
- **Telemetry inspection**: `curl http://localhost:8787/admin/telemetry | jq`
