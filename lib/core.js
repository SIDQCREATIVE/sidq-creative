'use strict';
// Shared helpers for the clipper platform: money, wallet ledger, payouts, notifications,
// Discord alerts, audit trail. Routes and background jobs both use these, so the rules live in one place.
const crypto = require('crypto');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (message, status = 400) => { throw new HttpError(status, message); };

const clip = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
const int = (v, d = 0, min = -Infinity, max = Infinity) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const usd = c => (c < 0 ? '-' : '') + '$' + (Math.abs(Number(c)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "12.50" or 12.5 -> 1250. Returns null when it is not a money amount with at most 2 decimals.
const parseMoney = v => { const s = String(v == null ? '' : v).trim().replace(/^\$/, ''); return /^\d{1,7}(\.\d{1,2})?$/.test(s) ? Math.round(parseFloat(s) * 100) : null; };

// ---------- tiny in-memory rate limiter ----------
const buckets = new Map();
const allow = (key, limit, ms) => {
  const now = Date.now(); let b = buckets.get(key);
  if (!b || b.t < now) { b = { n: 0, t: now + ms }; buckets.set(key, b); }
  return ++b.n <= limit;
};
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.t < now) buckets.delete(k); }, 60000).unref();
const limit = (key, n, ms, msg) => { if (!allow(key, n, ms)) fail(msg || 'Too many requests. Please wait a bit and try again.', 429); };

// ---------- optional encryption of payout details at rest ----------
// Set DATA_KEY in Railway to encrypt bank / wallet details in the database. Without it they are stored as plain JSON.
const DKEY = process.env.DATA_KEY ? crypto.createHash('sha256').update(process.env.DATA_KEY).digest() : null;
const seal = obj => {
  if (!DKEY) return obj;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', DKEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return { sealed: Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64') };
};
const unseal = j => {
  if (!j || !j.sealed) return j || {};
  if (!DKEY) throw new Error('DATA_KEY is missing, so saved payout details cannot be read');
  const b = Buffer.from(j.sealed, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', DKEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
};

// ---------- payout methods ----------
const METHOD_NAMES = { paypal: 'PayPal', usdt: 'USDT (crypto)', bank: 'Bank transfer', easypaisa: 'EasyPaisa', jazzcash: 'JazzCash' };
const USDT_NET = { TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, BEP20: /^0x[a-fA-F0-9]{40}$/, ERC20: /^0x[a-fA-F0-9]{40}$/ };
// Validates what a clipper typed and returns the cleaned details, or throws a friendly error.
const cleanMethod = (type, b) => {
  b = b || {};
  const name = (k, label, min = 2, max = 80) => { const v = clip(b[k], max); if (v.length < min) fail(`Enter ${label}`); return v; };
  if (type === 'paypal') {
    const email = clip(b.email, 120).toLowerCase();
    if (!/^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,}$/.test(email)) fail('Enter the email address of your PayPal account');
    return { email };
  }
  if (type === 'usdt') {
    const network = String(b.network || '').toUpperCase(), address = clip(b.address, 100);
    if (!USDT_NET[network]) fail('Pick the network: TRC20, BEP20 or ERC20');
    if (!USDT_NET[network].test(address)) fail(`That does not look like a ${network} wallet address. Check it and try again`);
    return { network, address };
  }
  if (type === 'bank') {
    const account = clip(b.account, 40).replace(/[\s-]/g, '').toUpperCase();
    if (!/^([A-Z]{2}\d{2}[A-Z0-9]{8,30}|\d{6,24})$/.test(account)) fail('Enter your IBAN or account number (digits and letters only)');
    return { holder: name('holder', "the account holder's name"), bank: name('bank', 'the bank name'), account, country: name('country', 'the country', 2, 40), swift: clip(b.swift, 20).toUpperCase() };
  }
  if (type === 'easypaisa' || type === 'jazzcash') {
    const raw = clip(b.phone, 20).replace(/[\s-]/g, '');
    if (!/^(\+?92|0)?3\d{9}$/.test(raw)) fail('Enter a Pakistani mobile number like 0300 1234567');
    return { holder: name('holder', "the account holder's name"), phone: '0' + raw.slice(-10) };
  }
  return fail('Pick a payout method');
};
const maskTail = (s, n = 4) => '••••' + String(s).slice(-n);
// Safe text to show back to the clipper (never the full number).
const describeMethod = (type, details) => {
  let d; try { d = unseal(details); } catch (e) { return { title: METHOD_NAMES[type] || type, sub: 'Saved' }; }
  if (type === 'paypal') { const [u, dom] = String(d.email).split('@'); return { title: 'PayPal', sub: u.slice(0, 2) + '•••@' + dom }; }
  if (type === 'usdt') return { title: 'USDT ' + d.network, sub: String(d.address).slice(0, 4) + '…' + String(d.address).slice(-4) };
  if (type === 'bank') return { title: d.bank, sub: d.holder + ' ' + maskTail(d.account) };
  return { title: METHOD_NAMES[type] || type, sub: d.holder + ' ' + String(d.phone).slice(0, 4) + '•••' + String(d.phone).slice(-3) };
};
// Full text for staff who have to send the money.
const staffMethod = (type, details) => {
  let d; try { d = unseal(details); } catch (e) { return { error: e.message }; }
  return { type, name: METHOD_NAMES[type] || type, fields: Object.entries(d).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)]) };
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = n => Array.from(crypto.randomBytes(n), b => CODE_CHARS[b % CODE_CHARS.length]).join('');

