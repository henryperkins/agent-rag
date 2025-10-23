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
  const absolutePath = ensureDirectoryFor(dbPath);
  const db = new Database(absolutePath);

  if (options.enableWal !== false) {
    db.pragma('journal_mode = WAL');
  }

  if (Array.isArray(options.pragmas) && options.pragmas.length > 0) {
    applyPragmas(db, options.pragmas);
  }

  return db;
}
