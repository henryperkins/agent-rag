import { createHash, randomUUID } from 'node:crypto';
import type { AgentMessage, ChatResponse } from '../../../shared/types.js';
import { runSession } from '../orchestrator/index.js';
import { createSessionRecorder } from '../orchestrator/sessionTelemetryStore.js';

function latestUserQuestion(messages: AgentMessage[]) {
  return [...messages].reverse().find((m) => m.role === 'user')?.content;
}

interface ChatOptions {
  sessionId?: string;
  clientFingerprint?: string;
}

function deriveSessionId(messages: AgentMessage[], fingerprint?: string): string {
  try {
    const keySource = messages
      .filter((message) => message.role !== 'system')
      .slice(0, 2)
      .map((message) => `${message.role}:${message.content}`)
      .join('|');

    if (!keySource) {
      throw new Error('Unable to derive session key');
    }

    const hash = createHash('sha1');
    hash.update(keySource);
    if (fingerprint) {
      hash.update('|');
      hash.update(fingerprint);
    }
    return hash.digest('hex');
  } catch {
    // ignore derivation errors and fall back to random id
  }
  return typeof randomUUID === 'function' ? randomUUID() : `session-${Date.now()}`;
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
