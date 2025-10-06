# Development Guidelines

## Code Quality Standards

### TypeScript Strict Mode
- **Strict mode enabled**: All TypeScript files use strict type checking
- **No implicit any**: Explicit types required for all parameters and return values
- **Type imports**: Use `import type` for type-only imports to enable tree-shaking
  ```typescript
  import type { AgentMessage, ChatResponse } from '../../../shared/types.js';
  ```

### File Extensions
- **ES Modules**: All imports use `.js` extension even for TypeScript files
  ```typescript
  import { compactHistory } from './compact.js';
  import { config } from '../config/app.js';
  ```

### Naming Conventions
- **Interfaces**: PascalCase with descriptive names (e.g., `AgentMessage`, `ChatResponse`, `SessionTrace`)
- **Functions**: camelCase with verb prefixes (e.g., `runSession`, `getPlan`, `evaluateAnswer`)
- **Constants**: UPPER_SNAKE_CASE for environment-based constants (e.g., `AZURE_OPENAI_ENDPOINT`)
- **Private helpers**: camelCase without underscore prefix (e.g., `latestQuestion`, `mergeSalienceForContext`)
- **Type aliases**: PascalCase (e.g., `ExecMode`, `Role`)

### Code Organization
- **Single responsibility**: Each file focuses on one concern (plan.ts, dispatch.ts, critique.ts)
- **Barrel exports**: Use index.ts for tool exports
- **Shared types**: Common interfaces in `shared/types.ts` for frontend/backend reuse
- **Config centralization**: All environment variables validated in `config/app.ts` with Zod schemas

## Structural Conventions

### Function Signatures
- **Options objects**: Use interface-based options for functions with 3+ parameters
  ```typescript
  export interface RunSessionOptions {
    messages: AgentMessage[];
    mode: ExecMode;
    sessionId: string;
    emit?: (event: string, data: unknown) => void;
    tools?: Partial<OrchestratorTools>;
  }
  
  export async function runSession(options: RunSessionOptions): Promise<ChatResponse>
  ```

### Error Handling
- **Try-catch with telemetry**: Wrap main execution in try-catch with OpenTelemetry span recording
  ```typescript
  try {
    // execution logic
    return response;
  } catch (error) {
    sessionSpan.recordException(error as Error);
    sessionSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
    throw error;
  } finally {
    sessionSpan.end();
  }
  ```
- **Silent failures for non-critical**: Use console.warn for semantic memory failures
- **Graceful degradation**: Fallback to default values when optional features fail

### Async/Await Patterns
- **Traced async operations**: Wrap async operations with `traced()` helper for observability
  ```typescript
  const plan = await traced('agent.plan', async () => {
    const result = await getPlan(messages, compacted);
    const span = trace.getActiveSpan();
    span?.setAttribute('agent.plan.confidence', result.confidence);
    return result;
  });
  ```

### Default Values
- **Nullish coalescing**: Use `??` for fallback values
  ```typescript
  const fallbackReason = retrieval?.fallbackReason ?? retrieval?.fallback_reason;
  ```
- **Optional chaining**: Use `?.` for safe property access
  ```typescript
  const issues = critic?.issues?.length ? critic.issues : undefined;
  ```

## Internal API Usage Patterns

### Configuration Access
```typescript
import { config } from '../config/app.js';

// Feature flags
if (config.ENABLE_SEMANTIC_MEMORY && question.trim()) {
  // feature implementation
}

// Thresholds
if (criticResult.coverage >= config.CRITIC_THRESHOLD) {
  // accept logic
}

// Token budgets
const sections = budgetSections({
  model: config.AZURE_OPENAI_GPT_MODEL_NAME,
  sections: { history, summary, salience },
  caps: {
    history: config.CONTEXT_HISTORY_TOKEN_CAP,
    summary: config.CONTEXT_SUMMARY_TOKEN_CAP,
    salience: config.CONTEXT_SALIENCE_TOKEN_CAP
  }
});
```

