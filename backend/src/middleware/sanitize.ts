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

    body.messages = body.messages.map((msg: any) => {
      if (typeof msg.content !== 'string') {
        throw new Error('Message content must be a string.');
      }

      if (msg.content.length > MAX_MESSAGE_LENGTH) {
        throw new Error(`Message too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`);
      }

      let sanitized = msg.content.replace(SCRIPT_REGEX, '');
      sanitized = sanitized.replace(HTML_TAG_REGEX, '');
      sanitized = sanitized.replace(/\s+/g, ' ').trim();

      return {
        role: msg.role,
        content: sanitized
      };
    });
  }

  done();
}
