'use strict';
// What went wrong, told to the owner only.
// Everyone sees "Something went wrong on our side". When the person asking is the owner, the answer also carries the real reason and the
// place in the code, and the last errors are listed in Staff > Settings > Website health. Secrets are always removed first.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const recent = [];

const SECRET_NAME = /KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL|WEBHOOK|DSN/i;
// Removes anything that looks like a secret: the value of every secret variable, keys in addresses, bearer tokens and passwords in database addresses.
function clean(text) {
  let s = String(text == null ? '' : text);
  for (const [name, value] of Object.entries(process.env)) if (value && value.length >= 6 && SECRET_NAME.test(name)) s = s.split(value).join('[hidden]');
  return s.split(ROOT).join('.')
    .replace(/([?&](?:key|api_key|apikey|access_token|refresh_token|client_secret|token|code|state)=)[^&\s"')]+/gi, '$1[hidden]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^"'&\s,;)}]+/gi, '$1$2[hidden]')
    .replace(/(Bearer\s+)[\w.~+\/=-]+/gi, '$1[hidden]')
    .replace(/(postgres(?:ql)?:\/\/)[^\s@]*@/gi, '$1[hidden]@');
}
const frame = e => {
  const line = e && e.stack && String(e.stack).split('\n').slice(1).find(l => l.includes(ROOT) && !l.includes('node_modules'));
  return line ? clean(line.trim().replace(/^at /, '')) : '';
};
const describe = e => clean(`${(e && e.name) || 'Error'}: ${(e && e.message) || e}`).slice(0, 300);

// Remembers an error (the last 30) and returns it.
function note(req, e) {
  const entry = { at: new Date().toISOString(), method: (req && req.method) || '', path: clean(String((req && (req.originalUrl || req.url)) || '').split('?')[0]).slice(0, 120), message: describe(e), where: frame(e) };
  recent.unshift(entry);
  if (recent.length > 30) recent.length = 30;
  return entry;
}
// The page was asked by the owner (a Discord login with the owner role, or the old admin password).
const isOwner = req => !!(req && ((req.actor && req.actor.role === 'owner') || (req.user && req.user.role === 'owner')));

// The reply for an unexpected error: the friendly sentence for everyone, plus the real reason for the owner.
function reply(res, req, e, text) {
  console.error(e);
  const entry = note(req || res.req, e), body = { error: text };
  if (isOwner(req || res.req)) body.detail = entry.message + (entry.where ? ' at ' + entry.where : '') + (entry.path ? ` (${entry.method} ${entry.path})` : '');
  if (!res.headersSent) res.status(500).json(body);
}

module.exports = { note, reply, clean, isOwner, recent: () => recent.slice() };
