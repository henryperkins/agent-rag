# Project Structure

## Directory Organization

### Root Level (Monorepo)

```
agent-rag/
├── backend/          # Node.js/TypeScript API server
├── frontend/         # React/Vite web application
├── shared/           # Shared TypeScript types
├── docs/             # Comprehensive documentation
├── .amazonq/         # Amazon Q rules and memory bank
├── .github/          # CI/CD workflows
└── .husky/           # Git hooks (pre-commit, pre-push)
```

### Backend Structure (`backend/src/`)

```
src/
├── orchestrator/     # Core agentic workflow logic
│   ├── index.ts           # Main runSession entry point
│   ├── plan.ts            # Query analysis and planning
│   ├── dispatch.ts        # Tool routing and execution
│   ├── critique.ts        # Answer evaluation
│   ├── compact.ts         # History compaction
│   ├── router.ts          # Intent classification
│   ├── summarySelector.ts # Semantic summary selection
│   └── semanticMemoryStore.ts # Persistent memory
├── azure/            # Azure service integrations
│   ├── directSearch.ts    # AI Search client
│   ├── lazyRetrieval.ts   # Lazy loading wrapper
│   └── openaiClient.ts    # OpenAI client
├── tools/            # Tool implementations
│   ├── index.ts           # retrieveTool, answerTool
│   └── webSearch.ts       # Google Custom Search
├── routes/           # Fastify API routes
├── config/           # Configuration (Zod schemas)
├── utils/            # Utilities (resilience, telemetry)
├── services/         # Business logic services
├── middleware/       # Fastify middleware
├── agents/           # Agent implementations
└── tests/            # Vitest test suites
```

### Frontend Structure (`frontend/src/`)

```
src/
├── components/       # React components
│   ├── PlanPanel.tsx      # Plan & critique display
│   ├── ActivityPanel.tsx  # Retrieval activity
│   ├── SourcesPanel.tsx   # Citations
│   ├── MessageList.tsx    # Chat history
│   ├── ChatInput.tsx      # User input
│   └── __tests__/         # Component tests
├── hooks/            # Custom React hooks
│   ├── useChatStream.ts   # SSE handling
│   └── useChat.ts         # Sync API
├── api/              # API client
│   └── client.ts          # Axios-based client
├── App.tsx           # Main application
└── types.ts          # Frontend types
```

## Core Components

### Orchestrator Pipeline

The orchestrator implements a multi-stage agentic workflow:

1. **Intent Classification** (`router.ts`): Categorizes queries (FAQ/factual/research/conversational)
2. **Context Engineering** (`compact.ts`, `summarySelector.ts`): Token-budgeted history management
3. **Planning** (`plan.ts`): Query analysis, confidence scoring, strategy selection
4. **Tool Dispatch** (`dispatch.ts`): Executes retrieval tools with fallback logic
5. **Synthesis** (`tools/index.ts`): Generates answers with citations
6. **Critique** (`critique.ts`): Evaluates quality and triggers revisions

### Azure Integrations

- **directSearch.ts**: Direct Azure AI Search client with hybrid search (vector + BM25 + semantic reranking)
- **lazyRetrieval.ts**: Wrapper for summary-first retrieval with on-demand hydration
- **openaiClient.ts**: Azure OpenAI client for GPT-4o and text-embedding-3-large

### Data Persistence

- **SQLite Databases** (`backend/data/`):
  - `semantic-memory.db`: Cross-session memory with vector embeddings
  - `session-store.db`: Conversation transcripts and session state
- **WAL Mode**: Write-Ahead Logging for concurrent access

### API Routes

- `POST /chat`: Synchronous chat endpoint
- `POST /chat/stream`: SSE streaming endpoint
- `POST /documents/upload`: PDF document upload
- `GET /sessions/:id`: Session history retrieval
- `GET /responses/:id`: Response details (Responses API)
- `GET /admin/telemetry`: Development-only telemetry endpoint

## Architectural Patterns

### Agentic Workflow

Multi-stage pipeline with planning, execution, and evaluation phases. Each stage emits telemetry events for observability.

### Hybrid Retrieval

Combines multiple search strategies:

- Vector similarity (embeddings)
- BM25 keyword matching
- L2 semantic reranking
- Reciprocal Rank Fusion (RRF) for multi-source results

### Lazy Loading

Summary-first retrieval pattern:

1. Retrieve document summaries (~200 chars)
2. Critic evaluates sufficiency
3. Hydrate full documents only when needed

### Multi-Pass Critic

Quality assurance loop:

1. Generate answer
2. Evaluate (grounding, coverage, quality)
3. Revise if needed (up to CRITIC_MAX_RETRIES)
4. Track iterations in critique timeline

### Context Engineering

Token-optimized context assembly:

- History compaction (extract summaries from old turns)
- Salience extraction (identify key information)
- Budget enforcement (caps per section)
- Semantic summary selection (embedding-based ranking)

### Streaming Architecture

Server-Sent Events (SSE) with granular event types:

- `route`: Intent classification
- `plan`: Query analysis
- `context`: Budget breakdown
- `tool`: Retrieval updates
- `token`: Answer streaming
- `critique`: Evaluation results
- `complete`: Final metadata
- `telemetry`: Performance metrics

## Configuration Management

### Environment-Based Config

All configuration via `.env` files with Zod schema validation (`backend/src/config/app.ts`).

### Feature Flags

10 advanced feature flags control optional capabilities:

- `ENABLE_LAZY_RETRIEVAL`: Summary-first loading
- `ENABLE_INTENT_ROUTING`: Adaptive model selection
- `ENABLE_WEB_RERANKING`: Unified result reranking
- `ENABLE_SEMANTIC_SUMMARY`: Embedding-based context selection
- `ENABLE_SEMANTIC_MEMORY`: Persistent memory
- `ENABLE_QUERY_DECOMPOSITION`: Complex query handling
- `ENABLE_SEMANTIC_BOOST`: Semantic similarity boosting
- `ENABLE_MULTI_INDEX_FEDERATION`: Multi-index search
- `ENABLE_RESPONSE_STORAGE`: Response audit trails
- `ENABLE_ADAPTIVE_RETRIEVAL`: Adaptive retrieval strategies
- `ENABLE_CRITIC`: Multi-pass evaluation (default: true)

### Progressive Enablement

Recommended rollout: Week 1 (cost optimization) → Week 2 (quality enhancement) → Week 3 (advanced features)
