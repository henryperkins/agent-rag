import { createHash, randomUUID } from 'node:crypto';
import type { AgentMessage, ChatResponse } from '../../../shared/types.js';
import { runSession } from '../orchestrator/index.js';
import { createSessionRecorder } from '../orchestrator/sessionTelemetryStore.js';

function latestUserQuestion(messages: AgentMessage[]) {
  return [...messages].reverse().find((m) => m.role === 'user')?.content;
}

function deriveSessionId(messages: AgentMessage[]): string {
  try {
    const keySource = messages
      .filter((message) => message.role !== 'system')
      .slice(0, 2)
      .map((message) => `${message.role}:${message.content}`)
      .join('|');
    if (keySource) {
      return createHash('sha1').update(keySource).digest('hex');
    }
  } catch {
    // ignore derivation errors and fall back to random id
  }
  return typeof randomUUID === 'function' ? randomUUID() : `session-${Date.now()}`;
}

export async function handleEnhancedChat(messages: AgentMessage[]): Promise<ChatResponse> {
  const sessionId = deriveSessionId(messages);
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