### OpenTelemetry Tracing
```typescript
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { getTracer, traced } from './telemetry.js';

// Start span
const tracer = getTracer();
const sessionSpan = tracer.startSpan('execute_task', {
  attributes: {
    'gen_ai.system': 'agent_orchestrator',
    'gen_ai.request.id': options.sessionId,
    'session.mode': mode
  }
});

// Execute within context
return await context.with(trace.setSpan(context.active(), sessionSpan), async () => {
  // implementation
});

// Add attributes
sessionSpan.setAttribute('agent.plan.confidence', plan.confidence);

// Add events
sessionSpan.addEvent('evaluation', evaluationEvent);
```

### Tool Dispatch Pattern
```typescript
const defaultTools: OrchestratorTools = {
  retrieve: (args) => retrieveTool(args),
  lazyRetrieve: (args) => lazyRetrieveTool(args),
  webSearch: (args) => webSearchTool({ mode: config.WEB_SEARCH_MODE, ...args }),
  answer: (args) => answerTool(args),
  critic: (args) => evaluateAnswer(args)
};

const tools: OrchestratorTools = {
  ...defaultTools,
  ...(options.tools ?? {})
};
```

### Event Emission Pattern
```typescript
// Status updates
emit?.('status', { stage: 'intent_classification' });

// Structured data
emit?.('plan', plan);
emit?.('context', { history, summary, salience });
emit?.('critique', { ...criticResult, attempt });

// Completion
emit?.('complete', { answer });
emit?.('done', { status: 'complete' });
```

## Frequently Used Code Idioms

### Array Filtering with Type Guards
```typescript
const scoreValues = dispatch.references
  .map((ref) => ref.score)
  .filter((score): score is number => typeof score === 'number');
```

### Map-Based Deduplication
```typescript
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

### Conditional Array Building
```typescript
const combinedSegments = [dispatch.contextText, dispatch.webContextText];
if (memoryContextAugmented) {
  combinedSegments.push(memoryContextAugmented);
}

const combinedContext = combinedSegments
  .filter((segment) => typeof segment === 'string' && segment.trim().length > 0)
  .join('\n\n');
```

### Utility Functions for Statistics
```typescript
function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function min(values: number[]) {
  return values.length ? Math.min(...values) : undefined;
}

function max(values: number[]) {
  return values.length ? Math.max(...values) : undefined;
}
```

### Clamping Values
```typescript
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const score = clamp(Math.round(rawScore), 1, 5);
```

### Likert Scale Conversion
```typescript
function likertFromFraction(value: number | undefined | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 1;
  }
  if (value >= 0.9) return 5;
  if (value >= 0.75) return 4;
  if (value >= 0.6) return 3;
  if (value >= 0.4) return 2;
  return 1;
}
```

### Stripping Undefined Properties
```typescript
function stripUndefined<T extends Record<string, unknown>>(value: T | undefined): T | undefined {
  if (!value) {
    return undefined;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      next[key] = item;
    }
  }
  return Object.keys(next).length ? (next as T) : undefined;
}
```

## Testing Patterns

### Vitest Setup
```typescript
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// Mock setup
const toolMocks = {
  retrieve: vi.fn(),
  webSearch: vi.fn(),
  answer: vi.fn(),
  critic: vi.fn()
};

vi.mock('../tools/index.js', () => ({
  retrieveTool: (args: any) => toolMocks.retrieve(args),
  webSearchTool: (args: any) => toolMocks.webSearch(args),
  answerTool: (args: any) => toolMocks.answer(args)
}));

beforeEach(() => {
  toolMocks.retrieve.mockReset();
  toolMocks.webSearch.mockReset();
});
```

### Integration Test Structure
```typescript
describe('orchestrator integration via /chat route', () => {
  it('serves high-confidence vector retrieval with citations', async () => {
    // Arrange
    plannerMock.mockResolvedValueOnce({
      confidence: 0.82,
      steps: [{ action: 'vector_search' }]
    });
    
    toolMocks.retrieve.mockResolvedValueOnce({
      response: 'Azure AI Search enables full-text and vector retrieval.',
      references: [{ id: 'doc-1', title: 'Overview', content: '...' }],
      activity: []
    });
    
    // Act
    const app = Fastify({ logger: false });
    await registerRoutes(app);
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { messages: [{ role: 'user', content: 'What is Azure AI Search?' }] }
    });
    await app.close();
    
    // Assert
    expect(response.statusCode).toBe(200);
    expect(body.citations).toHaveLength(1);
    expect(toolMocks.webSearch).not.toHaveBeenCalled();
  });
});
```

### Mock Assertions
```typescript
// Call count
expect(toolMocks.retrieve).toHaveBeenCalledTimes(1);
expect(toolMocks.webSearch).not.toHaveBeenCalled();

