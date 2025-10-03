import type { CompactedContext, SalienceNote } from './compact.js';

export interface SummaryBullet {
  text: string;
  embedding?: number[];
}

interface MemoryEntry {
  sessionId: string;
  turn: number;
  summaryBullets: SummaryBullet[];
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

function cloneSummary(entry: SummaryBullet): SummaryBullet {
  return {
    text: entry.text,
    embedding: entry.embedding ? [...entry.embedding] : undefined
  };
}

function normalizeSummaries(summaries: SummaryBullet[]): SummaryBullet[] {
  const deduped: SummaryBullet[] = [];
  const seen = new Set<string>();
  for (const entry of summaries) {
    const text = entry.text?.trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    deduped.push(cloneSummary({ text, embedding: entry.embedding }));
  }
  return deduped;
}

export function upsertMemory(
  sessionId: string,
  turn: number,
  compacted: CompactedContext,
  summaries?: SummaryBullet[]
) {
  if (!compacted.summary.length && !compacted.salience.length && !summaries?.length) {
    return;
  }

  const existing = sessionMemory.get(sessionId);
  const mergedSummaries: SummaryBullet[] = [...(existing?.summaryBullets ?? [])];
  const incomingSummaries = summaries
    ? summaries
    : compacted.summary.map((text) => ({ text } as SummaryBullet));

  for (const entry of incomingSummaries) {
    const normalizedText = entry.text?.trim();
    if (!normalizedText) {
      continue;
    }
    const current = cloneSummary({ text: normalizedText, embedding: entry.embedding });
    const idx = mergedSummaries.findIndex((item) => item.text === normalizedText);
    if (idx !== -1) {
      mergedSummaries.splice(idx, 1);
    }
    mergedSummaries.push(current);
  }

  const summaryBullets = normalizeSummaries(mergedSummaries).slice(-50);

  const next: MemoryEntry = {
    sessionId,
    turn,
    summaryBullets,
    salience: mergeSalience(existing?.salience ?? [], compacted.salience).slice(0, 100),
    createdAt: Date.now()
  };

  sessionMemory.set(sessionId, next);
}

export function loadMemory(sessionId: string, maxAgeInTurns = 50) {
  const entry = sessionMemory.get(sessionId);
  if (!entry) {
    return { summaryBullets: [] as SummaryBullet[], salience: [] as SalienceNote[] };
  }

  const recentSalience = entry.salience.filter((note) => {
    const lastSeen = note.lastSeenTurn ?? entry.turn;
    return entry.turn - lastSeen <= maxAgeInTurns;
  });

  return {
    summaryBullets: entry.summaryBullets.slice(-20).map(cloneSummary),
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
