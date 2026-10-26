/* SIDQ portal toolkit. Shared by the clipper portal and the staff panel; everything is exposed as window.SQ.
   No libraries. Text that comes from people or the database always goes through h`...` (escapes by default). */
const SQ = window.SQ = {};

/* ---------- text and templates ---------- */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = s => new Raw(s == null ? '' : String(s));
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ENT[c]);
const part = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : (v == null || v === false || v === true) ? '' : esc(v);
const h = (s, ...v) => { let o = s[0]; for (let i = 0; i < v.length; i++) o += part(v[i]) + s[i + 1]; return new Raw(o); };
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const html = (el, v) => { el.innerHTML = v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : String(v); return el; };
const safeUrl = u => /^(https?:\/\/|\/(?!\/))/i.test(String(u || '')) ? String(u) : '';
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const qs = o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {})) if (v !== '' && v != null && v !== false) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

/* ---------- network ---------- */
const fail = (m, status) => { const e = new Error(m); e.status = status; return e; };
const tok = () => { try { return sessionStorage.getItem('k') || ''; } catch (e) { return ''; } };
const setTok = v => { try { v ? sessionStorage.setItem('k', v) : sessionStorage.removeItem('k'); } catch (e) { /* private mode */ } };
async function api(path, o) {
  o = o || {};
  const method = o.method || (o.body !== undefined || o.raw !== undefined ? 'POST' : 'GET'), headers = {}, t = tok();
  if (t) headers['x-token'] = t;
  let body;
  if (o.raw !== undefined) { body = o.raw; headers['Content-Type'] = o.type || 'application/octet-stream'; }
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(path, { method, headers, body, credentials: 'same-origin' }); }
  catch (e) { throw fail('You seem to be offline. Check your connection and try again.', 0); }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    const e = fail((data && data.error) || (res.status === 401 ? 'Please log in again.' : res.status === 403 ? 'You are not allowed to do that.' : 'Something went wrong. Please try again.'), res.status);
    if (res.status === 401 && SQ.on401 && !o.quiet) SQ.on401(e);
    throw e;
  }
  return data;
}
const get = (p, o) => api(p, o), post = (p, b) => api(p, { method: 'POST', body: b === undefined ? {} : b }), put = (p, b) => api(p, { method: 'PUT', body: b }), del = p => api(p, { method: 'DELETE' });
// Images that need the staff password header cannot be plain <img> tags, so they are fetched and shown from memory.
const blobs = new Map();
async function blobUrl(path) {
  if (blobs.has(path)) return blobs.get(path);
  const t = tok(), res = await fetch(path, { headers: t ? { 'x-token': t } : {}, credentials: 'same-origin' });
  if (!res.ok) throw fail('The image could not be loaded.', res.status);
  const u = URL.createObjectURL(await res.blob()); blobs.set(path, u); return u;
}
async function download(path, name) {
  const t = tok(), res = await fetch(path, { headers: t ? { 'x-token': t } : {}, credentials: 'same-origin' });
  if (!res.ok) throw fail('The download failed. Please try again.', res.status);
  const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- numbers and dates ---------- */
const nf = new Intl.NumberFormat('en-US');
const num = n => nf.format(Math.round(Number(n) || 0));
const compact = n => {
  n = Number(n) || 0; const a = Math.abs(n); if (a < 1000) return String(Math.round(n));
  const u = ['K', 'M', 'B', 'T']; let i = -1, v = a; while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  const r = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return (n < 0 ? '-' : '') + (r >= 1000 && i < u.length - 1 ? '1' + u[i + 1] : r + u[i]);
};
const usd = (c, o) => {
  c = Math.round(Number(c) || 0); const whole = o && o.whole && c % 100 === 0;
  const s = (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return (c < 0 ? '-' : o && o.sign && c > 0 ? '+' : '') + '$' + s;
};
const D = s => s instanceof Date ? s : new Date(s);
const date = s => s ? D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const time = s => s ? D(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
const dtime = s => s ? date(s) + ', ' + time(s) : '';
const span = sec => {
  sec = Math.abs(sec); if (sec < 60) return 'moments';
  const m = sec / 60; if (m < 60) return Math.round(m) + ' min';
  const hr = m / 60; if (hr < 48) return plural(Math.round(hr), 'hour');
  const d = hr / 24; if (d < 60) return plural(Math.round(d), 'day');
  return plural(Math.round(d / 30), 'month');
};
const ago = s => { if (!s) return ''; const sec = (Date.now() - D(s)) / 1000; return sec < -60 ? 'in ' + span(sec) : sec < 60 ? 'just now' : span(sec) + ' ago'; };
const until = s => { if (!s) return ''; const sec = (D(s) - Date.now()) / 1000; return sec <= 0 ? 'ended ' + ago(s) : 'in ' + span(sec); };
const initials = n => { const p = String(n || '?').trim().split(/[\s._-]+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); };
const isSunday = () => new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Karachi' }) === 'Sunday';
const toLocalInput = s => { if (!s) return ''; const d = D(s), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/* ---------- icons (24px grid, drawn with strokes) ---------- */
const IC = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  usercheck: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3.2-6.5 7-6.5s7 2.5 7 6.5"/><path d="m16 11 2 2 4-4"/>',
  trophy: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v6a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h18M3 16h4M17 8h4M17 16h4"/>',
  video: '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="m15.5 10 6-3v10l-6-3z"/>',
  wallet: '<path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v3"/><path d="M3 6v12a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M21 12v4h-4a2 2 0 0 1 0-4z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  lifebuoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.5 3.5M14.9 14.9l3.5 3.5M18.4 5.6l-3.5 3.5M9.1 14.9l-3.5 3.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8"/><path d="M12 17h.01"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  xc: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  chevr: '<path d="m9 6 6 6-6 6"/>', chevl: '<path d="m15 6-6 6 6 6"/>', chevd: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  ext: '<path d="M14 4h6v6M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.7"/><path d="m21 15-4.5-4.5L6 21"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/><path d="M9 7V4h6v3"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  chart: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  dollar: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-1-1.5-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2s1 1.7 2.8 2.1c1.8.4 2.8.9 2.8 2.1s-1.2 2-2.8 2c-1.4 0-2.5-.6-3-1.7"/><path d="M12 6v1.7M12 16.3V18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 4 2.7 19.5a1 1 0 0 0 .9 1.5h16.8a1 1 0 0 0 .9-1.5z"/><path d="M12 10v4M12 17.5h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  logout: '<path d="M9 21H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  send: '<path d="M21 3 10 14"/><path d="m21 3-6.5 18-4-8.5L2 8.5z"/>',
  filter: '<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18-3-3-3-15 0-18"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5 6l-2 7v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6l-2-7z"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6.5 15h3"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8c-1-3-5-4-5-1.5S10 8 12 8zM12 8c1-3 5-4 5-1.5S14 8 12 8z"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 7 5-3 5 3-1.5-7"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 17h5"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  arrowr: '<path d="M5 12h14M13 6l6 6-6 6"/>', arrowur: '<path d="M7 17 17 7M8 7h9v9"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M8 7h7"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  pin: '<path d="M12 21v-6"/><path d="M8 4h8l-1 6 3 3v2H6v-2l3-3z"/>',
  crown: '<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><path d="M7.5 7.5h.01"/>',
  dots: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  discord: '<path d="M8 8.5c2.6-1 5.4-1 8 0M7 16.5c3.2 1.3 6.8 1.3 10 0"/><path d="M7.5 7.5 6 17c1 .8 2 1.2 3 1.5l.8-1.5M16.5 7.5 18 17c-1 .8-2 1.2-3 1.5l-.8-1.5"/><circle cx="9.5" cy="12.5" r="1"/><circle cx="14.5" cy="12.5" r="1"/>'
};
const icon = (n, cls) => new Raw(`<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || IC.info}</svg>`);

const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
const PLAT_SVG = {
  youtube: '<path d="M9.5 7.6v8.8l7.2-4.4z" fill="#fff" stroke="none"/>',
  tiktok: '<path d="M14.2 4.5v9.6a3.3 3.3 0 1 1-3.3-3.3"/><path d="M14.2 4.5c.3 2.4 1.9 4 4.3 4.2"/>',
  instagram: '<rect x="4.5" y="4.5" width="15" height="15" rx="4.6"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.7" cy="7.3" r=".6" fill="#fff"/>'
};
const plat = (p, lg) => new Raw(`<span class="pl ${esc(p)}${lg ? ' lg' : ''}" title="${esc(PLAT[p] || p)}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="${esc(PLAT[p] || p)}">${PLAT_SVG[p] || ''}</svg></span>`);
const detectPlat = u => /(youtube\.com|youtu\.be)/i.test(u) ? 'youtube' : /tiktok\.com/i.test(u) ? 'tiktok' : /(instagram\.com|instagr\.am)/i.test(u) ? 'instagram' : '';

/* ---------- small components ---------- */
const avatar = (u, size) => {
  const name = (u && (u.username || u.name)) || '?', src = safeUrl(u && u.avatar), cls = 'av' + (size ? ' ' + size : '');
  return src ? h`<img class="${cls}" src="${src}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ini="${initials(name)}">` : h`<span class="${cls}" aria-hidden="true">${initials(name)}</span>`;
};
const chip = (text, kind, ic) => h`<span class="chip ${kind || ''}">${ic ? icon(ic) : ''}${text}</span>`;
const STAGE = {
  review: ['In review', 'info', 'clock'], analytics: ['Analytics needed', 'warn', 'alert'], checking: ['Checking analytics', 'info', 'eye'],
  tracking: ['Tracking views', 'ok', 'trend'], verified: ['Verified', 'ok', 'check'], completed: ['Paid to wallet', 'ok', 'checkc'], rejected: ['Rejected', 'bad', 'xc']
};
const stageChip = (stage, label) => { const s = STAGE[stage] || [label || stage, 'mu']; return chip(label || s[0], s[1], s[2]); };
const STATUS = {
  acct: { pending: ['Waiting for review', 'warn'], approved: ['Verified', 'ok', 'check'], rejected: ['Rejected', 'bad'] },
  payout: { requested: ['Requested', 'warn'], processing: ['Processing', 'info'], paid: ['Paid', 'ok', 'check'], rejected: ['Rejected', 'bad'], cancelled: ['Cancelled', 'mu'] },
  ticket: { open: ['Waiting for us', 'warn'], answered: ['Answered', 'ok'], closed: ['Closed', 'mu'] },
  tickets: { open: ['Needs a reply', 'warn'], answered: ['Answered', 'ok'], closed: ['Closed', 'mu'] },
  camp: { draft: ['Draft', 'mu'], live: ['Live', 'ok'], ended: ['Ended', 'mu'] }
};
const status = (group, v) => { const s = (STATUS[group] || {})[v] || [v, 'mu']; return chip(s[0], s[1], s[2]); };
const note = (kind, ic, body) => h`<div class="note ${kind || ''}">${icon(ic || 'info')}<div class="x">${body}</div></div>`;
const empty = (ic, title, text, action) => h`<div class="empty">${icon(ic)}<h3>${title}</h3>${text ? h`<p>${text}</p>` : ''}${action || ''}</div>`;
const bar = (pct, kind) => { const p = clamp(Math.round(Number(pct) || 0), 0, 100); return h`<div class="bar ${kind || ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>`; };
const stat = (label, value, sub, o) => { o = o || {}; return h`<div class="card stat ${o.hero ? 'hi' : ''}"><div class="l">${o.icon ? icon(o.icon) : ''}${label}</div><div class="v ${o.g ? 'g' : ''}">${value}</div>${sub ? h`<div class="s">${sub}</div>` : ''}</div>`; };
const kv = rows => h`<dl class="kv">${rows.filter(Boolean).map(r => h`<dt>${r[0]}</dt><dd>${r[1]}</dd>`)}</dl>`;
const skeleton = () => h`<div class="sk" style="width:220px;height:30px;margin-bottom:22px"></div><div class="g4" style="margin-bottom:14px"><div class="sk card"></div><div class="sk card"></div><div class="sk card"></div><div class="sk card"></div></div><div class="sk card" style="height:260px"></div>`;
const copyBtn = (text, label) => h`<button type="button" class="iconbtn sm" data-act="copy" data-text="${text}" title="${label || 'Copy'}" aria-label="${label || 'Copy'}">${icon('copy')}</button>`;
const pager = (r, name) => (r.page > 1 || r.more) ? h`<div class="pg"><button class="btn s" data-act="${name}" data-page="${r.page - 1}" ${r.page > 1 ? '' : 'disabled'}>${icon('chevl')}Previous</button><span class="mu sm" style="align-self:center">Page ${r.page}</span><button class="btn s" data-act="${name}" data-page="${r.page + 1}" ${r.more ? '' : 'disabled'}>Next${icon('chevr')}</button></div>` : '';
const opts = (list, val) => list.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return h`<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${t}</option>`; });
const seg = (items, cur, act, key) => h`<div class="seg" role="group">${items.map(([v, t, n]) => h`<button type="button" class="${String(v) === String(cur) ? 'on' : ''}" data-act="${act}" data-${key || 'v'}="${v}" aria-pressed="${String(v) === String(cur)}">${t}${n != null ? h` <span class="xs">${n}</span>` : ''}</button>`)}</div>`;
const tabs = (items, cur, act, key) => h`<div class="tabs" role="tablist">${items.map(([v, t, n, hot]) => h`<button type="button" role="tab" class="${String(v) === String(cur) ? 'on' : ''}" aria-selected="${String(v) === String(cur)}" data-act="${act}" data-${key || 'v'}="${v}">${t}${n != null ? h`<span class="n ${hot ? 'hot' : ''}">${num(n)}</span>` : ''}</button>`)}</div>`;
const fields = root => {
  const o = {};
  $$('[name]', root).forEach(el => {
    const n = el.name;
    if (el.type === 'checkbox') { if (el.dataset.multi !== undefined) { o[n] = o[n] || []; if (el.checked) o[n].push(el.value); } else o[n] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[n] = el.value; }
    else o[n] = el.value;
  });
  return o;
};
const copyText = async t => {
  try { await navigator.clipboard.writeText(t); }
  catch (e) { const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (x) { /* nothing else to try */ } a.remove(); }
  toast('Copied');
};

/* ---------- toasts, dialogs, lightbox ---------- */
function toast(msg, kind) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg; box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 280); }, kind === 'bad' ? 6500 : 3800);
}
const ok = m => toast(m);
const err = e => { if (e && e.status === 401) return; toast((e && e.message) || String(e), 'bad'); };

