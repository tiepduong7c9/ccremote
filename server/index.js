'use strict';

const path = require('path');
const fs = require('fs');
const Fastify = require('fastify');
const { PORT, HOST, staticDir } = require('./config');
const { registerAuth } = require('./auth');
const AgentnodeStore = require('./store');
const SkillStore = require('./skill-store');
const AgentnodeHub = require('./agentnode-hub');
const BrowserHub = require('./browser-hub');

async function start() {
  const fastify = Fastify({ logger: false });

  await fastify.register(require('@fastify/formbody'));
  await fastify.register(require('@fastify/websocket'));

  // Auth (registers @fastify/cookie + requireWebAuth decorator)
  await registerAuth(fastify);

  const store = new AgentnodeStore();
  const skillStore = new SkillStore();
  const agentnodeHub = new AgentnodeHub();
  const browserHub = new BrowserHub(agentnodeHub, skillStore);

  // HTTP routes
  await fastify.register(require('./routes/auth'));
  await fastify.register(require('./routes/agentnodes'), { store, agentnodeHub });
  await fastify.register(require('./routes/skills'), { skillStore });

  // WS routes
  await fastify.register(require('./ws/agentnode-ws'), { store, agentnodeHub });
  await fastify.register(require('./ws/browser-ws'), { agentnodeHub, browserHub });

  // Serve frontend if built
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    await fastify.register(require('@fastify/static'), {
      root: staticDir,
      prefix: '/',
      wildcard: false,
    });
    // SPA fallback for non-api, non-ws paths
    fastify.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith('/api') && !request.url.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      reply.status(404).send({ error: 'Not found' });
    });
  }

  await fastify.listen({ port: PORT, host: HOST });
  process.stderr.write(`ccremote server listening on http://${HOST}:${PORT}\n`);
}

start().catch(err => {
  process.stderr.write(`Failed to start server: ${err.message}\n`);
  process.exit(1);
});
