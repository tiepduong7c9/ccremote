'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { nanoid } = require('nanoid');
const { agentnodesFile, dataDir } = require('./config');

class AgentnodeStore {
  constructor() {
    this._byId = new Map();
    this._byToken = new Map();
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(agentnodesFile)) return;
      const records = JSON.parse(fs.readFileSync(agentnodesFile, 'utf8'));
      for (const r of records) {
        this._byId.set(r.id, r);
        this._byToken.set(r.token, r);
      }
    } catch (_) {}
  }

  _save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = agentnodesFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...this._byId.values()], null, 2));
    fs.renameSync(tmp, agentnodesFile);
  }

  create({ name }) {
    const id = nanoid(12);
    const token = 'ant_' + randomBytes(24).toString('base64url');
    const record = { id, token, name: name || id, createdAt: new Date().toISOString() };
    this._byId.set(id, record);
    this._byToken.set(token, record);
    this._save();
    return { ...record };
  }

  findByToken(token) {
    return this._byToken.get(token) || null;
  }

  findById(id) {
    return this._byId.get(id) || null;
  }

  list() {
    return [...this._byId.values()].map(({ token: _t, ...rest }) => rest);
  }

  rename(id, name) {
    const r = this._byId.get(id);
    if (!r) return null;
    r.name = name;
    this._save();
    return { id: r.id, name: r.name };
  }

  remove(id) {
    const r = this._byId.get(id);
    if (!r) return false;
    this._byId.delete(id);
    this._byToken.delete(r.token);
    this._save();
    return true;
  }
}

module.exports = AgentnodeStore;
