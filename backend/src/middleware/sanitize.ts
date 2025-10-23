import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

const HTML_TAG_REGEX = /<[^>]*>/g;
const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_MESSAGES = 50;
const VALID_ROLES = new Set(['system', 'user', 'assistant']);

export function sanitizeInput(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
  const body = request.body as any;

  if (body?.messages) {
    if (!Array.isArray(body.messages)) {
      reply.code(400).send({ error: 'Messages must be an array.' });
      return done();
    }

    if (body.messages.length > MAX_MESSAGES) {
      reply.code(400).send({ error: `Too many messages. Maximum ${MAX_MESSAGES}.` });
      return done();
    }

    const sanitized: any[] = [];
    for (const msg of body.messages) {
      // Validate role field
      if (!msg.role || typeof msg.role !== 'string' || !VALID_ROLES.has(msg.role)) {
        reply.code(400).send({ error: 'Invalid message role. Must be "system", "user", or "assistant".' });
        return done();
      }

      if (typeof msg.content !== 'string') {
        reply.code(400).send({ error: 'Message content must be a string.' });
        return done();
      }

      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        reply.code(400).send({ error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` });
        return done();
      }

      let content = msg.content.replace(SCRIPT_REGEX, '');
      content = content.replace(/<\/?(code|pre)>/gi, '`');
      content = content.replace(HTML_TAG_REGEX, '');
      content = content.replace(/\r\n?/g, '\n');
      content = content.replace(/\u00a0/g, ' ');
      const lines = content.split('\n').map((line) => line.replace(/\s+$/g, ''));
      content = lines.join('\n');
      content = content.replace(/\n{3,}/g, '\n\n').trim();

      sanitized.push({
        role: msg.role,
        content
      });
    }

    body.messages = sanitized;
  }

  done();
}
