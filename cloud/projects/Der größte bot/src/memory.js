const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECTION_RE = /^##\s+(.+?)\s*$/;

function hash(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

function parse(md) {
  const out = { _raw: md, header: '', intro: '', sections: {} };
  let current = null;
  let buf = [];
  let headerLine = '';
  const introBuf = [];
  for (const line of md.split('\n')) {
    if (!headerLine && /^#\s/.test(line)) { headerLine = line; continue; }
    const m = line.match(SECTION_RE);
    if (m) {
      if (current) out.sections[current] = buf.join('\n').trim();
      current = m[1];
      buf = [];
    } else if (current) {
      buf.push(line);
    } else {
      introBuf.push(line);
    }
  }
  if (current) out.sections[current] = buf.join('\n').trim();
  out.header = headerLine;
  out.intro  = introBuf.join('\n').trim();
  return out;
}

function render(parsed, fallbackHeader) {
  const header = parsed.header || fallbackHeader;
  const lines = [header.trim(), ''];
  if (parsed.intro) lines.push(parsed.intro, '');
  for (const name of Object.keys(parsed.sections)) {
    lines.push(`## ${name}`, '', parsed.sections[name].trim(), '');
  }
  return lines.join('\n');
}

function parseYamlBlock(text) {
  const m = text.match(/```ya?ml\s*\n([\s\S]*?)```/);
  if (!m) return null;
  const obj = {};
  let currentKey = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      obj[currentKey] = kv[2] === '' ? {} : tryParse(kv[2]);
    } else if (currentKey && line.match(/^\s+(\w[\w-]*):\s*(.*)$/)) {
      const sub = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
      if (typeof obj[currentKey] !== 'object') obj[currentKey] = {};
      obj[currentKey][sub[1]] = tryParse(sub[2]);
    }
  }
  return obj;
}

function tryParse(v) {
  if (v === '' || v === undefined) return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\[.*\]$/.test(v)) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

function renderValue(v) {
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}

function renderYamlBlock(obj) {
  const lines = ['```yaml'];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const [sk, sv] of Object.entries(v)) lines.push(`  ${sk}: ${renderValue(sv)}`);
    } else {
      lines.push(`${k}: ${renderValue(v)}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}

class Memory {
  constructor(file) {
    this.file = file;
    this.lastHash = null;
    this.parsed = null;
  }

  load() {
    const md = fs.readFileSync(this.file, 'utf8');
    this.lastHash = hash(md);
    this.parsed = parse(md);
    return this.parsed;
  }

  externallyChanged() {
    if (!fs.existsSync(this.file)) return false;
    const md = fs.readFileSync(this.file, 'utf8');
    return hash(md) !== this.lastHash;
  }

  setSection(name, content) {
    if (!this.parsed) this.load();
    this.parsed.sections[name] = content.trim();
  }

  getSection(name) {
    if (!this.parsed) this.load();
    return this.parsed.sections[name] || '';
  }

  setStrategyStats(stats) {
    this.setSection('Strategy Stats', renderYamlBlock(stats));
  }

  getStrategyStats() {
    return parseYamlBlock(this.getSection('Strategy Stats')) || {};
  }

  flush(header = '# Der größte bot — Brain') {
    if (!this.parsed) this.load();
    const out = render(this.parsed, header);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, this.file);
    this.lastHash = hash(out);
  }
}

module.exports = { Memory, parse, render, parseYamlBlock, renderYamlBlock };
