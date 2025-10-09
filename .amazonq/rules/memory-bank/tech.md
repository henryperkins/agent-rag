# Technology Stack

## Programming Languages

- **TypeScript 5.6+**: Primary language for both backend and frontend
- **Node.js 20+**: Runtime environment (LTS version required)
- **JavaScript (ES Modules)**: Module system with `"type": "module"` in package.json

## Backend Technologies

### Core Framework

- **Fastify 5.6+**: High-performance HTTP server with plugin architecture
- **@fastify/cors**: CORS middleware for cross-origin requests
- **@fastify/rate-limit**: Rate limiting for API protection

### AI/ML Services

- **Azure OpenAI (openai 4.26+)**: GPT-4o and text-embedding-3-large models
- **Azure AI Search (@azure/search-documents 12.1+)**: Hybrid semantic search
- **@azure/identity 4.2+**: Azure authentication (API keys and Managed Identity)

### Database

- **better-sqlite3 9.6+**: Synchronous SQLite3 bindings for semantic memory
- **SQLite**: Embedded database with WAL mode for concurrent access

### Observability

- **OpenTelemetry**: Distributed tracing and metrics
  - @opentelemetry/api 1.9+
  - @opentelemetry/sdk-trace-node 1.25+
  - @opentelemetry/exporter-trace-otlp-proto 0.52+
- **Pino 9.3+**: High-performance JSON logging
- **pino-pretty 11.2+**: Pretty-printed logs for development

### Utilities

- **Zod 3.23+**: Runtime type validation and schema parsing
- **dotenv 17.2+**: Environment variable management
- **@dqbd/tiktoken 1.0+**: Token counting for OpenAI models

### Testing

- **Vitest 2.1+**: Fast unit test runner with Vite integration
- **@vitest/coverage-v8**: Code coverage reporting
- **tsx 4.19+**: TypeScript execution for scripts and development

## Frontend Technologies

### Core Framework

- **React 18.3+**: UI library with hooks and functional components
- **React DOM 18.3+**: React renderer for web

### Build Tools

- **Vite 5.4+**: Fast build tool and dev server
- **@vitejs/plugin-react 4.3+**: React plugin for Vite
- **TypeScript 5.6+**: Type checking and compilation

### State Management & Data Fetching

- **@tanstack/react-query 5.59+**: Server state management and caching
- **axios 1.7+**: HTTP client for API requests
- **EventSource (native)**: SSE streaming for real-time updates

### UI Utilities

- **clsx 2.1+**: Conditional CSS class composition
- **dompurify 3.2+**: XSS protection for HTML sanitization
- **react-hot-toast 2.4+**: Toast notifications

## Shared Dependencies

- **TypeScript**: Shared types in `shared/types.ts` compiled to CommonJS
- **Type Definitions**: @types/node, @types/react, @types/better-sqlite3

## Development Tools

### Package Management

- **pnpm 10.15+**: Fast, disk-efficient package manager (monorepo support)
- **pnpm workspaces**: Monorepo configuration via `pnpm-workspace.yaml`

### Code Quality

- **ESLint 9.11+**: Linting with flat config format
- **typescript-eslint 8.45+**: TypeScript-specific linting rules
- **Prettier 3.3+**: Code formatting
- **eslint-config-prettier**: Disables conflicting ESLint rules

### Git Hooks

- **Husky 9.1+**: Git hooks management
- **lint-staged 15.2+**: Run linters on staged files
- **@commitlint/cli 19.5+**: Commit message linting
- **@commitlint/config-conventional**: Conventional commits standard

### CI/CD

- **GitHub Actions**: Automated testing and linting (`.github/workflows/ci.yml`)

## Build System

### Backend Build

```bash
pnpm build          # TypeScript compilation (tsc)
pnpm dev            # Development with tsx watch mode
pnpm start          # Production server (node dist/server.js)
```

### Frontend Build

```bash
pnpm build          # TypeScript check + Vite build
pnpm dev            # Vite dev server with HMR
pnpm preview        # Preview production build
```

### Monorepo Commands

```bash
pnpm -r build       # Build all packages
pnpm -r test        # Run all tests
pnpm -r lint        # Lint all packages
```

## Development Commands

### Backend

- `pnpm dev`: Start development server with hot reload (tsx watch)
- `pnpm test`: Run Vitest tests
- `pnpm test:watch`: Watch mode for tests
- `pnpm test:coverage`: Generate coverage report
- `pnpm lint`: ESLint check
- `pnpm typecheck`: TypeScript type checking without emit
- `pnpm setup`: Initialize semantic memory database
- `pnpm cleanup`: Clean up database and temporary files

### Frontend

- `pnpm dev`: Start Vite dev server (http://localhost:5173)
- `pnpm build`: Production build to `dist/`
- `pnpm preview`: Preview production build
- `pnpm lint`: ESLint check
- `pnpm typecheck`: TypeScript type checking

### Root

- `pnpm lint`: Lint all packages recursively
- `pnpm build`: Build all packages
- `pnpm test`: Run all tests
- `pnpm format`: Format markdown, JSON, YAML files with Prettier

## Configuration Files

### TypeScript

- `tsconfig.base.json`: Base configuration for monorepo
- `backend/tsconfig.json`: Backend-specific config (ES2022, Node20 module resolution)
- `frontend/tsconfig.json`: Frontend-specific config (React JSX, DOM types)

### ESLint

- `eslint.config.js`: Flat config format with TypeScript support
- Extends: @eslint/js, typescript-eslint, eslint-config-prettier

### Environment

- `.env`: Local environment variables (gitignored)
- `.env.example`: Template with all available options
- `.nvmrc`: Node.js version specification (20.19.5)

## External Services

### Required

- **Azure AI Search**: Hybrid search with semantic ranking enabled
- **Azure OpenAI**: GPT-4o and text-embedding-3-large deployments

### Optional

- **Google Custom Search API**: Web search fallback
- **OpenTelemetry Collector**: Distributed tracing backend

## Version Requirements

- Node.js: >=20 (specified in package.json engines)
- pnpm: 10.15.1 (specified in packageManager field)
- TypeScript: 5.6+ (strict mode enabled)