const stack = []; let dlgId = 0;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function dialog(o) {
  const id = ++dlgId, prev = document.activeElement, ov = document.createElement('div');
  ov.className = 'ov' + (o.drawer ? ' dr' : '');
  const btns = o.buttons || [];
  ov.innerHTML = h`<div class="modal ${o.wide ? 'w' : ''} ${o.cls || ''}" role="dialog" aria-modal="true" aria-labelledby="dt${id}"><div class="mh"><h3 id="dt${id}">${o.title}</h3>${o.sticky ? '' : h`<button type="button" class="iconbtn" data-x aria-label="Close">${icon('x')}</button>`}</div><div class="mb"></div>${btns.length ? h`<div class="mf">${btns.map((b, i) => h`<button type="button" class="btn ${b.kind || ''}" data-i="${i}">${b.text}</button>`)}</div>` : ''}</div>`.s;
  const box = $('.modal', ov), mb = $('.mb', ov);
  let done, closed = false; const promise = new Promise(r => { done = r; });
  const m = {
    el: ov, box, body: mb, done: promise, opt: o,
    set(v) { html(mb, v); return m; },
    err(msg) { let n = $('.merr', mb); if (!n) { n = document.createElement('div'); n.className = 'note bad merr'; n.setAttribute('role', 'alert'); mb.prepend(n); } n.innerHTML = h`${icon('alert')}<div class="x">${msg}</div>`.s; mb.scrollTop = 0; },
    clear() { const n = $('.merr', mb); if (n) n.remove(); },
    close(v) {
      if (closed) return; closed = true; stack.splice(stack.indexOf(m), 1); ov.remove();
      document.documentElement.style.overflow = stack.length ? 'hidden' : '';
      if (o.onClose) o.onClose(v);
      if (prev && prev.isConnected && prev.focus) { try { prev.focus(); } catch (e) { /* element gone */ } }
      done(v);
    }
  };
  html(mb, o.body || '');
  ov.addEventListener('mousedown', e => { ov._down = e.target === ov; });
  ov.addEventListener('click', e => { if (e.target === ov && ov._down && !o.sticky) m.close(false); });
  ov.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) return m.close(false);
    const b = e.target.closest('.mf [data-i]'); if (!b) return;
    const def = btns[+b.dataset.i];
    if (!def.run) return m.close(def.value !== undefined ? def.value : false);
    if (b.classList.contains('busy')) return;
    b.classList.add('busy'); m.clear();
    try { const r = await def.run(m); if (r !== false) m.close(r === undefined ? true : r); }
    catch (x) { if (!(x && x.status === 401)) m.err((x && x.message) || String(x)); }
    finally { b.classList.remove('busy'); }
  });
  ov.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && !e.target.closest('[data-noenter]')) {
      const p = $('.mf .btn.p, .mf .btn.d', ov); if (p) { e.preventDefault(); p.click(); }
    }
    if (e.key !== 'Tab') return;
    const f = $$(FOCUSABLE, box).filter(x => x.offsetParent !== null); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.body.appendChild(ov); stack.push(m); document.documentElement.style.overflow = 'hidden';
  setTimeout(() => { const f = o.focus ? $(o.focus, box) : $('.mb input:not([type=checkbox]):not([type=hidden]),.mb textarea,.mb select', box) || $('.mf .btn.p,.mf .btn.d', box) || $('.mf .btn', box); if (f) f.focus(); }, 30);
  return m;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) { const m = stack[stack.length - 1]; if (!m.opt.sticky) { e.stopPropagation(); m.close(false); } }
});
const confirmBox = o => new Promise(res => {
  const m = dialog({ title: o.title, body: h`<p>${o.text}</p>`, buttons: [{ text: o.cancel || 'Cancel', kind: 'g', value: false }, { text: o.ok || 'Confirm', kind: o.kind || 'p', value: true }] });
  m.done.then(v => res(v === true));
});
// A small form that asks for one piece of text (a reason, a reference). `submit` may do the server call so errors show inside the dialog.
const ask = o => new Promise(res => {
  const long = o.long !== false, id = 'ask' + (++dlgId);
  const body = h`${o.text ? h`<p class="mu" style="margin-bottom:14px">${o.text}</p>` : ''}${o.presets && o.presets.length ? h`<div class="row" style="margin-bottom:12px;gap:8px">${o.presets.map(p => h`<button type="button" class="chip" data-preset="${p}" style="cursor:pointer">${p}</button>`)}</div>` : ''}
    <label class="f" style="margin:0"><span class="h">${o.label || ''}</span>${long ? h`<textarea class="in" id="${id}" rows="${o.rows || 3}" maxlength="${o.max || 300}" placeholder="${o.ph || ''}">${o.value || ''}</textarea>` : h`<input class="in" id="${id}" maxlength="${o.max || 120}" placeholder="${o.ph || ''}" value="${o.value || ''}" ${o.type ? 'type="' + o.type + '"' : ''}>`}${o.hint ? h`<div class="hint">${o.hint}</div>` : ''}</label>`;
  const m = dialog({
    title: o.title, body, focus: '#' + id, buttons: [{ text: 'Cancel', kind: 'g', value: null }, {
      text: o.ok || 'Save', kind: o.kind || 'p', run: async dm => {
        const v = $('#' + id, dm.box).value.trim();
        if (o.min && v.length < o.min) throw new Error(o.minMsg || `Write at least ${o.min} characters.`);
        if (o.submit) await o.submit(v);
        dm.value = v; return v;
      }
    }]
  });
  m.box.addEventListener('click', e => { const p = e.target.closest('[data-preset]'); if (p) { const f = $('#' + id, m.box); f.value = p.dataset.preset; f.focus(); } });
  m.done.then(v => res(typeof v === 'string' ? v : null));
});
function lightbox(src) {
  const d = document.createElement('div'); d.className = 'lb'; d.innerHTML = '<img alt="">'; $('img', d).src = src;
  const close = () => { d.remove(); document.removeEventListener('keydown', k, true); };
  const k = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  d.onclick = close; document.addEventListener('keydown', k, true); document.body.appendChild(d);
}

