# Development Guidelines

## Code Quality Standards

### TypeScript Configuration

- **Strict Mode**: Enabled across all packages (backend, frontend, shared)
- **ES Modules**: Use `import`/`export` syntax, `.js` extensions in imports for Node.js compatibility
- **Type Safety**: Explicit return types for public functions, avoid `any` except for error handling
- **Shared Types**: Common interfaces in `shared/types.ts` for cross-package consistency

### Code Formatting

- **Line Endings**: LF (`\n`) per .editorconfig
- **Indentation**: 2 spaces (no tabs)
- **Semicolons**: Required at statement ends
- **Quotes**: Single quotes for strings, double quotes in JSX
- **Trailing Commas**: Used in multi-line objects/arrays
- **Max Line Length**: 100 characters (printWidth in prettier.config.cjs)

### Naming Conventions

- **Files**: camelCase for modules (`openaiClient.ts`), PascalCase for React components (`MessageList.tsx`)
- **Functions**: camelCase with descriptive verbs (`generateAnswer`, `handleChatStream`)
- **Types/Interfaces**: PascalCase (`AgentMessage`, `ChatResponse`, `OrchestratorTools`)
- **Constants**: SCREAMING_SNAKE_CASE for environment-based config (`AZURE_OPENAI_ENDPOINT`)
- **Private Functions**: Prefix with underscore or keep internal to module scope

### Documentation

- **JSDoc Comments**: Minimal - code should be self-documenting
- **Type Annotations**: Serve as inline documentation
- **README Files**: Comprehensive project-level documentation in markdown
- **Inline Comments**: Only for complex logic or non-obvious decisions

## Architectural Patterns

### Backend Patterns

#### Configuration Management

```typescript
// Use Zod schemas for environment validation
const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  AZURE_SEARCH_ENDPOINT: z.string().url(),
  ENABLE_LAZY_RETRIEVAL: z.coerce.boolean().default(true),
});

export const config = envSchema.parse(process.env);
```

#### Async/Await Error Handling

```typescript
// Prefer async/await over promises, handle errors explicitly
try {
  const result = await traced('agent.plan', async () => {
    const plan = await getPlan(messages, compacted);
    span?.setAttribute('agent.plan.confidence', plan.confidence);
    return plan;
  });
} catch (error) {
  sessionSpan.recordException(error as Error);
  throw error;
}
```

#### OpenTelemetry Tracing

```typescript
// Wrap operations with traced() helper for observability
const result = await traced('agent.tool.dispatch', async () => {
  const dispatch = await dispatchTools({ plan, messages, tools });
  const span = trace.getActiveSpan();
  span?.setAttribute('retrieval.references', dispatch.references.length);
  return dispatch;
});
```

#### Type Guards and Validation

```typescript
// Use type guards for runtime safety
const scoreValues = dispatch.references
  .map((ref) => ref.score)
  .filter((score): score is number => typeof score === 'number');
```

#### Functional Composition

```typescript
// Pure functions with explicit inputs/outputs
function mergeSalienceForContext(existing: SalienceNote[], fresh: SalienceNote[]) {
  const map = new Map<string, SalienceNote>();
  for (const note of existing) {
    map.set(note.fact, note);
  }
  for (const note of fresh) {
    map.set(note.fact, note);
  }
  return [...map.values()].sort((a, b) => (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0));
}
```

#### Event Emission Pattern

```typescript
// Optional emit callback for streaming events
emit?.('status', { stage: 'generating' });
emit?.('plan', plan);
emit?.('critique', { ...criticResult, attempt });
```

#### Feature Flag Resolution

```typescript
// Centralized feature gate resolution with overrides
const featureResolution = resolveFeatureToggles({
  overrides: options.featureOverrides,
  persisted: options.persistedFeatures,
});
const features = featureResolution.gates;
```

### Frontend Patterns

#### React Hooks

```typescript
// Custom hooks for API interactions
export function useChatStream() {
  const [answer, setAnswer] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const stream = useCallback(async (messages, sessionId, features) => {
    // EventSource SSE handling
  }, []);

  return { answer, isStreaming, stream /* ... */ };
}
```

#### State Management

```typescript
// TanStack Query for server state
const chatMutation = useChat();
const response = await chatMutation.mutateAsync({
  messages: updated,
  sessionId,
  feature_overrides: featureSelections,
});
```

#### Local Storage Persistence

```typescript
// Session and feature persistence
const [sessionId] = useState<string>(() => {
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;

  const next = crypto.randomUUID();
  window.localStorage.setItem(SESSION_STORAGE_KEY, next);
  return next;
});
```

#### Conditional Rendering

```typescript
// Ternary operators for mode-based rendering
const sidebar = useMemo(
  () => ({
    citations: mode === 'stream' ? stream.citations : (chatMutation.data?.citations ?? []),
    activity: mode === 'stream' ? stream.activity : (chatMutation.data?.activity ?? []),
  }),
  [mode, stream, chatMutation.data],
);
```

## Testing Standards

### Test Structure

```typescript
describe('FeatureTogglePanel', () => {
  it('invokes onToggle when a feature selection changes', () => {
    const onToggle = vi.fn();
    render(<FeatureTogglePanel selections={{}} onToggle={onToggle} />);

    const checkbox = screen.getByLabelText(/Multi-index federation/i);
    fireEvent.click(checkbox);

    expect(onToggle).toHaveBeenCalledWith('ENABLE_MULTI_INDEX_FEDERATION', true);
  });
});
```

### Testing Library Usage

- **Vitest**: Primary test framework with `describe`, `it`, `expect`, `vi` (mocking)
- **@testing-library/react**: Component testing with `render`, `screen`, `fireEvent`
- **@testing-library/jest-dom**: Matchers like `toBeDisabled()`, `toHaveBeenCalledWith()`
- **User-Centric Queries**: `getByLabelText`, `getByRole` over `getByTestId`

