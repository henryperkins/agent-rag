# Technology Stack

## Programming Languages
- **TypeScript**: 5.6+ (strict mode enabled)
- **JavaScript**: ES Modules (type: "module")
- **Node.js**: 20.19.5+ runtime

## Backend Stack

### Core Framework
- **Fastify**: 5.6+ (high-performance HTTP server)
- **Runtime**: Node.js 20+ with native ES modules

### AI/ML Services
- **Azure OpenAI**: GPT-4o (gpt-4o-2024-08-06) for generation
- **Azure OpenAI Embeddings**: text-embedding-3-large for vector search
- **Azure AI Search**: 12.1+ SDK with hybrid semantic search
- **Google Custom Search**: Optional web search integration

### Database & Storage
- **SQLite**: better-sqlite3 9.6+ for semantic memory
- **File System**: Local storage for session data

### Key Dependencies
```json
{
  "@azure/search-documents": "^12.1.0",
  "@azure/identity": "^4.2.0",
  "openai": "^4.26.0",
  "fastify": "^5.6.1",
  "@fastify/cors": "^11.1.0",
  "@fastify/rate-limit": "^10.3.0",
  "better-sqlite3": "^9.6.0",
  "zod": "^3.23.8",
  "dotenv": "^17.2.3",
  "pino": "^9.3.2"
}
```

### Observability
- **OpenTelemetry**: Distributed tracing (@opentelemetry/api 1.9+)
- **Logging**: Pino 9.3+ with pretty printing
- **Token Counting**: @dqbd/tiktoken 1.0+

### Testing
- **Vitest**: 2.1+ (test runner with coverage)
- **@vitest/coverage-v8**: Coverage reporting
- **TypeScript**: Type checking in tests

## Frontend Stack

### Core Framework
- **React**: 18.3+ with hooks
- **React DOM**: 18.3+
- **Vite**: 5.4+ (build tool and dev server)

### State Management
- **React Query**: @tanstack/react-query 5.59+ for server state
- **React Hooks**: useState, useEffect for local state

### HTTP & Streaming
- **Axios**: 1.7+ for HTTP requests
- **EventSource**: Native browser API for SSE streaming

### UI Utilities
- **clsx**: 2.1+ for conditional CSS classes
- **react-hot-toast**: 2.4+ for notifications

### Key Dependencies
```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "@tanstack/react-query": "^5.59.15",
  "axios": "^1.7.7",
  "clsx": "^2.1.1",
  "react-hot-toast": "^2.4.1"
}
```

## Shared Types
- **Package**: Compiled TypeScript definitions
- **Location**: `shared/types.ts`
- **Usage**: Imported by both backend and frontend

## Build Tools

### Backend
- **Compiler**: TypeScript 5.6+ (tsc)
- **Dev Server**: tsx 4.19+ with watch mode
- **Linter**: ESLint 9.11+ with typescript-eslint 8.45+

### Frontend
- **Build Tool**: Vite 5.4+ with React plugin
- **Compiler**: TypeScript 5.6+
- **Linter**: ESLint 9.11+

## Package Management
- **Primary**: pnpm 10+ (recommended for monorepo)
- **Alternative**: npm (supported)
- **Lockfiles**: pnpm-lock.yaml

## Development Commands

### Backend
```bash
cd backend

# Development
pnpm dev              # Start dev server with hot reload (tsx watch)
pnpm build            # Compile TypeScript to dist/
pnpm start            # Run production build (node dist/server.js)

# Testing
pnpm test             # Run all tests (vitest run)
pnpm test:watch       # Watch mode
pnpm test:coverage    # With coverage report

# Utilities
pnpm setup            # Initialize database and resources
pnpm cleanup          # Clean up resources
pnpm lint             # ESLint check
```

### Frontend
```bash
cd frontend

# Development
pnpm dev              # Start Vite dev server (http://localhost:5173)
pnpm build            # Build for production (tsc + vite build)
pnpm preview          # Preview production build
pnpm lint             # ESLint check
```

### Monorepo
```bash
# Root level
./start.sh            # Start both backend and frontend
```

## Environment Configuration

### Backend (.env)
```bash
# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://your-search.search.windows.net
AZURE_SEARCH_API_KEY=your-key
AZURE_SEARCH_INDEX_NAME=your-index

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-openai.openai.azure.com
AZURE_OPENAI_API_KEY=your-key
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-4o
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large

# Google Search (Optional)
GOOGLE_SEARCH_API_KEY=your-key
GOOGLE_SEARCH_ENGINE_ID=your-id

# Server
PORT=8787
CORS_ORIGIN=http://localhost:5173

# Feature Flags (7 available)
ENABLE_INTENT_ROUTING=true
ENABLE_LAZY_RETRIEVAL=true
ENABLE_SEMANTIC_SUMMARY=false
ENABLE_SEMANTIC_MEMORY=false
ENABLE_WEB_RERANKING=false
ENABLE_QUERY_DECOMPOSITION=false
ENABLE_CRITIC=true
```

### Frontend (.env)
```bash
VITE_API_BASE_URL=http://localhost:8787
```

## TypeScript Configuration

### Backend (tsconfig.json)
- **Target**: ES2022
- **Module**: ES2022 (native ESM)
- **Strict**: true
- **Output**: dist/

### Frontend (tsconfig.json)
- **Target**: ES2020
- **Module**: ESNext
- **JSX**: react-jsx
- **Strict**: true

## Code Quality Tools
- **ESLint**: @eslint/js with TypeScript support
- **TypeScript**: Strict mode with no implicit any
- **Prettier**: Recommended (not enforced in package.json)

## Runtime Requirements
- **Node.js**: 20.19.5 or later
- **pnpm**: 10+ (or npm as alternative)
- **Azure Account**: AI Search + OpenAI deployments
- **Google Cloud**: Optional (for web search)
