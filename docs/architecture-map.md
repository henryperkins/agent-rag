# Agent-RAG Architecture Map

**Visual guide to the codebase structure and data flow**

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vite + React)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  ChatInput   │  │ MessageList  │  │ SourcesPanel │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            │                                     │
│                    ┌───────▼────────┐                           │
│                    │   API Client    │                           │
│                    └───────┬────────┘                           │
└────────────────────────────┼──────────────────────────────────┘
                             │ HTTP/SSE
                             │
┌────────────────────────────▼──────────────────────────────────┐
│                      BACKEND (Fastify)                         │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                       Routes                            │   │
│  │  /chat  │  /chat/stream  │  /documents/upload          │   │
│  └────┬─────────────┬──────────────────┬──────────────────┘   │
│       │             │                  │                       │
│  ┌────▼─────────────▼──────────────────▼──────────────────┐   │
│  │                    Services                             │   │
│  │  enhancedChatService  │  chatStreamService             │   │
│  └────────────────────┬────────────────────────────────────┘   │
│                       │                                        │
│  ┌────────────────────▼────────────────────────────────────┐   │
│  │                  Orchestrator                           │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐             │   │
│  │  │ Context  │  │  Plan    │  │ Dispatch │             │   │
│  │  │ Pipeline │  │          │  │          │             │   │
│  │  └────┬─────┘  └────┬─────┘  └────┬─────┘             │   │
│  │       │             │             │                    │   │
│  │  ┌────▼─────────────▼─────────────▼─────┐             │   │
│  │  │          Tool Execution               │             │   │
│  │  └────┬──────────────┬───────────────────┘             │   │
│  │       │              │                                 │   │
│  │  ┌────▼──────┐  ┌────▼────────┐                      │   │
│  │  │ Synthesis │  │  Critique   │                      │   │
│  │  └───────────┘  └─────────────┘                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                       │                                        │
│  ┌────────────────────▼────────────────────────────────────┐   │
│  │                    Tools                                │   │
│  │  retrieve │ webSearch │ answer                          │   │
│  └────┬──────────────────┬──────────────────────────────────┘   │
└───────┼─────────────────────┼────────────────────────────────┘
        │                     │
┌───────▼─────────────────────▼────────────────────────────────────────┐
│                      External Services                                │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐ │
│  │  Azure AI Search   │  │  Azure OpenAI API  │  │ Google Custom Search │ │
│  │  REST API          │  │  /chat/completions │  │ REST API             │ │
│  │  Hybrid Semantic   │  │  /embeddings       │  │ Web Results          │ │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Request Flow Diagrams

### 1. Standard Chat Request

```
User Input
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Frontend: ChatInput.tsx                                  │
│ - Captures user message                                 │
│ - Adds to messages array                                │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ API Client: client.ts                                   │
│ - POST /chat with messages                              │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Route: routes/index.ts                                  │
│ - Validate request                                      │
│ - Call handleEnhancedChat(messages)                     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Service: enhancedChatService.ts                         │
│ - Derive session ID                                     │
│ - Create telemetry recorder                             │
│ - Call runSession()                                     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Orchestrator: orchestrator/index.ts                     │
│                                                         │
│ 1. Context Preparation                                  │
│    ├─ compact.ts: Summarize old messages               │
│    ├─ memoryStore.ts: Load session memory              │
│    └─ summarySelector.ts: Pick relevant summaries      │
│                                                         │
│ 2. Planning                                             │
│    └─ plan.ts: Decide retrieval strategy               │
│        Returns: { confidence, steps[] }                 │
│                                                         │
│ 3. Tool Dispatch                                        │
│    └─ dispatch.ts: Execute tools based on plan          │
│        ├─ Vector search? → agenticRetrieveTool          │
│        ├─ Web search? → webSearchTool                   │
│        └─ Both? → Execute in parallel                   │
│                                                         │
│ 4. Synthesis                                            │
│    └─ answerTool: Generate answer from context          │
│                                                         │
│ 5. Critique Loop (max iterations)                       │
│    └─ critique.ts: Validate answer quality              │
│        ├─ Coverage >= threshold? Accept                 │
│        └─ Otherwise: Revise and retry                   │
│                                                         │
│ 6. Return Response                                      │
│    └─ { answer, citations, activity, metadata }        │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Response flows back through stack                       │
│ - Service records telemetry                             │
│ - Route returns JSON                                    │
│ - Frontend displays answer & citations                  │
└─────────────────────────────────────────────────────────┘
```

