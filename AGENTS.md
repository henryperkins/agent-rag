# Repository Guidelines

## Project Structure & Module Organization
The monorepo contains `backend/`, `frontend/`, `shared/`, plus reference material in `docs/`. The Fastify backend lives under `backend/src/`: `server.ts` boots the service, `routes/` define HTTP endpoints, `agents/` and `orchestrator/` drive retrieval planning, `services/` integrate Azure Search/OpenAI, `tools/` expose external actions, `middleware/` handles sanitation, and `config/` loads environment settings. Builds emit to `backend/dist/`. The Vite + React client sits in `frontend/src/` with UI components in `components/`, data hooks in `hooks/`, API helpers in `api/`, and production assets in `frontend/dist/`. Shared TypeScript contracts live in `shared/types.ts` to keep both runtimes aligned.

## Build, Test, and Development Commands
Install dependencies per package: `cd backend && pnpm install`, `cd frontend && pnpm install`. Run the API with `pnpm dev`, build via `pnpm build`, and serve compiled code with `pnpm start`. Frontend workflows mirror that flow: `pnpm dev`, `pnpm build`, and `pnpm preview`. Run `pnpm lint` before committing. Use `pnpm setup` / `pnpm cleanup` in `backend/` to seed or reset local Search indexes.

## Coding Style & Naming Conventions
TypeScript and ES modules are standard. Follow 2-space indentation, single quotes, and trailing commas (see `backend/src/server.ts`). Name utilities in kebab-case (`chunk-resolver.ts`), React components in PascalCase (`ChatPanel.tsx`), and share interfaces from `shared/types.ts`. Prefer async/await, guard logic with early returns, and funnel configuration through `config/app.ts`. Run `pnpm lint --fix` as the formatter.

## Testing Guidelines
Backend verification uses Vitest. Place specs under `backend/src/tests/` or co-locate as `*.test.ts`, covering orchestrators, services, and middleware edges. Run `pnpm test` for CI parity, `pnpm test:watch` while iterating, and `pnpm test:coverage` before merging. Add frontend tests when introducing significant UI logic, pairing React Testing Library with Vitest.

## Environment & Configuration
Create a `.env` at the repo root; `backend/src/config/app.ts` lists required values (Azure Search/OpenAI keys, rate limits, context caps, CORS). Keep secrets out of git, align `NODE_ENV` with the run mode, adjust `CORS_ORIGIN` when exposing new hosts, and toggle `ENABLE_SEMANTIC_SUMMARY` on once embeddings are evaluated so summary selection uses similarity ranking.

## Commit & Pull Request Guidelines
Write short, imperative commits (`Add request timeout`, `Update agent planner`). Keep backend and frontend changes isolated unless the feature spans both. Before pushing, run lint, build, and tests, and note those commands plus screenshots for UI updates in the PR description. Link issues or planning docs, highlight risks, and tag the owning reviewers (API, UI, shared contracts).