/* ---------- clicks: one listener for the whole page ---------- */
const ACTS = {}, DROPS = {}, SEARCHES = {};
const act = (name, fn) => { ACTS[name] = fn; };
const onDrop = (name, fn) => { DROPS[name] = fn; };
const onSearch = (name, fn) => { SEARCHES[name] = fn; };
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && ACTS[el.dataset.act]) {
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
    if (el.classList.contains('busy')) return;
    let r; try { r = ACTS[el.dataset.act](el, e); } catch (x) { return err(x); }
    if (r && typeof r.then === 'function') { el.classList.add('busy'); r.then(() => { }, err).finally(() => el.classList.remove('busy')); }
    return;
  }
  const g = e.target.closest('[data-go]');
  if (g && !e.target.closest('a,button,input,select,textarea,label,[data-act]')) go(g.dataset.go);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const g = e.target.closest && e.target.closest('[data-go]');
  if (g && e.target === g) go(g.dataset.go);
});
document.addEventListener('input', e => { const s = e.target.dataset && e.target.dataset.search; if (s && SEARCHES[s]) { clearTimeout(e.target._t); e.target._t = setTimeout(() => SEARCHES[s](e.target.value.trim(), e.target), 320); } });
document.addEventListener('change', e => { const t = e.target; if (t.type === 'file' && t.dataset.files && DROPS[t.dataset.files]) { DROPS[t.dataset.files](t, Array.from(t.files)); t.value = ''; } });
['dragover', 'drop'].forEach(n => window.addEventListener(n, e => e.preventDefault()));
document.addEventListener('dragenter', e => { const z = e.target.closest && e.target.closest('.drop[data-drop]'); if (z) z.classList.add('on'); });
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('.drop[data-drop]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('on'); });
document.addEventListener('drop', e => { const z = e.target.closest && e.target.closest('.drop[data-drop]'); if (!z) return; z.classList.remove('on'); if (DROPS[z.dataset.drop]) DROPS[z.dataset.drop](z, Array.from(e.dataTransfer.files)); });
document.addEventListener('error', e => {
  const t = e.target; if (!t || t.tagName !== 'IMG') return;
  if (t.dataset.ini) { const s = document.createElement('span'); s.className = t.className; s.textContent = t.dataset.ini; t.replaceWith(s); } else if (t.dataset.hide !== undefined) t.style.display = 'none';
}, true);
act('copy', el => copyText(el.dataset.text));
act('zoom', el => lightbox(el.dataset.full || el.currentSrc || el.src));
act('reload', () => reload());
act('menu', () => {
  const s = $('#side'); if (!s) return;
  const open = !s.classList.contains('open'); s.classList.toggle('open', open);
  let sc = $('.scrim'); if (open && !sc) { sc = document.createElement('div'); sc.className = 'scrim'; sc.setAttribute('data-act', 'menu'); document.body.appendChild(sc); } else if (!open && sc) sc.remove();
});
act('ctable', el => { const w = el.closest('.cwrap'); w.classList.toggle('tbl-on'); el.textContent = w.classList.contains('tbl-on') ? 'View as chart' : 'View as table'; });

/* ---------- router ---------- */
const routes = []; let navId = 0;
const route = (pattern, fn, nav) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, k) => { keys.push(k); return '([^/]+)'; }) + '$'); routes.push({ pattern, re, keys, fn, nav }); };
const parseHash = () => { const r = location.hash.replace(/^#\/?/, ''), i = r.indexOf('?'), q = {}; new URLSearchParams(i < 0 ? '' : r.slice(i + 1)).forEach((v, k) => { q[k] = v; }); return { path: i < 0 ? r : r.slice(0, i), q }; };
const setTitle = t => { document.title = (t ? t + ' | ' : '') + (SQ.brand || 'SIDQ Creative'); const e = $('.top .ttl'); if (e) e.textContent = t || ''; };
async function dispatch(keep) {
  const { path, q } = parseHash(), p = path || SQ.home; let hit = null; const params = {};
  for (const r of routes) { const m = r.re.exec(p); if (m) { hit = r; r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch (e) { params[k] = m[i + 1]; } }); break; } }
  if (!hit) return go(SQ.home, true);
  const id = ++navId, view = $('#view'); if (!view) return;
  const ctx = { id, params, q, path: p, view, alive: () => id === navId, set(v) { if (id !== navId) return false; html(view, v); return true; }, title(t) { if (id === navId) setTitle(t); } };
  SQ.curNav = hit.nav;
  $$('[data-nav]').forEach(a => { const on = a.dataset.nav === hit.nav; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const s = $('#side'); if (s) { s.classList.remove('open'); const sc = $('.scrim'); if (sc) sc.remove(); }
  const on = $('.ni.on'); setTitle(on ? on.textContent.replace(/\d+$/, '').trim() : '');
  if (!keep) { html(view, skeleton()); window.scrollTo(0, 0); }
  CH.clear(); hideTip();
  try { await hit.fn(ctx); }
  catch (e) {
    if (id !== navId) return;
    if (e && e.status === 401) return;
    html(view, empty('alert', 'This page did not load', (e && e.message) || 'Something went wrong.', h`<div class="row" style="justify-content:center"><button class="btn p" data-act="reload">Try again</button><a class="btn" href="#${SQ.home}">Back to home</a></div>`));
  }
}
const reload = () => dispatch(true);
function go(hash, replace) {
  hash = String(hash).replace(/^#/, '');
  if (replace) { history.replaceState(null, '', '#' + hash); dispatch(); }
  else if (location.hash === '#' + hash) dispatch(); else location.hash = hash;
}
// Change the filters in the address (tab, search, page) and show the new result. Search typing replaces the entry so Back stays useful.
const nav = (patch, replace) => { const { path, q } = parseHash(); Object.assign(q, patch); for (const k of Object.keys(q)) if (q[k] === '' || q[k] == null) delete q[k]; go(path + qs(q), replace); };
window.addEventListener('hashchange', () => dispatch());

/* ---------- charts: area for a trend, columns for counts; hover, touch and keyboard all show the value ---------- */
const CH = new Map(); let chId = 0, tipEl = null;
const niceStep = r => { const e = Math.pow(10, Math.floor(Math.log10(r || 1))), f = (r || 1) / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
const usdAxis = v => v === 0 ? '$0' : Math.abs(v) >= 100000 ? '$' + compact(v / 100) : usd(v, { whole: true });
function chartBase(kind, pts, o) {
  o = o || {};
  const W = o.w || 720, H = o.h || 220, pl = o.pl || 46, pr = 14, pt = 16, pb = 28, n = pts.length, ax = o.axis || num;
  const raw0 = Math.max(0, ...pts.map(p => p.y)), step = niceStep((raw0 || 1) / 4), top = Math.max(step, Math.ceil(raw0 / step) * step);
  const iw = W - pl - pr, ih = H - pt - pb, y = v => pt + (1 - v / top) * ih;
  const stepX = iw / Math.max(1, n), xs = pts.map((p, i) => kind === 'bar' ? pl + stepX * (i + .5) : pl + (n === 1 ? iw / 2 : i * iw / (n - 1))), ys = pts.map(p => y(p.y));
  let g = '';
  for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gl" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${pl - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(ax(v))}</text>`;
  const lab = (i, anchor) => `<text x="${xs[i].toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${esc(pts[i].x)}</text>`;
  let labels = n ? lab(0, kind === 'bar' ? 'middle' : 'start') : '';
  if (n > 2) labels += lab(Math.floor((n - 1) / 2), 'middle');
  if (n > 1) labels += lab(n - 1, kind === 'bar' ? 'middle' : 'end');
  return { W, H, pl, pr, pt, pb, n, top, y, xs, ys, stepX, g, labels, id: 'c' + (++chId) };
}
function chartWrap(c, kind, pts, o, inner) {
  CH.set(c.id, { kind, pts, W: c.W, H: c.H, pl: c.pl, pr: c.pr, n: c.n, xs: c.xs, ys: c.ys, step: c.stepX, fmt: o.fmt || num, unit: o.unit || '' });
  const total = pts.reduce((a, p) => a + p.y, 0);
  const rows = pts.map(p => h`<tr><td>${p.x}</td><td class="r">${(o.fmt || num)(p.y)}</td></tr>`);
  return h`<div class="cwrap"><div class="cw" data-cid="${c.id}" tabindex="0" role="img" aria-label="${(o.label || 'Chart') + '. ' + (o.fmt || num)(total) + ' in total over ' + pts.length + ' days. Use the left and right arrow keys to read each day.'}"><svg class="chart" viewBox="0 0 ${c.W} ${c.H}" preserveAspectRatio="xMidYMid meet">${raw(c.g)}${raw(inner)}${raw(c.labels)}<line class="xh" y1="${c.pt}" y2="${c.H - c.pb}" style="display:none"/><circle class="xd" r="4.5" style="display:none"/></svg></div>
    <div class="ctbl tw"><table class="tbl"><thead><tr><th>${o.xlabel || 'Day'}</th><th class="r">${o.ylabel || 'Value'}</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${o.table === false ? '' : h`<button type="button" class="btn g s" data-act="ctable" style="margin-top:6px">View as table</button>`}</div>`;
}
function areaChart(pts, o) {
  o = o || {}; if (!pts.length) return empty('chart', 'No data yet');
  const c = chartBase('line', pts, o), base = c.H - c.pb;
  const line = pts.map((p, i) => (i ? 'L' : 'M') + c.xs[i].toFixed(1) + ' ' + c.ys[i].toFixed(1)).join('');
  const area = pts.length > 1 ? `<path class="ar" d="${line}L${c.xs[c.n - 1].toFixed(1)} ${base}L${c.xs[0].toFixed(1)} ${base}Z"/>` : '';
  const last = pts.length ? `<circle class="pt" cx="${c.xs[c.n - 1].toFixed(1)}" cy="${c.ys[c.n - 1].toFixed(1)}" r="4"/>` : '';
  return chartWrap(c, 'line', pts, o, `${area}<path class="ln" d="${line}"/>${last}`);
}
function barChart(pts, o) {
  o = o || {}; if (!pts.length) return empty('chart', 'No data yet');
  o = { h: 150, pl: 34, ...o };
  const c = chartBase('bar', pts, o), base = c.H - c.pb, bw = Math.min(24, c.stepX - 3);
  const bars = pts.map((p, i) => {
    const x = c.xs[i] - bw / 2, hh = Math.max(p.y > 0 ? 2 : 0, base - c.ys[i]), r = Math.min(4, bw / 2, hh);
    return hh ? `<path class="cb" data-i="${i}" d="M${x.toFixed(1)} ${base}V${(base - hh + r).toFixed(1)}Q${x.toFixed(1)} ${(base - hh).toFixed(1)} ${(x + r).toFixed(1)} ${(base - hh).toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)} ${(base - hh).toFixed(1)} ${(x + bw).toFixed(1)} ${(base - hh + r).toFixed(1)}V${base}Z"/>` : '';
  }).join('');
  return chartWrap(c, 'bar', pts, { table: false, ...o }, bars);
}
function showTip(cw, i, fromKey) {
  const c = CH.get(cw.dataset.cid); if (!c) return;
  i = clamp(i, 0, c.n - 1); cw._i = i;
  const svg = $('svg', cw), r = svg.getBoundingClientRect(), sx = r.width / c.W, sy = r.height / c.H, p = c.pts[i];
  const xh = $('.xh', svg), xd = $('.xd', svg);
  $$('.cb.on', svg).forEach(b => b.classList.remove('on'));
  if (c.kind === 'line') { xh.setAttribute('x1', c.xs[i]); xh.setAttribute('x2', c.xs[i]); xh.style.display = ''; xd.setAttribute('cx', c.xs[i]); xd.setAttribute('cy', c.ys[i]); xd.style.display = ''; }
  else { const b = $(`.cb[data-i="${i}"]`, svg); if (b) b.classList.add('on'); }
  if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); tipEl.innerHTML = '<b></b><span></span>'; document.body.appendChild(tipEl); }
  $('b', tipEl).textContent = c.fmt(p.y) + (c.unit ? ' ' + c.unit : ''); $('span', tipEl).textContent = p.full || p.x;
  const tx = clamp(r.left + c.xs[i] * sx, 70, window.innerWidth - 70), ty = r.top + c.ys[i] * sy;
  tipEl.style.left = tx + 'px'; tipEl.style.top = (ty < 80 ? ty + 54 : ty - 12) + 'px'; tipEl.style.transform = ty < 80 ? 'translate(-50%,0)' : 'translate(-50%,-100%)'; tipEl.style.display = 'block';
}
function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
  $$('.cw .xh,.cw .xd').forEach(x => { x.style.display = 'none'; }); $$('.cw .cb.on').forEach(b => b.classList.remove('on'));
}
document.addEventListener('pointermove', e => {
  const cw = e.target.closest && e.target.closest('.cw');
  if (!cw) { if (tipEl && tipEl.style.display === 'block') hideTip(); return; }
  const c = CH.get(cw.dataset.cid); if (!c) return;
  const r = $('svg', cw).getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * c.W;
  showTip(cw, c.kind === 'bar' ? Math.floor((vx - c.pl) / c.step) : Math.round((vx - c.pl) / ((c.W - c.pl - c.pr) / Math.max(1, c.n - 1))));
}, { passive: true });
document.addEventListener('keydown', e => {
  const cw = e.target.closest && e.target.closest('.cw'); if (!cw || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  e.preventDefault(); showTip(cw, (cw._i == null ? (CH.get(cw.dataset.cid) || { n: 1 }).n : cw._i) + (e.key === 'ArrowRight' ? 1 : -1), true);
});
document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('.cw')) hideTip(); });
window.addEventListener('scroll', () => { if (tipEl && tipEl.style.display === 'block') hideTip(); }, { passive: true });

