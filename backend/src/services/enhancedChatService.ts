import type { AgentMessage, ChatResponse, FeatureOverrideMap } from '../../../shared/types.js';
import { runSession } from '../orchestrator/index.js';
import { createSessionRecorder } from '../orchestrator/sessionTelemetryStore.js';
import { deriveSessionId, latestUserQuestion } from '../utils/session.js';
import { sessionStore } from './sessionStore.js';
import { sanitizeFeatureOverrides } from '../config/features.js';

interface ChatOptions {
  sessionId?: string;
  clientFingerprint?: string;
  featureOverrides?: FeatureOverrideMap | null;
}

export async function handleEnhancedChat(messages: AgentMessage[], options?: ChatOptions): Promise<ChatResponse> {
  const providedId = options?.sessionId?.trim();
  const sessionId = providedId?.length ? providedId : deriveSessionId(messages, options?.clientFingerprint);
  const incomingOverrides = sanitizeFeatureOverrides(options?.featureOverrides);
  const persisted = sessionStore.loadFeatures(sessionId ?? '')?.features;
  const recorder = createSessionRecorder({
    sessionId,
    mode: 'sync',
    question: latestUserQuestion(messages)
  });

  try {
    const response = await runSession({
      messages,
      mode: 'sync',
      sessionId,
      emit: recorder.emit,
      featureOverrides: incomingOverrides,
      persistedFeatures: persisted
    });
    recorder.complete(response);

    const updatedMessages: AgentMessage[] = [...messages, { role: 'assistant', content: response.answer }];
    sessionStore.saveTranscript(sessionId, updatedMessages);
    const resolvedFeatures = response.metadata?.features?.resolved ?? incomingOverrides;
    if (resolvedFeatures) {
      sessionStore.saveFeatures(sessionId, resolvedFeatures);
    }

    return response;
  } catch (error) {
    recorder.fail(error as Error);
    throw error;
  }
}
