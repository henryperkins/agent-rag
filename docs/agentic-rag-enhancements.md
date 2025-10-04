# Agentic RAG Enhancements Implementation Guide

**Date:** October 3, 2025
**Version:** 1.0
**Status:** Planning
**Reference:** Based on context-engineering.md best practices

---

## Overview

This document provides detailed implementation plans for Priority 1 (P1) and Priority 2 (P2) enhancements to transform the Agent-RAG application into a production-grade agentic RAG system following best practices from `docs/context-engineering.md`.

### Current Implementation Status (P0 - COMPLETED)

✅ **Intent-Based Routing** (`backend/src/orchestrator/router.ts`)
- Classifies queries into faq, research, factual_lookup, conversational
- Routes to specialized models and retrieval strategies
- Uses Azure OpenAI structured outputs with JSON schema validation
- Integrated into orchestrator at `backend/src/orchestrator/index.ts:316-331`

✅ **Just-in-Time (Lazy) Retrieval** (`backend/src/azure/lazyRetrieval.ts`)
- Loads summary-only references first (truncated to `LAZY_SUMMARY_MAX_CHARS`)
- Defers full document loads via `loadFull()` callbacks
- Critic can trigger hydration when summaries lack coverage
- Tracks summary token usage for telemetry
- Integrated into dispatch at `backend/src/orchestrator/dispatch.ts:146-156`

---

## Priority 1 (High Priority)

### Feature 1: Long-Term Semantic Memory with Embeddings

**Goal:** Replace in-memory Map storage with SQLite-backed semantic memory that persists across server restarts and supports embedding-based recall.

**Reference:** context-engineering.md §5 "Persist learning" and §2 Example code showing SQLite memory store with vector recall.

**Current Limitation:** `backend/src/orchestrator/memoryStore.ts` uses transient in-memory `Map<string, MemoryEntry>` that loses state on restart.

#### Implementation Steps

**Step 1.1: Add Dependencies**
```bash
cd backend
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

**Step 1.2: Create Semantic Memory Store Module**

Create `backend/src/orchestrator/semanticMemoryStore.ts`:

```typescript
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { generateEmbedding } from '../azure/directSearch.js';
import { config } from '../config/app.js';

const DB_PATH = join(process.cwd(), 'data', 'semantic-memory.db');

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'preference';

export interface SemanticMemory {
  id: number;
  text: string;
  type: MemoryType;
  embedding: number[];
  metadata: Record<string, any>;
  sessionId?: string;
  userId?: string;
  tags: string[];
  usageCount: number;
  createdAt: string;
  lastAccessedAt: string;
}

export interface RecallOptions {
  k?: number;
  type?: MemoryType;
  sessionId?: string;
  userId?: string;
  tags?: string[];
  minSimilarity?: number;
  maxAgeDays?: number;
}

