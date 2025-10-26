import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config, isDevelopment } from './config/app.js';
import { allowedOrigins as normalizedAllowedOrigins, isOriginAllowed } from './config/cors.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { registerRoutes } from './routes/index.js';

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    transport: isDevelopment
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      : undefined
  }
});

const allowedOriginsSet = new Set(normalizedAllowedOrigins);
const allowedOriginsList = Array.from(allowedOriginsSet);

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) {
      cb(null, true);
      return;
    }
    if (isOriginAllowed(origin)) {
      cb(null, true);
      return;
    }
    const normalizedOrigin = origin.toLowerCase();
    app.log.warn({ origin, normalizedOrigin, allowedOrigins: allowedOriginsList }, 'CORS origin rejected');
    cb(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true
});

await app.register(rateLimit, {
  max: config.RATE_LIMIT_MAX_REQUESTS,
  timeWindow: config.RATE_LIMIT_WINDOW_MS,
  errorResponseBuilder: () => ({
    error: 'Too many requests',
    message: 'Please try again later.'
  })
});

app.addHook('preHandler', sanitizeInput);

app.addHook('onRequest', async (request, reply) => {
  // Skip timeout for SSE streaming endpoints to prevent premature connection closure
  if (request.method === 'POST' && request.url === '/chat/stream') {
    return;
  }

  const timer = setTimeout(() => {
    if (!reply.sent) {
      reply.code(408).send({ error: 'Request timeout' });
    }
  }, config.REQUEST_TIMEOUT_MS);

  reply.raw.on('close', () => clearTimeout(timer));
  reply.raw.on('finish', () => clearTimeout(timer));
});

await registerRoutes(app);

const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down gracefully.`);
    await app.close();
    process.exit(0);
  });
});

try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`🚀 Backend running on http://localhost:${config.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
