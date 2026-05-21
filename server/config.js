'use strict';

const path = require('path');
const fs = require('fs');
const { randomBytes } = require('crypto');

const dataDir = path.resolve(__dirname, 'data');
const serverConfigFile = path.join(dataDir, 'server-config.json');

function loadServerConfig() {
  try {
    if (fs.existsSync(serverConfigFile)) {
      return JSON.parse(fs.readFileSync(serverConfigFile, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveServerConfig(cfg) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(serverConfigFile, JSON.stringify(cfg, null, 2));
}

let _serverCfg = loadServerConfig();

function getCookieSecret() {
  if (_serverCfg.cookieSecret) return _serverCfg.cookieSecret;
  const secret = randomBytes(32).toString('hex');
  _serverCfg.cookieSecret = secret;
  saveServerConfig(_serverCfg);
  return secret;
}

const PORT = parseInt(process.env.CCREMOTE_PORT || '8080', 10);
const HOST = process.env.CCREMOTE_HOST || '0.0.0.0';
const WEB_PASSWORD = process.env.CCREMOTE_WEB_PASSWORD || '';
const staticDir = path.resolve(__dirname, '../web/dist');
const agentnodesFile = path.join(dataDir, 'agentnodes.json');

module.exports = { PORT, HOST, WEB_PASSWORD, getCookieSecret, staticDir, agentnodesFile, dataDir };
