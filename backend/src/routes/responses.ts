import type { FastifyInstance } from 'fastify';
import { deleteResponse, listInputItems, retrieveResponse } from '../azure/openaiClient.js';

export async function setupResponsesRoutes(app: FastifyInstance) {
  // GET /responses/:id?include[]=... to retrieve a stored response
  app.get<{ Params: { id: string }; Querystring: { include?: string | string[] } }>(
    '/responses/:id',
    async (request, reply) => {
      const { id } = request.params;
      const includeRaw = request.query.include;
      const include = Array.isArray(includeRaw)
        ? includeRaw
        : typeof includeRaw === 'string'
        ? [includeRaw]
        : undefined;

      try {
        const res = await retrieveResponse(id, include);
        return res;
      } catch (error: any) {
        request.log.error(error);
        return reply.code(500).send({ error: 'Failed to retrieve response', message: error.message });
      }
    }
  );

  // DELETE /responses/:id to remove stored output
  app.delete<{ Params: { id: string } }>('/responses/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await deleteResponse(id);
      return res;
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to delete response', message: error.message });
    }
  });

  // GET /responses/:id/input_items to list canonical input items
  app.get<{ Params: { id: string } }>('/responses/:id/input_items', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await listInputItems(id);
      return res;
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to list input items', message: error.message });
    }
  });
}

