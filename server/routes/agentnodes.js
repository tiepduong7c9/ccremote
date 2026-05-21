'use strict';

async function agentnodeRoutes(fastify, { store, agentnodeHub }) {
  fastify.addHook('preHandler', fastify.requireWebAuth);

  fastify.get('/api/agentnodes', async () => {
    const records = store.list();
    return records.map(r => ({
      ...r,
      online: agentnodeHub.online.has(r.id),
      sessions: agentnodeHub.online.get(r.id)?.sessions || [],
    }));
  });

  fastify.post('/api/agentnodes', async (request, reply) => {
    const { name } = request.body || {};
    const record = store.create({ name });
    reply.status(201);
    return record; // token included — only time it's sent to browser
  });

  fastify.patch('/api/agentnodes/:id', async (request, reply) => {
    const { id } = request.params;
    const { name } = request.body || {};
    const result = store.rename(id, name);
    if (!result) return reply.status(404).send({ error: 'Not found' });
    return result;
  });

  fastify.delete('/api/agentnodes/:id', async (request, reply) => {
    const { id } = request.params;
    const entry = agentnodeHub.online.get(id);
    if (entry) {
      try { entry.ws.close(1008, 'Revoked'); } catch (_) {}
      agentnodeHub.unregister(id);
    }
    const ok = store.remove(id);
    if (!ok) return reply.status(404).send({ error: 'Not found' });
    return { ok: true };
  });
}

module.exports = agentnodeRoutes;
