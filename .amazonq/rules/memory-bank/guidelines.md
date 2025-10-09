# Development Guidelines

## Code Quality Standards

### TypeScript Strict Mode

- **Strict type checking enabled**: All code uses TypeScript strict mode with explicit types
- **No implicit any**: All function parameters, return types, and variables have explicit type annotations
- **Type imports**: Use `import type` for type-only imports to enable proper tree-shaking
  ```typescript
  import type { Reference, AgentMessage } from '../../../shared/types.js';
  ```
- **Interface over type**: Prefer `interface` for object shapes, `type` for unions/intersections

### File Extensions

- **ES Modules**: All imports use `.js` extension even for TypeScript files
  ```typescript
  import { config } from '../config/app.js';
  import { traced } from './telemetry.js';
  ```
- **Rationale**: Required for ES module resolution in Node.js with `"type": "module"`

### Naming Conventions

- **camelCase**: Functions, variables, parameters
  ```typescript
  function generateAnswer() {}
  const queryVector = await generateEmbedding(query);
  ```
- **PascalCase**: Classes, interfaces, types, enums
  ```typescript
  interface SearchOptions {}
  class SearchQueryBuilder {}
  type ExecMode = 'sync' | 'stream';
  ```
- **SCREAMING_SNAKE_CASE**: Constants and environment variables
  ```typescript
  const DEFAULT_INTENT_MODELS = { ... };
  config.AZURE_OPENAI_ENDPOINT
  ```
- **Descriptive names**: Avoid abbreviations except common ones (id, url, api, http)

### Code Organization

- **Single responsibility**: Each file has one primary export/purpose
- **Barrel exports**: Use index.ts for public API surface
  ```typescript
  // tools/index.ts
  export { retrieveTool, answerTool } from './retrieve.js';
  export { webSearchTool } from './webSearch.js';
  ```
- **Colocation**: Tests live in `src/tests/` directory, not alongside source files
- **Shared types**: Common types in `shared/types.ts` for cross-package usage

## Architectural Patterns

### Async/Await Pattern

- **Consistent async**: All async functions use async/await, never raw Promises
- **Error propagation**: Let errors bubble up, catch at boundaries (route handlers, main orchestrator)
  ```typescript
  export async function runSession(options: RunSessionOptions): Promise<ChatResponse> {
    try {
      // Main logic
      return response;
    } catch (error) {
      sessionSpan.recordException(error as Error);
      throw error;
    }
  }
  ```

### Builder Pattern

- **Fluent interfaces**: Use method chaining for complex object construction
  ```typescript
  const builder = new SearchQueryBuilder(query)
    .asHybrid(queryVector, ['page_embedding_text_3_large'])
    .withSemanticRanking('default')
    .take(config.RAG_TOP_K * 2)
    .selectFields(['id', 'page_chunk', 'page_number']);
  ```
- **Immutable builders**: Each method returns `this` for chaining

### Factory Pattern

- **Tool factories**: Tools are functions that return standardized response shapes
  ```typescript
  export async function retrieveTool(args: { query: string }): Promise<AgenticRetrievalResponse> {
    return { response, references, activity };
  }
  ```

### Dependency Injection

- **Tool injection**: Orchestrator accepts tools as parameters for testability
  ```typescript
  export interface RunSessionOptions {
    tools?: Partial<OrchestratorTools>;
  }
  const tools: OrchestratorTools = { ...defaultTools, ...(options.tools ?? {}) };
  ```

### Event Emitter Pattern

- **Streaming events**: Use callback-based emit for real-time progress
  ```typescript
  emit?: (event: string, data: unknown) => void;
  emit?.('plan', plan);
  emit?.('token', { content });
  ```

## Internal API Usage

### Configuration Access

- **Centralized config**: Always import from `config/app.ts`, never use `process.env` directly
  ```typescript
  import { config } from '../config/app.js';
  if (config.ENABLE_LAZY_RETRIEVAL) { ... }
  ```
- **Zod validation**: All environment variables validated at startup with descriptive errors

### OpenTelemetry Tracing