class SemanticMemoryStore {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        embedding BLOB NOT NULL,
        metadata TEXT DEFAULT '{}',
        session_id TEXT,
        user_id TEXT,
        tags TEXT DEFAULT '[]',
        usage_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
    `);
  }

  async addMemory(
    text: string,
    type: MemoryType,
    metadata: Record<string, any> = {},
    options: {
      sessionId?: string;
      userId?: string;
      tags?: string[];
    } = {}
  ): Promise<number | null> {
    if (!text.trim()) {
      return null;
    }

    try {
      const embedding = await generateEmbedding(text);
      const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);

      const stmt = this.db.prepare(`
        INSERT INTO memories (text, type, embedding, metadata, session_id, user_id, tags, created_at, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = new Date().toISOString();
      const result = stmt.run(
        text,
        type,
        embeddingBlob,
        JSON.stringify(metadata),
        options.sessionId ?? null,
        options.userId ?? null,
        JSON.stringify(options.tags ?? []),
        now,
        now
      );

      return result.lastInsertRowid as number;
    } catch (error) {
      console.error('Failed to add semantic memory:', error);
      return null;
    }
  }

  async recallMemories(query: string, options: RecallOptions = {}): Promise<SemanticMemory[]> {
    const {
      k = 5,
      type,
      sessionId,
      userId,
      tags,
      minSimilarity = 0.6,
      maxAgeDays
    } = options;

    try {
      const queryEmbedding = await generateEmbedding(query);

      let sql = `SELECT * FROM memories WHERE 1=1`;
      const params: any[] = [];

      if (type) {
        sql += ` AND type = ?`;
        params.push(type);
      }

      if (sessionId) {
        sql += ` AND session_id = ?`;
        params.push(sessionId);
      }

      if (userId) {
        sql += ` AND user_id = ?`;
        params.push(userId);
      }

      if (maxAgeDays) {
        const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
        sql += ` AND created_at >= ?`;
        params.push(cutoff);
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      const scored = rows.map((row) => {
        const embeddingBuffer = row.embedding as Buffer;
        const embedding = Array.from(new Float32Array(
          embeddingBuffer.buffer,
          embeddingBuffer.byteOffset,
          embeddingBuffer.byteLength / 4
        ));

        const similarity = this.cosineSimilarity(queryEmbedding, embedding);

        return {
          id: row.id,
          text: row.text,
          type: row.type as MemoryType,
          embedding,
          metadata: JSON.parse(row.metadata || '{}'),
          sessionId: row.session_id,
          userId: row.user_id,
          tags: JSON.parse(row.tags || '[]'),
          usageCount: row.usage_count,
          createdAt: row.created_at,
          lastAccessedAt: row.last_accessed_at,
          similarity
        };
      });

      const filtered = scored.filter((item) => item.similarity >= minSimilarity);

      if (tags && tags.length > 0) {
        filtered.forEach((item) => {
          const matchedTags = item.tags.filter((tag: string) => tags.includes(tag));
          item.similarity += matchedTags.length * 0.05;
        });
      }

      filtered.sort((a, b) => b.similarity - a.similarity);

      const results = filtered.slice(0, k);

      if (results.length > 0) {
        const ids = results.map((r) => r.id);
        const updateStmt = this.db.prepare(`
          UPDATE memories
          SET usage_count = usage_count + 1, last_accessed_at = ?
          WHERE id IN (${ids.map(() => '?').join(',')})
        `);
        updateStmt.run(new Date().toISOString(), ...ids);
      }

      return results;
    } catch (error) {
      console.error('Failed to recall semantic memories:', error);
      return [];
    }
  }

  pruneMemories(maxAgeDays: number, minUsageCount: number = 2): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

    const stmt = this.db.prepare(`
      DELETE FROM memories
      WHERE created_at < ? AND usage_count < ?
    `);

    const result = stmt.run(cutoff, minUsageCount);
    return result.changes;
  }

  getStats() {
    const total = this.db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM memories
      GROUP BY type
    `).all() as Array<{ type: string; count: number }>;

    return {
      total: total.count,
      byType: Object.fromEntries(byType.map((row) => [row.type, row.count]))
    };
  }

  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  close() {
    this.db.close();
  }
}

export const semanticMemoryStore = new SemanticMemoryStore();
```

**Step 1.3: Update Configuration**

Add to `backend/src/config/app.ts`:

```typescript
const envSchema = z.object({
  // ... existing config ...

  // Semantic Memory
  SEMANTIC_MEMORY_DB_PATH: z.string().default('./data/semantic-memory.db'),
  ENABLE_SEMANTIC_MEMORY: z.coerce.boolean().default(false),
  SEMANTIC_MEMORY_RECALL_K: z.coerce.number().default(3),
  SEMANTIC_MEMORY_MIN_SIMILARITY: z.coerce.number().default(0.6),
  SEMANTIC_MEMORY_PRUNE_AGE_DAYS: z.coerce.number().default(90),
});
```

**Step 1.4: Integrate with Orchestrator**

Update `backend/src/orchestrator/index.ts` to capture and recall semantic memories:

```typescript
import { semanticMemoryStore } from './semanticMemoryStore.js';

export async function runSession(options: RunSessionOptions): Promise<ChatResponse> {
  // ... existing code ...

  // After intent classification (around line 331)
  if (config.ENABLE_SEMANTIC_MEMORY) {
    const recalled = await semanticMemoryStore.recallMemories(question, {
      k: config.SEMANTIC_MEMORY_RECALL_K,
      sessionId: options.sessionId,
      minSimilarity: config.SEMANTIC_MEMORY_MIN_SIMILARITY,
      maxAgeDays: config.SEMANTIC_MEMORY_PRUNE_AGE_DAYS
    });

    if (recalled.length > 0) {
      emit?.('semantic_memory', {
        recalled: recalled.length,
        memories: recalled.map((m) => ({
          type: m.type,
          text: m.text.slice(0, 100),
          similarity: m.similarity
        }))
      });

      // Inject memories into context sections
      const memoryText = recalled
        .map((m, idx) => `[Memory ${idx + 1}] ${m.text}`)
        .join('\n');
      sections.salience = `${sections.salience}\n\nRelevant memories:\n${memoryText}`;
    }
  }

  // ... after critic loop completion (around line 587) ...

  if (config.ENABLE_SEMANTIC_MEMORY && answer && !answer.startsWith('I do not know')) {
    // Save successful interaction as episodic memory
    await semanticMemoryStore.addMemory(
      `Q: ${question}\nA: ${answer.slice(0, 500)}`,
      'episodic',
      { planConfidence: plan.confidence, criticCoverage: critic.coverage },
      { sessionId: options.sessionId }
    );
  }

  return response;
}
```

**Step 1.5: Create Data Directory**

```bash
mkdir -p backend/data
echo "data/" >> backend/.gitignore
```

**Step 1.6: Test Integration**

Create `backend/src/tests/semanticMemory.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { semanticMemoryStore } from '../orchestrator/semanticMemoryStore';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './data/test-semantic-memory.db';

describe('SemanticMemoryStore', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_DB)) {
      unlinkSync(TEST_DB);
    }
  });

  it('should add and recall semantic memories', async () => {
    const id = await semanticMemoryStore.addMemory(
      'Azure OpenAI embeddings use text-embedding-3-large model',
      'semantic',
      { source: 'documentation' },
      { tags: ['azure', 'embeddings'] }
    );

    expect(id).toBeGreaterThan(0);

    const recalled = await semanticMemoryStore.recallMemories(
      'What model is used for Azure embeddings?',
      { k: 1, minSimilarity: 0.3 }
    );

    expect(recalled.length).toBeGreaterThan(0);
    expect(recalled[0].text).toContain('text-embedding-3-large');
  });

  it('should filter memories by type and tags', async () => {
    await semanticMemoryStore.addMemory(
      'User prefers concise answers',
      'preference',
      {},
      { userId: 'user123', tags: ['style'] }
    );

    await semanticMemoryStore.addMemory(
      'Hybrid search combines vector and keyword matching',
      'semantic',
      {},
      { tags: ['retrieval'] }
    );

    const preferences = await semanticMemoryStore.recallMemories('answer style', {
      type: 'preference',
      userId: 'user123',
      minSimilarity: 0.3
    });

    expect(preferences.length).toBe(1);
    expect(preferences[0].type).toBe('preference');
  });

  it('should prune old unused memories', async () => {
    await semanticMemoryStore.addMemory('Old memory', 'semantic', {}, {});

    // Manually set created_at to 100 days ago
    // (requires direct DB access or mock)

    const pruned = semanticMemoryStore.pruneMemories(90, 1);
    expect(pruned).toBeGreaterThan(0);
  });
});
```

**Estimated Effort:** 5-6 days
**Dependencies:** Azure OpenAI embeddings endpoint, SQLite

---

### Feature 2: Query Decomposition

**Goal:** Break complex multi-part questions into atomic sub-queries with dependency tracking, execute in order, and synthesize consolidated results.

**Reference:** context-engineering.md §5 "Workflow Patterns" (prompt chaining, orchestrator–worker loops) and research orchestrator example.

**Current Limitation:** Planner returns steps but doesn't decompose complex questions into executable sub-queries with dependencies.

#### Implementation Steps

**Step 2.1: Create Query Decomposition Module**

Create `backend/src/orchestrator/queryDecomposition.ts`:

```typescript
import { createResponse } from '../azure/openaiClient.js';
import { extractOutputText } from '../utils/openai.js';
import { config } from '../config/app.js';
import type { Reference, WebResult } from '../../../shared/types.js';

export interface SubQuery {
  id: number;
  query: string;
  dependencies: number[];
  reasoning: string;
}

export interface ComplexityAssessment {
  complexity: number;
  needsDecomposition: boolean;
  reasoning: string;
}

export interface DecomposedQuery {
  subQueries: SubQuery[];
  synthesisPrompt: string;
}

const COMPLEXITY_SCHEMA = {
  type: 'json_schema' as const,
  name: 'complexity_assessment',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      complexity: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Complexity score from 0 (simple) to 1 (very complex)'
      },
      needsDecomposition: {
        type: 'boolean',
        description: 'Whether the question requires decomposition'
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation of the complexity assessment'
      }
    },
    required: ['complexity', 'needsDecomposition', 'reasoning']
  }
};

const DECOMPOSITION_SCHEMA = {
  type: 'json_schema' as const,
  name: 'query_decomposition',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      subQueries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'number' },
            query: { type: 'string' },
            dependencies: {
              type: 'array',
              items: { type: 'number' }
            },
            reasoning: { type: 'string' }
          },
          required: ['id', 'query', 'dependencies', 'reasoning']
        }
      },
      synthesisPrompt: {
        type: 'string',
        description: 'Instructions for synthesizing sub-query results'
      }
    },
    required: ['subQueries', 'synthesisPrompt']
  }
};

export async function assessComplexity(question: string): Promise<ComplexityAssessment> {
  const systemPrompt = `You are a query complexity analyzer for a RAG system. Assess whether the question requires decomposition into sub-queries.

Questions needing decomposition typically:
- Ask multiple unrelated facts ("What is X and Y?")
- Require multi-step reasoning ("Compare X and Y in terms of Z")
- Span different knowledge domains
- Have temporal dependencies ("What happened before/after X?")

Simple questions:
- Single fact lookup ("What is X?")
- Direct comparisons with clear criteria
- Follow-ups to previous context`;

  try {
    const response = await createResponse({
      model: config.MODEL_FAQ,
      temperature: 0.1,
      max_output_tokens: 150,
      textFormat: COMPLEXITY_SCHEMA,
      parallel_tool_calls: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Question: ${question}` }
      ]
    });

    const parsed = JSON.parse(extractOutputText(response) || '{}');
    return {
      complexity: parsed.complexity ?? 0.3,
      needsDecomposition: parsed.needsDecomposition ?? false,
      reasoning: parsed.reasoning ?? 'No assessment available'
    };
  } catch (error) {
    console.warn('Complexity assessment failed:', error);
    return {
      complexity: 0.3,
      needsDecomposition: false,
      reasoning: 'Assessment error fallback'
    };
  }
}

