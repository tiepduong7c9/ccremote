'use strict';

const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('./constants');

const CONFIG_FILE = path.join(STATE_DIR, 'config.json');

function load() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function save(cfg) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function update(patch) {
  const cfg = load();
  save({ ...cfg, ...patch });
}

module.exports = { load, save, update, CONFIG_FILE };
