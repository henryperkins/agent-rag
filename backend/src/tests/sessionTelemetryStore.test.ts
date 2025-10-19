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

  it('redacts sensitive data in singular token events (SSE streaming)', () => {
    const recorder = createSessionRecorder({
      sessionId: 'session-token-singular',
      mode: 'stream',
      question: 'How to reach us?'
    });

    // SSE streaming emits 'token' (singular) events
    recorder.emit('token', {
      content: 'Email admin@company.com for'
    });

    recorder.emit('token', {
      content: ' billing at 5555-6666-7777-8888'
    });

    recorder.emit('token', {
      content: ' or SSN 111-22-3333.'
    });

    recorder.complete({
      answer: 'Complete',
      metadata: {}
    } as any);

    const [entry] = getSessionTelemetry();
    const tokenEvents = entry.events.filter((event) => event.event === 'token');

    expect(tokenEvents).toHaveLength(3);
    expect((tokenEvents[0]?.data as any)?.content).toBe('Email [EMAIL] for');
    expect((tokenEvents[1]?.data as any)?.content).toBe(' billing at [CARD]');
    expect((tokenEvents[2]?.data as any)?.content).toBe(' or SSN [SSN].');

    // Verify PII is fully redacted
    tokenEvents.forEach((evt) => {
      const content = (evt.data as any)?.content ?? '';
      expect(content).not.toContain('admin@company.com');
      expect(content).not.toContain('5555-6666-7777-8888');
      expect(content).not.toContain('111-22-3333');
    });
  });

  it('redacts sensitive data in context payloads', () => {
    const recorder = createSessionRecorder({
      sessionId: 'session-3',
      mode: 'sync',
      question: 'Initial question'
    });

    recorder.emit('context', {
      history: 'User said email me at context@example.com',
      summary: 'Summary mentions 4111 2222 3333 4444',
      salience: 'SSN 123-45-6789 is sensitive'
    });

    recorder.complete({
      answer: 'done',
      metadata: {}
    } as any);

    const [entry] = getSessionTelemetry();
    expect(entry.context?.history).toBe('User said email me at [EMAIL]');
    expect(entry.context?.summary).toBe('Summary mentions [CARD]');
    expect(entry.context?.salience).toBe('SSN [SSN] is sensitive');
  });

  it('redacts sensitive data in activity events and final state', () => {
    const recorder = createSessionRecorder({
      sessionId: 'session-4',
      mode: 'sync',
      question: 'Track progress'
    });

    recorder.emit('activity', {
      steps: [
        {
          type: 'note',
          description: 'Contact user via activity@example.com'
        }
      ]
    });

    recorder.complete({
      answer: 'done',
      activity: [
        {
          type: 'final',
          description: 'Final outreach to 4111-2222-3333-4444'
        }
      ],
      metadata: {}
    } as any);

    const [entry] = getSessionTelemetry();
    expect(entry.activity).toHaveLength(1);
    expect(entry.activity?.[0]?.description).toBe('Final outreach to [CARD]');

    const activityEvent = entry.events.find((event) => event.event === 'activity');
    const steps = (activityEvent?.data as any)?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]?.description).toBe('Contact user via [EMAIL]');
  });

  it('stores summary selection telemetry from events and metadata', () => {
    const recorder = createSessionRecorder({
      sessionId: 'session-5',
      mode: 'sync',
      question: 'Summarize context'
    });

    const stats = {
      mode: 'semantic' as const,
      totalCandidates: 4,
      selectedCount: 2,
      discardedCount: 2,
      usedFallback: false,
      maxScore: 0.91,
      minScore: 0.42,
      meanScore: 0.66,
      maxSelectedScore: 0.91,
      minSelectedScore: 0.75
    };

    recorder.emit('telemetry', {
      summarySelection: stats
    });

    recorder.complete({
      answer: 'done',
      metadata: {
        summary_selection: stats
      }
    } as any);

    const [entry] = getSessionTelemetry();
    expect(entry.summarySelection?.mode).toBe('semantic');
    expect(entry.summarySelection?.selectedCount).toBe(2);
    expect(entry.metadata?.summary_selection?.maxScore).toBeCloseTo(0.91);
  });

  it('sanitizes evaluation telemetry payloads', () => {
    const recorder = createSessionRecorder({
      sessionId: 'session-eval',
      mode: 'sync',
      question: 'Evaluate telemetry'
    });

    const evaluation = {
      rag: {
        retrieval: {
          metric: 'retrieval',
          score: 1,
          threshold: 3,
          passed: false,
          reason: 'Reach analyst@example.com for details',
          evidence: { fallback: 'triggered' }
        }
      },
      quality: undefined,
      agent: {
        intentResolution: {
          metric: 'intent_resolution',
          score: 4,
          threshold: 3,
          passed: true,
          reason: 'Intent resolved successfully',
          evidence: { confidence: 0.9 }
        }
      },
      safety: {
        flagged: false,
        categories: [],
        reason: undefined,
        evidence: undefined
      },
      summary: {
        status: 'needs_review' as const,
        failingMetrics: ['rag.retrieval'],
        generatedAt: new Date().toISOString()
      }
    };

    recorder.emit('telemetry', { evaluation });

    recorder.complete({
      answer: 'done',
      metadata: {
        evaluation
      }
    } as any);

    const [entry] = getSessionTelemetry();
    expect(entry.evaluation?.rag?.retrieval?.reason).toContain('[EMAIL]');
    expect(entry.evaluation?.agent?.intentResolution?.metric).toBe('intent_resolution');
    expect(entry.metadata?.evaluation?.summary.status).toBe('needs_review');
  });
});
