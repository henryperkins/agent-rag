import type { FastifyInstance } from 'fastify';
import type { AgentMessage } from '../../../shared/types.js';
import { handleEnhancedChat } from '../services/enhancedChatService.js';
import { setupStreamRoute } from './chatStream.js';
import { config, isDevelopment } from '../config/app.js';
import { getTelemetry as getOperationTelemetry, clearTelemetry as clearOperationTelemetry } from '../utils/resilience.js';
import { getSessionTelemetry, clearSessionTelemetry } from '../orchestrator/sessionTelemetryStore.js';
import { clearMemory } from '../orchestrator/memoryStore.js';

export async function registerRoutes(app: FastifyInstance) {
  app.get('/', async () => ({
    name: config.PROJECT_NAME,
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    endpoints: {
      health: '/health',
      chat: '/chat',
      chatStream: '/chat/stream',
      ...(isDevelopment ? { adminTelemetry: '/admin/telemetry' } : {})
    }
  }));

  app.get('/health', async () => ({
    status: 'healthy',
    timestamp: new Date().toISOString()
  }));

  app.post<{ Body: { messages: AgentMessage[]; sessionId?: string } }>('/chat', async (request, reply) => {
    const { messages, sessionId } = request.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ error: 'Messages array required.' });
    }

    try {
      const response = await handleEnhancedChat(messages, {
        sessionId,
        clientFingerprint: [request.ip, request.headers['user-agent']].filter(Boolean).join('|')
      });
      return response;
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Internal server error', message: error.message });
    }
  });

  await setupStreamRoute(app);

  if (isDevelopment) {
    app.get('/admin/telemetry', async () => ({
      operations: getOperationTelemetry(),
      sessions: getSessionTelemetry()
    }));
    app.post('/admin/telemetry/clear', async () => {
      clearOperationTelemetry();
      clearSessionTelemetry();
      clearMemory();
      return { status: 'cleared' };
    });
  }
}
