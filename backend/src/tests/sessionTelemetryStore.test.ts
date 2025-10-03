import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearSessionTelemetry,
  createSessionRecorder,
  getSessionTelemetry
} from '../orchestrator/sessionTelemetryStore.js';

describe('sessionTelemetryStore redaction', () => {
  beforeEach(() => {
    clearSessionTelemetry();
  });

  it('redacts sensitive data in stored question, answer, and events', () => {
    const recorder = createSessionRecorder({
      sessionId: 'session-1',
      mode: 'sync',
      question: 'Email test@example.com and SSN 123-45-6789'
    });

    recorder.emit('complete', {
      answer: 'Reach me at 4111-1111-1111-1111 or test@example.com',
      status: 'done'
    });

    recorder.complete({
      answer: 'Follow up at test@example.com',
      metadata: {}
    } as any);

    const [entry] = getSessionTelemetry();
    expect(entry.question).toContain('[EMAIL]');
    expect(entry.question).toContain('[SSN]');
    expect(entry.question).not.toContain('test@example.com');
    expect(entry.question).not.toContain('123-45-6789');

    expect(entry.answer).toBe('Follow up at [EMAIL]');

    const completeEvent = entry.events.find((event) => event.event === 'complete');
    expect(completeEvent).toBeDefined();
    expect((completeEvent?.data as any)?.answer).toBe('Reach me at [CARD] or [EMAIL]');
  });

  it('redacts sensitive data in streaming tokens events', () => {
    const recorder = createSessionRecorder({
      sessionId: 'session-2',
      mode: 'stream',
      question: 'How to contact support?'
    });

    recorder.emit('tokens', {
      content: 'Contact us at support@example.com or call'
    });

    recorder.emit('tokens', {
      content: ' 4111222233334444 for help.'
    });

    recorder.emit('tokens', {
      content: ' SSN 987-65-4321 is on file.'
    });

    recorder.complete({
      answer: 'Complete answer redacted',
      metadata: {}
    } as any);

    const [entry] = getSessionTelemetry();
    const tokenEvents = entry.events.filter((event) => event.event === 'tokens');

    expect(tokenEvents).toHaveLength(3);
    expect((tokenEvents[0]?.data as any)?.content).toBe('Contact us at [EMAIL] or call');
    expect((tokenEvents[1]?.data as any)?.content).toBe(' [CARD] for help.');
    expect((tokenEvents[2]?.data as any)?.content).toBe(' SSN [SSN] is on file.');

    // Ensure no unredacted PII remains
    tokenEvents.forEach((evt) => {
      const content = (evt.data as any)?.content ?? '';
      expect(content).not.toContain('support@example.com');
      expect(content).not.toContain('4111222233334444');
      expect(content).not.toContain('987-65-4321');
    });
  });
});
