# Azure OpenAI Responses API in this repo

This backend calls Azure OpenAI’s v1 Responses API and exposes minimal helpers so you can inspect or manage stored responses from your app and tests.

## Endpoints

- `GET /responses/:id?include[]=...` – Retrieve a stored response. Pass one or more `include[]` entries (e.g., `include[]=file_search_call.results`).
- `GET /responses/:id/input_items` – List canonical input items used for the response.
- `DELETE /responses/:id` – Delete stored output for a response ID.

## Streaming

- Chat SSE: `POST /chat/stream` streams model output. The backend forwards Azure SSE events and emits:
  - `response.output_text.delta`, `response.output_text.done`, `response.completed`
  - Optional usage snapshots when `RESPONSES_STREAM_INCLUDE_USAGE=true`.

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
