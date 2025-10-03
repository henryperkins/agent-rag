import type { FastifyInstance } from 'fastify';
import type { AgentMessage } from '../../../shared/types.js';
import { handleChatStream } from '../services/chatStreamService.js';

export async function setupStreamRoute(app: FastifyInstance) {
  app.post<{ Body: { messages: AgentMessage[]; sessionId?: string } }>('/chat/stream', async (request, reply) => {
    const { messages, sessionId } = request.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array required.' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Transfer-Encoding': 'chunked'
    });

    const sendEvent = (event: string, data: any) => {
      reply.raw.write(`event: ${event}\n`);
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await handleChatStream(messages, sendEvent, {
        sessionId,
        clientFingerprint: [request.ip, request.headers['user-agent']].filter(Boolean).join('|')
      });
    } catch (error: any) {
      sendEvent('error', { message: error.message });
    } finally {
      reply.raw.end();
    }
  });
}
