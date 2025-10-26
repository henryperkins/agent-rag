import type { FastifyInstance } from 'fastify';
import type { ChatRequestPayload } from '../../../shared/types.js';
import { handleChatStream } from '../services/chatStreamService.js';
import { resolveAllowedOrigin } from '../config/cors.js';

export async function setupStreamRoute(app: FastifyInstance) {
  app.post<{ Body: ChatRequestPayload }>('/chat/stream', async (request, reply) => {
    const { messages, sessionId, feature_overrides } = request.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array required.' });
    }

    reply.status(200);
    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');
    reply.header('Transfer-Encoding', 'chunked');

    const allowedOrigin = resolveAllowedOrigin(request.headers.origin);
    if (allowedOrigin) {
      reply.header('Access-Control-Allow-Origin', allowedOrigin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Vary', 'Origin');
    }

    if (typeof reply.raw.flushHeaders === 'function') {
      reply.raw.flushHeaders();
    } else {
      reply.raw.writeHead(200);
    }

    const sendEvent = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await handleChatStream(messages, sendEvent, {
        sessionId,
        clientFingerprint: [request.ip, request.headers['user-agent']].filter(Boolean).join('|'),
        featureOverrides: feature_overrides
      });
    } catch (error: any) {
      sendEvent('error', { message: error.message });
    } finally {
      reply.raw.end();
    }
  });
}
