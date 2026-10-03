import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../security/auth.js';
import { orchestrate } from '../agent/orchestrator.js';
import { createSSEStream } from '../streaming/sse.js';

const chatBodySchema = z.object({
  sessionId: z.string().max(64),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000)
  })).max(20),
  pageContext: z.object({
    url: z.string(),
    title: z.string(),
    text: z.string(),
    truncated: z.boolean()
  }).nullable().optional(),
  client: z.object({
    locale: z.string(),
    version: z.string()
  })
});

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/chat', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.split(' ')[1];
    if (!authenticate(token)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const parsed = chatBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.format() });
    }

    const sse = createSSEStream(reply.raw);

    try {
      await orchestrate(parsed.data, sse);
    } catch (err: any) {
      request.log.error(err);
      sse.send('error', { code: 'INTERNAL_ERROR', message: err.message });
    } finally {
      sse.close();
    }
  });
}
