import type { AgentMessage } from '../../../shared/types.js';
import { runSession } from '../orchestrator/index.js';
import { createSessionRecorder } from '../orchestrator/sessionTelemetryStore.js';
import { deriveSessionId, latestUserQuestion } from '../utils/session.js';

interface StreamOptions {
  sessionId?: string;
  clientFingerprint?: string;
}

type EventSender = (event: string, data: any) => void;

export async function handleChatStream(messages: AgentMessage[], sendEvent: EventSender, options?: StreamOptions) {
  const providedId = options?.sessionId?.trim();
  const sessionId = providedId?.length ? providedId : deriveSessionId(messages, options?.clientFingerprint);
  const recorder = createSessionRecorder({
    sessionId,
    mode: 'stream',
    question: latestUserQuestion(messages),
    forward: (event, data) => {
      const transformedEvent = event === 'tokens' ? 'token' : event;
      sendEvent(transformedEvent, data);
    }
  });

  try {
    const response = await runSession({
      messages,
      mode: 'stream',
      sessionId,
      emit: recorder.emit
    });
    recorder.complete(response);
  } catch (error) {
    recorder.fail(error as Error);
    throw error;
  }
}