export async function decomposeQuery(question: string): Promise<DecomposedQuery> {
  const systemPrompt = `You are a query decomposition expert. Break complex questions into atomic sub-queries with clear dependencies.

Rules:
1. Each sub-query must be independently answerable
2. Use dependencies array to indicate which sub-queries must complete first (by ID)
3. Number sub-queries sequentially starting from 0
4. Keep sub-queries focused and specific
5. Provide synthesis instructions for combining results

Example:
Question: "Compare Azure AI Search and Google Vertex AI in terms of pricing and features"
Sub-queries:
[
  {id: 0, query: "What are the pricing tiers for Azure AI Search?", dependencies: [], reasoning: "Foundation for comparison"},
  {id: 1, query: "What are the pricing tiers for Google Vertex AI?", dependencies: [], reasoning: "Foundation for comparison"},
  {id: 2, query: "What key features does Azure AI Search offer?", dependencies: [], reasoning: "Feature baseline"},
  {id: 3, query: "What key features does Google Vertex AI offer?", dependencies: [], reasoning: "Feature baseline"},
  {id: 4, query: "Compare pricing models", dependencies: [0,1], reasoning: "Depends on pricing data"},
  {id: 5, query: "Compare feature sets", dependencies: [2,3], reasoning: "Depends on feature data"}
]`;

  try {
    const response = await createResponse({
      model: config.MODEL_RESEARCH,
      temperature: 0.2,
      max_output_tokens: 800,
      textFormat: DECOMPOSITION_SCHEMA,
      parallel_tool_calls: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Decompose this question:\n${question}` }
      ]
    });

    const parsed = JSON.parse(extractOutputText(response) || '{}');
    return {
      subQueries: parsed.subQueries ?? [],
      synthesisPrompt: parsed.synthesisPrompt ?? 'Synthesize the sub-query results into a coherent answer.'
    };
  } catch (error) {
    console.error('Query decomposition failed:', error);
    return {
      subQueries: [{ id: 0, query: question, dependencies: [], reasoning: 'Fallback to original query' }],
      synthesisPrompt: 'Answer the question directly.'
    };
  }
}

export async function executeSubQueries(
  subqueries: SubQuery[],
  tools: {
    retrieve: (args: { query: string; top?: number }) => Promise<{
      references: Reference[];
      activity: any[];
    }>;
    webSearch: (args: { query: string; count?: number }) => Promise<{
      results: WebResult[];
    }>;
  }
): Promise<Map<number, { references: Reference[]; webResults: WebResult[] }>> {
  const results = new Map<number, { references: Reference[]; webResults: WebResult[] }>();
  const completed = new Set<number>();

  const sortedQueries = topologicalSort(subqueries);

  for (const subquery of sortedQueries) {
    const canExecute = subquery.dependencies.every((dep) => completed.has(dep));
    if (!canExecute) {
      console.warn(`Skipping sub-query ${subquery.id} due to incomplete dependencies`);
      continue;
    }

    try {
      const [retrievalResult, webResult] = await Promise.all([
        tools.retrieve({ query: subquery.query, top: 3 }),
        tools.webSearch({ query: subquery.query, count: 3 }).catch(() => ({ results: [] }))
      ]);

      results.set(subquery.id, {
        references: retrievalResult.references,
        webResults: webResult.results ?? []
      });

      completed.add(subquery.id);
    } catch (error) {
      console.error(`Failed to execute sub-query ${subquery.id}:`, error);
      results.set(subquery.id, { references: [], webResults: [] });
      completed.add(subquery.id);
    }
  }

  return results;
}

function topologicalSort(subqueries: SubQuery[]): SubQuery[] {
  const sorted: SubQuery[] = [];
  const visited = new Set<number>();
  const temp = new Set<number>();

  function visit(query: SubQuery) {
    if (temp.has(query.id)) {
      throw new Error(`Circular dependency detected at sub-query ${query.id}`);
    }
    if (visited.has(query.id)) {
      return;
    }

    temp.add(query.id);

    for (const depId of query.dependencies) {
      const dep = subqueries.find((q) => q.id === depId);
      if (dep) {
        visit(dep);
      }
    }

    temp.delete(query.id);
    visited.add(query.id);
    sorted.push(query);
  }

  for (const query of subqueries) {
    if (!visited.has(query.id)) {
      visit(query);
    }
  }

  return sorted;
}
```

**Step 2.2: Update Configuration**

Add to `backend/src/config/app.ts`:

```typescript
const envSchema = z.object({
  // ... existing config ...

  // Query Decomposition
  ENABLE_QUERY_DECOMPOSITION: z.coerce.boolean().default(false),
  DECOMPOSITION_COMPLEXITY_THRESHOLD: z.coerce.number().default(0.6),
  DECOMPOSITION_MAX_SUBQUERIES: z.coerce.number().default(8),
});
```

**Step 2.3: Integrate with Orchestrator**

Update `backend/src/orchestrator/index.ts`:

```typescript
import { assessComplexity, decomposeQuery, executeSubQueries } from './queryDecomposition.js';

export async function runSession(options: RunSessionOptions): Promise<ChatResponse> {
  // ... existing code ...

  // After intent classification, before planning (around line 332)
  let decomposed: DecomposedQuery | undefined;

  if (config.ENABLE_QUERY_DECOMPOSITION) {
    emit?.('status', { stage: 'complexity_assessment' });
    const assessment = await assessComplexity(question);

    emit?.('complexity', {
      score: assessment.complexity,
      needsDecomposition: assessment.needsDecomposition,
      reasoning: assessment.reasoning
    });

    if (
      assessment.needsDecomposition &&
      assessment.complexity >= config.DECOMPOSITION_COMPLEXITY_THRESHOLD
    ) {
      emit?.('status', { stage: 'query_decomposition' });
      decomposed = await decomposeQuery(question);

      if (decomposed.subQueries.length > 1 && decomposed.subQueries.length <= config.DECOMPOSITION_MAX_SUBQUERIES) {
        emit?.('decomposition', {
          subQueries: decomposed.subQueries.map((sq) => ({
            id: sq.id,
            query: sq.query,
            dependencies: sq.dependencies
          })),
          synthesisPrompt: decomposed.synthesisPrompt
        });

        emit?.('status', { stage: 'executing_subqueries' });
        const subqueryResults = await executeSubQueries(decomposed.subQueries, {
          retrieve: tools.retrieve,
          webSearch: tools.webSearch
        });

        // Consolidate all references and web results
        const allReferences: Reference[] = [];
        const allWebResults: WebResult[] = [];

        for (const [id, result] of subqueryResults.entries()) {
          allReferences.push(...result.references);
          allWebResults.push(...result.webResults);
        }

        // Override dispatch result with consolidated sub-query results
        dispatch = {
          contextText: allReferences.map((ref, idx) => `[${idx + 1}] ${ref.content}`).join('\n\n'),
          references: allReferences,
          lazyReferences: [],
          activity: [
            {
              type: 'query_decomposition',
              description: `Executed ${decomposed.subQueries.length} sub-queries`
            }
          ],
          webResults: allWebResults,
          webContextText: '',
          webContextTokens: 0,
          webContextTrimmed: false,
          summaryTokens: undefined,
          source: 'direct' as const,
          retrievalMode: 'direct' as const,
          escalated: false
        };

        combinedContext = dispatch.contextText;
      }
    }
  }

  // ... continue with normal flow ...
}
```

**Step 2.4: Test Query Decomposition**

Create `backend/src/tests/queryDecomposition.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { assessComplexity, decomposeQuery, executeSubQueries } from '../orchestrator/queryDecomposition';

describe('Query Decomposition', () => {
  it('should identify complex queries', async () => {
    const assessment = await assessComplexity(
      'Compare Azure AI Search and Elasticsearch in terms of pricing, features, and performance'
    );

    expect(assessment.complexity).toBeGreaterThan(0.5);
    expect(assessment.needsDecomposition).toBe(true);
  });

  it('should decompose complex query into sub-queries', async () => {
    const decomposed = await decomposeQuery(
      'What are the differences between hybrid search and vector search, and when should each be used?'
    );

    expect(decomposed.subQueries.length).toBeGreaterThan(1);
    expect(decomposed.subQueries[0]).toHaveProperty('id');
    expect(decomposed.subQueries[0]).toHaveProperty('dependencies');
  });

  it('should execute sub-queries with dependency ordering', async () => {
    const mockRetrieve = vi.fn().mockResolvedValue({ references: [], activity: [] });
    const mockWebSearch = vi.fn().mockResolvedValue({ results: [] });

    const subqueries = [
      { id: 0, query: 'Query A', dependencies: [], reasoning: 'Base query' },
      { id: 1, query: 'Query B', dependencies: [0], reasoning: 'Depends on A' }
    ];

    const results = await executeSubQueries(subqueries, {
      retrieve: mockRetrieve,
      webSearch: mockWebSearch
    });

    expect(results.size).toBe(2);
    expect(mockRetrieve).toHaveBeenCalledTimes(2);
  });
});
```

**Estimated Effort:** 3-4 days
**Dependencies:** None (uses existing Azure OpenAI structured outputs)

---

### Feature 3: Web Search Reranking

**Goal:** Apply Reciprocal Rank Fusion (RRF) to combine scores from multiple web search results and Azure Search results, providing unified ranking.

**Reference:** context-engineering.md §2 "Select" strategy and hybrid search examples.

**Current Limitation:** Web search results and Azure Search results are not reranked together; they're simply concatenated.

#### Implementation Steps

**Step 3.1: Create Reranking Module**

Create `backend/src/orchestrator/reranker.ts`:

```typescript
import type { Reference, WebResult } from '../../../shared/types.js';

export interface RerankedResult {
  id: string;
  title: string;
  content: string;
  url?: string;
  page_number?: number;
  originalScore: number;
  rrfScore: number;
  source: 'azure' | 'web';
  rank: number;
}

/**
 * Reciprocal Rank Fusion (RRF) combines rankings from multiple sources
 * Formula: RRF(d) = Σ 1 / (k + rank_i(d))
 * where k is a constant (typically 60) and rank_i(d) is the rank of document d in source i
 */
export function reciprocalRankFusion(
  azureResults: Reference[],
  webResults: WebResult[],
  k: number = 60
): RerankedResult[] {
  const scoreMap = new Map<string, {
    id: string;
    title: string;
    content: string;
    url?: string;
    page_number?: number;
    originalScore: number;
    source: 'azure' | 'web';
    ranks: number[];
  }>();

  // Process Azure Search results
  azureResults.forEach((ref, index) => {
    const id = ref.id ?? `azure_${index}`;
    scoreMap.set(id, {
      id,
      title: ref.title ?? `Azure Result ${index + 1}`,
      content: ref.content ?? ref.chunk ?? '',
      url: ref.url,
      page_number: ref.page_number,
      originalScore: ref.score ?? 0,
      source: 'azure',
      ranks: [index + 1]
    });
  });

  // Process Web results
  webResults.forEach((result, index) => {
    const id = result.id ?? result.url ?? `web_${index}`;
    const existing = scoreMap.get(id);

    if (existing) {
      existing.ranks.push(index + 1);
    } else {
      scoreMap.set(id, {
        id,
        title: result.title,
        content: result.snippet + (result.body ? `\n${result.body}` : ''),
        url: result.url,
        page_number: undefined,
        originalScore: 0,
        source: 'web',
        ranks: [index + 1]
      });
    }
  });

  // Calculate RRF scores
  const reranked: RerankedResult[] = [];

  for (const [id, item] of scoreMap.entries()) {
    const rrfScore = item.ranks.reduce((sum, rank) => sum + 1 / (k + rank), 0);

    reranked.push({
      id: item.id,
      title: item.title,
      content: item.content,
      url: item.url,
      page_number: item.page_number,
      originalScore: item.originalScore,
      rrfScore,
      source: item.source,
      rank: 0 // Will be set after sorting
    });
  }

  // Sort by RRF score (descending)
  reranked.sort((a, b) => b.rrfScore - a.rrfScore);

  // Assign final ranks
  reranked.forEach((item, index) => {
    item.rank = index + 1;
  });

  return reranked;
}

export function applySemanticBoost(
  results: RerankedResult[],
  queryEmbedding: number[],
  documentEmbeddings: Map<string, number[]>,
  boostWeight: number = 0.3
): RerankedResult[] {
  const boosted = results.map((result) => {
    const embedding = documentEmbeddings.get(result.id);
    if (!embedding) {
      return { ...result };
    }

    const similarity = cosineSimilarity(queryEmbedding, embedding);
    const boostedScore = result.rrfScore * (1 - boostWeight) + similarity * boostWeight;

    return {
      ...result,
      rrfScore: boostedScore
    };
  });

  boosted.sort((a, b) => b.rrfScore - a.rrfScore);
  boosted.forEach((item, index) => {
    item.rank = index + 1;
  });

  return boosted;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}
```

**Step 3.2: Update Configuration**

Add to `backend/src/config/app.ts`:

```typescript
const envSchema = z.object({
  // ... existing config ...

  // Reranking
  ENABLE_WEB_RERANKING: z.coerce.boolean().default(false),
  RRF_K_CONSTANT: z.coerce.number().default(60),
  RERANKING_TOP_K: z.coerce.number().default(10),
  ENABLE_SEMANTIC_BOOST: z.coerce.boolean().default(false),
  SEMANTIC_BOOST_WEIGHT: z.coerce.number().default(0.3),
});
```

**Step 3.3: Integrate with Dispatch**

Update `backend/src/orchestrator/dispatch.ts`:

```typescript
import { reciprocalRankFusion, applySemanticBoost } from './reranker.js';
import { generateEmbedding } from '../azure/directSearch.js';

export async function dispatchTools({ plan, messages, salience, emit, tools, preferLazy }: DispatchOptions): Promise<DispatchResult> {
  // ... existing retrieval and web search code ...

  // After both retrieval and web search complete
  if (config.ENABLE_WEB_RERANKING && references.length > 0 && webResults.length > 0) {
    emit?.('status', { stage: 'reranking' });

    let reranked = reciprocalRankFusion(references, webResults, config.RRF_K_CONSTANT);

    if (config.ENABLE_SEMANTIC_BOOST) {
      try {
        const queryEmbedding = await generateEmbedding(queryFallback);
        const docEmbeddings = new Map<string, number[]>();

        // Generate embeddings for top candidates
        for (const result of reranked.slice(0, 20)) {
          if (result.content) {
            const embedding = await generateEmbedding(result.content.slice(0, 1000));
            docEmbeddings.set(result.id, embedding);
          }
        }

        reranked = applySemanticBoost(
          reranked,
          queryEmbedding,
          docEmbeddings,
          config.SEMANTIC_BOOST_WEIGHT
        );
      } catch (error) {
        console.warn('Semantic boost failed:', error);
      }
    }

    // Take top K after reranking
    const topReranked = reranked.slice(0, config.RERANKING_TOP_K);

    // Convert back to Reference format
    const rerankedReferences: Reference[] = topReranked.map((item) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      url: item.url,
      page_number: item.page_number,
      score: item.rrfScore,
      metadata: { source: item.source, originalScore: item.originalScore }
    }));

    activity.push({
      type: 'reranking',
      description: `Applied RRF to ${references.length} Azure + ${webResults.length} web results → ${topReranked.length} final`
    });

    emit?.('reranking', {
      inputCount: references.length + webResults.length,
      outputCount: topReranked.length,
      method: config.ENABLE_SEMANTIC_BOOST ? 'rrf+semantic' : 'rrf'
    });

    // Replace references with reranked results
    references.splice(0, references.length, ...rerankedReferences);
  }

  // ... rest of existing code ...
}
```

**Step 3.4: Test Reranking**

Create `backend/src/tests/reranker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../orchestrator/reranker';
import type { Reference, WebResult } from '../../../shared/types';

describe('Reciprocal Rank Fusion', () => {
  it('should combine Azure and Web results with RRF scoring', () => {
    const azureResults: Reference[] = [
      { id: 'doc1', title: 'Doc 1', content: 'Content 1', score: 0.9 },
      { id: 'doc2', title: 'Doc 2', content: 'Content 2', score: 0.8 },
    ];

    const webResults: WebResult[] = [
      { id: 'web1', title: 'Web 1', snippet: 'Snippet 1', url: 'https://example.com/1', rank: 1 },
      { id: 'doc1', title: 'Doc 1', snippet: 'Snippet', url: 'https://example.com/doc1', rank: 2 }
    ];

    const reranked = reciprocalRankFusion(azureResults, webResults, 60);

    expect(reranked.length).toBeGreaterThan(0);
    expect(reranked[0].rrfScore).toBeGreaterThan(0);

    // Doc1 appears in both sources, should have higher RRF score
    const doc1 = reranked.find((r) => r.id === 'doc1');
    expect(doc1).toBeDefined();
    expect(doc1!.rrfScore).toBeGreaterThan(reranked[reranked.length - 1].rrfScore);
  });

  it('should assign sequential ranks after sorting', () => {
    const azureResults: Reference[] = [
      { id: 'a', title: 'A', content: 'A', score: 0.5 },
      { id: 'b', title: 'B', content: 'B', score: 0.7 }
    ];

    const reranked = reciprocalRankFusion(azureResults, [], 60);

    expect(reranked[0].rank).toBe(1);
    expect(reranked[1].rank).toBe(2);
  });
});
```

**Estimated Effort:** 2 days
**Dependencies:** None (mathematical reranking only)

---

### Feature 4: Azure AI Foundry Evals Integration

**Goal:** Integrate Azure AI Foundry Evals API (preview) to systematically evaluate planner performance, critic accuracy, and retrieval quality using production-grade evaluation metrics.

**Reference:** Unified orchestrator docs mention "Azure AI Foundry Evals API (preview) from v1preview.json" as an open question.

**Current Limitation:** No systematic evaluation of agent components; critic is the only quality gate.

#### Implementation Steps

**Step 4.1: Research Azure AI Foundry Evals API**

Check `v1preview.json` specification (if available) or Azure AI Foundry documentation for evaluation endpoints and schemas.

Expected API structure (hypothetical based on typical Azure patterns):
```
POST https://{endpoint}/evals/groundedness?api-version=2024-preview
POST https://{endpoint}/evals/relevance?api-version=2024-preview
POST https://{endpoint}/evals/coherence?api-version=2024-preview
```

**Step 4.2: Create Evals Client Module**

Create `backend/src/azure/foundryEvals.ts`:

```typescript
import { config } from '../config/app.js';
import type { Reference } from '../../../shared/types.js';

export interface GroundednessEval {
  score: number;
  reasoning: string;
  ungroundedClaims: string[];
}

export interface RelevanceEval {
  score: number;
  reasoning: string;
}

export interface CoherenceEval {
  score: number;
  reasoning: string;
  issues: string[];
}

export async function evaluateGroundedness(
  answer: string,
  context: string,
  question: string
): Promise<GroundednessEval> {
  const endpoint = config.AZURE_FOUNDRY_EVALS_ENDPOINT;
  const apiKey = config.AZURE_FOUNDRY_EVALS_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('Azure Foundry Evals endpoint not configured');
  }

  const url = `${endpoint}/evals/groundedness?api-version=${config.AZURE_FOUNDRY_API_VERSION}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        answer,
        context,
        question
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groundedness evaluation failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    return {
      score: data.score ?? 0,
      reasoning: data.reasoning ?? '',
      ungroundedClaims: data.ungrounded_claims ?? []
    };
  } catch (error) {
    console.error('Groundedness evaluation error:', error);
    throw error;
  }
}

export async function evaluateRelevance(
  answer: string,
  question: string
): Promise<RelevanceEval> {
  const endpoint = config.AZURE_FOUNDRY_EVALS_ENDPOINT;
  const apiKey = config.AZURE_FOUNDRY_EVALS_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('Azure Foundry Evals endpoint not configured');
  }

  const url = `${endpoint}/evals/relevance?api-version=${config.AZURE_FOUNDRY_API_VERSION}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        answer,
        question
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Relevance evaluation failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    return {
      score: data.score ?? 0,
      reasoning: data.reasoning ?? ''
    };
  } catch (error) {
    console.error('Relevance evaluation error:', error);
    throw error;
  }
}

export async function evaluateRetrieval(
  query: string,
  retrievedDocs: Reference[]
): Promise<{ precision: number; recall: number; mrr: number }> {
  // This would typically require ground truth labels
  // For now, implement basic heuristics or return mock data

  const relevantDocs = retrievedDocs.filter((doc) =>
    doc.score && doc.score > config.RERANKER_THRESHOLD
  );

  const precision = retrievedDocs.length > 0
    ? relevantDocs.length / retrievedDocs.length
    : 0;

  // MRR (Mean Reciprocal Rank) - first relevant document
  let mrr = 0;
  for (let i = 0; i < retrievedDocs.length; i++) {
    if (retrievedDocs[i].score && retrievedDocs[i].score! > config.RERANKER_THRESHOLD) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  return {
    precision,
    recall: 0, // Requires ground truth
    mrr
  };
}
```

**Step 4.3: Update Configuration**

Add to `backend/src/config/app.ts`:

```typescript
const envSchema = z.object({
  // ... existing config ...

  // Azure AI Foundry Evals
  AZURE_FOUNDRY_EVALS_ENDPOINT: z.string().url().optional(),
  AZURE_FOUNDRY_EVALS_API_KEY: z.string().optional(),
  AZURE_FOUNDRY_API_VERSION: z.string().default('2024-10-01-preview'),
  ENABLE_FOUNDRY_EVALS: z.coerce.boolean().default(false),
  FOUNDRY_EVAL_SAMPLE_RATE: z.coerce.number().default(0.1), // Evaluate 10% of requests
});
```

**Step 4.4: Integrate with Orchestrator**

Update `backend/src/orchestrator/index.ts`:

```typescript
import { evaluateGroundedness, evaluateRelevance, evaluateRetrieval } from '../azure/foundryEvals.js';

export async function runSession(options: RunSessionOptions): Promise<ChatResponse> {
  // ... existing code ...

  // After final answer generation and critic acceptance (around line 590)
  if (
    config.ENABLE_FOUNDRY_EVALS &&
    Math.random() < config.FOUNDRY_EVAL_SAMPLE_RATE
  ) {
    emit?.('status', { stage: 'foundry_evaluation' });

    try {
      const [groundedness, relevance, retrieval] = await Promise.all([
        evaluateGroundedness(answer, combinedContext, question),
        evaluateRelevance(answer, question),
        evaluateRetrieval(question, dispatch.references)
      ]);

      emit?.('foundry_evals', {
        groundedness: {
          score: groundedness.score,
          ungroundedClaims: groundedness.ungroundedClaims.length
        },
        relevance: {
          score: relevance.score
        },
        retrieval: {
          precision: retrieval.precision,
          mrr: retrieval.mrr
        }
      });

      // Store evaluation results in telemetry
      response.metadata.foundry_evals = {
        groundedness: groundedness.score,
        relevance: relevance.score,
        retrievalPrecision: retrieval.precision,
        retrievalMRR: retrieval.mrr,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.warn('Foundry evals failed:', error);
    }
  }

  return response;
}
```

**Step 4.5: Create Evaluation Dashboard Endpoint**

Add to `backend/src/routes/index.ts`:

```typescript
// Admin endpoint to view evaluation metrics
app.get('/admin/evals', async (request, reply) => {
  const sessions = telemetryStore.getAllSessions();

  const evalsData = sessions
    .filter((s) => s.metadata?.foundry_evals)
    .map((s) => ({
      sessionId: s.sessionId,
      timestamp: s.completedAt,
      groundedness: s.metadata.foundry_evals.groundedness,
      relevance: s.metadata.foundry_evals.relevance,
      retrievalPrecision: s.metadata.foundry_evals.retrievalPrecision,
      planConfidence: s.plan.confidence,
      criticCoverage: s.critic.coverage
    }));

  const stats = {
    totalEvaluations: evalsData.length,
    avgGroundedness: average(evalsData.map((e) => e.groundedness)),
    avgRelevance: average(evalsData.map((e) => e.relevance)),
    avgRetrievalPrecision: average(evalsData.map((e) => e.retrievalPrecision)),
    lowGroundednessCount: evalsData.filter((e) => e.groundedness < 0.7).length
  };

  return {
    stats,
    recent: evalsData.slice(0, 50)
  };
});
```

**Estimated Effort:** 3 days
**Dependencies:** Azure AI Foundry Evals API endpoint (preview access required)

---

## Priority 2 (Future Work)

### Feature 5: Multi-Agent Workers

**Goal:** Implement orchestrator–worker pattern where a central planner dynamically spawns specialized sub-agents (environment setup, patching, testing) with isolated context windows.

**Reference:** context-engineering.md §5 "Multi-agent code remediation" example and workflow patterns (orchestrator–worker loops).

**Current Limitation:** Single monolithic orchestrator handles all tasks; no worker isolation or specialized sub-agents.

#### Implementation Steps

**Step 5.1: Define Worker Agent Interface**

Create `backend/src/agents/workerAgent.ts`:

```typescript
import type { AgentMessage } from '../../../shared/types.js';

export interface WorkerAgentConfig {
  name: string;
  role: string;
  systemPrompt: string;
  tools: string[];
  maxContextTokens: number;
  temperature: number;
}

export interface WorkerTask {
  id: string;
  type: string;
  input: string;
  dependencies: string[];
  agentName: string;
}

export interface WorkerResult {
  taskId: string;
  status: 'success' | 'failure';
  output: string;
  context: string[];
  tokensUsed: number;
  error?: string;
}

export const WORKER_AGENTS: Record<string, WorkerAgentConfig> = {
  retrieval_specialist: {
    name: 'retrieval_specialist',
    role: 'Retrieval Expert',
    systemPrompt: 'You are a retrieval specialist. Your job is to search knowledge bases and return the most relevant documents for a given query. Focus on precision and relevance.',
    tools: ['retrieve', 'vector_search'],
    maxContextTokens: 2000,
    temperature: 0.1
  },
  web_researcher: {
    name: 'web_researcher',
    role: 'Web Research Specialist',
    systemPrompt: 'You are a web research specialist. Search the web for up-to-date information, evaluate source credibility, and summarize findings concisely.',
    tools: ['web_search', 'fetch_url'],
    maxContextTokens: 3000,
    temperature: 0.3
  },
  synthesizer: {
    name: 'synthesizer',
    role: 'Information Synthesizer',
    systemPrompt: 'You are a synthesis specialist. Combine information from multiple sources into coherent, well-cited answers. Prioritize groundedness and clarity.',
    tools: ['answer'],
    maxContextTokens: 4000,
    temperature: 0.4
  },
  fact_checker: {
    name: 'fact_checker',
    role: 'Fact Checker',
    systemPrompt: 'You are a fact-checking specialist. Verify claims against provided evidence, identify unsupported statements, and suggest corrections.',
    tools: ['evaluate', 'retrieve'],
    maxContextTokens: 3000,
    temperature: 0.1
  }
};

export async function executeWorkerTask(
  task: WorkerTask,
  tools: Record<string, Function>,
  emit?: (event: string, data: unknown) => void
): Promise<WorkerResult> {
  const agentConfig = WORKER_AGENTS[task.agentName];
  if (!agentConfig) {
    return {
      taskId: task.id,
      status: 'failure',
      output: '',
      context: [],
      tokensUsed: 0,
      error: `Unknown agent: ${task.agentName}`
    };
  }

  emit?.('worker_start', {
    taskId: task.id,
    agent: task.agentName,
    type: task.type
  });

  try {
    // Execute task based on type
    let output = '';
    let context: string[] = [];
    let tokensUsed = 0;

    switch (task.type) {
      case 'retrieve':
        const retrieveResult = await tools.retrieve({ query: task.input });
        output = retrieveResult.response;
        context = retrieveResult.references.map((r: any) => r.content);
        break;

      case 'web_search':
        const webResult = await tools.webSearch({ query: task.input });
        output = webResult.results.map((r: any) => r.snippet).join('\n');
        context = webResult.results.map((r: any) => r.url);
        break;

      case 'synthesize':
        const synthesisResult = await tools.answer({
          question: task.input,
          context: context.join('\n\n')
        });
        output = synthesisResult.answer;
        break;

      default:
        throw new Error(`Unsupported task type: ${task.type}`);
    }

    emit?.('worker_complete', {
      taskId: task.id,
      agent: task.agentName,
      tokensUsed
    });

    return {
      taskId: task.id,
      status: 'success',
      output,
      context,
      tokensUsed
    };
  } catch (error) {
    emit?.('worker_error', {
      taskId: task.id,
      agent: task.agentName,
      error: (error as Error).message
    });

    return {
      taskId: task.id,
      status: 'failure',
      output: '',
      context: [],
      tokensUsed: 0,
      error: (error as Error).message
    };
  }
}
```

**Step 5.2: Create Multi-Agent Orchestrator**

Create `backend/src/orchestrator/multiAgentOrchestrator.ts`:

```typescript
import type { WorkerTask, WorkerResult } from '../agents/workerAgent.js';
import { executeWorkerTask, WORKER_AGENTS } from '../agents/workerAgent.js';

export interface MultiAgentPlan {
  tasks: WorkerTask[];
  synthesisStrategy: string;
}

export async function planMultiAgentExecution(
  question: string,
  complexity: number
): Promise<MultiAgentPlan> {
  // Simple heuristic-based planning (could be LLM-powered)
  const tasks: WorkerTask[] = [];

  if (complexity > 0.7) {
    // Complex research question
    tasks.push({
      id: 'task_1',
      type: 'retrieve',
      input: question,
      dependencies: [],
      agentName: 'retrieval_specialist'
    });

    tasks.push({
      id: 'task_2',
      type: 'web_search',
      input: question,
      dependencies: [],
      agentName: 'web_researcher'
    });

    tasks.push({
      id: 'task_3',
      type: 'synthesize',
      input: question,
      dependencies: ['task_1', 'task_2'],
      agentName: 'synthesizer'
    });

    tasks.push({
      id: 'task_4',
      type: 'evaluate',
      input: 'Check synthesis',
      dependencies: ['task_3'],
      agentName: 'fact_checker'
    });
  } else {
    // Simple question
    tasks.push({
      id: 'task_1',
      type: 'retrieve',
      input: question,
      dependencies: [],
      agentName: 'retrieval_specialist'
    });

    tasks.push({
      id: 'task_2',
      type: 'synthesize',
      input: question,
      dependencies: ['task_1'],
      agentName: 'synthesizer'
    });
  }

  return {
    tasks,
    synthesisStrategy: 'Combine worker outputs in dependency order'
  };
}

export async function executeMultiAgentPlan(
  plan: MultiAgentPlan,
  tools: Record<string, Function>,
  emit?: (event: string, data: unknown) => void
): Promise<Map<string, WorkerResult>> {
  const results = new Map<string, WorkerResult>();
  const completed = new Set<string>();

  // Topological sort by dependencies
  const sortedTasks = topologicalSort(plan.tasks);

  for (const task of sortedTasks) {
    const canExecute = task.dependencies.every((dep) => completed.has(dep));
    if (!canExecute) {
      console.warn(`Skipping task ${task.id} due to incomplete dependencies`);
      continue;
    }

    const result = await executeWorkerTask(task, tools, emit);
    results.set(task.id, result);
    completed.add(task.id);
  }

  return results;
}

function topologicalSort(tasks: WorkerTask[]): WorkerTask[] {
  const sorted: WorkerTask[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  function visit(task: WorkerTask) {
    if (temp.has(task.id)) {
      throw new Error(`Circular dependency detected at task ${task.id}`);
    }
    if (visited.has(task.id)) {
      return;
    }

    temp.add(task.id);

    for (const depId of task.dependencies) {
      const dep = tasks.find((t) => t.id === depId);
      if (dep) {
        visit(dep);
      }
    }

    temp.delete(task.id);
    visited.add(task.id);
    sorted.push(task);
  }

  for (const task of tasks) {
    if (!visited.has(task.id)) {
      visit(task);
    }
  }

  return sorted;
}
```

**Step 5.3: Update Configuration**

Add to `backend/src/config/app.ts`:

```typescript
const envSchema = z.object({
  // ... existing config ...

  // Multi-Agent
  ENABLE_MULTI_AGENT: z.coerce.boolean().default(false),
  MULTI_AGENT_COMPLEXITY_THRESHOLD: z.coerce.number().default(0.7),
  MULTI_AGENT_MAX_WORKERS: z.coerce.number().default(5),
});
```

**Step 5.4: Integrate with Orchestrator**

This would be integrated into `backend/src/orchestrator/index.ts` similar to query decomposition, with complexity assessment triggering multi-agent execution.

**Estimated Effort:** 5 days
**Dependencies:** Requires mature task planning and execution infrastructure

---

### Feature 6: Full Trace Logging

**Goal:** Capture complete execution traces with prompt snapshots, tool calls, token usage, latency, and evaluation scores for offline analysis and replay.

**Reference:** context-engineering.md §6 "Observability and Evaluation as First-Class Citizens" and instrumentation examples.

**Current Status:** Partial telemetry exists (`backend/src/orchestrator/sessionTelemetryStore.ts`) but doesn't capture full prompts and tool call details.

#### Implementation Steps

**Step 6.1: Extend Telemetry Store**

Update `backend/src/orchestrator/sessionTelemetryStore.ts` to capture full traces:

```typescript
export interface ToolCallTrace {
  tool: string;
  args: Record<string, any>;
  result: any;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  timestamp: string;
}

export interface PromptTrace {
  stage: string;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  response: string;
  timestamp: string;
}

export interface FullSessionTrace extends SessionTrace {
  toolCalls: ToolCallTrace[];
  prompts: PromptTrace[];
  errors: Array<{
    stage: string;
    error: string;
    timestamp: string;
  }>;
}
```

**Step 6.2: Create Trace Interceptor**

Create `backend/src/utils/traceInterceptor.ts`:

```typescript
export function wrapToolForTracing<T extends (...args: any[]) => Promise<any>>(
  toolName: string,
  toolFn: T,
  onTrace: (trace: ToolCallTrace) => void
): T {
  return (async (...args: any[]) => {
    const start = Date.now();
    const argsSnapshot = JSON.parse(JSON.stringify(args[0] ?? {}));

    try {
      const result = await toolFn(...args);
      const latencyMs = Date.now() - start;

      onTrace({
        tool: toolName,
        args: argsSnapshot,
        result: JSON.parse(JSON.stringify(result)),
        tokensIn: estimateTokens('gpt-4o', JSON.stringify(argsSnapshot)),
        tokensOut: estimateTokens('gpt-4o', JSON.stringify(result)),
        latencyMs,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      const latencyMs = Date.now() - start;

      onTrace({
        tool: toolName,
        args: argsSnapshot,
        result: { error: (error as Error).message },
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
        timestamp: new Date().toISOString()
      });

      throw error;
    }
  }) as T;
}
```

**Step 6.3: Update Orchestrator to Capture Full Traces**

Wrap all tool calls and LLM invocations with tracing interceptors in `backend/src/orchestrator/index.ts`.

**Step 6.4: Export Traces Endpoint**

Add to `backend/src/routes/index.ts`:

```typescript
app.get('/admin/traces/:sessionId', async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const trace = telemetryStore.getFullTrace(sessionId);

  if (!trace) {
    return reply.code(404).send({ error: 'Trace not found' });
  }

  return trace;
});

app.get('/admin/traces/export/:sessionId', async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const trace = telemetryStore.getFullTrace(sessionId);

  if (!trace) {
    return reply.code(404).send({ error: 'Trace not found' });
  }

  reply.header('Content-Type', 'application/json');
  reply.header('Content-Disposition', `attachment; filename="trace-${sessionId}.json"`);
  return JSON.stringify(trace, null, 2);
});
```

**Estimated Effort:** 2 days
**Dependencies:** None (extends existing telemetry)

---

## Implementation Timeline

### Sequential (Single Developer)
- **P1 Feature 1 (Semantic Memory):** 5-6 days
- **P1 Feature 2 (Query Decomposition):** 3-4 days
- **P1 Feature 3 (Web Reranking):** 2 days
- **P1 Feature 4 (Foundry Evals):** 3 days
- **P2 Feature 5 (Multi-Agent):** 5 days
- **P2 Feature 6 (Trace Logging):** 2 days

**Total:** 20-24 days

### Parallel (2 Developers)
- **Week 1-2:** Dev1 (Semantic Memory), Dev2 (Query Decomposition + Web Reranking)
- **Week 3:** Dev1 (Foundry Evals), Dev2 (Multi-Agent)
- **Week 4:** Dev1 (Trace Logging), Dev2 (Integration Testing)

**Total:** ~4 weeks

---

## Testing Strategy

### Unit Tests
- Semantic memory CRUD and cosine similarity
- Query decomposition complexity assessment
- RRF scoring algorithm
- Worker agent task execution
- Trace interceptor wrapping

### Integration Tests
- End-to-end semantic memory recall in orchestrator
- Multi-step query decomposition execution
- Reranked results in synthesis
- Foundry evals API calls (mocked)
- Full trace capture and export

### Performance Tests
- Semantic memory recall latency (target: <100ms for k=5)
- Query decomposition overhead (target: <500ms)
- Reranking throughput (target: 50 docs/sec)
- Worker agent concurrency (target: 5 parallel workers)

---

## Feature Flags & Rollout

Use existing environment variable pattern from `backend/src/config/app.ts`:

```typescript
// Progressive rollout phases
Phase 1: ENABLE_SEMANTIC_MEMORY=true (low risk)
Phase 2: ENABLE_QUERY_DECOMPOSITION=true (medium risk)
Phase 3: ENABLE_WEB_RERANKING=true (low risk)
Phase 4: ENABLE_FOUNDRY_EVALS=true (requires API access)
Phase 5: ENABLE_MULTI_AGENT=true (high complexity)
```

All features default to `false` and must be explicitly enabled.

---

## Monitoring & Metrics

### Metrics to Track

**Semantic Memory:**
- Recall latency (p50, p95, p99)
- Hit rate (memories found vs. requested)
- Storage growth (memories/day)
- Pruning effectiveness (removed/total)

**Query Decomposition:**
- Decomposition rate (% queries decomposed)
- Avg sub-queries per decomposition
- Sub-query execution time
- Synthesis quality (human eval)

**Web Reranking:**
- RRF score distribution
- Position changes (before/after reranking)
- Top-k stability
- Semantic boost impact

**Foundry Evals:**
- Groundedness score distribution
- Relevance score distribution
- Correlation with critic scores
- API latency

### Alerting Thresholds

- Semantic memory recall > 200ms (p95)
- Query decomposition failure rate > 5%
- Foundry evals API errors > 10%
- Worker agent timeout rate > 2%

---

## Cost Impact Analysis

### Semantic Memory
- **Storage:** ~10KB per memory × 10K memories = 100MB (negligible)
- **Embeddings:** 1 query embedding per recall × $0.00002/1K tokens × 1K tokens = $0.00002/query
- **Net:** ~$0.60/month (30K queries)

### Query Decomposition
- **LLM calls:** 2 extra calls (complexity + decomposition) × 500 tokens × $0.002/1K = $0.001/query
- **Applied to:** ~5% of queries
- **Net:** ~$4.50/month (30K queries)

### Web Reranking
- **Compute:** Negligible (mathematical operation)
- **Embeddings (if semantic boost):** 10 embeddings × $0.00002 = $0.0002/query
- **Net:** ~$6/month (30K queries)

### Foundry Evals
- **API calls:** $0.01 per evaluation (hypothetical)
- **Sample rate:** 10%
- **Net:** ~$300/month (30K queries)

**Total P1 Monthly Cost:** ~$311/month (assuming 30K queries)
**Offset by P0 savings:** -$180 to -$420 (intent routing + lazy retrieval)
**Net Impact:** -$109 to +$131/month

---

## Success Criteria

### P1 Success
- [ ] Semantic memory recall adds relevant context to ≥30% of queries
- [ ] Query decomposition improves complex question answers (human eval ≥70% preference)
- [ ] Web reranking improves top-3 relevance by ≥15% (offline eval)
- [ ] Foundry evals correlation with critic scores ≥0.7

### P2 Success
- [ ] Multi-agent execution reduces single-agent context overflow by ≥40%
- [ ] Full trace logging captures 100% of tool calls and prompts
- [ ] Trace export enables successful replay for ≥95% of sessions

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Semantic memory embeddings cost | Medium | Implement caching layer, batch embedding generation |
| Query decomposition complexity explosion | High | Hard limit on max sub-queries (8), timeout per sub-query (30s) |
| Foundry API rate limits | Medium | Implement exponential backoff, respect sample rate |
| Multi-agent deadlocks | High | Implement DAG validation, timeout per worker (60s) |
| Trace storage growth | Low | Implement retention policy (30 days), compression |

---

## Dependencies & Prerequisites

### External Services
- Azure OpenAI embeddings endpoint (for semantic memory)
- Azure AI Foundry Evals API access (preview)
- SQLite or PostgreSQL (for semantic memory persistence)

### Internal Dependencies
- ✅ Intent routing (P0 - completed)
- ✅ Lazy retrieval (P0 - completed)
- Mature error handling and retry logic
- OpenTelemetry integration for distributed tracing

### Infrastructure
- `backend/data/` directory for SQLite databases
- Sufficient disk space for trace storage (~100MB/10K sessions)

---

## Next Steps

1. **Review & Prioritize:** Stakeholder review of P1 features
2. **Provision Resources:** Set up Azure AI Foundry Evals API access
3. **Implementation:** Start with P1 Feature 1 (Semantic Memory) as foundation
4. **Testing:** Unit tests for each module before integration
5. **Gradual Rollout:** Enable features one at a time with monitoring
6. **Evaluation:** Collect metrics for 2 weeks before enabling next feature

---

## References

- `docs/context-engineering.md` - Best practices for agentic RAG
- `docs/unified-orchestrator-context-pipeline.md` - Current architecture
- `backend/src/orchestrator/router.ts` - P0 Intent routing implementation
- `backend/src/azure/lazyRetrieval.ts` - P0 Lazy retrieval implementation
