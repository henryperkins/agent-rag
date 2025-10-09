# Project Structure

## Directory Organization

### Root Structure

```
agent-rag/                    # Monorepo root
├── backend/                  # Node.js/TypeScript backend service
├── frontend/                 # React/TypeScript frontend application
├── shared/                   # Shared TypeScript types
├── docs/                     # Comprehensive documentation
├── .amazonq/rules/           # Amazon Q rules and memory bank
├── .github/workflows/        # CI/CD pipelines
└── .husky/                   # Git hooks for code quality
```

### Backend Structure (`backend/src/`)

```
src/
├── orchestrator/             # Core agentic orchestration logic
│   ├── index.ts              # Main runSession entry point
│   ├── plan.ts               # Query analysis and planning
│   ├── dispatch.ts           # Tool routing and execution
│   ├── critique.ts           # Multi-pass answer evaluation
│   ├── compact.ts            # History compaction
│   ├── router.ts             # Intent classification
│   ├── summarySelector.ts    # Semantic summary selection
│   └── semanticMemoryStore.ts # Persistent memory with SQLite
├── azure/                    # Azure service integrations
│   ├── directSearch.ts       # Azure AI Search client
│   ├── lazyRetrieval.ts      # Lazy document loading wrapper
│   └── openaiClient.ts       # Azure OpenAI client
├── tools/                    # Tool implementations
│   ├── index.ts              # retrieveTool, answerTool
│   └── webSearch.ts          # Google Custom Search integration
├── routes/                   # Fastify API routes
│   └── chat.ts               # /chat and /chat/stream endpoints
├── config/                   # Configuration with Zod schemas
│   └── app.ts                # Environment variables and feature flags
├── utils/                    # Shared utilities
│   ├── resilience.ts         # Retry logic and error handling
│   ├── telemetry.ts          # OpenTelemetry and logging
│   └── tokenCounter.ts       # Token counting utilities
├── tests/                    # Test suites
│   ├── orchestrator.test.ts
│   ├── orchestrator.integration.test.ts
│   └── ...
└── server.ts                 # Fastify server initialization
```

### Frontend Structure (`frontend/src/`)

```
src/
├── components/               # React components
│   ├── PlanPanel.tsx         # Plan and critique display
│   ├── ActivityPanel.tsx     # Retrieval activity timeline
│   ├── SourcesPanel.tsx      # Citations and sources
│   ├── MessageList.tsx       # Chat history
│   └── ChatInput.tsx         # User input interface
├── hooks/                    # Custom React hooks
│   ├── useChatStream.ts      # SSE streaming handler
│   └── useChat.ts            # Synchronous API handler
├── api/                      # API client functions
├── App.tsx                   # Main application component
└── types.ts                  # Frontend-specific types
```

## Core Components and Relationships

### Orchestrator Pipeline

The orchestrator (`backend/src/orchestrator/index.ts`) coordinates the entire RAG workflow:

1. **Intent Classification** (`router.ts`) → Determines query type (FAQ/factual/research/chat)
2. **Context Engineering** (`compact.ts`, `summarySelector.ts`) → Optimizes conversation history
3. **Planning** (`plan.ts`) → Analyzes query and selects retrieval strategy
4. **Tool Dispatch** (`dispatch.ts`) → Executes Azure Search, web search, or lazy retrieval
5. **Synthesis** (`tools/index.ts`) → Generates answer with citations
6. **Critique** (`critique.ts`) → Evaluates quality and triggers revisions if needed

### Azure Integration Layer

- **directSearch.ts**: Direct Azure AI Search client with hybrid search (vector + BM25 + semantic reranking)
- **lazyRetrieval.ts**: Wrapper for summary-first retrieval with on-demand full document hydration
- **openaiClient.ts**: Azure OpenAI client for chat completions and embeddings

### API Layer

- **Synchronous**: `POST /chat` returns complete response with answer, citations, metadata
- **Streaming**: `POST /chat/stream` uses SSE to emit events (route, plan, context, tool, token, critique, complete, telemetry, done)

### Frontend Architecture

- **State Management**: React hooks (useState, useEffect) for local state
- **API Communication**: Axios for sync requests, EventSource for SSE streaming
- **Component Hierarchy**: App → MessageList + ChatInput + PlanPanel + ActivityPanel + SourcesPanel

## Architectural Patterns

### Agentic Workflow Pattern

The system follows a plan-execute-evaluate loop:

- **Planning**: LLM analyzes query and creates execution plan
- **Execution**: Tools are dispatched based on plan
- **Evaluation**: Critic assesses quality and triggers revisions

### Multi-Level Fallback Pattern

Graceful degradation with confidence-based escalation:

1. Hybrid search (vector + BM25 + semantic)
2. Pure vector search (if hybrid confidence < threshold)
3. Web search (if vector confidence < threshold)

### Lazy Loading Pattern

Cost optimization through deferred loading:

1. Retrieve document summaries (~200 chars)
2. Generate answer from summaries
3. Critic evaluates sufficiency
4. Load full documents only if needed

### Context Engineering Pattern

Token-budgeted history management:

- **Compaction**: Extract summaries from old conversation turns
- **Salience**: Identify key information to preserve
- **Semantic Selection**: Rank summaries by relevance to current query
- **Budget Enforcement**: Enforce token caps per section

### Streaming Pattern

Real-time progress updates via SSE:

- Frontend subscribes to `/chat/stream`
- Backend emits typed events (route, plan, tool, token, critique)
- Frontend updates UI incrementally
- Error handling with automatic reconnection

## Configuration Management

- **Environment Variables**: Loaded via dotenv, validated with Zod schemas
- **Feature Flags**: 7+ flags for progressive enablement (ENABLE_LAZY_RETRIEVAL, ENABLE_INTENT_ROUTING, etc.)
- **Type Safety**: All config validated at startup with descriptive error messages
