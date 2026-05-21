'use strict';

const { issueSessionCookie, clearSessionCookie, checkPassword, checkRateLimit } = require('../auth');

async function authRoutes(fastify) {
  fastify.post('/api/login', async (request, reply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip)) {
      return reply.status(429).send({ error: 'Too many attempts. Try again in 10 minutes.' });
    }
    const { password } = request.body || {};
    if (!checkPassword(password)) {
      return reply.status(401).send({ error: 'Invalid password' });
    }
    issueSessionCookie(reply);
    return { ok: true };
  });

  fastify.post('/api/logout', async (request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  fastify.get('/api/me', {
    preHandler: fastify.requireWebAuth,
  }, async () => ({ ok: true }));
}

module.exports = authRoutes;