// Metadata validation
expect(body.metadata?.plan?.confidence).toBeCloseTo(0.82);
expect(body.metadata?.evaluation?.summary.status).toBeDefined();

// Activity validation
expect(body.activity.some((step: any) => step.type === 'confidence_escalation')).toBe(true);
```

## Documentation Standards

### JSDoc Comments
- **File headers**: Describe purpose and alignment with architecture docs
  ```typescript
  /**
   * Integration scenarios aligned with docs/unified-orchestrator-context-pipeline.md (Phase 4 hardening).
   * 1. High-confidence vector path (no escalation, citations mandatory).
   * 2. Low-confidence escalation to dual retrieval.
   */
  ```

### Inline Comments
- **Explain "why" not "what"**: Focus on business logic and non-obvious decisions
  ```typescript
  // Critic disabled — generate once, do not emit review/critique events
  ```
- **Section markers**: Use comments to delineate major sections
  ```typescript
  // Critic (optional) retry loop
  ```

## Environment Configuration

### Zod Schema Validation
```typescript
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  AZURE_SEARCH_ENDPOINT: z.string().url(),
  ENABLE_LAZY_RETRIEVAL: z.coerce.boolean().default(false),
  RAG_TOP_K: z.coerce.number().default(5),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export const config = envSchema.parse(process.env);
```

### Feature Flag Pattern
```typescript
if (config.ENABLE_SEMANTIC_MEMORY && question.trim()) {
  const recalledMemories = await semanticMemoryStore.recallMemories(question, {
    k: config.SEMANTIC_MEMORY_RECALL_K,
    sessionId: options.sessionId,
    minSimilarity: config.SEMANTIC_MEMORY_MIN_SIMILARITY
  });
}
```

## Performance Optimization

### Token Budgeting
- **Section-based caps**: Enforce token limits per context section (history, summary, salience)
- **Lazy loading**: Load summaries first, full content only when needed
- **Intent routing**: Use smaller models (gpt-4o-mini) for simple queries

### Streaming Response Handling
```typescript
const reader = await createResponseStream({ messages, temperature: 0.4, model });
let answer = '';
const decoder = new TextDecoder();
let buffer = '';

while (!completed) {
  const { value, done } = await reader.read();
  if (done) {
    buffer += decoder.decode();
    processBuffer(true);
    break;
  }
  buffer += decoder.decode(value, { stream: true });
  processBuffer();
}
```

## Security Practices

### Input Sanitization
- **Zod validation**: All API inputs validated with Zod schemas
- **Type safety**: TypeScript strict mode prevents type-related vulnerabilities
- **Environment secrets**: API keys loaded from environment, never hardcoded

### Safety Evaluation
```typescript
const SAFETY_PATTERNS: Array<{ category: SafetyEvaluationCategory; regex: RegExp }> = [
  { category: 'hate_and_unfairness', regex: /\b(racist|bigot)\b/i },
  { category: 'violence', regex: /\b(kill|attack)\b/i },
  { category: 'code_vulnerability', regex: /\b(eval\(|exec\(|system\()\b/i }
];
```

## Observability

### Telemetry Events
- **Structured logging**: Use Pino with structured JSON logs
- **OpenTelemetry spans**: Instrument all major operations
- **Evaluation metrics**: Track RAG quality, agent performance, safety

### Span Attributes
```typescript
sessionSpan.setAttributes({
  'agent.plan.confidence': plan.confidence,
  'agent.critic.coverage': critic.coverage,
  'agent.retrieval.documents': dispatch.references.length,
  'gen_ai.response.latency_ms': completedAt - startedAt
});
```
