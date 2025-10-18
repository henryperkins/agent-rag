# Technology Stack

## Programming Languages

### TypeScript 5.6+

- **Backend**: Strict mode enabled, ES modules
- **Frontend**: React with JSX/TSX support
- **Shared**: Common type definitions across packages

### Node.js 20+

- **Runtime**: ES module support, native fetch API
- **Package Manager**: pnpm 10+ (monorepo workspace support)

## Backend Technologies

### Core Framework

- **Fastify 5.6+**: High-performance HTTP server
  - Plugins: @fastify/cors, @fastify/multipart, @fastify/rate-limit
  - Schema validation with JSON Schema
  - Async/await request handlers

### AI/ML Services

- **Azure OpenAI**: GPT-4o (gpt-4o-2024-08-06), text-embedding-3-large
  - SDK: openai ^4.26.0
  - Structured outputs with JSON schema
  - Streaming completions
- **Azure AI Search**: Hybrid semantic search
  - SDK: @azure/search-documents ^12.1.0
  - Vector + BM25 + L2 semantic reranking
  - Semantic ranking configuration

### Database

- **SQLite**: better-sqlite3 ^9.6.0
  - Semantic memory with vector embeddings
  - Session transcripts and state
  - WAL mode for concurrent access

### Observability

- **OpenTelemetry**: Distributed tracing
  - @opentelemetry/api ^1.9.0
  - @opentelemetry/sdk-trace-node ^1.25.1
  - OTLP exporter for trace data
- **Pino**: Structured logging
  - pino ^9.3.2
  - pino-pretty for development

### Utilities

- **Zod ^3.23.8**: Runtime schema validation
- **@dqbd/tiktoken ^1.0.15**: Token counting
- **pdf-parse ^2.2.6**: PDF document processing
- **xml2js ^0.6.2**: XML parsing
- **dotenv ^17.2.3**: Environment configuration

## Frontend Technologies

### Core Framework

- **React 18.3+**: Component-based UI
  - Hooks: useState, useEffect, useCallback, useMemo
  - Functional components only
- **Vite 5.4+**: Build tool and dev server
  - @vitejs/plugin-react ^4.3.2
  - Fast HMR (Hot Module Replacement)

### State Management

- **TanStack Query 5.59+**: Server state management
  - Query caching and invalidation
  - Optimistic updates
  - Automatic refetching

### HTTP Client

- **Axios 1.7+**: Promise-based HTTP client
  - Request/response interceptors
  - Automatic JSON transformation

### UI Libraries

- **react-hot-toast ^2.4.1**: Toast notifications
- **dompurify ^3.2.7**: XSS sanitization
- **clsx ^2.1.1**: Conditional class names

### Streaming

- **EventSource**: Native SSE client for real-time updates

## Testing

### Test Framework

- **Vitest 2.1+**: Unit and integration testing
  - @vitest/coverage-v8 for coverage reports
  - Compatible with Vite configuration

### Frontend Testing

- **Testing Library**: React component testing
  - @testing-library/react ^16.3.0
  - @testing-library/jest-dom ^6.9.1
  - @testing-library/user-event ^14.6.1
- **jsdom ^27.0.0**: DOM simulation

## Development Tools

### Code Quality

- **ESLint 9.11+**: Linting
  - typescript-eslint ^8.45.0
  - eslint-config-prettier ^9.1.0
- **Prettier 3.3+**: Code formatting
- **EditorConfig**: Consistent editor settings

### Git Hooks

- **Husky 9.1+**: Git hook management
  - pre-commit: Lint staged files
  - pre-push: Run tests
- **lint-staged 15.2+**: Run linters on staged files
- **commitlint 19.5+**: Conventional commit messages

### Build Tools

- **TypeScript Compiler**: tsc for type checking and compilation
- **tsx 4.19+**: TypeScript execution for development

## Development Commands

### Monorepo (Root)

```bash
pnpm dev              # Start backend + frontend concurrently
pnpm dev:backend      # Start backend only
pnpm dev:frontend     # Start frontend only
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm lint             # Lint all packages
pnpm typecheck        # Type check all packages
pnpm format           # Format markdown/JSON/YAML
```

### Backend

```bash
pnpm dev              # Start with hot reload (tsx watch)
pnpm build            # Compile TypeScript to dist/
pnpm start            # Run production build
pnpm test             # Run Vitest tests
pnpm test:watch       # Watch mode
pnpm test:coverage    # With coverage report
pnpm setup            # Initialize databases
pnpm cleanup          # Clean databases
pnpm lint             # ESLint check
pnpm typecheck        # TypeScript check
```

### Frontend

```bash
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # Build for production (dist/)
pnpm preview          # Preview production build
pnpm test             # Run Vitest tests
pnpm test:watch       # Watch mode
pnpm lint             # ESLint check
pnpm typecheck        # TypeScript check
```

## Environment Requirements

### Node.js

- Version: 22 or later
- Specified in: .nvmrc (22), package.json engines (>=20)

### Package Manager

- pnpm 10.15.1 (specified in packageManager field)
- Workspace support for monorepo

### Azure Services

- Azure AI Search instance with semantic ranking enabled
- Azure OpenAI deployment with GPT-4o and text-embedding-3-large

### Optional Services

- Google Cloud Custom Search API (for web search)

## Configuration Files

### TypeScript

- `tsconfig.base.json`: Shared base configuration
- `backend/tsconfig.json`: Backend-specific settings
- `frontend/tsconfig.json`: Frontend-specific settings
- `frontend/tsconfig.node.json`: Vite config types

### ESLint

- `eslint.config.js`: Root configuration
- `backend/eslint.config.js`: Backend rules
- `frontend/eslint.config.js`: Frontend rules

### Other

- `.editorconfig`: Editor settings
- `.prettierignore`: Prettier exclusions
- `prettier.config.cjs`: Prettier configuration
- `commitlint.config.cjs`: Commit message rules
- `.lintstagedrc.json`: Lint-staged configuration
- `pnpm-workspace.yaml`: Workspace definition