### 2. Streaming Chat Request

```
User Input
    │
    ▼
Frontend sends to /chat/stream
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Route: routes/chatStream.ts                             │
│ - Set SSE headers                                       │
│ - Create sendEvent callback                             │
│ - Call handleChatStream(messages, sendEvent)            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Service: chatStreamService.ts                           │
│ - Call runSession with emit function                    │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Orchestrator emits events as they occur:                │
│                                                         │
│ emit('status', { stage: 'context' })                    │
│ emit('context', { history, summary, salience })         │
│ emit('plan', { confidence, steps })                     │
│ emit('status', { stage: 'retrieval' })                  │
│ emit('citations', { citations })                        │
│ emit('activity', { steps })                             │
│ emit('status', { stage: 'generating' })                 │
│ emit('tokens', { content: "chunk..." })                 │
│ emit('critique', { grounded, coverage, action })        │
│ emit('complete', { answer })                            │
│ emit('telemetry', { ... })                              │
│ emit('done', { status: 'complete' })                    │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Frontend: useChatStream hook                            │
│ - Listens to SSE events                                │
│ - Updates state in real-time                           │
│ - Displays progressive results                         │
└─────────────────────────────────────────────────────────┘
```

### 3. Document Upload Flow (New Feature)

```
User selects PDF
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Frontend: DocumentUpload.tsx                            │
│ - Validate file type & size                            │
│ - Create FormData                                       │
│ - POST /documents/upload                                │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Route: routes/index.ts                                  │
│ - Multipart handler receives file                      │
│ - Convert to buffer                                     │
│ - Call processPDF()                                     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Tool: documentProcessor.ts                              │
│                                                         │
│ processPDF(buffer):                                     │
│ 1. Parse PDF with pdf-parse                            │
│ 2. Split into pages                                    │
│ 3. Chunk each page (1000 chars, 200 overlap)          │
│ 4. Return { id, title, chunks[] }                      │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Tool: embedAndIndex()                                   │
│                                                         │
│ For each batch of 10 chunks:                           │
│ 1. Call createEmbeddings(texts[])                      │
│ 2. Get embedding vectors                               │
│ 3. Prepare documents with embeddings                   │
│ 4. Wait 1 second (rate limit)                          │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Tool: uploadToIndex()                                   │
│                                                         │
│ 1. Build payload with @search.action = mergeOrUpload   │
│ 2. POST to Azure Search /docs/index                    │
│ 3. Verify upload success                               │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│ Response returns to frontend:                           │
│ {                                                       │
│   documentId: "doc_123",                                │
│   title: "Research Paper",                              │
│   chunks: 42,                                           │
│   uploadedAt: "2025-10-03T12:00:00Z"                   │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
```

---

## Directory Structure Deep Dive

### Backend (`backend/src/`)