## API Design Patterns

### Fastify Route Handlers

```typescript
export async function setupStreamRoute(app: FastifyInstance) {
  app.post<{ Body: ChatRequestPayload }>('/chat/stream', async (request, reply) => {
    const { messages, sessionId, feature_overrides } = request.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array required.' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const sendEvent = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    await handleChatStream(messages, sendEvent, { sessionId, featureOverrides });
    reply.raw.end();
  });
}
```

### Server-Sent Events (SSE)

- **Event Types**: `route`, `plan`, `context`, `tool`, `token`, `critique`, `complete`, `telemetry`, `done`
- **Format**: `event: <type>\ndata: <json>\n\n`
- **Error Handling**: Emit `error` event before closing stream

## Common Code Idioms

### Array Filtering with Type Guards

```typescript
const validItems = items.filter((item): item is ValidType => item !== null && item !== undefined);
```

### Optional Chaining and Nullish Coalescing

```typescript
const value = config.OPTIONAL_SETTING ?? defaultValue;
const nested = object?.property?.nested ?? fallback;
```

### Destructuring with Defaults

```typescript
const { messages, sessionId, feature_overrides = {} } = request.body;
```

### Map-Based Deduplication

```typescript
const candidateMap = new Map<string, SummaryBullet>();
for (const entry of memorySummary) {
  const text = entry.text?.trim();
  if (!text) continue;
  candidateMap.set(text, { text, embedding: entry.embedding });
}
return Array.from(candidateMap.values());
```

### Streaming Text Extraction

```typescript
// Recursive extraction from nested response objects
function extractStreamText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map(extractStreamText).join('');
  if (typeof payload === 'object' && payload) {
    const candidate = payload as Record<string, unknown>;
    return candidate.text ?? candidate.delta ?? candidate.output_text ?? '';
  }
  return '';
}
```

### Retry Loops with Critic Feedback

```typescript
let attempt = 0;
while (attempt <= config.CRITIC_MAX_RETRIES) {
  const answer = await generateAnswer(/* ... */);
  const critic = await tools.critic({ draft: answer, evidence, question });

  if (critic.action === 'accept' || critic.coverage >= threshold) {
    break;
  }

  attempt += 1;
}
```

## Environment and Configuration

### Feature Flags

- **Default State**: Most features disabled by default (opt-in)
- **Progressive Enablement**: Week-by-week rollout recommended
- **Cost Awareness**: Flags like `ENABLE_LAZY_RETRIEVAL` reduce costs, `ENABLE_QUERY_DECOMPOSITION` increases costs
- **Runtime Overrides**: Support client-side feature toggles via `feature_overrides` parameter

### Environment Variables

- **Validation**: All env vars validated with Zod schemas at startup
- **Defaults**: Sensible defaults for development, explicit values required for production
- **Secrets**: API keys via `.env` files, never committed to version control
- **Type Safety**: Export typed `config` object from `config/app.ts`

## Error Handling

### Backend Error Patterns

```typescript
try {
  const result = await riskyOperation();
} catch (error) {
  console.warn('Operation failed, using fallback:', error);
  return fallbackValue;
}
```

### Frontend Error Boundaries

```typescript
// Use react-hot-toast for user-facing errors
import { toast } from 'react-hot-toast';

try {
  await apiCall();
} catch (error) {
  toast.error('Failed to load data');
  console.error(error);
}
```

## Performance Optimization

### Token Budget Management

```typescript
// Enforce token caps per context section
const sections = budgetSections({
  model: config.AZURE_OPENAI_GPT_MODEL_NAME,
  sections: { history, summary, salience },
  caps: {
    history: config.CONTEXT_HISTORY_TOKEN_CAP,
    summary: config.CONTEXT_SUMMARY_TOKEN_CAP,
    salience: config.CONTEXT_SALIENCE_TOKEN_CAP,
  },
});
```

### Lazy Loading Pattern

```typescript
// Load summaries first, hydrate full content only when needed
const lazyRefs = await lazyRetrieveTool({ query, topK });
const answer = await generateAnswer(/* ... */, lazyRefs);

if (critic.coverage < threshold) {
  const targets = identifyLoadCandidates(lazyRefs, critic.issues);
  const fullContent = await loadFullContent(lazyRefs, targets);
  // Regenerate with full content
}
```

## Security Practices

### Input Validation

```typescript
if (!Array.isArray(messages) || messages.length === 0) {
  return reply.code(400).send({ error: 'Messages array required.' });
}
```

### Sanitization

```typescript
// Sanitize user identifiers before sending to external APIs
import { sanitizeUserField } from '../utils/session.js';
const userId = sanitizeUserField(sessionId);
```

### CORS Configuration

```typescript
// Whitelist specific origins
CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174');
```

## Git Workflow

### Commit Messages

- **Format**: Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
- **Validation**: commitlint enforces format via Husky pre-commit hook
- **Scope**: Optional scope for clarity (`feat(orchestrator): add lazy retrieval`)

### Pre-Commit Hooks

- **Lint Staged**: ESLint auto-fix on staged TypeScript files
- **Prettier**: Format markdown, JSON, YAML files
- **Type Check**: Run `tsc --noEmit` before push

## Monorepo Management

### Workspace Commands

```bash
pnpm -r <command>        # Run in all packages
pnpm --filter backend <command>  # Run in specific package
pnpm dev                 # Concurrent backend + frontend
```

### Shared Dependencies

- **Shared Types**: `shared/types.ts` imported by both backend and frontend
- **Version Alignment**: Keep TypeScript, ESLint versions consistent across packages
- **Build Order**: Shared types compiled first, then backend/frontend
