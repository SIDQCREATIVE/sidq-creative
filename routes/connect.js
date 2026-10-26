'use strict';
// "Connect YouTube / TikTok / Instagram": the clipper signs in on the platform and comes back here.
//   GET  /connect/:platform/start      sends the clipper to the platform's sign-in page
//   GET  /connect/:platform/callback   the platform sends them back with ?code=. The account is approved and its tokens saved.
//   POST /connect/instagram/deauthorize, /connect/instagram/delete   the two callbacks Meta asks every app to provide
const crypto = require('crypto');
const express = require('express');

module.exports = function mountConnect(app, ctx) {
  const { db, core, sessionUserId, ck, setCk, sign, connect, jobs } = ctx;
  const PLATS = ['youtube', 'tiktok', 'instagram'], PLAT = connect.PLAT;
  const wrap = f => (q, r, n) => Promise.resolve(f(q, r, n)).catch(e => { console.error('[connect]', e && e.message); if (!r.headersSent) r.status(500).send('Something went wrong. Please go back and try again.'); });
  const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const stateMac = (platform, nonce, uid, exp) => sign(`connect.${platform}.${nonce}.${uid}.${exp}`);

  app.get('/connect/:platform/start', wrap(async (q, r) => {
    const platform = q.params.platform;
    if (!PLATS.includes(platform) || !connect.ready(platform)) return r.status(404).type('text').send('This connection is not set up yet.');
    const uid = sessionUserId(q);
    if (!uid) return r.redirect('/clipper');
    const u = (await db.query('SELECT id, agreed_at FROM users WHERE id = $1 AND NOT banned', [uid])).rows[0];
    if (!u || !u.agreed_at) return r.redirect('/clipper');
    core.limit('connect:' + uid, 30, 3600e3, 'You tried to connect too many times. Please wait a few minutes.');
    const { state, url } = connect.begin(platform, q), exp = Date.now() + 10 * 60e3;
    setCk(q, r, 'cs', `${platform}.${state}.${uid}.${exp}.${stateMac(platform, state, uid, exp)}`, 600);
    r.set('Cache-Control', 'no-store');
    r.redirect(url);
  }));

  app.get('/connect/:platform/callback', wrap(async (q, r) => {
    const platform = q.params.platform;
    if (!PLATS.includes(platform) || !connect.ready(platform)) return r.status(404).type('text').send('Not found');
    const done = code => { setCk(q, r, 'cs', '', 0); r.set('Cache-Control', 'no-store'); r.redirect('/clipper#accounts?' + (code === 'ok' ? 'connected=' + platform : 'connect_error=' + code + '&p=' + platform)); };
    const uid = sessionUserId(q);
    if (!uid) { setCk(q, r, 'cs', '', 0); return r.redirect('/clipper'); }
    // the "state" we sent must come back unchanged, and must belong to this clipper (stops someone else's sign-in being attached to this account)
    const [cp, nonce, cu, ce, mac] = String(ck(q).cs || '').split('.');
    if (cp !== platform || !nonce || +cu !== uid || !(+ce > Date.now()) || !eq(mac || '', stateMac(cp, nonce, cu, ce)) || !eq(q.query.state || '', nonce)) return done('failed');
    if (q.query.error) return done('denied');
    const code = String(q.query.code || '').replace(/#_$/, '');
    if (!code) return done('failed');
    const user = (await db.query('SELECT * FROM users WHERE id = $1 AND NOT banned', [uid])).rows[0];
    if (!user || !user.agreed_at) return done('failed');
    let acct;
    try { acct = await connect.complete(platform, code, q, user); }
    catch (e) {
      if (e instanceof connect.ConnectError) return done(e.code);
      console.error('[connect]', platform, e.message);
      return done(e.code === 'not_professional' || e.code === 'no_channel' ? e.code : 'failed');
    }
    await core.audit({ id: user.id, name: user.username }, 'account.connect', 'account', acct.id, { platform, handle: acct.handle, followers: acct.followers });
    await core.notify(user.id, 'account_approved', PLAT[platform] + ' connected', `@${acct.handle} is verified and its views are counted automatically. You can join campaigns now.`, '#campaigns');
    jobs.refreshAccount(acct.id).catch(e => console.error('[connect] first read failed:', e.message)); // clips already on this account get real numbers right away
    done('ok');
  }));

  // ---- Meta: "Deauthorize callback URL" and "Data deletion request URL" (the clipper removed our app inside Instagram) ----
  const signed = sr => {
    const secret = process.env.INSTAGRAM_APP_SECRET; if (!secret) return null;
    const [sig, payload] = String(sr || '').split('.'); if (!sig || !payload) return null;
    const want = crypto.createHmac('sha256', secret).update(payload).digest();
    let got; try { got = Buffer.from(sig, 'base64url'); } catch (e) { return null; }
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return null; }
  };
  const form = express.urlencoded({ extended: false, limit: '20kb' });
  app.post('/connect/instagram/deauthorize', form, wrap(async (q, r) => {
    const d = signed(q.body && q.body.signed_request); if (!d || !d.user_id) return r.status(400).json({ error: 'Bad request' });
    const rows = (await db.query(`SELECT id FROM platform_connections WHERE platform = 'instagram' AND external_id = $1 AND status = 'active'`, [String(d.user_id)])).rows;
    for (const c of rows) await connect.markExpired(c.id, 'The clipper removed the app in Instagram.');
    r.json({ ok: true });
  }));
  app.post('/connect/instagram/delete', form, wrap(async (q, r) => {
    const d = signed(q.body && q.body.signed_request); if (!d || !d.user_id) return r.status(400).json({ error: 'Bad request' });
    // forget the login and ask the clipper to verify the account the normal way
    const rows = (await db.query(`DELETE FROM platform_connections WHERE platform = 'instagram' AND external_id = $1 RETURNING account_id`, [String(d.user_id)])).rows;
    for (const c of rows) await db.query(`UPDATE accounts SET status = 'pending', verified_via = 'code', verify_code = $2 WHERE id = $1`, [c.account_id, core.verifyCode()]);
    r.json({ url: core.baseUrl(q) + '/clipper#accounts', confirmation_code: 'sidq-' + crypto.randomBytes(6).toString('hex') });
  }));
};
