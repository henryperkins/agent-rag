import { describe, expect, it } from 'vitest';
import { mapToTelemetryResult } from '../orchestrator/telemetry/mapResult.js';

describe('mapToTelemetryResult', () => {
  it('extracts telemetry fields from a full result', () => {
    const mapped = mapToTelemetryResult({
      id: 'doc-1',
      title: 'Example',
      url: 'https://contoso.com',
      rank: 3,
      snippet: 'Hello world'
    });

    expect(mapped).toEqual({
      id: 'doc-1',
      title: 'Example',
      url: 'https://contoso.com',
      rank: 3
    });
  });

  it('returns undefined values when fields are missing', () => {
    const mapped = mapToTelemetryResult(undefined);
    expect(mapped).toEqual({
      id: undefined,
      title: undefined,
      url: undefined,
      rank: undefined
    });
  });
});