/* ---------- screenshots: shrink big phone screenshots in the browser before uploading ---------- */
async function compressImage(file, max, quality) {
  max = max || 1600; quality = quality || 0.82;
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw fail('Choose a PNG, JPG or WebP screenshot.', 0);
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) { bmp = await new Promise((res, rej) => { const i = new Image(), u = URL.createObjectURL(file); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => rej(fail('That image could not be read. Try another screenshot.', 0)); i.src = u; }); }
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight, s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s));
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  let q = quality, blob;
  for (let i = 0; i < 4; i++) { blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); if (blob && blob.size < 5.2e6) break; q -= 0.15; }
  if (!blob) throw fail('That image could not be prepared. Try another screenshot.', 0);
  return blob;
}

/* ---------- screen recordings: choose a file, record in the browser, upload with progress, play back ---------- */
const VIDEO_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', webm: 'video/webm' };
// 'video/mp4', 'video/quicktime' or 'video/webm' for a file we accept, otherwise ''. Phones sometimes leave the type empty, so the file name decides then.
const videoType = f => {
  const t = String((f && f.type) || '').toLowerCase().split(';')[0];
  if (/^video\/(mp4|quicktime|webm)$/.test(t)) return t;
  const m = /\.(\w+)$/.exec((f && f.name) || ''); return (m && VIDEO_EXT[m[1].toLowerCase()]) || '';
};
const mb = n => n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const clock = s => { s = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// fetch cannot report how much of an upload is sent, XMLHttpRequest can. Resolves with the JSON answer.
function upload(path, body, o) {
  o = o || {};
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(), t = tok();
    x.open('POST', path); x.withCredentials = true;
    if (t) x.setRequestHeader('x-token', t);
    x.setRequestHeader('Content-Type', o.type || body.type || 'application/octet-stream');
    if (x.upload && o.onProgress) x.upload.onprogress = e => { if (e.lengthComputable && e.total) o.onProgress(Math.min(1, e.loaded / e.total)); };
    x.onerror = x.onabort = () => reject(fail('Your connection dropped during the upload. Check your internet and try again.', 0));
    x.onload = () => {
      let d = null; try { d = JSON.parse(x.responseText); } catch (e) { d = null; }
      if (x.status >= 200 && x.status < 300) return resolve(d || {});
      const e = fail((d && d.error) || (x.status === 401 ? 'Please log in again.' : x.status === 413 ? 'That file is too large.' : 'Something went wrong. Please try again.'), x.status);
      if (x.status === 401 && SQ.on401 && !o.quiet) SQ.on401(e);
      reject(e);
    };
    x.send(body);
  });
}
// A recording made in the browser has no length stored in the file, so the player shows "infinity" and cannot jump around. Seeking to the end once makes the browser learn the real length.
document.addEventListener('loadedmetadata', e => {
  const v = e.target; if (!v || v.tagName !== 'VIDEO' || v.duration !== Infinity) return;
  const back = () => { v.removeEventListener('timeupdate', back); v.currentTime = 0; };
  v.addEventListener('timeupdate', back); v.currentTime = 1e101;
}, true);
// Recording the screen from the page works in desktop browsers. Phones do not allow it; there people use the phone's own screen recorder and upload the file.
const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
const recMime = () => ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
// Asks the browser which screen to share, then records it. Resolves with { stop, done } as soon as recording starts;
// done resolves with { blob, seconds, type } when it ends (the person pressed stop, shared screen was closed, the time limit passed or the size limit was reached).
async function record(o) {
  o = o || {};
  const max = o.max || 300, cap = o.maxBytes || 72e6;
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  const type = recMime(), chunks = []; let size = 0, t0 = Date.now(), timer, rec;
  try { rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: 1200000 }, type ? { mimeType: type } : {})); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); throw fail('Your browser cannot record the screen. Record with your phone or computer recorder and upload the video instead.', 0); }
  let res, rej; const done = new Promise((a, b) => { res = a; rej = b; });
  const stop = () => { try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* already stopped */ } };
  rec.ondataavailable = e => { if (e.data && e.data.size) { chunks.push(e.data); size += e.data.size; if (size >= cap) stop(); } };
  rec.onerror = () => { clearInterval(timer); stream.getTracks().forEach(t => t.stop()); rej(fail('The recording stopped because of an error. Please try again.', 0)); };
  rec.onstop = () => {
    clearInterval(timer); stream.getTracks().forEach(t => t.stop());
    const seconds = Math.max(1, Math.round((Date.now() - t0) / 1000)), blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' });
    if (!blob.size) return rej(fail('Nothing was recorded. Please try again.', 0));
    res({ blob, seconds, type: blob.type });
  };
  stream.getVideoTracks().forEach(t => t.addEventListener('ended', stop)); // the browser's own "Stop sharing" button
  rec.start(1000); t0 = Date.now();
  timer = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); if (o.onTick) o.onTick(sec); if (sec >= max) stop(); }, 500);
  return { stop, done };
}