const DEFAULT_SETTINGS = {
  min_payout_cents: 1000,
  referral_pct: 0,
  methods: { paypal: true, usdt: true, bank: true, easypaisa: true, jazzcash: true },
  show_payout_feed: true,
  pkr_rate: 280,
  payout_note: 'Payouts are sent within 3 to 7 working days. Staff are off on Sundays.'
};
const DM_TYPES = new Set(['connection_expired', 'analytics_requested', 'analytics_declined', 'submission_rejected', 'account_rejected', 'payout_paid', 'payout_rejected', 'message']);
const HOOKS = { staff: 'DISCORD_WEBHOOK_STAFF', payouts: 'DISCORD_WEBHOOK_PAYOUTS', campaigns: 'DISCORD_WEBHOOK_CAMPAIGNS' };

module.exports = function makeCore(db, ctx = {}) {
  const core = { HttpError, fail, clip, int, usd, parseMoney, limit, allow, cleanMethod, describeMethod, staffMethod, seal, unseal, randCode, METHOD_NAMES, DEFAULT_SETTINGS };
  const RANKS = ctx.RANKS || [['Noob', 0], ['Rookie', 1200], ['Clipper', 5000], ['Pro', 20000], ['Elite', 100000]];
  core.baseUrl = q => (process.env.SITE_URL || (q ? q.protocol + '://' + q.get('host') : '')).replace(/\/$/, '');
  core.rankOf = xp => { const i = RANKS.reduce((a, x, k) => xp >= x[1] ? k : a, 0), nx = RANKS[i + 1]; return { rank: RANKS[i][0], next: nx ? nx[1] : null, nextRank: nx ? nx[0] : null, floor: RANKS[i][1] }; };

  // ---------- database helpers ----------
  core.tx = async fn => {
    const c = await db.connect();
    try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
    catch (e) { try { await c.query('ROLLBACK'); } catch (x) { /* connection already gone */ } throw e; }
    finally { c.release(); }
  };

  // ---------- settings (cached for 15 seconds) ----------
  let cache = null, cacheAt = 0;
  core.settings = async () => {
    if (cache && Date.now() - cacheAt < 15000) return cache;
    const s = { ...DEFAULT_SETTINGS };
    for (const r of (await db.query('SELECT key, value FROM settings')).rows) s[r.key] = r.value;
    s.methods = { ...DEFAULT_SETTINGS.methods, ...(s.methods || {}) };
    cache = s; cacheAt = Date.now(); return s;
  };
  core.saveSettings = async patch => {
    for (const [k, v] of Object.entries(patch)) await db.query('INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb', [k, JSON.stringify(v)]);
    cache = null;
  };

  // ---------- audit trail and clip history ----------
  core.audit = async (actor, action, targetType, targetId, meta) => {
    try { await db.query('INSERT INTO audit_log (actor_id, actor, action, target_type, target_id, meta) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [actor && actor.id || null, actor ? actor.name : 'system', action, targetType || '', String(targetId == null ? '' : targetId), JSON.stringify(meta || {})]); }
    catch (e) { console.error('audit failed:', e.message); }
  };
  core.event = (c, sid, actor, type, text, internal) =>
    (c || db).query('INSERT INTO submission_events (submission_id, actor, type, text, internal) VALUES ($1,$2,$3,$4,$5)', [sid, actor || '', type, clip(text, 500), !!internal]);

  // ---------- Discord: webhooks (staff / payouts / campaigns channels) and DMs from the bot ----------
  const post = (url, headers, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(7000) });
  core.hook = (kind, embed) => {
    const url = process.env[HOOKS[kind]]; if (!url) return;
    post(url, {}, { username: 'SIDQ Creative', embeds: [{ color: 0xb7e222, timestamp: new Date().toISOString(), ...embed }], allowed_mentions: { parse: [] } })
      .catch(e => console.error('Discord webhook failed:', e.message));
  };
  const dm = async (userId, text) => {
    const bot = process.env.DISCORD_BOT_TOKEN; if (!bot) return;
    try {
      const u = (await db.query('SELECT discord_id FROM users WHERE id = $1', [userId])).rows[0]; if (!u) return;
      const H = { Authorization: 'Bot ' + bot };
      const ch = await post('https://discord.com/api/v10/users/@me/channels', H, { recipient_id: u.discord_id }).then(r => r.json());
      if (ch.id) await post(`https://discord.com/api/v10/channels/${ch.id}/messages`, H, { content: String(text).slice(0, 1900), allowed_mentions: { parse: [] } });
    } catch (e) { console.error('Discord DM failed:', e.message); }
  };
  // An in-app notification (bell icon). Important ones are also sent as a Discord DM when the bot is set up.
  core.notify = async (userId, type, title, body, link) => {
    try { await db.query('INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1,$2,$3,$4,$5)', [userId, type, clip(title, 120), clip(body, 400), link || '']); }
    catch (e) { console.error('notify failed:', e.message); }
    if (DM_TYPES.has(type)) { const base = core.baseUrl(); dm(userId, `**${title}**\n${body || ''}${link && base ? `\n${base}/clipper${link}` : ''}`); }
  };

  // ---------- money ----------
  // Same formula as the SQL function sidq_earn_cents.
  core.earnCents = (views, camp) => {
    const v = Number(views), min = Number(camp.min_views) || 0;
    if (!(v > 0) || v < min) return 0;
    let c = Math.floor(v * Math.round(Number(camp.rate) * 100) / 1000);
    if (camp.max_payout != null) c = Math.min(c, Math.round(Number(camp.max_payout) * 100));
    return c;
  };
  // Views that count toward pay: staff-verified views, else automatically tracked views, else nothing yet.
  core.payViews = s => s.views_verified != null ? Number(s.views_verified) : (s.views_source === 'api' ? Number(s.views) : null);
  core.balance = async (userId, c) => Number((await (c || db).query('SELECT COALESCE(SUM(amount_cents),0) AS b FROM ledger WHERE user_id = $1', [userId])).rows[0].b);
  core.recalcXp = userId => db.query(`UPDATE users SET xp = LEAST(2000000000, COALESCE((SELECT SUM(GREATEST(sidq_pay_views(views_verified, views, views_source), 0)) FROM submissions WHERE user_id = $1 AND status IN ('approved','verified','completed')), 0))::int WHERE id = $1`, [userId]);
  // Money promised to clippers per campaign (completed earnings + estimates for approved/verified clips).
  core.committed = async ids => {
    const out = new Map(); if (!ids.length) return out;
    const rows = (await db.query(`SELECT c.id, COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.earned_cents
        WHEN s.status IN ('approved','verified') THEN sidq_earn_cents(sidq_pay_views(s.views_verified, s.views, s.views_source), c.rate, c.min_views, c.max_payout) ELSE 0 END), 0) AS cents
      FROM campaigns c LEFT JOIN submissions s ON s.campaign_id = c.id WHERE c.id = ANY($1) GROUP BY c.id`, [ids])).rows;
    for (const r of rows) out.set(r.id, Number(r.cents));
    return out;
  };

  // Pay a verified clip into the clipper's wallet. Safe to call twice: the second call does nothing.
  core.finalize = async (id, actor) => {
    const st = await core.settings();
    const res = await core.tx(async c => {
      const s = (await c.query('SELECT * FROM submissions WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!s || s.status !== 'verified') return null;
      const camp = (await c.query('SELECT * FROM campaigns WHERE id = $1 FOR UPDATE', [s.campaign_id])).rows[0];
      const pv = core.payViews(s); if (pv == null) return null;
      let amt = core.earnCents(pv, camp), capped = false;
      const budget = Math.round(Number(camp.budget) * 100);
      if (budget > 0) {
        const used = Number((await c.query(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM ledger WHERE type = 'earning' AND campaign_id = $1`, [camp.id])).rows[0].t);
        const left = Math.max(0, budget - used);
        if (amt > left) { amt = left; capped = true; }
      }
      await c.query(`UPDATE submissions SET status = 'completed', earned_cents = $2, finalized_at = now(), updated_at = now() WHERE id = $1`, [id, amt]);
      if (amt > 0) {
        await c.query(`INSERT INTO ledger (user_id, type, amount_cents, submission_id, campaign_id, note) VALUES ($1,'earning',$2,$3,$4,$5)`, [s.user_id, amt, id, camp.id, clip(camp.title, 100)]);
        const ref = (await c.query('SELECT referred_by FROM users WHERE id = $1', [s.user_id])).rows[0];
        const bonus = ref && ref.referred_by ? Math.floor(amt * (Number(st.referral_pct) || 0) / 100) : 0;
        if (bonus > 0) await c.query(`INSERT INTO ledger (user_id, type, amount_cents, submission_id, campaign_id, note) VALUES ($1,'referral',$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [ref.referred_by, bonus, id, camp.id, 'Referral bonus']);
      }
      await core.event(c, id, actor ? actor.name : 'system', 'completed', amt > 0
        ? `${usd(amt)} added to the wallet for ${pv.toLocaleString('en-US')} views${capped ? ' (campaign budget ran out)' : ''}`
        : `Finished with ${pv.toLocaleString('en-US')} views, below the ${Number(camp.min_views).toLocaleString('en-US')} minimum, so nothing was earned`);
      return { amt, s, camp, pv, capped };
    });
    if (res) {
      await core.recalcXp(res.s.user_id);
      await core.notify(res.s.user_id, 'earning', res.amt > 0 ? `You earned ${usd(res.amt)}` : 'Clip finished without earnings',
        res.amt > 0 ? `${res.camp.title}: ${res.pv.toLocaleString('en-US')} views. The money is in your wallet.` : `${res.camp.title}: ${res.pv.toLocaleString('en-US')} views is below the ${Number(res.camp.min_views).toLocaleString('en-US')} view minimum.`, '#submission/' + id);
    }
    return res;
  };

  // ---------- payouts ----------
  core.requestPayout = async (user, cents, methodId) => {
    const st = await core.settings();
    const p = await core.tx(async c => {
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]); // one payout request at a time per clipper
      if (cents == null || cents <= 0) fail('Enter the amount you want to withdraw');
      if (cents < st.min_payout_cents) fail(`The minimum payout is ${usd(st.min_payout_cents)}`);
      if (cents > await core.balance(user.id, c)) fail('That is more than your available balance');
      if ((await c.query(`SELECT 1 FROM payouts WHERE user_id = $1 AND status IN ('requested','processing')`, [user.id])).rowCount) fail('You already have a payout in progress. You can request another once it is paid.');
      const m = (await c.query('SELECT * FROM payout_methods WHERE id = $1 AND user_id = $2', [methodId, user.id])).rows[0];
      if (!m) fail('Pick where to send the money');
      if (!st.methods[m.type]) fail(`${METHOD_NAMES[m.type] || m.type} payouts are not available right now. Pick another method.`);
      const row = (await c.query(`INSERT INTO payouts (user_id, method_type, method, amount_cents) VALUES ($1,$2,$3::jsonb,$4) RETURNING *`, [user.id, m.type, JSON.stringify(m.details), cents])).rows[0];
      await c.query(`INSERT INTO ledger (user_id, type, amount_cents, payout_id, note) VALUES ($1,'payout',$2,$3,$4)`, [user.id, -cents, row.id, 'Payout request #' + row.id]);
      return row;
    });
    core.hook('staff', { title: 'New payout request', description: `**${user.username}** requested **${usd(cents)}** via ${METHOD_NAMES[p.method_type] || p.method_type}`, fields: [{ name: 'Request', value: '#' + p.id, inline: true }] });
    return p;
  };
  // action: processing | paid | rejected | cancelled
  core.payoutAction = async (id, action, actor, o = {}) => {
    const r = await core.tx(async c => {
      const p = (await c.query('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!p) fail('Payout not found', 404);
      const open = p.status === 'requested' || p.status === 'processing';
      const by = actor && actor.id || null;
      if (action === 'processing') {
        if (p.status !== 'requested') fail('Only new requests can be moved to processing');
        await c.query(`UPDATE payouts SET status = 'processing', processed_by = $2, updated_at = now() WHERE id = $1`, [id, by]);
      } else if (action === 'paid') {
        if (!open) fail('This payout is already closed');
        await c.query(`UPDATE payouts SET status = 'paid', tx_ref = $2, note = $3, processed_by = $4, paid_at = now(), updated_at = now() WHERE id = $1`, [id, clip(o.tx_ref, 120), clip(o.note, 300), by]);
      } else if (action === 'rejected' || action === 'cancelled') {
        if (!open) fail('This payout is already closed');
        if (action === 'cancelled' && p.status !== 'requested') fail('It is already being processed, so it cannot be cancelled now');
        await c.query(`UPDATE payouts SET status = $2, note = $3, processed_by = $4, updated_at = now() WHERE id = $1`, [id, action, clip(o.note, 300), by]);
        await c.query(`INSERT INTO ledger (user_id, type, amount_cents, payout_id, note, actor_id) VALUES ($1,'payout_refund',$2,$3,$4,$5)`, [p.user_id, p.amount_cents, id, action === 'cancelled' ? 'Payout cancelled' : 'Payout rejected: ' + clip(o.note, 100), by]);
      } else fail('Unknown action');
      return (await c.query('SELECT * FROM payouts WHERE id = $1', [id])).rows[0];
    });
    return r;
  };

  // ---------- codes ----------
  core.refCode = async userId => {
    const cur = (await db.query('SELECT ref_code FROM users WHERE id = $1', [userId])).rows[0];
    if (cur && cur.ref_code) return cur.ref_code;
    for (let i = 0; i < 6; i++) {
      try {
        const u = await db.query('UPDATE users SET ref_code = $2 WHERE id = $1 AND ref_code IS NULL RETURNING ref_code', [userId, randCode(7)]);
        if (u.rows[0]) return u.rows[0].ref_code;
        return (await db.query('SELECT ref_code FROM users WHERE id = $1', [userId])).rows[0].ref_code;
      } catch (e) { if (e.code !== '23505') throw e; }
    }
    throw new Error('Could not create a referral code');
  };
  core.verifyCode = () => 'SIDQ-' + randCode(6);

  // ---------- fraud signals ----------
  // Looks at one clip and returns warning flags for staff. Nothing here rejects a clip by itself.
  core.assess = ({ sub, camp, userCreated, acctCreated, snaps, rejected30 }) => {
    const flags = [], views = Number(sub.views) || 0, eng = (Number(sub.likes) || 0) + (Number(sub.comments) || 0);
    if (sub.posted_at && camp && Number(camp.submit_hours) > 0) {
      const h = (new Date(sub.submitted_at || Date.now()) - new Date(sub.posted_at)) / 36e5;
      if (h > Number(camp.submit_hours)) flags.push({ code: 'late', level: 'high', text: `Posted ${Math.round(h)} hours before it was submitted (limit ${camp.submit_hours} hours)` });
    }
    if (sub.views_source === 'api' && views >= 3000 && eng / views < 0.003) flags.push({ code: 'low_engagement', level: 'high', text: `Only ${(eng / views * 100).toFixed(2)}% of viewers liked or commented. Very low engagement can mean bought views` });
    if (snaps && snaps.length) { const prev = Number(snaps[snaps.length - 1]); if (prev >= 500 && views >= prev * 5) flags.push({ code: 'spike', level: 'high', text: `Views jumped from ${prev.toLocaleString('en-US')} to ${views.toLocaleString('en-US')} between two checks` }); }
    if (acctCreated && Date.now() - new Date(acctCreated) < 3 * 864e5) flags.push({ code: 'new_account', level: 'warn', text: 'The connected account was added less than 3 days ago' });
    if (userCreated && Date.now() - new Date(userCreated) < 2 * 864e5) flags.push({ code: 'new_clipper', level: 'warn', text: 'Brand new clipper (joined less than 2 days ago)' });
    if (rejected30 >= 3) flags.push({ code: 'rejections', level: 'warn', text: `${rejected30} of this clipper's clips were rejected in the last 30 days` });
    return flags;
  };

  return core;
};
