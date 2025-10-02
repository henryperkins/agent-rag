# Agentic Azure Chat Frontend

React + Vite UI for the Agentic Azure AI Search application.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Backend running on `http://localhost:8787` (or configure `VITE_API_BASE`)

## Quick Start

```bash
pnpm install
cp .env.example .env    # adjust API base if needed
pnpm dev
```

Visit http://localhost:5173 to use the chat.

## Scripts

| Command         | Description                               |
| --------------- | ----------------------------------------- |
| `pnpm dev`      | Start Vite dev server                     |
| `pnpm build`    | Type-check and build production bundle    |
| `pnpm preview`  | Preview production build                  |
| `pnpm lint`     | Run ESLint (optional)                     |

## Environment Variables

- `VITE_API_BASE`: Backend base URL (defaults to `http://localhost:8787`)
- `VITE_APP_TITLE`: Custom title (optional)

## Deployment

1. Build assets: `pnpm build`
2. Serve `dist/` with your preferred static host (Azure Static Web Apps, Azure Storage + CDN, etc.)
3. Ensure backend CORS allows your origin.