```
backend/src/
│
├── server.ts                      # Entry point, Fastify setup
│
├── config/
│   └── app.ts                     # Environment config (Zod schema)
│
├── middleware/
│   └── sanitize.ts                # Input sanitization
│
├── routes/
│   ├── index.ts                   # Route registration
│   └── chatStream.ts              # SSE streaming setup
│
├── services/
│   ├── enhancedChatService.ts     # Orchestrator integration
│   └── chatStreamService.ts       # Streaming handler
│
├── orchestrator/                  # Core orchestration logic
│   ├── index.ts                   # Main runSession function
│   ├── router.ts                  # Intent classification & routing profiles
│   ├── plan.ts                    # Strategy planning
│   ├── dispatch.ts                # Tool routing + lazy retrieval orchestration
│   ├── compact.ts                 # History summarization
│   ├── memoryStore.ts             # Session memory
│   ├── summarySelector.ts         # Semantic selection
│   ├── contextBudget.ts           # Token management
│   ├── critique.ts                # Answer validation
│   ├── schemas.ts                 # JSON schemas
│   ├── telemetry.ts               # OpenTelemetry
│   └── sessionTelemetryStore.ts   # Session tracking
│
├── agents/                        # Lightweight planner/critic helpers
│   ├── critic.ts                  # Legacy critic prompt wrapper
│   └── planner.ts                 # Simple heuristic planner
│
├── tools/                         # Tool implementations
│   ├── index.ts                   # Tool exports (retrieve, lazyRetrieve, webSearch, answer)
│   └── webSearch.ts               # Google Custom Search integration
│
├── azure/                         # Azure integrations
│   ├── directSearch.ts            # Direct Azure AI Search (hybrid semantic)
│   ├── lazyRetrieval.ts           # Summary-first Azure AI Search helper
│   ├── openaiClient.ts            # Azure OpenAI client (/chat/completions, /embeddings)
│   └── indexSetup.ts              # Index creation utilities
│
├── utils/
│   ├── openai.ts                  # OpenAI helpers
│   └── resilience.ts              # Retry logic
│
└── tests/                         # Unit & integration tests
    ├── orchestrator.test.ts
    ├── orchestrator.integration.test.ts
    ├── dispatch.test.ts
    ├── lazyRetrieval.test.ts
    └── router.test.ts
```

### Frontend (`frontend/src/`)

```
frontend/src/
│
├── main.tsx                       # Entry point
├── App.tsx                        # Main app component
├── App.css                        # Global styles
│
├── components/
│   ├── ChatInput.tsx              # User input field
│   ├── MessageList.tsx            # Conversation display
│   ├── SourcesPanel.tsx           # Citations sidebar
│   ├── ActivityPanel.tsx          # Retrieval activity
│   └── PlanPanel.tsx              # Strategy & telemetry
│
├── hooks/
│   ├── useChat.ts                 # Standard chat hook
│   └── useChatStream.ts           # Streaming hook
│
├── api/
│   └── client.ts                  # API functions
│
└── types.ts                       # Frontend types
```

### Shared Types (`shared/`)

```
shared/
├── types.ts                       # Source of truth
├── types.js                       # Compiled JS
└── types.d.ts                     # Type declarations
```

---

## Data Flow for Key Operations

### Context Pipeline

```
Messages Array
    │
    ▼
┌─────────────────────────────────────┐
│ compact.ts: compactHistory()        │
│                                     │
│ Input: All messages                 │
│                                     │
│ 1. Split into:                      │
│    ├─ Recent (last 12 turns)        │
│    └─ Older (rest)                  │
│                                     │
│ 2. Summarize older:                 │
│    └─ LLM call → summary bullets    │
│                                     │
│ 3. Extract salience:                │
│    └─ LLM call → salient facts      │
│                                     │
│ Output: {                           │
│   latest: AgentMessage[],           │
│   summary: string[],                │
│   salience: SalienceNote[]          │
│ }                                   │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│ memoryStore.ts: loadMemory()        │
│                                     │
│ 1. Load from in-memory store        │
│ 2. Filter by age (50 turns)         │
│                                     │
│ Returns: {                          │
│   summaryBullets: SummaryBullet[]   │
│   salience: SalienceNote[]          │
│ }                                   │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│ summarySelector.ts                  │
│                                     │
│ If ENABLE_SEMANTIC_SUMMARY:         │
│ 1. Generate query embedding         │
│ 2. Get/create summary embeddings    │
│ 3. Cosine similarity ranking        │
│ 4. Select top-K                     │
│                                     │
│ Else:                               │
│ - Select most recent                │
└───────────────┬─────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│ contextBudget.ts                    │
│                                     │
│ 1. Estimate tokens for each:        │
│    ├─ History                       │
│    ├─ Summary                       │
│    └─ Salience                      │
│                                     │
│ 2. Apply caps:                      │
│    ├─ History: 1800 tokens          │
│    ├─ Summary: 600 tokens           │
│    └─ Salience: 400 tokens          │
│                                     │
│ 3. Trim if needed                   │
└───────────────┬─────────────────────┘
                │
                ▼
        Final Context Ready
```

