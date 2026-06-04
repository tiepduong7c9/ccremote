'use strict';

const fs = require('fs');
const { nanoid } = require('nanoid');
const { skillsFile, dataDir } = require('./config');

class SkillStore {
  constructor() {
    this._byId = new Map();
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(skillsFile)) return;
      const records = JSON.parse(fs.readFileSync(skillsFile, 'utf8'));
      for (const r of records) this._byId.set(r.id, r);
    } catch (_) {}
  }

  _save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = skillsFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...this._byId.values()], null, 2));
    fs.renameSync(tmp, skillsFile);
  }

  create({ name, description, content }) {
    const id = nanoid(8);
    const now = new Date().toISOString();
    const record = {
      id,
      name: name || id,
      description: description || '',
      content: content || '',
      createdAt: now,
      updatedAt: now,
    };
    this._byId.set(id, record);
    this._save();
    return { ...record };
  }

  list() {
    return [...this._byId.values()];
  }

  findById(id) {
    return this._byId.get(id) || null;
  }

  update(id, { name, description, content }) {
    const r = this._byId.get(id);
    if (!r) return null;
    if (name !== undefined) r.name = name;
    if (description !== undefined) r.description = description;
    if (content !== undefined) r.content = content;
    r.updatedAt = new Date().toISOString();
    this._save();
    return { ...r };
  }

  remove(id) {
    if (!this._byId.has(id)) return false;
    this._byId.delete(id);
    this._save();
    return true;
  }
}

module.exports = SkillStore;
