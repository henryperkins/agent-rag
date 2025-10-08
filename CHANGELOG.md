# Changelog

All notable changes to the Agent-RAG application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.1] - 2025-10-08

### Fixed

- **SSE Timeout Bug** - Fixed request timeout hook in `server.ts:60-72` to skip timeout for `/chat/stream` endpoint, preventing premature termination of Server-Sent Events streaming connections
  - Impact: High - Streaming chat now works correctly for conversations longer than 30 seconds
  - Files: `backend/src/server.ts`

- **Sanitization Error Handling** - Fixed input validation in `sanitize.ts:23-42` to return proper 400 Bad Request responses instead of 500 Internal Server Error
  - Impact: Medium - API now returns correct HTTP status codes for malformed input
  - Files: `backend/src/middleware/sanitize.ts`

### Verified

- All 41/41 tests passing after bug fixes
- Production streaming chat endpoints now stable for long-running sessions

---

## [2.0.0] - 2025-10-07

### Fixed

- **Tool Injection Bug** - Fixed tool parameter passing in orchestrator/index.ts:669 from `options.tools` to `tools`
- **Test Coverage** - Added `lazyRetrieve` mocks to all test suites for complete coverage
- **Test Assertions** - Updated test assertions to handle lazy vs direct retrieval paths

### Added

- Full test suite with 41 tests covering:
  - Orchestrator core logic (10 tests)
  - Tool dispatch (8 tests)
  - Intent routing (5 tests)
  - Azure AI Search authentication (4 tests)
  - Lazy retrieval (6 tests)
  - Summary selection (4 tests)
  - Semantic memory (4 tests)

---

## [1.0.0] - 2025-10-04

### Added

- **Unified Orchestrator Pattern** - Single entry point (`runSession`) for sync and streaming modes
- **Direct Azure AI Search Integration** - Hybrid semantic search with 3-level fallback
- **Multi-Pass Critic Loop** - Quality assurance with automatic revision (up to configurable retries)
- **Lazy Retrieval** - Summary-first document loading with critic-triggered hydration
- **Intent Routing** - Adaptive model/strategy selection (FAQ/Research/Factual/Conversational)
- **Query Decomposition** - Complex query breakdown with dependency-aware execution
- **Semantic Memory** - SQLite-backed persistent cross-session context with embedding-based recall
- **Web Search Integration** - Google Custom Search JSON API with token budgeting
- **RRF Reranking** - Reciprocal Rank Fusion combining Azure + web results
- **Context Engineering** - History compaction, token budgeting, semantic summary selection
- **OpenTelemetry Observability** - Distributed tracing with structured spans
- **Streaming Architecture** - SSE-based real-time event streaming to frontend
- **Feature Flags** - 7 toggleable advanced capabilities for progressive enablement
- **Configuration System** - 77 environment variables for fine-tuning

### Technical Details

- **Backend**: Fastify + TypeScript + Azure AI Search + Azure OpenAI
- **Frontend**: React 18 + Vite + TypeScript
- **Testing**: Vitest with 41 tests across 12 test files
- **Authentication**: API Key + Managed Identity with token caching
- **Security**: Rate limiting, CORS, request timeouts, input sanitization
- **Resilience**: Exponential backoff retry logic, multi-level fallback chains

---

## Documentation

- [README.md](./README.md) - Quick start guide
- [CLAUDE.md](./CLAUDE.md) - Developer reference
- [docs/architecture-map.md](./docs/architecture-map.md) - System architecture
- [docs/CURRENTLY_WORKING_FEATURES.md](./docs/CURRENTLY_WORKING_FEATURES.md) - Feature inventory
- [docs/backend-fixes.md](./docs/backend-fixes.md) - Bug fix details
- [docs/CRITIC_ENHANCEMENTS.md](./docs/CRITIC_ENHANCEMENTS.md) - Multi-pass critic design
- [docs/unified-orchestrator-context-pipeline.md](./docs/unified-orchestrator-context-pipeline.md) - Orchestrator specification
