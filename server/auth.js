'use strict';

const { timingSafeEqual } = require('crypto');
const { WEB_PASSWORD, getCookieSecret } = require('./config');

// In-memory rate limiter: IP -> { count, resetAt }
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateLimitMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

async function registerAuth(fastify) {
  await fastify.register(require('@fastify/cookie'), {
    secret: getCookieSecret(),
    hook: 'onRequest',
  });

  fastify.decorate('requireWebAuth', async function (request, reply) {
    const cookie = request.cookies['ccremote_session'];
    if (!cookie) return reply.status(401).send({ error: 'Unauthorized' });
    const unsigned = request.unsignCookie(cookie);
    if (!unsigned.valid || unsigned.value !== 'authenticated') {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
}

function issueSessionCookie(reply) {
  reply.setCookie('ccremote_session', 'authenticated', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
    signed: true,
    secure: process.env.NODE_ENV === 'production',
  });
}

function clearSessionCookie(reply) {
  reply.clearCookie('ccremote_session', { path: '/' });
}

function checkPassword(input) {
  if (!WEB_PASSWORD) return false;
  const a = Buffer.from(input || '');
  const b = Buffer.from(WEB_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

module.exports = { registerAuth, issueSessionCookie, clearSessionCookie, checkPassword, checkRateLimit };
