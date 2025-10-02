import { useCallback, useRef, useState } from 'react';
import type { ActivityStep, AgentMessage, Citation } from '../types';

interface CritiqueAttempt {
  attempt: number;
  grounded: boolean;
  coverage: number;
  action: 'accept' | 'revise';
  issues?: string[];
}

interface StreamState {
  isStreaming: boolean;
  status: string;
  answer: string;
  citations: Citation[];
  activity: ActivityStep[];
  critique?: { score?: number; reasoning?: string; action?: string };
  critiqueHistory: CritiqueAttempt[];
  plan?: any;
  context?: { history?: string; summary?: string; salience?: string };
  telemetry?: Record<string, unknown>;
  trace?: Record<string, unknown>;
  webContext?: {
    text?: string;
    tokens?: number;
    trimmed?: boolean;
    results?: Array<{ id?: string; title?: string; url?: string; rank?: number }>;
  };
  error?: string;
}

export function useChatStream() {
  const [state, setState] = useState<StreamState>({
    isStreaming: false,
    status: 'idle',
    answer: '',
    citations: [],
    activity: [],
    critiqueHistory: [],
    telemetry: {}
  });
  const controllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    setState({
      isStreaming: false,
      status: 'idle',
      answer: '',
      citations: [],
    activity: [],
    critiqueHistory: [],
    telemetry: {}
  });
  }, []);

  const stream = useCallback(async (messages: AgentMessage[]) => {
    reset();

    const controller = new AbortController();
    controllerRef.current = controller;

    setState((prev) => ({ ...prev, isStreaming: true, status: 'starting', answer: '' }));

    try {
      const response = await fetch(`${(import.meta.env.VITE_API_BASE ?? __API_BASE__) as string}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(text || `Stream failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        let eventType: string | null = null;
        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('event:')) {
            eventType = line.replace('event:', '').trim();
            continue;
          }

          if (line.startsWith('data:')) {
            const data = JSON.parse(line.replace('data:', '').trim());
            switch (eventType) {
              case 'status':
                setState((prev) => ({ ...prev, status: data.stage ?? prev.status }));
                break;
              case 'token':
                setState((prev) => ({ ...prev, answer: prev.answer + (data.content ?? '') }));
                break;
              case 'citations':
                setState((prev) => ({ ...prev, citations: data.citations ?? [] }));
                break;
              case 'activity':
                setState((prev) => ({ ...prev, activity: data.steps ?? [] }));
                break;
              case 'critique':
                setState((prev) => ({
                  ...prev,
                  critique: data,
                  critiqueHistory: [...prev.critiqueHistory, {
                    attempt: data.attempt ?? prev.critiqueHistory.length,
                    grounded: data.grounded ?? false,
                    coverage: data.coverage ?? 0,
                    action: data.action ?? 'accept',
                    issues: data.issues
                  }]
                }));
                break;
              case 'plan':
                setState((prev) => ({ ...prev, plan: data }));
                break;
              case 'context':
                setState((prev) => ({ ...prev, context: data }));
                break;
              case 'telemetry':
                setState((prev) => ({ ...prev, telemetry: { ...(prev.telemetry ?? {}), ...data } }));
                break;
              case 'web_context':
                setState((prev) => ({
                  ...prev,
                  webContext: {
                    text: data.text,
                    tokens: data.tokens,
                    trimmed: data.trimmed,
                    results: data.results
                  }
                }));
                break;
              case 'trace':
                setState((prev) => ({ ...prev, trace: data }));
                break;
              case 'error':
                setState((prev) => ({ ...prev, error: data.message, status: 'error' }));
                break;
              case 'complete':
                setState((prev) => ({ ...prev, answer: data.answer ?? prev.answer }));
                break;
              case 'done':
                setState((prev) => ({ ...prev, status: 'complete' }));
                break;
              default:
                break;
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setState((prev) => ({ ...prev, isStreaming: false, status: 'cancelled' }));
      } else {
        setState((prev) => ({ ...prev, isStreaming: false, status: 'error', error: error.message }));
      }
      return;
    }

    setState((prev) => ({ ...prev, isStreaming: false }));
  }, [reset]);

  return {
    ...state,
    stream,
    cancel: () => {
      controllerRef.current?.abort();
    },
    reset,
    plan: state.plan,
    contextSnapshot: state.context,
    telemetry: state.telemetry,
    trace: state.trace,
    webContext: state.webContext,
    critiqueHistory: state.critiqueHistory
  };
}
