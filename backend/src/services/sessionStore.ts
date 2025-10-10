import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AgentMessage } from '../../../shared/types.js';
import { config } from '../config/app.js';
import type { SalienceNote } from '../orchestrator/compact.js';

export interface StoredSummaryBullet {
  text: string;
  embedding?: number[];
}

export interface SessionSnapshot {
  sessionId: string;
  messages: AgentMessage[];
  updatedAt: string;
}

export interface SessionMemorySnapshot {
  sessionId: string;
  summaryBullets: StoredSummaryBullet[];
  salience: SalienceNote[];
  turn: number;
  updatedAt: string;
}

function ensureDirectory(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

interface MemoryFallbackState {
  transcripts: Map<string, SessionSnapshot>;
  memories: Map<string, SessionMemorySnapshot>;
}

export class SessionStore {
  private db: Database.Database | null = null;
  private fallback: MemoryFallbackState | null = null;

  constructor(dbPath: string = config.SESSION_DB_PATH) {
    const absolute = resolve(dbPath);
    ensureDirectory(absolute);

    try {
      this.db = new Database(absolute);
      this.db.pragma('journal_mode = WAL');
      this.initialize();
    } catch (error) {
      console.warn('SessionStore: falling back to in-memory storage (better-sqlite3 unavailable)', error);
      this.fallback = {
        transcripts: new Map(),
        memories: new Map()
      };
    }
  }

  private initialize() {
    if (!this.db) {
      return;
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_transcripts (
        session_id TEXT PRIMARY KEY,
        messages TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_memory (
        session_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        salience TEXT NOT NULL,
        turn INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  saveTranscript(sessionId: string, messages: AgentMessage[]): void {
    if (!sessionId?.trim()) {
      return;
    }

    if (this.fallback) {
      const updatedAt = new Date().toISOString();
      this.fallback.transcripts.set(sessionId, { sessionId, messages, updatedAt });
      return;
    }

    if (!this.db) {
      return;
    }

    const payload = JSON.stringify(messages);
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT INTO session_transcripts (session_id, messages, updated_at)
          VALUES (@sessionId, @messages, @updatedAt)
          ON CONFLICT(session_id) DO UPDATE SET
            messages = excluded.messages,
            updated_at = excluded.updated_at
        `
      )
      .run({ sessionId, messages: payload, updatedAt });
  }

  loadTranscript(sessionId: string): SessionSnapshot | null {
    if (!sessionId?.trim()) {
      return null;
    }

    if (this.fallback) {
      return this.fallback.transcripts.get(sessionId) ?? null;
    }

    if (!this.db) {
      return null;
    }

    const row = this.db
      .prepare<[{ session_id: string; messages: string; updated_at: string }]>(
        `SELECT session_id, messages, updated_at FROM session_transcripts WHERE session_id = ?`
      )
      .get(sessionId) as { session_id: string; messages: string; updated_at: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      const messages = JSON.parse(row.messages) as AgentMessage[];
      return {
        sessionId: row.session_id,
        messages,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.warn(`Failed to parse conversation history for session ${sessionId}:`, error);
      return null;
    }
  }

  saveMemory(sessionId: string, turn: number, summary: StoredSummaryBullet[], salience: SalienceNote[]): void {
    if (!sessionId?.trim()) {
      return;
    }

    if (this.fallback) {
      const updatedAt = new Date().toISOString();
      this.fallback.memories.set(sessionId, {
        sessionId,
        summaryBullets: summary ?? [],
        salience: salience ?? [],
        turn,
        updatedAt
      });
      return;
    }

    if (!this.db) {
      return;
    }

    const payload = {
      summary: JSON.stringify(summary ?? []),
      salience: JSON.stringify(salience ?? []),
      updatedAt: new Date().toISOString(),
      turn
    };

    this.db
      .prepare(
        `
          INSERT INTO session_memory (session_id, summary, salience, turn, updated_at)
          VALUES (@sessionId, @summary, @salience, @turn, @updatedAt)
          ON CONFLICT(session_id) DO UPDATE SET
            summary = excluded.summary,
            salience = excluded.salience,
            turn = excluded.turn,
            updated_at = excluded.updated_at
        `
      )
      .run({ sessionId, ...payload });
  }

  loadMemory(sessionId: string): SessionMemorySnapshot | null {
    if (!sessionId?.trim()) {
      return null;
    }

    if (this.fallback) {
      return this.fallback.memories.get(sessionId) ?? null;
    }

    if (!this.db) {
      return null;
    }

    const row = this.db
      .prepare<[{ session_id: string; summary: string; salience: string; turn: number; updated_at: string }]>(
        `SELECT session_id, summary, salience, turn, updated_at FROM session_memory WHERE session_id = ?`
      )
      .get(sessionId) as
      | { session_id: string; summary: string; salience: string; turn: number; updated_at: string }
      | undefined;

    if (!row) {
      return null;
    }

    try {
      const summary = JSON.parse(row.summary) as StoredSummaryBullet[];
      const salience = JSON.parse(row.salience) as SalienceNote[];
      return {
        sessionId: row.session_id,
        summaryBullets: Array.isArray(summary) ? summary : [],
        salience: Array.isArray(salience) ? salience : [],
        turn: row.turn ?? 0,
        updatedAt: row.updated_at
      };
    } catch (error) {
      console.warn(`Failed to parse memory snapshot for session ${sessionId}:`, error);
      return null;
    }
  }

  removeSession(sessionId: string): void {
    if (!sessionId?.trim()) {
      return;
    }

    if (this.fallback) {
      this.fallback.transcripts.delete(sessionId);
      this.fallback.memories.delete(sessionId);
      return;
    }

    if (!this.db) {
      return;
    }

    const stmt = this.db.prepare(`DELETE FROM session_transcripts WHERE session_id = ?`);
    stmt.run(sessionId);
    const memStmt = this.db.prepare(`DELETE FROM session_memory WHERE session_id = ?`);
    memStmt.run(sessionId);
  }

  clearAll(): void {
    if (this.fallback) {
      this.fallback.transcripts.clear();
      this.fallback.memories.clear();
      return;
    }

    if (!this.db) {
      return;
    }

    this.db.exec(`DELETE FROM session_transcripts; DELETE FROM session_memory;`);
  }
}

export const sessionStore = new SessionStore();