### Retrieval Dispatch

```
Plan: { confidence, steps[] }
    │
    ▼
┌─────────────────────────────────────┐
│ dispatch.ts: dispatchTools()        │
│                                     │
│ Check confidence threshold:         │
│ - If < 0.45: ESCALATE               │
│   → Execute both vector + web       │
│                                     │
│ Otherwise, check plan steps:        │
└───────────────┬─────────────────────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
┌─────────────┐   ┌─────────────┐
│ Vector      │   │ Web Search  │
│ Search?     │   │ Needed?     │
└──────┬──────┘   └──────┬──────┘
       │                 │
       ▼                 ▼
┌─────────────────┐   ┌─────────────────┐
│ retrieveTool    │   │ webSearchTool   │
│                 │   │                 │
│ 1. Generate     │   │ 1. Query Google │
│    embedding    │   │    Custom Search│
│ 2. Hybrid       │   │ 2. Get results  │
│    semantic     │   │ 3. Build context│
│    search       │   │ 4. Budget tokens│
│ 3. Get refs     │   └────────┬────────┘
│                 │            │
│ Multi-level     │            │
│ fallback:       │            │
│ ├─ High rerank  │            │
│ │  threshold    │            │
│ ├─ Low rerank   │            │
│ │  threshold    │            │
│ └─ Pure vector  │            │
│    search       │            │
└────────┬────────┘            │
         │                     │
         └─────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Merge Results:       │
        │ - References         │
        │ - Web results        │
        │ - Context text       │
        │ - Activity log       │
        └──────────────────────┘
```

### Critique Loop

```
Draft Answer Generated
    │
    ▼
┌─────────────────────────────────────┐
│ critique.ts: evaluateAnswer()       │
│                                     │
│ LLM evaluates:                      │
│ {                                   │
│   grounded: boolean,                │
│   coverage: 0-1,                    │
│   issues: string[],                 │
│   action: 'accept' | 'revise'       │
│ }                                   │
└───────────────┬─────────────────────┘
                │
        ┌───────┴────────┐
        │                │
        ▼                ▼
    ┌────────┐      ┌─────────┐
    │ Accept │      │ Revise  │
    └────┬───┘      └────┬────┘
         │               │
         │               ▼
         │      ┌─────────────────┐
         │      │ Increment count │
         │      │ Max retries?    │
         │      └────┬────────┬───┘
         │           │        │
         │           │ Yes    │ No
         │           │        │
         │           ▼        ▼
         │      ┌────────┐  ┌──────────────┐
         │      │ Append │  │ Regenerate   │
         │      │ notes  │  │ with issues  │
         │      │ Accept │  └──────┬───────┘
         │      └───┬────┘         │
         │          │              │
         └──────────┴──────────────┘
                    │
                    ▼
            Final Answer Ready
```

---

## Component Communication

### React Component State Flow

```
┌─────────────────────────────────────────────────────────┐
│ App.tsx                                                 │
│                                                         │
│ State:                                                  │
│ ├─ messages: AgentMessage[]                            │
│ ├─ mode: 'sync' | 'stream'                             │
│ └─ Derived sidebar state                               │
│                                                         │
│ Hooks:                                                  │
│ ├─ useChat() → chatMutation                            │
│ └─ useChatStream() → stream object                     │
└─────────────────────────────────────────────────────────┘
         │              │              │
         │              │              │
         ▼              ▼              ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ ChatInput   │  │ MessageList │  │ Sidebars    │
│             │  │             │  │             │
│ Props:      │  │ Props:      │  │ Props:      │
│ - disabled  │  │ - messages  │  │ - citations │
│ - onSend    │  │ - streaming │  │ - activity  │
│             │  │ - isLoading │  │ - plan      │
│             │  │             │  │ - telemetry │
└─────────────┘  └─────────────┘  └─────────────┘
```

### Event Flow (Streaming Mode)

