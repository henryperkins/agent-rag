import type { SummaryBullet } from '../memoryStore.js';

export function dedupeSummaryBullets(bullets: SummaryBullet[]): SummaryBullet[] {
  const deduped: SummaryBullet[] = [];
  const seen = new Set<string>();

  for (const bullet of bullets) {
    const text = bullet.text?.trim();
    if (!text) {
      continue;
    }
    if (seen.has(text)) {
      continue;
    }
    seen.add(text);
    deduped.push({
      text,
      embedding: bullet.embedding ? [...bullet.embedding] : undefined
    });
  }

  return deduped;
}
