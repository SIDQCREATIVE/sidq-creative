'use strict';
// "Connect" a clipper's own YouTube, TikTok or Instagram account with the platform's own login (OAuth).
//  - Signing in proves the account is theirs, so it is approved at once (no code in the bio, no waiting for staff).
//  - The platform then lets us read the views of THEIR OWN videos through its official API, so views are counted automatically.
//  - Access tokens are stored encrypted. Nothing is scraped.
const crypto = require('crypto');
const P = require('./platforms');

const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
// Refresh an access token this long before it runs out.
const AHEAD = { youtube: 120e3, tiktok: 300e3, instagram: 3 * 864e5 };

// code is what the clipper is shown (see the messages in public/portal/clipper/accounts.js)
class ConnectError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

module.exports = function makeConnect(ctx) {
  const { db, core } = ctx;

  // ---------- encrypted tokens (AES-256-GCM). The key comes from DATA_KEY only. It is not borrowed from SESSION_SECRET: changing the session secret to log everybody out must not break every connection. ----------
  const keyOf = () => { const s = process.env.DATA_KEY || ''; return s ? crypto.createHash('sha256').update('sidq-platform-tokens\0' + s).digest() : null; };
  const seal = text => {
    const k = keyOf(); if (!k) throw new Error('Set DATA_KEY in Railway so platform logins can be stored safely');
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv), enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  };
  const open = blob => {
    const k = keyOf(); if (!k) throw new Error('DATA_KEY is missing');
    const b = Buffer.from(blob, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  };
  const openToken = (blob, platform) => { try { return open(blob); } catch (e) { throw new P.ApiError('The saved ' + PLAT[platform] + ' login could not be read. The clipper must connect again.', { auth: true }); } };

  // which platforms can be connected right now (app keys are set and tokens can be stored)
  const ready = p => P.hasConnect(p) && !!keyOf();
  const status = () => ({ youtube: ready('youtube'), tiktok: ready('tiktok'), instagram: ready('instagram') });
  const redirectUri = (platform, q) => core.baseUrl(q) + '/connect/' + platform + '/callback';
  const begin = (platform, q) => { const state = crypto.randomBytes(16).toString('hex'); return { state, url: P.PROVIDERS[platform].authUrl({ redirectUri: redirectUri(platform, q), state }) }; };

  // ---------- saving a connection ----------
  // Finds or creates the clipper's account row for this platform identity, approves it, and stores the encrypted tokens.
  const save = (platform, user, profile, tok) => core.tx(async c => {
    const exp = tok.expiresIn ? new Date(Date.now() + tok.expiresIn * 1000) : null, rexp = tok.refreshExpiresIn ? new Date(Date.now() + tok.refreshExpiresIn * 1000) : null;
    // 1) this exact platform account is known already
    let acct = (await c.query('SELECT * FROM accounts WHERE platform = $1 AND external_id = $2 FOR UPDATE', [platform, profile.externalId])).rows[0];
    if (acct && acct.user_id !== user.id) throw new ConnectError('taken');
    // 2) the same @username was added before
    if (!acct) {
      const same = (await c.query('SELECT * FROM accounts WHERE platform = $1 AND lower(handle) = lower($2) FOR UPDATE', [platform, profile.handle])).rows[0];
      if (same && same.user_id !== user.id) {
        if (same.status === 'approved') throw new ConnectError('taken');
        await c.query('DELETE FROM accounts WHERE id = $1', [same.id]); // somebody typed this username but never proved it. Signing in proves it.
      } else if (same) acct = same;
    }
    if (!acct) {
      if ((await c.query('SELECT count(*)::int AS n FROM accounts WHERE user_id = $1', [user.id])).rows[0].n >= 10) throw new ConnectError('limit');
      acct = (await c.query(`INSERT INTO accounts (user_id, platform, handle, followers, status, external_id, verified_via, reviewed_at) VALUES ($1,$2,$3,$4,'approved',$5,'api', now()) RETURNING *`,
        [user.id, platform, profile.handle, profile.followers, profile.externalId])).rows[0];
    } else {
      await c.query(`UPDATE accounts SET handle = $2, followers = $3, status = 'approved', external_id = $4, verified_via = 'api', reject_reason = '', reviewed_at = now() WHERE id = $1`, [acct.id, profile.handle, profile.followers, profile.externalId]);
    }
    await c.query(`INSERT INTO platform_connections (account_id, user_id, platform, external_id, access_token, refresh_token, expires_at, refresh_expires_at, scopes, status, last_error, connected_at, refreshed_at, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','', now(), now(), now())
      ON CONFLICT (account_id) DO UPDATE SET external_id = $4, access_token = $5, refresh_token = COALESCE($6, platform_connections.refresh_token), expires_at = $7, refresh_expires_at = $8,
        scopes = $9, status = 'active', last_error = '', connected_at = now(), refreshed_at = now(), synced_at = now()`,
      [acct.id, user.id, platform, profile.externalId, seal(tok.accessToken), tok.refreshToken ? seal(tok.refreshToken) : null, exp, rexp, tok.scopes]);
    return (await c.query('SELECT * FROM accounts WHERE id = $1', [acct.id])).rows[0];
  });

  // The platform sent the clipper back with ?code=. Returns the (now approved) account row.
  const complete = async (platform, code, q, user) => {
    const prov = P.PROVIDERS[platform];
    const tok = await prov.exchange(code, redirectUri(platform, q));
    const got = tok.scopes.split(/[,\s]+/).filter(Boolean);
    if (platform === 'youtube' && !got.some(s => s.endsWith('/youtube.readonly') || s.endsWith('/youtube'))) throw new ConnectError('noscope');
    for (const s of prov.required || []) if (!got.includes(s)) throw new ConnectError('noscope');
    const profile = await prov.profile(tok.accessToken);
    if (!profile.externalId) throw new ConnectError('failed');
    if (!profile.handle) throw new ConnectError('nohandle');
    try { return await save(platform, user, profile, tok); }
    catch (e) { if (e.code === '23505') throw new ConnectError('taken'); throw e; }
  };

  // ---------- using a connection ----------
  const loadConn = async accountId => (await db.query('SELECT * FROM platform_connections WHERE account_id = $1', [accountId])).rows[0] || null;
  const markExpired = async (id, message) => {
    const r = await db.query(`UPDATE platform_connections SET status = 'expired', last_error = $2 WHERE id = $1 AND status = 'active' RETURNING user_id, platform`, [id, String(message || '').slice(0, 300)]);
    if (r.rows[0]) await core.notify(r.rows[0].user_id, 'connection_expired', PLAT[r.rows[0].platform] + ' connection expired', 'Open Accounts and press Reconnect, so we can keep counting your views.', '#accounts');
  };
  const expired = (conn, msg) => new P.ApiError(msg || `The ${PLAT[conn.platform]} connection has expired. The clipper must connect again.`, { auth: true });

  // A new access token. Runs under a database lock because TikTok replaces the refresh token on every refresh.
  const refresh = async (id, failedBlob) => {
    const res = await core.tx(async c => {
      await c.query('SELECT pg_advisory_xact_lock(727200, $1)', [id]);
      const conn = (await c.query('SELECT * FROM platform_connections WHERE id = $1', [id])).rows[0];
      if (!conn || conn.status !== 'active') return { err: expired(conn || { platform: 'youtube' }) };
      const exp = conn.expires_at ? new Date(conn.expires_at).getTime() : Infinity;
      // someone refreshed while we waited (TikTok replaces the refresh token each time, so a second refresh would fail)
      if (failedBlob ? conn.access_token !== failedBlob : exp - Date.now() > AHEAD[conn.platform]) return { token: openToken(conn.access_token, conn.platform) };
      // Instagram only allows a refresh when the token is at least a day old
      if (!failedBlob && conn.platform === 'instagram' && exp > Date.now() && Date.now() - new Date(conn.refreshed_at || conn.connected_at).getTime() < 864e5) return { token: openToken(conn.access_token, conn.platform) };
      let t;
      try {
        if (conn.platform === 'instagram') t = await P.PROVIDERS.instagram.refresh(openToken(conn.access_token, 'instagram'));
        else { if (!conn.refresh_token) return { err: expired(conn) }; t = await P.PROVIDERS[conn.platform].refresh(openToken(conn.refresh_token, conn.platform)); }
      } catch (e) { return { err: e, conn }; }
      await c.query(`UPDATE platform_connections SET access_token = $2, refresh_token = COALESCE($3, refresh_token), expires_at = $4, refresh_expires_at = COALESCE($5, refresh_expires_at), refreshed_at = now(), status = 'active', last_error = '' WHERE id = $1`,
        [id, seal(t.accessToken), t.refreshToken ? seal(t.refreshToken) : null, t.expiresIn ? new Date(Date.now() + t.expiresIn * 1000) : null, t.refreshExpiresIn ? new Date(Date.now() + t.refreshExpiresIn * 1000) : null]);
      return { token: t.accessToken };
    });
    if (res.err) { if (res.err.auth) await markExpired(id, res.err.message); throw res.err; }
    return res.token;
  };
  // A valid access token for this connection, refreshed when it is about to run out. Throws ApiError (auth = must connect again).
  const token = async conn => {
    if (conn.status !== 'active') throw expired(conn);
    const exp = conn.expires_at ? new Date(conn.expires_at).getTime() : Infinity;
    if (exp - Date.now() > AHEAD[conn.platform]) return openToken(conn.access_token, conn.platform);
    return refresh(conn.id);
  };

  // Runs fn(accessToken). If the platform says the token is no longer valid although it should be, refresh once and try again.
  const withToken = async (conn, fn) => {
    const t = await token(conn);
    try { return await fn(t); }
    catch (e) { if (!e.auth) throw e; return fn(await refresh(conn.id, conn.access_token)); }
  };

  // Numbers for several clips of one connected account. clips = [{ id, external_id, api_ref }].
  // Returns Map(clip id -> { views, likes, comments, title, thumb, postedAt, ref? } or null when the platform does not show that video).
  const readClips = (conn, clips) => withToken(conn, async t => {
    const out = new Map();
    if (conn.platform === 'youtube') {
      const map = (await P.youtubeVideos(clips.map(s => s.external_id), t)) || new Map();
      for (const s of clips) out.set(s.id, map.get(s.external_id) || null);
    } else if (conn.platform === 'tiktok') {
      const map = await P.PROVIDERS.tiktok.videos(t, clips.map(s => s.external_id));
      for (const s of clips) out.set(s.id, map.get(String(s.external_id)) || null);
    } else {
      // one pass over the account's posts finds every clip that does not know its Instagram post id yet
      const need = clips.filter(s => !s.api_ref).map(s => s.external_id), found = need.length ? await P.PROVIDERS.instagram.findMedia(t, need) : new Map();
      for (const s of clips) {
        let ref = s.api_ref;
        if (!ref) { const m = found.get(s.external_id); if (m) { ref = String(m.id); await db.query('UPDATE submissions SET api_ref = $2 WHERE id = $1', [s.id, ref]); } }
        const st = ref ? await P.PROVIDERS.instagram.mediaStats(t, ref) : null;
        out.set(s.id, st ? { ...st, ref } : null);
      }
    }
    return out;
  });
  // One clip that is being submitted: is it really on this account, and what are its numbers?
  const lookup = (conn, p) => withToken(conn, async t => {
    if (conn.platform === 'instagram') {
      const m = (await P.PROVIDERS.instagram.findMedia(t, [p.id])).get(p.id); if (!m) return { found: false };
      const st = await P.PROVIDERS.instagram.mediaStats(t, String(m.id));
      return st ? { found: true, ref: String(m.id), stats: st } : { found: false };
    }
    const map = conn.platform === 'tiktok' ? await P.PROVIDERS.tiktok.videos(t, [p.id]) : await P.youtubeVideos([p.id], t);
    const v = map && map.get(p.id);
    return v ? { found: true, stats: v } : { found: false };
  });

  // Follower count and @username can change. Keep them current (campaigns can ask for a minimum number of followers).
  const sync = async conn => {
    if (conn.platform === 'instagram' && Date.now() - new Date(conn.refreshed_at || conn.connected_at).getTime() > 7 * 864e5) await refresh(conn.id); // weekly, keeps the 60 day token alive
    conn = (await db.query('SELECT * FROM platform_connections WHERE id = $1', [conn.id])).rows[0] || conn;
    const pr = await withToken(conn, t => P.PROVIDERS[conn.platform].profile(t));
    if (pr.externalId && pr.externalId !== conn.external_id) throw expired(conn, 'The signed-in account is not the one that was connected.');
    await db.query('UPDATE accounts SET followers = $2 WHERE id = $1', [conn.account_id, pr.followers]);
    if (pr.handle) await db.query(`UPDATE accounts SET handle = $2 WHERE id = $1 AND lower(handle) <> lower($2)
      AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.platform = $3 AND lower(x.handle) = lower($2) AND x.id <> $1)`, [conn.account_id, pr.handle, conn.platform]);
    await db.query('UPDATE platform_connections SET synced_at = now(), last_error = $2 WHERE id = $1', [conn.id, '']);
  };
  // Daily upkeep of every connection: refresh tokens and profile numbers, and notice connections that stopped working.
  const syncDue = async (limit = 150) => {
    const rows = (await db.query(`SELECT * FROM platform_connections WHERE status = 'active' AND COALESCE(synced_at, connected_at) < now() - interval '20 hours' ORDER BY COALESCE(synced_at, connected_at) LIMIT $1`, [limit])).rows;
    let ok = 0, failed = 0;
    for (const c of rows) {
      try { await sync(c); ok++; }
      catch (e) {
        failed++;
        if (e.auth) await markExpired(c.id, e.message);
        else await db.query('UPDATE platform_connections SET last_error = $2, synced_at = now() WHERE id = $1', [c.id, String(e.message).slice(0, 300)]);
      }
    }
    return { synced: ok, failed };
  };

  // Removing an account also signs us out of the platform (best effort).
  const revokeFor = async accountId => {
    const conn = await loadConn(accountId); if (!conn) return;
    try { await P.PROVIDERS[conn.platform].revoke(open(conn.access_token)); } catch (e) { /* the connection row is deleted anyway */ }
  };

  return { PLAT, ConnectError, ready, status, redirectUri, begin, complete, loadConn, token, refresh, readClips, lookup, sync, syncDue, markExpired, revokeFor, keyReady: () => !!keyOf(), seal, open };
};
module.exports.ConnectError = ConnectError;
