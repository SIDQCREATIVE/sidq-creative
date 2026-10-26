'use strict';
// Small helpers shared by the staff routes: friendly errors, paging, safe LIKE patterns.
module.exports = function makeHttp(core) {
  const { HttpError, int } = core;
  const sendError = (r, e) => {
    if (e instanceof HttpError) return r.status(e.status).json({ error: e.message });
    if (e && e.status === 413) return r.status(413).json({ error: 'That is too large.' });
    if (e && e.status === 400 && /JSON/i.test(String(e.message))) return r.status(400).json({ error: 'The request was not valid.' });
    console.error(e);
    r.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  };
  // Wraps an async route so every error becomes a clean JSON reply.
  const h = fn => (q, r, n) => Promise.resolve().then(() => fn(q, r, n)).catch(e => sendError(r, e));
  const paging = (q, per = 25) => { const page = int(q.query.page, 1, 1, 100000); return { page, per, offset: (page - 1) * per }; };
  const like = s => '%' + String(s).replace(/[\\%_]/g, '\\$&') + '%';
  const isSunday = () => new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Karachi' }) === 'Sunday';
  // Spreadsheets run text that starts with = + - @ as a formula. Names typed by clippers must never do that.
  const csvCell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return { sendError, h, paging, like, isSunday, csvCell };
};
