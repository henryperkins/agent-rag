import type { WebResult } from '../../../../shared/types.js';

export type TelemetryResult = Pick<WebResult, 'id' | 'title' | 'url' | 'rank'>;

export function mapToTelemetryResult(result: Partial<WebResult> | undefined | null): TelemetryResult {
  const fallbackId = typeof result?.url === 'string' ? result.url : '';
  const id =
    typeof result?.id === 'string' && result.id.trim().length > 0 ? result.id : fallbackId;
  const url = typeof result?.url === 'string' ? result.url : '';
  const title =
    typeof result?.title === 'string' && result.title.trim().length > 0
      ? result.title
      : id || 'Untitled result';

  return {
    id,
    title,
    url,
    rank: typeof result?.rank === 'number' ? result.rank : undefined
  };
}
