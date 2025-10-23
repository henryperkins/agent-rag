import type { Reference } from '../../../shared/types.js';

function resolveReferenceText(reference: Reference | undefined): string {
  if (!reference) {
    return '';
  }
  const candidates: Array<unknown> = [
    reference.content,
    reference.chunk,
    (reference as { summary?: unknown }).summary,
    reference.metadata && (reference.metadata as Record<string, unknown>).snippet,
    reference.title
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return '';
}

export function validateCitationIntegrity(answer: string, citations: Reference[]): boolean {
  const matches = [...answer.matchAll(/\[(\d+)\]/g)];
  if (!matches.length) {
    return false;
  }

  for (const match of matches) {
    const rawId = match[1];
    const citationId = Number.parseInt(rawId, 10);
    if (Number.isNaN(citationId) || citationId < 1) {
      return false;
    }

    const reference = citations[citationId - 1];
   if (!reference) {
     return false;
   }

   const referenceText = resolveReferenceText(reference);
   if (!referenceText) {
     return false;
   }

    const metadata = reference.metadata as Record<string, unknown> | undefined;
    if (metadata && 'unifiedGroundingIds' in metadata) {
      const rawIds = metadata['unifiedGroundingIds'];
      const ids = Array.isArray(rawIds)
        ? rawIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];
      if (!ids.length) {
        return false;
      }
    }
  }

  return true;
}
