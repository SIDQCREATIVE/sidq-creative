'use strict';
// "Are all the files on the server from the same release?" and "does the database have everything this release needs?"
// release.json (made when the zip is built) lists a fingerprint for every code file. A file that does not match is a file that was not
// replaced when the new version was uploaded (an old copy), or one that was changed by hand.
// The check is shown at /version (anyone can open it, it holds no secrets), in Staff > Settings > Website health, and in the server log at start.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const diag = require('./diag');

const ROOT = path.join(__dirname, '..');
// Line endings and a byte order mark must not matter: a file uploaded from Windows is still the same file.
const fingerprint = text => crypto.createHash('sha256').update(String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n')).digest('hex');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cached = null;
function files() {
  if (cached) return cached;
  let man;
  try { man = JSON.parse(fs.readFileSync(path.join(ROOT, 'release.json'), 'utf8')); }
  catch (e) { return (cached = { release: '', ok: false, manifest: false, differ: [], missing: [] }); }
  const differ = [], missing = [];
  for (const [file, want] of Object.entries(man.files || {})) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (e) { missing.push(file); continue; }
    if (fingerprint(text) !== want) differ.push(file);
  }
  return (cached = { release: String(man.release || ''), ok: !differ.length && !missing.length, manifest: true, differ, missing });
}

// What this release adds to the database. migrate() creates all of it when the server starts, so something missing here means the
// copy of lib/schema.js on the server is an old one (or the database refused the change: see the server log).
const NEEDS = { accounts: ['code_at', 'checked_at'], submissions: ['read_failed_at'], api_usage: ['n'] };
async function schema(db) {
  const tables = Object.keys(NEEDS).map(t => `'${t}'`).join(', '); // fixed names from the list above, never user input
  const rows = (await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name IN (${tables})`)).rows;
  const have = new Set(rows.map(r => r.table_name + '.' + r.column_name));
  return Object.entries(NEEDS).flatMap(([t, cols]) => cols.filter(c => !have.has(t + '.' + c)).map(c => t + '.' + c));
}

let last = { at: 0, value: null };
async function status(db, fresh) {
  if (!fresh && last.value && Date.now() - last.at < 5000) return last.value; // /version is public: do not ask the database again for every visit
  const f = files();
  let missing = [], db_ok = true;
  try { missing = await schema(db); } catch (e) { db_ok = false; }
  const value = { release: f.release, files: { ok: f.ok, manifest: f.manifest, differ: f.differ, missing: f.missing }, database: { ok: db_ok && !missing.length, reachable: db_ok, missing } };
  last = { at: Date.now(), value };
  return value;
}

const sentence = s => {
  const f = s.files;
  if (!f.manifest) return { ok: false, text: 'The file release.json is missing, so the files cannot be checked. Upload every file from the zip, including server.js, package.json and release.json, then deploy again.' };
  if (f.ok) return { ok: true, text: 'All files are from this release.' };
  const list = [...f.differ, ...f.missing.map(x => x + ' (missing)')];
  return { ok: false, text: 'These files are not the same as in this release: ' + list.join(', ') + '. If you did not change them yourself, they are old copies. Upload them again from the latest zip and deploy again.' };
};

const page = s => {
  const a = sentence(s), d = s.database;
  const dbText = !d.reachable ? 'The database did not answer.' : d.ok ? 'Everything this release needs is in the database.' : 'Missing in the database: ' + d.missing.join(', ') + '. The file lib/schema.js on the server is probably an old copy.';
  const row = (ok, title, text) => `<div class="r ${ok ? 'y' : 'n'}"><b>${ok ? 'OK' : 'PROBLEM'}</b><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Version check | SIDQ Creative</title>
<style>body{margin:0;background:#0a0a0a;color:#f2f2f2;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}main{max-width:640px;margin:0 auto;padding:32px 16px}h1{font-size:24px;margin:0 0 4px}.mu{color:#9a9a9a;margin:0 0 24px}
.r{display:flex;gap:14px;align-items:flex-start;background:#141414;border:1px solid #262626;border-radius:12px;padding:16px;margin:0 0 12px}.r b{flex:none;min-width:84px;text-align:center;border-radius:8px;padding:4px 8px;font-size:13px}.y b{background:#b7e222;color:#0a0a0a}.n b{background:#ff5d5d;color:#0a0a0a}h2{font-size:16px;margin:0 0 4px}p{margin:0;word-break:break-word}</style></head>
<body><main><h1>Version check</h1><p class="mu">Release ${esc(s.release || 'unknown')}. This page shows no secrets.</p>
${row(a.ok, 'Files on the server', a.text)}${row(d.ok, 'Database', dbText)}</main></body></html>`;
};

const mounted = new WeakSet();
function mount(app, ctx) {
  if (mounted.has(app)) return;
  mounted.add(app);
  const send = h => (q, r) => status(ctx.db).then(s => h(s, r)).catch(e => { console.error(e); r.status(500).type('text').send('The check could not run.'); });
  // Always answers 200: a proxy in front of the site may replace an error status with its own page, and then the facts would be lost.
  app.get('/version', send((s, r) => { r.set('Cache-Control', 'no-store'); r.type('html'); r.send(page(s)); }));
  app.get('/version.json', send((s, r) => { r.set('Cache-Control', 'no-store'); r.json(s); }));
  const f = files(), a = sentence({ files: f });
  if (f.ok) console.log(`Release ${f.release}: all files match.`);
  else console.error('WARNING: ' + a.text + ' (see /version)');
}

// For Staff > Settings: the same facts plus the last errors the server had.
async function health(db) {
  const s = await status(db, true);
  return { release: s.release, files: s.files, text: sentence(s).text, database: s.database, errors: diag.recent().slice(0, 10) };
}

module.exports = { files, status, health, mount, fingerprint, sentence };
