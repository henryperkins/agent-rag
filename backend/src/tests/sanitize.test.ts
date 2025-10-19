import { describe, it, expect, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sanitizeInput } from '../middleware/sanitize.js';

describe('sanitizeInput middleware', () => {
  const createMockRequest = (body: any): FastifyRequest => ({
    body
  } as FastifyRequest);

  const createMockReply = () => {
    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis()
    };
    return reply as unknown as FastifyReply;
  };

  describe('role validation', () => {
    it('accepts valid roles: system, user, assistant', () => {
      const validRoles = ['system', 'user', 'assistant'];

      validRoles.forEach((role) => {
        const request = createMockRequest({
          messages: [{ role, content: 'test message' }]
        });
        const reply = createMockReply();
        const done = vi.fn();

        sanitizeInput(request, reply, done);

        expect(reply.code).not.toHaveBeenCalled();
        expect(reply.send).not.toHaveBeenCalled();
        expect(done).toHaveBeenCalledOnce();
      });
    });

    it('rejects invalid role string', () => {
      const request = createMockRequest({
        messages: [{ role: 'hacker', content: 'test' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Invalid message role. Must be "system", "user", or "assistant".'
      });
      expect(done).toHaveBeenCalledOnce();
    });

    it('rejects null role', () => {
      const request = createMockRequest({
        messages: [{ role: null, content: 'test' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Invalid message role. Must be "system", "user", or "assistant".'
      });
    });

    it('rejects undefined role', () => {
      const request = createMockRequest({
        messages: [{ role: undefined, content: 'test' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Invalid message role. Must be "system", "user", or "assistant".'
      });
    });

    it('rejects numeric role', () => {
      const request = createMockRequest({
        messages: [{ role: 123, content: 'test' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Invalid message role. Must be "system", "user", or "assistant".'
      });
    });

    it('rejects object role', () => {
      const request = createMockRequest({
        messages: [{ role: { nested: 'object' }, content: 'test' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Invalid message role. Must be "system", "user", or "assistant".'
      });
    });

    it('rejects empty string role', () => {
      const request = createMockRequest({
        messages: [{ role: '', content: 'test' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Invalid message role. Must be "system", "user", or "assistant".'
      });
    });
  });

  describe('content validation', () => {
    it('accepts valid string content', () => {
      const request = createMockRequest({
        messages: [{ role: 'user', content: 'valid message' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledOnce();
    });

    it('rejects non-string content', () => {
      const request = createMockRequest({
        messages: [{ role: 'user', content: 123 }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Message content must be a string.'
      });
    });

    it('rejects content exceeding max length', () => {
      const longContent = 'a'.repeat(10001); // MAX_MESSAGE_LENGTH is 10000
      const request = createMockRequest({
        messages: [{ role: 'user', content: longContent }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Message too long. Maximum 10000 characters.'
      });
    });
  });

  describe('HTML/script sanitization', () => {
    it('removes script tags from content', () => {
      const request = createMockRequest({
        messages: [{ role: 'user', content: 'Hello <script>alert("xss")</script> world' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect((request.body as any).messages[0].content).not.toContain('<script>');
      expect((request.body as any).messages[0].content).toContain('Hello');
      expect((request.body as any).messages[0].content).toContain('world');
    });

    it('removes HTML tags from content', () => {
      const request = createMockRequest({
        messages: [{ role: 'user', content: 'Hello <b>bold</b> <i>italic</i>' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect((request.body as any).messages[0].content).not.toContain('<b>');
      expect((request.body as any).messages[0].content).not.toContain('</b>');
      expect((request.body as any).messages[0].content).toContain('bold');
    });
  });

  describe('array validation', () => {
    it('rejects non-array messages', () => {
      const request = createMockRequest({
        messages: 'not an array'
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Messages must be an array.'
      });
    });

    it('rejects too many messages', () => {
      const messages = Array.from({ length: 51 }, (_, i) => ({
        role: 'user',
        content: `message ${i}`
      }));
      const request = createMockRequest({ messages });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).toHaveBeenCalledWith(400);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Too many messages. Maximum 50.'
      });
    });
  });

  describe('edge cases', () => {
    it('allows requests without messages field', () => {
      const request = createMockRequest({});
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect(reply.code).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledOnce();
    });

    it('preserves role after sanitization', () => {
      const request = createMockRequest({
        messages: [{ role: 'assistant', content: 'test' }]
      });
      const reply = createMockReply();
      const done = vi.fn();

      sanitizeInput(request, reply, done);

      expect((request.body as any).messages[0].role).toBe('assistant');
    });
  });
});
