import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface SqliteInitOptions {
  enableWal?: boolean;
  pragmas?: Array<{ pragma: string; value?: unknown }>;
}

export function ensureDirectoryFor(filePath: string): string {
  const absolutePath = resolve(filePath);
  const directory = dirname(absolutePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  return absolutePath;
}

export function applyPragmas(
  db: Database.Database,
  pragmas: Array<{ pragma: string; value?: unknown }> = []
): void {
  for (const entry of pragmas) {
    if (!entry?.pragma) {
      continue;
    }
    if (entry.value === undefined) {
      db.pragma(entry.pragma);
    } else {
      db.pragma(`${entry.pragma} = ${entry.value}`);
    }
  }
}

export function openSqliteDatabase(dbPath: string, options: SqliteInitOptions = {}): Database.Database {
  // Handle special in-memory database case
  const isMemoryDb = dbPath === ':memory:' || dbPath.startsWith('file::memory:');
  const absolutePath = isMemoryDb ? dbPath : ensureDirectoryFor(dbPath);
  const db = new Database(absolutePath);

  // WAL mode is not compatible with in-memory databases
  // Enabling WAL on :memory: causes SQLite to create physical files
  if (options.enableWal !== false && !isMemoryDb) {
    db.pragma('journal_mode = WAL');
  }

  if (Array.isArray(options.pragmas) && options.pragmas.length > 0) {
    applyPragmas(db, options.pragmas);
  }

  return db;
}
