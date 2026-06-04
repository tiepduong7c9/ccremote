'use strict';

async function skillRoutes(fastify, { skillStore }) {
  fastify.addHook('preHandler', fastify.requireWebAuth);

  fastify.get('/api/skills', async () => {
    return skillStore.list();
  });

  fastify.post('/api/skills', async (request, reply) => {
    const { name, description, content } = request.body || {};
    const record = skillStore.create({ name, description, content });
    reply.status(201);
    return record;
  });

  fastify.patch('/api/skills/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, description, content } = request.body || {};
    const result = skillStore.update(id, { name, description, content });
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return result;
  });

  fastify.delete('/api/skills/:id', async (request, reply) => {
    const { id } = request.params;
    const ok = skillStore.remove(id);
    if (!ok) return reply.status(404).send({ error: 'Not found' });
    return { ok: true };
  });
}

module.exports = skillRoutes;
