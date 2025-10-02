import type { CompactedContext, SalienceNote } from './compact.js';

interface MemoryEntry {
  sessionId: string;
  turn: number;
  summaryBullets: string[];
  salience: SalienceNote[];
  createdAt: number;
}

const sessionMemory = new Map<string, MemoryEntry>();

function mergeSalience(existing: SalienceNote[], updates: SalienceNote[]): SalienceNote[] {
  const map = new Map<string, SalienceNote>();
  for (const note of existing) {
    map.set(note.fact, note);
  }
  for (const note of updates) {
    map.set(note.fact, { ...note });
  }
  return [...map.values()].sort((a, b) => (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0));
}

export function upsertMemory(sessionId: string, turn: number, compacted: CompactedContext) {
  if (!compacted.summary.length && !compacted.salience.length) {
    return;
  }

  const existing = sessionMemory.get(sessionId);
  const next: MemoryEntry = {
    sessionId,
    turn,
    summaryBullets: [...(existing?.summaryBullets ?? []), ...compacted.summary].slice(-50),
    salience: mergeSalience(existing?.salience ?? [], compacted.salience).slice(0, 100),
    createdAt: Date.now()
  };

  sessionMemory.set(sessionId, next);
}

export function loadMemory(sessionId: string, maxAgeInTurns = 50) {
  const entry = sessionMemory.get(sessionId);
  if (!entry) {
    return { summaryBullets: [] as string[], salience: [] as SalienceNote[] };
  }

  const recentSalience = entry.salience.filter((note) => {
    const lastSeen = note.lastSeenTurn ?? entry.turn;
    return entry.turn - lastSeen <= maxAgeInTurns;
  });

  return {
    summaryBullets: entry.summaryBullets.slice(-20),
    salience: recentSalience
  };
}

export function clearMemory(sessionId?: string) {
  if (sessionId) {
    sessionMemory.delete(sessionId);
  } else {
    sessionMemory.clear();
  }
}
