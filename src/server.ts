import fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { logger } from './observability/logger.js';
import { chatRoutes } from './routes/chat.js';
import { checkProviders } from './providers/model-client.js';

const app = fastify({ loggerInstance: logger });

app.register(cors, {
  origin: config.ALLOWED_ORIGIN ? [config.ALLOWED_ORIGIN] : false,
  methods: ['POST', 'GET']
});

app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute'
});

app.get('/healthz', async (request, reply) => {
  return { status: 'ok' };
});

app.get('/readyz', async (request, reply) => {
  const ready = await checkProviders();
  if (!ready) {
    return reply.status(503).send({ status: 'unavailable' });
  }
  return { status: 'ok' };
});

app.register(chatRoutes, { prefix: '/v1' });

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    logger.info(`Server listening on ${config.HOST}:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
