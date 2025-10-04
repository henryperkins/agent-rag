# Agentic RAG Chat Application

A production-grade **Retrieval-Augmented Generation (RAG)** chat application with intelligent orchestration, multi-source retrieval, and real-time streaming responses.

![Architecture](https://img.shields.io/badge/Architecture-Agentic%20RAG-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-blue)
![Node.js](https://img.shields.io/badge/Node.js-20+-green)
![React](https://img.shields.io/badge/React-18+-61dafb)

## 🌟 Features

### Core Capabilities
- **🤖 Intelligent Orchestration**: Advanced agentic workflow with planning, retrieval, synthesis, and critique
- **🔍 Hybrid Retrieval**: Direct Azure AI Search integration with vector + BM25 + L2 semantic reranking
- **🌐 Web Search**: Google Custom Search integration for real-time information
- **⚡ Streaming Responses**: Real-time SSE (Server-Sent Events) streaming with progress updates
- **🎯 Multi-Pass Critic**: Quality evaluation with automatic revision loops
- **💡 Lazy Retrieval**: Summary-first retrieval with on-demand full document hydration
- **🧠 Semantic Memory**: Persistent semantic memory with SQLite and vector similarity
- **📊 Rich Observability**: OpenTelemetry tracing, telemetry events, and evaluation metrics

### Advanced Features
- **Intent Classification**: Automatic routing (FAQ, factual, research, conversational)
- **Context Engineering**: Token-budgeted history compaction with summary/salience extraction
- **Confidence-Based Escalation**: Automatic fallback to dual retrieval on low confidence
- **Structured Outputs**: JSON schema validation for planner and critic responses
- **Multi-Level Fallback**: Graceful degradation from hybrid → pure vector → web search
- **Session Persistence**: In-memory session state with conversation history

## 🏗️ Architecture

### Tech Stack

**Backend**
- **Runtime**: Node.js 20+ with TypeScript 5.6
- **Framework**: Fastify (high-performance HTTP)
- **AI/ML**: Azure OpenAI (GPT-4o, text-embedding-3-large)
- **Search**: Azure AI Search (hybrid semantic search)
- **Database**: SQLite (better-sqlite3) for semantic memory
- **Observability**: OpenTelemetry, Pino logging
- **Testing**: Vitest with coverage

**Frontend**
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite 5
- **Styling**: CSS with responsive design
- **State**: React hooks (useState, useEffect)
- **Streaming**: EventSource for SSE

**Shared**
- **Types**: Common TypeScript interfaces
- **Package Manager**: pnpm (monorepo-ready)

### Orchestrator Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                   Intent Classification                  │
│              (FAQ/Factual/Research/Chat)                │
└───────────────────────┬─────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                  Context Engineering                     │
│        (History Compaction + Summary Selection)         │
└───────────────────────┬─────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                      Planning                            │
│         (Query Analysis + Strategy Selection)           │
└───────────────────────┬─────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                    Tool Dispatch                         │
│  (Azure AI Search + Web Search + Lazy Retrieval)        │
└───────────────────────┬─────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                     Synthesis                            │
│           (Answer Generation with Citations)            │
└───────────────────────┬─────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                   Critic Evaluation                      │
│        (Coverage + Grounding + Quality Check)           │
└───────────────────────┬─────────────────────────────────┘
                        ↓
                  Accept or Revise
```

## 📋 Prerequisites

- **Node.js** 20.19.5 or later
- **pnpm** 10+ (recommended) or npm
- **Azure Account** with:
  - Azure AI Search instance (with semantic ranking enabled)
  - Azure OpenAI deployment (GPT-4o + text-embedding-3-large)
- **Google Cloud** (optional, for web search):
  - Custom Search API key
  - Search Engine ID

## 🚀 Quick Start

### 1. Clone Repository

```bash
git clone <repository-url>
cd agent-rag
```

### 2. Install Dependencies

```bash
# Backend
cd backend
pnpm install

# Frontend
cd ../frontend
pnpm install
```

### 3. Configure Environment

Create `.env` in the `backend/` directory:

```bash
# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://your-search.search.windows.net
AZURE_SEARCH_API_KEY=your-search-key
AZURE_SEARCH_INDEX_NAME=your-index-name

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-openai.openai.azure.com
AZURE_OPENAI_API_KEY=your-openai-key
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-4o
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large
AZURE_OPENAI_GPT_MODEL_NAME=gpt-4o-2024-08-06
AZURE_OPENAI_EMBEDDING_MODEL_NAME=text-embedding-3-large

# Google Custom Search (Optional)
GOOGLE_SEARCH_API_KEY=your-google-api-key
GOOGLE_SEARCH_ENGINE_ID=your-search-engine-id

# Server Configuration
PORT=8787
CORS_ORIGIN=http://localhost:5173

# Feature Flags
ENABLE_INTENT_ROUTING=true
ENABLE_LAZY_RETRIEVAL=true
ENABLE_SEMANTIC_SUMMARY=true

# Retrieval Settings
RAG_TOP_K=5
RERANKER_THRESHOLD=3.0
RETRIEVAL_FALLBACK_RERANKER_THRESHOLD=2.0
CRITIC_MAX_RETRIES=2
CRITIC_THRESHOLD=0.75

# Context Limits
CONTEXT_HISTORY_TOKEN_CAP=4000
CONTEXT_SUMMARY_TOKEN_CAP=1500
CONTEXT_SALIENCE_TOKEN_CAP=800
WEB_CONTEXT_MAX_TOKENS=2000

# Semantic Memory
SEMANTIC_MEMORY_DB_PATH=./data/semantic-memory.db
SEMANTIC_MEMORY_RECALL_K=3
SEMANTIC_MEMORY_MIN_SIMILARITY=0.7
```

### 4. Run Application

**Option 1: Using the startup script**
```bash
./start.sh
```

**Option 2: Manual startup**
```bash
# Terminal 1 - Backend
cd backend
pnpm dev

# Terminal 2 - Frontend
cd frontend
pnpm dev
```

**Access the application:**
- Frontend: http://localhost:5173
- Backend API: http://localhost:8787

## 📖 Usage

### Chat Interface

1. Open http://localhost:5173 in your browser
2. Toggle between **Sync** and **Stream** modes
3. Type your question and press Enter
4. View:
   - **Plan Panel**: Query analysis, confidence, context budget, critique timeline
   - **Activity Panel**: Retrieval steps, tool execution, fallback triggers
   - **Sources Panel**: Citations with inline references
   - **Message List**: Conversation history with answers

### API Endpoints

#### `POST /chat` - Synchronous Chat
```json
{
  "messages": [
    { "role": "user", "content": "What is Azure AI Search?" }
  ]
}
```

**Response:**
```json
{
  "answer": "Azure AI Search is a cloud search service... [1]",
  "citations": [
    {
      "id": "doc-1",
      "title": "Azure AI Search Overview",
      "url": "https://...",
      "content": "..."
    }
  ],
  "metadata": {
    "plan": { "confidence": 0.85, "steps": [...] },
    "context_budget": { "history_tokens": 150, ... },
    "evaluation": { ... }
  },
  "activity": [...]
}
```

#### `POST /chat/stream` - Streaming Chat (SSE)

**Events emitted:**
- `route`: Intent classification result
- `plan`: Query analysis and strategy
- `context`: Context budget breakdown
- `tool`: Tool execution updates
- `token`: Answer tokens (streaming)
- `critique`: Critic evaluation
- `complete`: Final answer with metadata
- `telemetry`: Performance metrics
- `done`: Stream completion

## 🧪 Testing

### Run Tests
```bash
cd backend
pnpm test                # Run all tests
pnpm test:watch          # Watch mode
pnpm test:coverage       # With coverage report
```

### Test Suites
- `orchestrator.test.ts` - Core orchestration logic
- `orchestrator.integration.test.ts` - End-to-end scenarios
- `dispatch.test.ts` - Tool dispatch and fallback
- `directSearch.auth.test.ts` - Azure AI Search integration
- `lazyRetrieval.test.ts` - Lazy retrieval patterns
- `router.test.ts` - Intent classification
- `summarySelector.test.ts` - Summary selection
- `semanticMemoryStore.test.ts` - Semantic memory operations

## 📁 Project Structure

```
agent-rag/
├── backend/
│   ├── src/
│   │   ├── orchestrator/      # Core orchestration logic
│   │   │   ├── index.ts        # Main runSession entry point
│   │   │   ├── plan.ts         # Query analysis and planning
│   │   │   ├── dispatch.ts     # Tool routing and execution
│   │   │   ├── critique.ts     # Answer evaluation
│   │   │   ├── compact.ts      # History compaction
│   │   │   ├── router.ts       # Intent classification
│   │   │   ├── summarySelector.ts   # Semantic summary selection
│   │   │   ├── semanticMemoryStore.ts # Persistent memory
│   │   │   └── ...
│   │   ├── azure/             # Azure integrations
│   │   │   ├── directSearch.ts     # AI Search client
│   │   │   ├── lazyRetrieval.ts    # Lazy loading wrapper
│   │   │   └── openaiClient.ts     # OpenAI client
│   │   ├── tools/             # Tool implementations
│   │   │   ├── index.ts        # retrieveTool, answerTool
│   │   │   └── webSearch.ts    # Google Custom Search
│   │   ├── routes/            # API routes
│   │   ├── config/            # Configuration (Zod schemas)
│   │   ├── utils/             # Utilities (resilience, telemetry)
│   │   └── tests/             # Test suites
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/        # React components
│   │   │   ├── PlanPanel.tsx       # Plan & critique display
│   │   │   ├── ActivityPanel.tsx   # Retrieval activity
│   │   │   ├── SourcesPanel.tsx    # Citations
│   │   │   ├── MessageList.tsx     # Chat history
│   │   │   └── ChatInput.tsx       # User input
│   │   ├── hooks/             # Custom hooks
│   │   │   ├── useChatStream.ts    # SSE handling
│   │   │   └── useChat.ts          # Sync API
│   │   ├── App.tsx            # Main application
│   │   └── types.ts           # Frontend types
│   └── package.json
│
├── shared/
│   └── types.ts               # Shared TypeScript types
│
├── docs/                      # Documentation
│   ├── architecture-map.md
│   ├── CRITIC_ENHANCEMENTS.md
│   └── ...
│
├── start.sh                   # Startup script
├── CLAUDE.md                  # Developer guide
└── README.md                  # This file
```

## 🔑 Key Concepts

### Intent Routing
Automatically classifies queries into categories:
- **FAQ**: Quick answers (e.g., "What is X?")
- **Factual**: Specific information lookup
- **Research**: Multi-source analysis required
- **Conversational**: Follow-up or chitchat

Each intent uses optimized model/token settings.

### Lazy Retrieval
Summary-first approach to reduce costs:
1. Retrieve document summaries (~200 chars)
2. Critic evaluates if summaries are sufficient
3. Load full documents only when needed
4. Configurable via `ENABLE_LAZY_RETRIEVAL=true`

### Multi-Pass Critic
Quality assurance loop:
1. Generate answer from retrieved context
2. Critic evaluates: grounding, coverage, quality
3. If `action: 'revise'`, regenerate with revision notes
4. Repeat up to `CRITIC_MAX_RETRIES` times
5. Track iterations in critique history timeline

### Context Engineering
Token-optimized context assembly:
- **Compaction**: Extract summaries from old turns
- **Salience**: Identify key information
- **Budgeting**: Enforce caps per section
- **Summary Selection**: Semantic similarity ranking

### Semantic Memory
Persistent cross-session memory:
- Stores episodic, semantic, procedural, preference memories
- Vector similarity search with cosine distance
- Automatic usage tracking and pruning
- SQLite backend with WAL mode

## 🛠️ Development

### Backend Development
```bash
cd backend
pnpm dev          # Start with hot reload
pnpm lint         # Check code quality
pnpm build        # Compile TypeScript
pnpm start        # Run production build
```

### Frontend Development
```bash
cd frontend
pnpm dev          # Start Vite dev server
pnpm lint         # Check code quality
pnpm build        # Build for production
pnpm preview      # Preview production build
```

### Environment Variables

Full configuration reference in `backend/src/config/app.ts`

**Categories:**
- Azure endpoints and credentials
- Feature flags (`ENABLE_*`)
- Retrieval thresholds and limits
- Context token budgets
- Critic settings
- Web search configuration
- Security (rate limiting, CORS)
- Semantic memory settings

## 📊 Observability

### Telemetry Events
- `SessionTrace`: Complete request lifecycle
- `PlanSummary`: Query analysis results
- `ContextBudget`: Token allocation breakdown
- `CriticReport`: Evaluation findings
- `ActivityStep`: Retrieval operations

### OpenTelemetry Spans
- `execute_task`: End-to-end request
- `agent.plan`: Planning phase
- `agent.tool.dispatch`: Tool execution
- `agent.synthesis`: Answer generation
- `agent.critique`: Quality evaluation

### Metrics
- Intent resolution accuracy
- RAG retrieval precision/recall
- Answer quality scores (fluency, coherence, completeness)
- Tool call accuracy
- Token usage per component

## 🔒 Security

- **Rate Limiting**: Configurable per-IP limits
- **CORS**: Whitelist origins
- **Input Validation**: Zod schemas
- **Request Timeouts**: Prevent hanging requests
- **API Key Protection**: Environment-based secrets
- **Data Redaction**: Sensitive info removed from telemetry

## 🚢 Deployment

### Production Build
```bash
# Backend
cd backend
pnpm build
pnpm start

# Frontend
cd frontend
pnpm build
# Serve dist/ with nginx/caddy/vercel
```

### Environment Setup
1. Provision Azure resources (AI Search, OpenAI)
2. Configure index with semantic ranking
3. Deploy embeddings to vector fields
4. Set environment variables
5. Run `pnpm install --prod`
6. Start with process manager (PM2, systemd)

### Docker (Coming Soon)
```bash
docker-compose up -d
```

## 📚 Documentation

- **[CLAUDE.md](./CLAUDE.md)**: Developer guide for Claude Code
- **[docs/architecture-map.md](./docs/architecture-map.md)**: System architecture overview
- **[docs/CRITIC_ENHANCEMENTS.md](./docs/CRITIC_ENHANCEMENTS.md)**: Multi-pass critic details
- **[docs/unified-orchestrator-context-pipeline.md](./docs/unified-orchestrator-context-pipeline.md)**: Orchestrator design spec

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Development Standards:**
- TypeScript strict mode enabled
- ESLint + Prettier for code style
- Vitest for testing (>80% coverage goal)
- Conventional commits preferred

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

- **Azure AI Search** for hybrid semantic search capabilities
- **Azure OpenAI** for GPT-4o and embeddings
- **Fastify** for high-performance HTTP server
- **React** and **Vite** for modern frontend development
- **OpenTelemetry** for observability standards

## 📧 Support

For issues, questions, or contributions:
- Open an [Issue](../../issues)
- Submit a [Pull Request](../../pulls)
- Check [Documentation](./docs/)

---

**Built with ❤️ using Azure AI, TypeScript, and React**
