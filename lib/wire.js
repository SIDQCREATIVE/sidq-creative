'use strict';
// The pages and the background jobs need two helpers that server.js builds: the optional TikTok and Instagram data service, and the
// automatic account check. If an OLDER server.js is still on the server next to these newer files, it does not build them, and every page
// that touches them failed with "Something went wrong on our side".
// parts(ctx) hands back what server.js gave us, or builds the same helper once per database, so the website works either way.
// safe() keeps an optional part of a page (a status line, a usage counter) from taking the whole page down.
const makeService = require('./dataservice');
const makeAutoVerify = require('./autoverify');

const built = new WeakMap(); // one set of helpers per database connection, shared by the pages and the jobs
function parts(ctx) {
  let b = built.get(ctx.db);
  if (!b) built.set(ctx.db, b = {});
  if (!ctx.service && !b.service) b.service = makeService({ db: ctx.db, core: ctx.core });
  const service = ctx.service || b.service;
  if (!ctx.autoverify && !b.autoverify) b.autoverify = makeAutoVerify({ db: ctx.db, core: ctx.core, service });
  return { service, autoverify: ctx.autoverify || b.autoverify };
}

const lastLog = new Map(); // one log line per minute for each part, so a broken part cannot flood the logs
function skipped(label, e) {
  const now = Date.now();
  if (now - (lastLog.get(label) || 0) < 60e3) return;
  lastLog.set(label, now);
  console.error(`[${label}] could not be read, the page loads without it:`, e && e.message ? e.message : e);
}
const safe = (label, fn, fallback) => { try { return fn(); } catch (e) { skipped(label, e); return fallback; } };
const safeAsync = async (label, fn, fallback) => { try { return await fn(); } catch (e) { skipped(label, e); return fallback; } };

module.exports = parts;
module.exports.safe = safe;
module.exports.safeAsync = safeAsync;
