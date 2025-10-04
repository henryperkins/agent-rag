import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores = new Map<string, { rows: any[]; lastId: number }>();

vi.mock('better-sqlite3', () => {
  class MockStatement {
    constructor(private handler: {
      run?: (...args: any[]) => any;
      all?: (...args: any[]) => any;
      get?: (...args: any[]) => any;
    }) {}

    run(...args: any[]) {
      if (!this.handler.run) {
        throw new Error('run not implemented for this statement');
      }
      return this.handler.run(...args);
    }

    all(...args: any[]) {
      if (!this.handler.all) {
        throw new Error('all not implemented for this statement');
      }
      return this.handler.all(...args);
    }

    get(...args: any[]) {
      if (!this.handler.get) {
        throw new Error('get not implemented for this statement');
      }
      return this.handler.get(...args);
    }
  }

  class MockDatabase {
    private store: { rows: any[]; lastId: number };

    constructor(path: string) {
      if (!stores.has(path)) {
        stores.set(path, { rows: [], lastId: 0 });
      }
      this.store = stores.get(path)!;
    }

    exec() {
      // schema creation no-op
    }

    pragma() {
      return undefined;
    }

    prepare(sql: string) {
      const trimmed = sql.trim();

      if (trimmed.startsWith('INSERT INTO memories')) {
        return new MockStatement({
          run: (
            text: string,
            type: string,
            embedding: Buffer,
            metadata: string,
            sessionId: string | null,
            userId: string | null,
            tags: string,
            createdAt: string,
            lastAccessedAt: string
          ) => {
            const id = ++this.store.lastId;
            this.store.rows.push({
              id,
              text,
              type,
              embedding,
              metadata,
              session_id: sessionId ?? undefined,
              user_id: userId ?? undefined,
              tags,
              usage_count: 0,
              created_at: createdAt,
              last_accessed_at: lastAccessedAt
            });
            return { lastInsertRowid: id };
          }
        });
      }

      if (trimmed.startsWith('SELECT * FROM memories')) {
        const hasType = trimmed.includes('type = ?');
        const hasSession = trimmed.includes('session_id = ?');
        const hasUser = trimmed.includes('user_id = ?');
        const hasCutoff = trimmed.includes('created_at >= ?');

        return new MockStatement({
          all: (...params: any[]) => {
            let index = 0;
            let rows = [...this.store.rows];
            if (hasType) {
              const type = params[index++];
              rows = rows.filter((row) => row.type === type);
            }
            if (hasSession) {
              const sessionId = params[index++];
              rows = rows.filter((row) => row.session_id === sessionId);
            }
            if (hasUser) {
              const userId = params[index++];
              rows = rows.filter((row) => row.user_id === userId);
            }
            if (hasCutoff) {
              const cutoff = params[index++];
              rows = rows.filter((row) => row.created_at >= cutoff);
            }
            return rows;
          }
        });
      }

      if (trimmed.startsWith('UPDATE memories')) {
        return new MockStatement({
          run: (timestamp: string, ...ids: number[]) => {
            for (const id of ids) {
              const row = this.store.rows.find((item) => item.id === id);
              if (row) {
                row.usage_count += 1;
                row.last_accessed_at = timestamp;
              }
            }
            return { changes: ids.length };
          }
        });
      }

      if (trimmed.startsWith('DELETE FROM memories')) {
        return new MockStatement({
          run: (cutoff: string, minUsage: number) => {
            const before = this.store.rows.length;
            this.store.rows = this.store.rows.filter(
              (row) => !(row.created_at < cutoff && row.usage_count < minUsage)
            );
            return { changes: before - this.store.rows.length };
          }
        });
      }

      if (trimmed.startsWith('SELECT COUNT(*) as count FROM memories')) {
        return new MockStatement({
          get: () => ({ count: this.store.rows.length })
        });
      }

      if (trimmed.includes('GROUP BY type')) {
        return new MockStatement({
          all: () => {
            const counts = new Map<string, number>();
            for (const row of this.store.rows) {
              counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
            }
            return Array.from(counts.entries()).map(([type, count]) => ({ type, count }));
          }
        });
      }

      throw new Error(`Unsupported SQL in mock: ${sql}`);
    }

    close() {
      // nothing to release
    }

    static __reset(path?: string) {
      if (path) {
        stores.delete(path);
      } else {
        stores.clear();
      }
    }
  }

  return { default: MockDatabase };
});

vi.mock('../azure/directSearch.js', () => ({
  generateEmbedding: vi.fn(async (text: string) => {
    const normalized = text.toLowerCase();
    return [
      normalized.length || 1,
      normalized.includes('azure') ? 1 : 0,
      normalized.includes('embedding') ? 1 : 0,
      normalized.includes('memory') ? 1 : 0
    ];
  })
}));

const TEST_DB_PATH = './tests/semantic-memory.db';

describe('SemanticMemoryStore', () => {
  beforeEach(() => {
    stores.clear();
  });

  it('adds and recalls semantic memories', async () => {
    const { SemanticMemoryStore } = await import('../orchestrator/semanticMemoryStore.js');
    const store = new SemanticMemoryStore(TEST_DB_PATH);

    const id = await store.addMemory(
      'Azure OpenAI embeddings provide rich semantic vectors.',
      'semantic',
      { source: 'docs' },
      { sessionId: 'session-1', tags: ['azure', 'embeddings'] }
    );

    expect(id).toBeGreaterThan(0);

    const recalled = await store.recallMemories('How do Azure embeddings work?', {
      sessionId: 'session-1',
      k: 2,
      minSimilarity: 0.1
    });

    expect(recalled.length).toBeGreaterThan(0);
    expect(recalled[0].text).toContain('Azure OpenAI embeddings');
    store.close();
  });

  it('filters memories by type and tags', async () => {
    const { SemanticMemoryStore } = await import('../orchestrator/semanticMemoryStore.js');
    const store = new SemanticMemoryStore(TEST_DB_PATH);

    await store.addMemory('User prefers concise answers', 'preference', {}, {
      userId: 'user-123',
      tags: ['style']
    });

    await store.addMemory('Vector search improves recall', 'semantic', {}, { tags: ['retrieval'] });

    const preferences = await store.recallMemories('What style does the user prefer?', {
      type: 'preference',
      userId: 'user-123',
      minSimilarity: 0
    });

    expect(preferences).toHaveLength(1);
    expect(preferences[0].type).toBe('preference');
    store.close();
  });

  it('prunes stale low-usage memories', async () => {
    const { SemanticMemoryStore } = await import('../orchestrator/semanticMemoryStore.js');
    const store = new SemanticMemoryStore(TEST_DB_PATH);

    const memoryId = await store.addMemory('Old memory to prune', 'semantic');
    expect(memoryId).toBeGreaterThan(0);

    const removed = store.pruneMemories(-1, 1);
    expect(removed).toBeGreaterThanOrEqual(1);
    store.close();
  });
});
