'use strict';

// Newline-delimited JSON. Binary PTY data is base64-encoded inside JSON fields.

function encode(obj) {
  return JSON.stringify(obj) + '\n';
}

class MessageParser {
  constructor(onMessage) {
    this._buf = '';
    this._onMessage = onMessage;
  }

  feed(data) {
    this._buf += data.toString();
    const lines = this._buf.split('\n');
    this._buf = lines.pop(); // retain incomplete trailing line
    for (const line of lines) {
      if (!line.trim()) continue;
      try { this._onMessage(JSON.parse(line)); } catch (_) {}
    }
  }
}

module.exports = { encode, MessageParser };
