import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateEmbedding } from '../azure/directSearch.js';
import { config } from '../config/app.js';
import { cosineSimilarity } from '../utils/vector-ops.js';

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
  similarity?: number;
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

function ensureDirectory(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function toFloat32Array(buffer: Buffer) {
  return Array.from(
    new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT)
  );
}

export class SemanticMemoryStore {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = config.SEMANTIC_MEMORY_DB_PATH) {
    this.dbPath = dbPath;
  }

  private ensureInitialized() {
    if (!this.db) {
      const absolutePath = resolve(this.dbPath);
      ensureDirectory(absolutePath);
      this.db = new Database(absolutePath);
      this.db.pragma('journal_mode = WAL');
      this.initialize();
    }
  }

  private initialize() {
    this.db!.exec(`
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
      this.ensureInitialized();
      const embedding = await generateEmbedding(text);
      const embeddingBlob = Buffer.from(new Float32Array(embedding).buffer);
      const now = new Date().toISOString();

      const stmt = this.db!.prepare(`
        INSERT INTO memories (text, type, embedding, metadata, session_id, user_id, tags, created_at, last_accessed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        text,
        type,
        embeddingBlob,
        JSON.stringify(metadata ?? {}),
        options.sessionId ?? null,
        options.userId ?? null,
        JSON.stringify(options.tags ?? []),
        now,
        now
      );

      return Number(result.lastInsertRowid);
    } catch (error) {
      console.error('Failed to add semantic memory:', error);
      return null;
    }
  }

  async recallMemories(query: string, options: RecallOptions = {}): Promise<SemanticMemory[]> {
    const {
      k = config.SEMANTIC_MEMORY_RECALL_K,
      type,
      sessionId,
      userId,
      tags,
      minSimilarity = config.SEMANTIC_MEMORY_MIN_SIMILARITY,
      maxAgeDays
    } = options;

    try {
      this.ensureInitialized();
      const queryEmbedding = await generateEmbedding(query);

      let sql = 'SELECT * FROM memories WHERE 1=1';
      const params: any[] = [];

      if (type) {
        sql += ' AND type = ?';
        params.push(type);
      }
      if (sessionId) {
        sql += ' AND session_id = ?';
        params.push(sessionId);
      }
      if (userId) {
        sql += ' AND user_id = ?';
        params.push(userId);
      }
      if (maxAgeDays) {
        const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
        sql += ' AND created_at >= ?';
        params.push(cutoff);
      }

      const stmt = this.db!.prepare(sql);
      const rows = stmt.all(...params) as Array<Record<string, any>>;

      const scored = rows.map((row) => {
        const embeddingBuffer: Buffer = row.embedding;
        const embedding = toFloat32Array(embeddingBuffer);
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        const recordTags = JSON.parse(row.tags || '[]');
        const matchedTags = Array.isArray(tags)
          ? recordTags.filter((tag: string) => tags.includes(tag))
          : [];

        return {
          id: row.id as number,
          text: row.text as string,
          type: row.type as MemoryType,
          embedding,
          metadata: JSON.parse(row.metadata || '{}'),
          sessionId: row.session_id as string | undefined,
          userId: row.user_id as string | undefined,
          tags: recordTags,
          usageCount: row.usage_count as number,
          createdAt: row.created_at as string,
          lastAccessedAt: row.last_accessed_at as string,
          similarity: matchedTags.length ? similarity + matchedTags.length * 0.05 : similarity
        } satisfies SemanticMemory;
      });

      const filtered = scored.filter((item) => (item.similarity ?? 0) >= minSimilarity);
      filtered.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      const results = filtered.slice(0, k);

      if (results.length) {
        const updateStmt = this.db!.prepare(`
          UPDATE memories
          SET usage_count = usage_count + 1, last_accessed_at = ?
          WHERE id IN (${results.map(() => '?').join(',')})
        `);
        updateStmt.run(new Date().toISOString(), ...results.map((item) => item.id));
      }

      return results;
    } catch (error) {
      console.error('Failed to recall semantic memories:', error);
      return [];
    }
  }

  pruneMemories(maxAgeDays: number, minUsageCount = 2): number {
    this.ensureInitialized();
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
    const stmt = this.db!.prepare(`
      DELETE FROM memories
      WHERE created_at < ? AND usage_count < ?
    `);
    const result = stmt.run(cutoff, minUsageCount);
    return result.changes;
  }

  getStats() {
    this.ensureInitialized();
    const totalRow = this.db!.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    const byTypeRows = this.db!
      .prepare(
        `SELECT type, COUNT(*) as count
         FROM memories
         GROUP BY type`
      )
      .all() as Array<{ type: string; count: number }>;

    return {
      total: totalRow.count,
      byType: Object.fromEntries(byTypeRows.map((row) => [row.type, row.count]))
    };
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }

}

export const semanticMemoryStore = new SemanticMemoryStore();
