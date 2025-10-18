import { createHash, randomUUID } from 'node:crypto';
import type { AgentMessage } from '../../../shared/types.js';

const SAFE_AZURE_USER_FIELD = /^[A-Za-z0-9_-]+$/;

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

/**
 * Sanitizes a session ID for use in the Azure OpenAI 'user' field.
 * The 'user' field must be at most 64 characters and is used for abuse monitoring.
 *
 * @param sessionId - The raw session ID (may be any length)
 * @returns A sanitized string suitable for the Azure OpenAI 'user' field (max 64 chars)
 *
 * @example
 * sanitizeUserField('short-id') // returns 'short-id'
 * sanitizeUserField('a'.repeat(100)) // returns SHA256 hash (64 chars)
 */
export function sanitizeUserField(sessionId: string): string {
  // Trim whitespace
  const trimmed = sessionId.trim();

  // If empty, return a safe default
  if (!trimmed) {
    return 'anonymous';
  }

  // If within limit and using an allowed character set, return as-is
  if (trimmed.length <= 64 && SAFE_AZURE_USER_FIELD.test(trimmed)) {
    return trimmed;
  }

  // For long or invalid IDs, hash to maintain uniqueness while fitting the
  // 64-character limit and allowed charset. SHA256 produces 64 hex characters.
  const hash = createHash('sha256');
  hash.update(trimmed);
  return hash.digest('hex');
}
