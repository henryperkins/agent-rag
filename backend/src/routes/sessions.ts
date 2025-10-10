import type { FastifyInstance } from 'fastify';
import type { FastifySchema } from 'fastify/types/schema';
import { sessionStore } from '../services/sessionStore.js';

interface SessionParams {
  id: string;
}

const sessionSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 }
    }
  },
  querystring: {
    type: 'object',
    properties: {
      includeMemory: { type: 'boolean', default: true }
    }
  }
};

export async function setupSessionRoutes(app: FastifyInstance) {
  app.get<{ Params: SessionParams; Querystring: { includeMemory?: boolean } }>(
    '/sessions/:id',
    { schema: sessionSchema },
    async (request, reply) => {
      const sessionId = request.params.id.trim();
      if (!sessionId) {
        return reply.code(400).send({ error: 'Session id required' });
      }

      const transcript = sessionStore.loadTranscript(sessionId);
      if (!transcript) {
        return reply.code(404).send({ error: 'Session not found' });
      }

      const includeMemory = request.query.includeMemory ?? true;
      const memory = includeMemory ? sessionStore.loadMemory(sessionId) : null;

      return {
        sessionId: transcript.sessionId,
        messages: transcript.messages,
        updatedAt: transcript.updatedAt,
        memory: memory
          ? {
              summary: memory.summaryBullets,
              salience: memory.salience,
              turn: memory.turn,
              updatedAt: memory.updatedAt
            }
          : null
      };
    }
  );
}
