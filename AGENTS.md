# Repository Guidelines

## Project Structure & Module Organization

- Monorepo folders: `backend/`, `frontend/`, `shared/`, `docs/`.
- Backend (Fastify) in `backend/src/`:
  - `server.ts` boots the service.
  - `routes/` HTTP endpoints; `agents/` and `orchestrator/` plan retrieval; `services/` integrate Azure Search/OpenAI; `tools/` external actions; `middleware/` sanitation; `config/` env loading.
  - Builds emit to `backend/dist/`.
- Frontend (Vite + React) in `frontend/src/` with `components/`, `hooks/`, `api/`; build to `frontend/dist/`.
- Shared TypeScript contracts in `shared/types.ts`.

## Build, Test, and Development Commands

- Install: `cd backend && pnpm install`, `cd frontend && pnpm install`.
- Backend: `pnpm dev` (watch), `pnpm build` (compile), `pnpm start` (run dist).
- Frontend: `pnpm dev` (local), `pnpm build`, `pnpm preview` (serve build).
- Index utilities (backend): `pnpm setup` to seed, `pnpm cleanup` to reset Search indexes.
- Lint/format: `pnpm lint`, `pnpm lint --fix`.

## Coding Style & Naming Conventions

- TypeScript + ES modules; 2-space indent, single quotes, trailing commas (see `backend/src/server.ts`).
- Naming: utilities kebab-case (e.g., `chunk-resolver.ts`), React components PascalCase (e.g., `ChatPanel.tsx`).
- Share interfaces via `shared/types.ts`. Prefer async/await and early returns. Route all config through `config/app.ts`.

## Testing Guidelines

- Backend: Vitest. Place specs in `backend/src/tests/` or as `*.test.ts` near sources.
- Commands: `pnpm test` (CI parity), `pnpm test:watch` (iterate), `pnpm test:coverage` (run before merging).
- Frontend: add tests for significant UI logic with React Testing Library + Vitest.
- Focus on orchestrators, services, and middleware edge cases; mirror file structure in tests.

## Environment & Configuration

- Create a root `.env`. Required values listed in `backend/src/config/app.ts` (Azure Search/OpenAI keys, rate limits, context caps, CORS).
- Keep secrets out of git; set `NODE_ENV` to match mode; adjust `CORS_ORIGIN` when exposing new hosts.
- Toggle `ENABLE_SEMANTIC_SUMMARY` after embeddings are validated to enable similarity-based summary selection.

## Commit & Pull Request Guidelines

- Commits: short, imperative (e.g., `Add request timeout`, `Update agent planner`).
- Scope: keep backend and frontend changes isolated unless the feature spans both.
- Before pushing: run lint, build, and tests; attach screenshots for UI updates.
- PRs: include clear description, commands run, linked issues/plans, risks, and tag owning reviewers (API, UI, shared contracts).
