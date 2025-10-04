import { createHash, randomUUID } from 'node:crypto';
import type { AgentMessage } from '../../../shared/types.js';

export function latestUserQuestion(messages: AgentMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content;
}

export function deriveSessionId(messages: AgentMessage[], fingerprint?: string): string {
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

  return randomUUID();
}