// Contact links the owner edits in the website content (Discord invite, WhatsApp, Instagram, email). Loaded once.
let linksP = null;
const links = () => linksP || (linksP = get('/api/content', { quiet: true }).then(c => { const t = (c && c.t) || {}; return { discord: safeUrl(t.discord), whop: safeUrl(t.whop), wa: String(t.wa || '').replace(/\D/g, ''), ig: String(t.ig || '').replace(/^@/, ''), email: String(t.email || '') }; }).catch(() => ({})));
const METHODS = { paypal: 'PayPal', usdt: 'USDT (crypto)', bank: 'Bank transfer', easypaisa: 'EasyPaisa', jazzcash: 'JazzCash' };
// A style fragment for a background picture. Quotes, brackets and spaces are encoded so a strange address cannot break out of it.
const bgImg = u => { const s = safeUrl(u); return s ? 'background-image:url(' + s.replace(/["'()\\\s]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) + ')' : ''; };
const dayLabel = (d, long) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, long ? { year: 'numeric' } : {}));
Object.assign(SQ, {
  METHODS, bgImg, dayLabel, links,
  Raw, raw, esc, h, $, $$, html, safeUrl, clamp, sleep, debounce, qs, plural, fail, api, get, post, put, del, blobUrl, download, tok, setTok,
  num, compact, usd, date, time, dtime, span, ago, until, initials, isSunday, toLocalInput, icon, IC, PLAT, plat, detectPlat, avatar, chip, stageChip, STAGE, status, note, empty,
  bar, stat, kv, skeleton, copyBtn, pager, opts, seg, tabs, fields, copyText, toast, ok, err, dialog, confirm: confirmBox, ask, lightbox, act, onDrop, onSearch,
  route, dispatch, reload, go, nav, parseHash, setTitle, areaChart, barChart, usdAxis, compressImage, videoType, mb, clock, upload, canRecord, record, home: 'home', brand: 'SIDQ Creative'
});
