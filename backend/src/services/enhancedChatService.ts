import type { AgentMessage, ChatResponse } from '../../../shared/types.js';
import { runSession } from '../orchestrator/index.js';
import { createSessionRecorder } from '../orchestrator/sessionTelemetryStore.js';
import { deriveSessionId, latestUserQuestion } from '../utils/session.js';

interface ChatOptions {
  sessionId?: string;
  clientFingerprint?: string;
}

export async function handleEnhancedChat(messages: AgentMessage[], options?: ChatOptions): Promise<ChatResponse> {
  const providedId = options?.sessionId?.trim();
  const sessionId = providedId?.length ? providedId : deriveSessionId(messages, options?.clientFingerprint);
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
      emit: recorder.emit
    });
    recorder.complete(response);
    return response;
  } catch (error) {
    recorder.fail(error as Error);
    throw error;
  }
}
