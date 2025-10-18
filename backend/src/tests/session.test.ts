import { describe, it, expect } from 'vitest';
import { sanitizeUserField, deriveSessionId } from '../utils/session.js';

describe('sanitizeUserField', () => {
  it('should return the input as-is if it is within 64 characters', () => {
    const shortId = 'short-session-id';
    expect(sanitizeUserField(shortId)).toBe(shortId);
  });

  it('should return the input as-is if it is exactly 64 characters', () => {
    const exactId = 'a'.repeat(64);
    expect(sanitizeUserField(exactId)).toBe(exactId);
  });

  it('should hash IDs containing invalid characters', () => {
    const invalidId = 'user id with spaces';
    const result = sanitizeUserField(invalidId);

    expect(result).toHaveLength(64);
    expect(result).not.toBe(invalidId.trim());
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should hash long session IDs to fit the 64-character limit', () => {
    const longId = 'a'.repeat(100);
    const result = sanitizeUserField(longId);

    expect(result).toHaveLength(64);
    expect(result).not.toBe(longId);
    // SHA256 produces hex output (0-9, a-f)
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce consistent hashes for the same input', () => {
    const longId = 'very-long-session-id-that-exceeds-the-azure-openai-user-field-limit-of-64-characters';
    const result1 = sanitizeUserField(longId);
    const result2 = sanitizeUserField(longId);

    expect(result1).toBe(result2);
  });

  it('should produce different hashes for different inputs', () => {
    const longId1 = 'a'.repeat(100);
    const longId2 = 'b'.repeat(100);

    const result1 = sanitizeUserField(longId1);
    const result2 = sanitizeUserField(longId2);

    expect(result1).not.toBe(result2);
  });

  it('should handle empty strings by returning "anonymous"', () => {
    expect(sanitizeUserField('')).toBe('anonymous');
  });

  it('should trim whitespace before checking length', () => {
    const paddedId = '  short-id  ';
    expect(sanitizeUserField(paddedId)).toBe('short-id');
  });

  it('should return "anonymous" for whitespace-only strings', () => {
    expect(sanitizeUserField('   ')).toBe('anonymous');
  });

  it('should handle typical UUID format (36 chars)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(sanitizeUserField(uuid)).toBe(uuid);
  });

  it('should handle typical SHA1 hash format (40 chars)', () => {
    const sha1 = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
    expect(sanitizeUserField(sha1)).toBe(sha1);
  });
});

describe('deriveSessionId', () => {
  it('should derive consistent session IDs from messages', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there' }
    ];

    const id1 = deriveSessionId(messages);
    const id2 = deriveSessionId(messages);

    expect(id1).toBe(id2);
  });

  it('should derive different IDs for different messages', () => {
    const messages1 = [
      { role: 'user' as const, content: 'Hello' }
    ];
    const messages2 = [
      { role: 'user' as const, content: 'Goodbye' }
    ];

    const id1 = deriveSessionId(messages1);
    const id2 = deriveSessionId(messages2);

    expect(id1).not.toBe(id2);
  });

  it('should include fingerprint in derivation when provided', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' }
    ];

    const id1 = deriveSessionId(messages, 'fingerprint1');
    const id2 = deriveSessionId(messages, 'fingerprint2');

    expect(id1).not.toBe(id2);
  });

  it('should produce a valid session ID (40 chars for SHA1)', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' }
    ];

    const id = deriveSessionId(messages);

    expect(id).toHaveLength(40);
    expect(id).toMatch(/^[0-9a-f]{40}$/);
  });

  it('should fall back to UUID for empty messages', () => {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    const id = deriveSessionId(messages);

    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