```
Backend Orchestrator
    │
    │ emit('status', { stage })
    │ emit('plan', plan)
    │ emit('citations', { citations })
    │ emit('tokens', { content })
    │ ...
    │
    ▼
SSE Stream
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ useChatStream.ts                                        │
│                                                         │
│ EventSource listener:                                   │
│                                                         │
│ on 'status':     setStatus(data.stage)                 │
│ on 'plan':       setPlan(data)                         │
│ on 'citations':  setCitations(data.citations)          │
│ on 'activity':   addActivity(data.steps)               │
│ on 'tokens':     answer += data.content                │
│ on 'critique':   setCritique(data)                     │
│ on 'telemetry':  setTelemetry(data)                    │
│ on 'complete':   setAnswer(data.answer)                │
│ on 'done':       setIsStreaming(false)                 │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
                React State Updates
                        │
                        ▼
                UI Re-renders
```

---

## Extension Points for New Features

### Adding a New Tool

```
1. Create tool file:
   backend/src/tools/myTool.ts
   
2. Implement function:
   export async function myTool(args: MyArgs) {
     // Logic
     return result;
   }

3. Export from index:
   backend/src/tools/index.ts
   export { myTool } from './myTool.js';

4. Add to orchestrator dispatch:
   backend/src/orchestrator/dispatch.ts
   
5. Add to tool routing:
   if (plan.steps.includes('my_action')) {
     result = await myTool(args);
   }
```

### Adding a New Route

```
1. Define handler:
   backend/src/routes/feature.ts
   
2. Register in main routes:
   backend/src/routes/index.ts
   app.post('/feature/action', handler);

3. Add type definitions:
   shared/types.ts
   
4. Create frontend API call:
   frontend/src/api/client.ts
   
5. Use in component:
   frontend/src/components/Feature.tsx
```

### Adding a New Component

```
1. Create component file:
   frontend/src/components/NewFeature.tsx
   
2. Define props interface:
   interface NewFeatureProps { ... }

3. Implement component:
   export function NewFeature(props) { ... }

4. Add to App.tsx:
   <NewFeature {...props} />

5. Add styles:
   frontend/src/App.css
```

---

## Key Configuration Points

### Backend Configuration

```typescript
// backend/src/config/app.ts

Essential vars:
- AZURE_SEARCH_ENDPOINT
- AZURE_SEARCH_INDEX_NAME
- AZURE_OPENAI_ENDPOINT
- AZURE_OPENAI_GPT_DEPLOYMENT

Context settings:
- CONTEXT_HISTORY_TOKEN_CAP: 1800
- CONTEXT_SUMMARY_TOKEN_CAP: 600
- CONTEXT_MAX_RECENT_TURNS: 12

Critic settings:
- CRITIC_MAX_RETRIES: 1
- CRITIC_THRESHOLD: 0.8

Retrieval settings:
- PLANNER_CONFIDENCE_DUAL_RETRIEVAL: 0.45
- RERANKER_THRESHOLD: 2.5
- RETRIEVAL_MIN_DOCS: 3

Web search:
- WEB_CONTEXT_MAX_TOKENS: 8000
- WEB_RESULTS_MAX: 6
```

### Frontend Configuration

```typescript
// frontend/.env

VITE_API_BASE=http://localhost:8787
VITE_APP_TITLE=Agentic Azure Chat
```

---

## Testing Entry Points

### Backend Tests

```bash
# Run all tests
cd backend && pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# Specific test
pnpm test orchestrator.test.ts
```

### Manual API Testing

```bash
# Health check
curl http://localhost:8787/health

# Chat (sync)
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'

# Chat (stream)
curl -N -X POST http://localhost:8787/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'

# Telemetry (dev only)
curl http://localhost:8787/admin/telemetry
```

---

## Summary

This architecture map provides a visual and structural guide to:

1. **System layers** - Frontend → Backend → Azure
2. **Request flows** - How data moves through the system
3. **Directory structure** - What each file does
4. **Data pipelines** - How information is transformed
5. **Extension points** - Where to add new features
6. **Configuration** - Key settings to adjust
7. **Testing** - How to verify functionality

**Use this map when:**
- Planning new features
- Debugging issues
- Onboarding new developers
- Making architectural decisions

---

**Last Updated:** October 3, 2025  
**Version:** 1.0
