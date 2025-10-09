# Azure OpenAI Responses API in this repo

This backend calls Azure OpenAI’s v1 Responses API and exposes minimal helpers so you can inspect or manage stored responses from your app and tests.

## Endpoints

- `GET /responses/:id?include[]=...` – Retrieve a stored response. Pass one or more `include[]` entries (e.g., `include[]=file_search_call.results`).
- `GET /responses/:id/input_items` – List canonical input items used for the response.
- `DELETE /responses/:id` – Delete stored output for a response ID.

## Streaming

Chat SSE (`POST /chat/stream`) streams model output via Server-Sent Events. The backend forwards Azure SSE events and emits custom orchestrator events.

**Event Naming Convention**:

- Clients should subscribe to `token` events (singular) for streamed answer content
- Internally, the orchestrator emits `tokens` events, which the streaming service maps to `token` for SSE clients
- See [`backend/src/services/chatStreamService.ts:20-23`](../backend/src/services/chatStreamService.ts:20-23) for mapping logic

**Core SSE Events**:

- `status` - Execution stage updates (context, planning, retrieval, generating, review)
- `route` - Intent classification result with model/retriever strategy
- `plan` - Query analysis and retrieval strategy
- `context` - Context budget breakdown (history, summary, salience)
- `tool` - Tool execution updates (references count, web results count)
- `citations` - Retrieved references with metadata
- `activity` - Execution steps timeline
- `token` - Answer tokens (streamed progressively) ⚠️ **Listen to 'token' not 'tokens'**
- `critique` - Critic evaluation (grounding, coverage, issues)
- `complete` - Final answer with full metadata
- `telemetry` - Performance metrics and diagnostics
- `trace` - Session trace object
- `done` - Stream completion signal

**Advanced Events** (when features enabled):

- `semantic_memory` - Recalled memories (when `ENABLE_SEMANTIC_MEMORY=true`)
- `complexity` - Query complexity assessment (when `ENABLE_QUERY_DECOMPOSITION=true`)
- `decomposition` - Sub-queries generated (when `ENABLE_QUERY_DECOMPOSITION=true`)
- `web_context` - Web search context info (when web search used)
- `reranking` - RRF reranking details (when `ENABLE_WEB_RERANKING=true`)
- `summary_selection_stats` - Summary selection metrics for monitoring

**Azure API Events** (forwarded from Azure OpenAI):

- `response.output_text.delta` - Partial text chunks from Azure
- `response.output_text.done` - Complete text from Azure
- `response.completed` - Azure response completion
- `response.usage` - Token usage (when `RESPONSES_STREAM_INCLUDE_USAGE=true`)

## Configuration

- `AZURE_OPENAI_ENDPOINT` – Your resource endpoint, e.g., `https://{resource}.openai.azure.com`.
- `AZURE_OPENAI_API_VERSION` – Fixed to `v1` by default.
- `AZURE_OPENAI_API_QUERY` – Appended to all calls (default: `api-version=preview`).
- `RESPONSES_PARALLEL_TOOL_CALLS` – Default for `parallel_tool_calls` (true/false).
- `RESPONSES_STREAM_INCLUDE_USAGE` – Include usage chunks in SSE (true/false).

## Code locations

- Client: `backend/src/azure/openaiClient.ts` (`createResponse`, `createResponseStream`, `retrieveResponse`, `deleteResponse`, `listInputItems`).
- Routes: `backend/src/routes/responses.ts`, wired in `backend/src/routes/index.ts`.
- Stream handler: `backend/src/orchestrator/index.ts` (SSE parsing and `usage` events).

## Quick examples

- Retrieve stored response:
  - `curl "http://localhost:8787/responses/resp_123?include[]=message.output_text.logprobs"`
- Delete stored response:
  - `curl -X DELETE "http://localhost:8787/responses/resp_123"`
- Enable usage in streaming:
  - Set `RESPONSES_STREAM_INCLUDE_USAGE=true` in `.env` and reconnect your stream client.

> Note: Requests to Azure always use `.../openai/v1/...` with `?api-version=preview` appended by default. Change the query via `AZURE_OPENAI_API_QUERY` when Microsoft updates the preview label.
