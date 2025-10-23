# File Tree Map

Comprehensive map of the `agent-rag` monorepo highlighting directories, primary modules, and documentation assets.

## Top-Level Map

- [`backend/`](backend/)
  - [`src/`](backend/src/)
    - [`server.ts`](backend/src/server.ts) — Boots the Fastify service and wires middleware, routes, and plugins.
    - [`config/`](backend/src/config/) — Environment & feature toggles via [`app.ts`](backend/src/config/app.ts) and [`features.ts`](backend/src/config/features.ts).
    - [`routes/`](backend/src/routes/) — HTTP endpoints such as [`index.ts`](backend/src/routes/index.ts) and [`chatStream.ts`](backend/src/routes/chatStream.ts).
    - [`services/`](backend/src/services/) — Business flows including [`enhancedChatService.ts`](backend/src/services/enhancedChatService.ts) and [`chatStreamService.ts`](backend/src/services/chatStreamService.ts).
    - [`orchestrator/`](backend/src/orchestrator/) — Core pipeline modules (e.g., [`index.ts`](backend/src/orchestrator/index.ts), [`plan.ts`](backend/src/orchestrator/plan.ts), [`dispatch.ts`](backend/src/orchestrator/dispatch.ts), [`critique.ts`](backend/src/orchestrator/critique.ts)).
    - [`azure/`](backend/src/azure/) — Azure Search/OpenAI integrations like [`adaptiveRetrieval.ts`](backend/src/azure/adaptiveRetrieval.ts) and [`openaiClient.ts`](backend/src/azure/openaiClient.ts).
    - [`tools/`](backend/src/tools/) — Tool implementations such as [`index.ts`](backend/src/tools/index.ts) and [`webSearch.ts`](backend/src/tools/webSearch.ts).
    - [`middleware/`](backend/src/middleware/) — Request sanitation handled by [`sanitize.ts`](backend/src/middleware/sanitize.ts).
    - [`tests/`](backend/src/tests/) — Vitest suites (e.g., [`orchestrator.test.ts`](backend/src/tests/orchestrator.test.ts)).
  - [`scripts/`](backend/scripts/) — Operational helpers like [`setup.ts`](backend/scripts/setup.ts) and [`cleanup.ts`](backend/scripts/cleanup.ts).
  - Build artifacts output to [`dist/`](backend/dist/) during compilation (ignored in version control).

- [`frontend/`](frontend/)
  - [`src/`](frontend/src/)
    - Entry points [`main.tsx`](frontend/src/main.tsx) and [`App.tsx`](frontend/src/App.tsx).
    - [`components/`](frontend/src/components/) — UI modules including [`ChatInput.tsx`](frontend/src/components/ChatInput.tsx), [`MessageList.tsx`](frontend/src/components/MessageList.tsx), [`PlanPanel.tsx`](frontend/src/components/PlanPanel.tsx), [`TelemetryDrawer.tsx`](frontend/src/components/TelemetryDrawer.tsx).
    - [`hooks/`](frontend/src/hooks/) — Data orchestrators [`useChat.ts`](frontend/src/hooks/useChat.ts) and [`useChatStream.ts`](frontend/src/hooks/useChatStream.ts).
    - [`api/`](frontend/src/api/) — HTTP client [`client.ts`](frontend/src/api/client.ts).
    - [`styles/`](frontend/src/styles/) — CSS bundles [`components.css`](frontend/src/styles/components.css), [`design-system.css`](frontend/src/styles/design-system.css), [`markdown.css`](frontend/src/styles/markdown.css).
    - [`components/__tests__/`](frontend/src/components/__tests__/) — Component tests such as [`FeatureTogglePanel.test.tsx`](frontend/src/components/__tests__/FeatureTogglePanel.test.tsx) and [`RichMessageContent.test.tsx`](frontend/src/components/__tests__/RichMessageContent.test.tsx).
  - Configuration files [`vite.config.ts`](frontend/vite.config.ts), [`tsconfig.json`](frontend/tsconfig.json), [`tsconfig.node.json`](frontend/tsconfig.node.json), and [`package.json`](frontend/package.json).

- [`shared/`](shared/) — Cross-package contracts including [`types.ts`](shared/types.ts), emitted [`types.js`](shared/types.js), and declarations [`types.d.ts`](shared/types.d.ts).

- [`docs/`](docs/) — Architecture and operations knowledge base covering [`architecture-map.md`](docs/architecture-map.md), [`ROADMAP.md`](docs/ROADMAP.md), [`PRIORITIZED_ACTION_PLAN.md`](docs/PRIORITIZED_ACTION_PLAN.md), [`quickstart-pdf-upload.md`](docs/quickstart-pdf-upload.md), and extensive archives under [`docs/archive/`](docs/archive/).

- Tooling & configuration assets:
  - Workspace manifests [`package.json`](package.json), [`pnpm-workspace.yaml`](pnpm-workspace.yaml), and [`pnpm-lock.yaml`](pnpm-lock.yaml).
  - Formatting and linting configs including [`prettier.config.cjs`](prettier.config.cjs), [`commitlint.config.cjs`](commitlint.config.cjs), [`backend/eslint.config.js`](backend/eslint.config.js), and [`frontend/eslint.config.js`](frontend/eslint.config.js).
  - Continuous integration and git automation via [`husky/`](.husky/), [`.github/workflows/`](.github/workflows/), and lint-staged settings in [`.lintstagedrc.json`](.lintstagedrc.json).
  - Environment templates [`backend/.env.example`](backend/.env.example), [`backend/.env.test`](backend/.env.test), and [`frontend/.env.example`](frontend/.env.example).

## Usage Notes

- Backend development: run `pnpm dev` from the scripts defined in [`backend/package.json`](backend/package.json) to launch the Fastify server on port 8787.
- Frontend development: start Vite via `pnpm dev` in [`frontend/package.json`](frontend/package.json) to serve the UI on port 5173.
- Shared contracts: modify [`shared/types.ts`](shared/types.ts) when changing request or response payloads so both services consume the latest shapes.

## Related Documentation

- Architectural diagrams and flow narratives: [`docs/architecture-map.md`](docs/architecture-map.md).
- Program roadmap and prioritized workstreams: [`docs/PRIORITIZED_ACTION_PLAN.md`](docs/PRIORITIZED_ACTION_PLAN.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).
- Feature implementation guidance for document ingestion: [`docs/quickstart-pdf-upload.md`](docs/quickstart-pdf-upload.md).
