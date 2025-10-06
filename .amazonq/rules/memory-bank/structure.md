# Project Structure

## Directory Organization

```
agent-rag/
├── backend/              # Node.js/TypeScript backend server
│   ├── src/
│   │   ├── orchestrator/ # Core agentic orchestration logic
│   │   ├── azure/        # Azure AI Search & OpenAI integrations
│   │   ├── tools/        # Tool implementations (retrieve, answer, webSearch)
│   │   ├── routes/       # Fastify API routes
│   │   ├── config/       # Configuration with Zod schemas
│   │   ├── utils/        # Utilities (resilience, telemetry, token counting)
│   │   ├── middleware/   # Request middleware
│   │   ├── services/     # Business logic services
│   │   ├── agents/       # Agent-specific logic
│   │   └── tests/        # Test suites (Vitest)
│   ├── scripts/          # Setup and cleanup scripts
│   ├── data/             # SQLite database storage
│   └── docs/             # Backend-specific documentation
│
├── frontend/             # React 18 + TypeScript frontend
│   └── src/
│       ├── components/   # React components (PlanPanel, ActivityPanel, etc.)
│       ├── hooks/        # Custom hooks (useChatStream, useChat)
│       ├── api/          # API client utilities
│       └── App.tsx       # Main application component
│
├── shared/               # Shared TypeScript types
│   └── types.ts          # Common interfaces (AgentMessage, ChatResponse, etc.)
│
└── docs/                 # Project-wide documentation
    ├── architecture-map.md
    ├── CRITIC_ENHANCEMENTS.md
    ├── COST_OPTIMIZATION.md
    └── unified-orchestrator-context-pipeline.md
```

## Core Components

### Backend Orchestrator (`backend/src/orchestrator/`)
- **index.ts**: Main `runSession` entry point - orchestrates entire pipeline
- **plan.ts**: Query analysis and strategy selection
- **dispatch.ts**: Tool routing and execution with fallback logic
- **critique.ts**: Answer evaluation with multi-pass revision
- **compact.ts**: History compaction and token budgeting
- **router.ts**: Intent classification (FAQ/factual/research/conversational)
- **summarySelector.ts**: Semantic summary selection with embedding similarity
- **semanticMemoryStore.ts**: Persistent memory with SQLite and vector search
- **evaluationTelemetry.ts**: Evaluation metrics and telemetry

### Azure Integrations (`backend/src/azure/`)
- **directSearch.ts**: Azure AI Search client with hybrid semantic search
- **lazyRetrieval.ts**: Summary-first retrieval with on-demand hydration
- **openaiClient.ts**: Azure OpenAI client wrapper

### Tools (`backend/src/tools/`)
- **index.ts**: `retrieveTool` (Azure AI Search) and `answerTool` (synthesis)
- **webSearch.ts**: Google Custom Search integration

### Frontend Components (`frontend/src/components/`)
- **PlanPanel.tsx**: Displays query analysis, confidence, and critique timeline
- **ActivityPanel.tsx**: Shows retrieval steps and tool execution
- **SourcesPanel.tsx**: Citation display with inline references
- **MessageList.tsx**: Conversation history
- **ChatInput.tsx**: User input with sync/stream mode toggle

### Shared Types (`shared/types.ts`)
- **AgentMessage**: Chat message structure
- **ChatResponse**: Complete response with answer, citations, metadata
- **Reference/LazyReference**: Document citation types
- **SessionTrace**: Complete request lifecycle telemetry
- **OrchestratorTools**: Tool interface definitions

## Architectural Patterns

### Orchestrator Pipeline
```
Intent Classification → Context Engineering → Planning → 
Tool Dispatch → Synthesis → Critic Evaluation → Accept/Revise
```

### Multi-Level Fallback
```
Hybrid Search (vector + BM25 + semantic) →
Pure Vector Search (fallback) →
Web Search (final fallback)
```

### Lazy Retrieval Pattern
```
1. Retrieve summaries (~200 chars)
2. Critic evaluates sufficiency
3. Load full documents if needed (on-demand)
```

### Streaming Architecture
- Backend: Fastify SSE with event types (route, plan, context, tool, token, critique, complete)
- Frontend: EventSource with React hooks for state management

## Configuration Management
- **Environment Variables**: `.env` files with Zod schema validation
- **Feature Flags**: 7 flags controlling optional capabilities (ENABLE_*)
- **Token Budgets**: Configurable caps per context section
- **Thresholds**: Reranker, critic, and confidence thresholds

## Data Flow

### Synchronous Chat (`POST /chat`)
```
Request → Orchestrator → Tools → Synthesis → Critic → Response
```

### Streaming Chat (`POST /chat/stream`)
```
Request → Orchestrator → [Events: route, plan, context, tool, token, critique] → Complete
```

## Testing Structure
- **Unit Tests**: Component-level testing (dispatch, router, summarySelector)
- **Integration Tests**: End-to-end orchestrator scenarios
- **Auth Tests**: Azure AI Search authentication validation
- **Coverage**: Vitest with coverage reporting