- **Traced functions**: Wrap key operations with `traced` helper
  ```typescript
  const plan = await traced('agent.plan', async () => {
    const result = await getPlan(messages, compacted);
    const span = trace.getActiveSpan();
    span?.setAttribute('agent.plan.confidence', result.confidence);
    return result;
  });
  ```
- **Span attributes**: Add structured attributes for observability
- **Context propagation**: Use `context.with()` to maintain trace context

### Error Handling

- **Typed errors**: Cast errors to `Error` type when catching
  ```typescript
  } catch (error) {
    sessionSpan.recordException(error as Error);
    sessionSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
  }
  ```
- **Graceful degradation**: Provide fallback values when optional features fail
  ```typescript
  try {
    await trackCitationUsage(answer, references, question, sessionId);
  } catch (error) {
    console.warn('Citation tracking failed:', error);
  }
  ```

### Azure Client Patterns

- **Token caching**: Cache authentication tokens with expiry checks
  ```typescript
  let cachedSearchToken: { token: string; expiresOnTimestamp: number } | null = null;
  const now = Date.now();
  if (cachedSearchToken && cachedSearchToken.expiresOnTimestamp - now > 120000) {
    return { Authorization: `Bearer ${cachedSearchToken.token}` };
  }
  ```
- **Managed Identity fallback**: Support both API key and Managed Identity auth
  ```typescript
  if (config.AZURE_SEARCH_API_KEY) {
    return { 'api-key': config.AZURE_SEARCH_API_KEY };
  }
  const tokenResponse = await credential.getToken(scope);
  ```

### Response Streaming

- **SSE format**: Use Server-Sent Events with typed event names
  ```typescript
  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    const delta = JSON.parse(payload);
  };
  ```
- **Buffer management**: Process streaming data with line-based buffering
- **Completion detection**: Track completion state to stop reading

## Common Code Idioms

### Array Operations

- **Filter-map chains**: Chain operations for readability
  ```typescript
  const references: Reference[] = results
    .filter(r => (r['@search.rerankerScore'] || 0) >= threshold)
    .slice(0, config.RAG_TOP_K)
    .map((result, idx) => ({ id: result.id || `result_${idx}`, ... }));
  ```
- **Spread for immutability**: Use spread operator for array/object copies
  ```typescript
  const lazyReferenceState: LazyReference[] = dispatch.lazyReferences.map((ref) => ({ ...ref }));
  ```

### Conditional Execution

- **Feature flags**: Check config flags before executing optional features
  ```typescript
  if (config.ENABLE_SEMANTIC_MEMORY && question.trim()) {
    recalledMemories = await semanticMemoryStore.recallMemories(question, { ... });
  }
  ```
- **Optional chaining**: Use `?.` for safe property access
  ```typescript
  const firstToken = normalizedQuestion.split(/\s+/).find(Boolean);
  span?.setAttribute('agent.plan.confidence', result.confidence);
  ```

### Object Construction

- **Conditional properties**: Use spread with conditional objects
  ```typescript
  return {
    answer,
    citations,
    ...(config.ENABLE_RESPONSE_STORAGE && previousResponseId
      ? { previous_response_id: previousResponseId }
      : {}),
  };
  ```
- **Undefined stripping**: Remove undefined values before returning
  ```typescript
  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  });
  ```

### Type Guards

- **Runtime type checking**: Validate types at runtime for external data
  ```typescript
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return value >= 0.9 ? 5 : 4;
  }
  ```
- **Array checks**: Use `Array.isArray()` before array operations
  ```typescript
  if (Array.isArray(candidate.content)) {
    return candidate.content.map((part) => extractText(part)).join('');
  }
  ```

## Testing Patterns

### Vitest Configuration

- **Mock modules**: Use `vi.mock()` at top level before imports
  ```typescript
  vi.mock('../tools/index.js', () => ({
    retrieveTool: (args: any) => toolMocks.retrieve(args),
    answerTool: (args: any) => toolMocks.answer(args),
  }));
  ```
