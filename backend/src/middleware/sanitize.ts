import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

const HTML_TAG_REGEX = /<[^>]*>/g;
const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_MESSAGES = 50;

export function sanitizeInput(request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) {
  const body = request.body as any;

  if (body?.messages) {
    if (!Array.isArray(body.messages)) {
      reply.code(400).send({ error: 'Messages must be an array.' });
      return;
    }

    if (body.messages.length > MAX_MESSAGES) {
      reply.code(400).send({ error: `Too many messages. Maximum ${MAX_MESSAGES}.` });
      return;
    }

    const sanitized: any[] = [];
    for (const msg of body.messages) {
      if (typeof msg.content !== 'string') {
        reply.code(400).send({ error: 'Message content must be a string.' });
        return;
      }

      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        reply.code(400).send({ error: `Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.` });
        return;
      }

      let content = msg.content.replace(SCRIPT_REGEX, '');
      content = content.replace(HTML_TAG_REGEX, '');
      content = content.replace(/\s+/g, ' ').trim();

      sanitized.push({
        role: msg.role,
        content
      });
    }

    body.messages = sanitized;
  }

  done();
}
