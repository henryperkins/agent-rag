import type { FastifyInstance } from 'fastify';
import type { ChatRequestPayload } from '../../../shared/types.js';
import { handleEnhancedChat } from '../services/enhancedChatService.js';
import { setupStreamRoute } from './chatStream.js';
import { setupResponsesRoutes } from './responses.js';
import { config, isDevelopment } from '../config/app.js';
import { getSessionTelemetry, clearSessionTelemetry, getSummaryAggregates, clearSummaryAggregates } from '../orchestrator/sessionTelemetryStore.js';
import { clearMemory } from '../orchestrator/memoryStore.js';
import { setupDocumentRoutes } from './documents.js';
import { setupSessionRoutes } from './sessions.js';
import { getServiceStats, getIndexStats, getIndexStatsSummary } from '../azure/searchStats.js';

export async function registerRoutes(app: FastifyInstance) {
  app.get('/', async () => ({
    name: config.PROJECT_NAME,
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    endpoints: {
      health: '/health',
      chat: '/chat',
      chatStream: '/chat/stream',
      responses: '/responses/:id',
      responseInputItems: '/responses/:id/input_items',
      documentUpload: config.ENABLE_DOCUMENT_UPLOAD ? '/documents/upload' : undefined,
      session: '/sessions/:id',
      ...(isDevelopment ? { adminTelemetry: '/admin/telemetry' } : {})
    }
  }));

  app.get('/health', async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString()
  }));

  app.post<{ Body: ChatRequestPayload }>('/chat', async (request, reply) => {
    const { messages, sessionId, feature_overrides } = request.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array required.' });
    }

    try {
      const response = await handleEnhancedChat(messages, {
        sessionId,
        clientFingerprint: [request.ip, request.headers['user-agent']].filter(Boolean).join('|'),
        featureOverrides: feature_overrides
      });
      return response;
    } catch (error: any) {
      request.log.error(error);
      // Sanitize error message to prevent information disclosure
      const sanitizedMessage = isDevelopment ? error.message : 'An unexpected error occurred';
      return reply.code(500).send({ error: 'Internal server error', message: sanitizedMessage });
    }
  });

  await setupStreamRoute(app);
  await setupResponsesRoutes(app);
  await setupSessionRoutes(app);
  if (config.ENABLE_DOCUMENT_UPLOAD) {
    await setupDocumentRoutes(app);
  }

  if (isDevelopment) {
    app.get('/admin/telemetry', async () => {
      let searchStats: any = null;
      try {
        const [service, index, summary] = await Promise.all([
          getServiceStats(),
          getIndexStats(),
          getIndexStatsSummary()
        ]);
        searchStats = { service, index, summary };
      } catch (err: any) {
        searchStats = { error: err?.message ?? 'Failed to fetch search stats' };
      }

      return {
        sessions: getSessionTelemetry(),
        summaryAggregates: getSummaryAggregates(),
        searchStats
      };
    });
    app.get('/admin/telemetry/summary-aggregates', async () => getSummaryAggregates());
    app.post('/admin/telemetry/clear', async () => {
      clearSessionTelemetry();
      clearSummaryAggregates();
      clearMemory();
      return { status: 'cleared' };
    });
  }
}