- **Mock reset**: Reset mocks in `beforeEach` for test isolation
  ```typescript
  beforeEach(() => {
    plannerMock.mockReset();
    toolMocks.retrieve.mockReset();
  });
  ```

### Integration Testing

- **Fastify injection**: Use `app.inject()` for route testing without HTTP server
  ```typescript
  const response = await app.inject({
    method: 'POST',
    url: '/chat',
    payload: { messages: [{ role: 'user', content: 'test' }] },
  });
  expect(response.statusCode).toBe(200);
  ```
- **End-to-end scenarios**: Test complete workflows through public API
- **Cleanup**: Always close Fastify app after tests
  ```typescript
  await app.close();
  ```

### Assertion Patterns

- **Structured assertions**: Check nested properties explicitly
  ```typescript
  expect(body.metadata?.plan?.confidence).toBeCloseTo(0.82);
  expect(body.metadata?.evaluation?.summary.status).toBeDefined();
  ```
- **Mock verification**: Verify tool calls and arguments
  ```typescript
  expect(toolMocks.webSearch).not.toHaveBeenCalled();
  expect(toolMocks.retrieve).toHaveBeenCalledTimes(1);
  ```

## Documentation Standards

### JSDoc Comments

- **Public APIs**: Document all exported functions with JSDoc
  ```typescript
  /**
   * Hybrid Search with Semantic Ranking (Recommended)
   * Combines vector similarity + keyword matching + L2 semantic reranking
   */
  export async function hybridSemanticSearch(query: string, options = {}) { ... }
  ```
- **Complex logic**: Add inline comments for non-obvious code
- **File headers**: Include purpose and key features at top of file

### Type Documentation

- **Interface comments**: Document complex interfaces and their fields
  ```typescript
  export interface SearchOptions {
    // Query
    query: string;
    queryVector?: number[];

    // Search modes
    searchMode?: 'any' | 'all'; // For keyword search
    queryType?: 'simple' | 'semantic' | 'vector' | 'hybrid';
  }
  ```

## Performance Considerations

### Token Optimization

- **Lazy loading**: Load summaries first, full content only when needed
- **Token budgeting**: Enforce caps per context section
  ```typescript
  const sections = budgetSections({
    sections: { history, summary, salience },
    caps: {
      history: config.CONTEXT_HISTORY_TOKEN_CAP,
      summary: config.CONTEXT_SUMMARY_TOKEN_CAP,
      salience: config.CONTEXT_SALIENCE_TOKEN_CAP,
    },
  });
  ```

### Caching Strategies

- **Token caching**: Cache authentication tokens with 2-minute buffer
- **Memory caching**: Use in-memory stores for session state
- **Embedding caching**: Reuse embeddings when possible

### Batch Operations

- **Parallel execution**: Use `Promise.all()` for independent operations
- **Streaming**: Stream large responses instead of buffering entirely

## Security Best Practices

### Input Validation

- **Zod schemas**: Validate all external input with Zod
  ```typescript
  const schema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      }),
    ),
  });
  ```

### Credential Management

- **Environment variables**: Never hardcode credentials
- **Token rotation**: Refresh tokens before expiry
- **Scope limitation**: Use minimal required scopes for tokens

### Data Sanitization

- **HTML sanitization**: Use DOMPurify on frontend for user content
- **SQL injection prevention**: Use parameterized queries (SQLite prepared statements)
- **XSS prevention**: Escape user content in responses

## Observability Patterns

### Structured Logging

- **Pino logger**: Use structured JSON logging
- **Log levels**: Use appropriate levels (debug, info, warn, error)
- **Context enrichment**: Include trace IDs and session IDs

### Metrics Collection

- **Evaluation dimensions**: Track quality metrics per request
  ```typescript
  const evaluation: SessionEvaluation = buildSessionEvaluation({
    question,
    answer,
    retrieval,
    critic,
    citations,
  });
  ```
- **Performance tracking**: Record latency, token usage, retry counts

### Telemetry Events

- **Typed events**: Use strongly-typed event payloads
- **Event ordering**: Emit events in logical sequence (route → plan → tool → critique → complete)
- **Error events**: Always emit error events with context
