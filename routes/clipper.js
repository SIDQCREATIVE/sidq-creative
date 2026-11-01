'use strict';
// API for logged-in clippers: profile, accounts, campaigns, clips, analytics uploads, wallet and payouts,
// leaderboard, clipper directory, notifications, support tickets, news.
const express = require('express');
const P = require('../lib/platforms');
const makeClips = require('../lib/clips');
const diag = require('../lib/diag');
const release = require('../lib/release');
const wire = require('../lib/wire');

module.exports = function mountClipper(app, ctx) {
  const { db, core, needUser, sessionUserId, actorOf, ROLES, connect } = ctx;
  const { service, autoverify } = wire(ctx); // built here when server.js did not build them (an older server.js)
  const { safe } = wire;
  release.mount(app, ctx); // /version: are all files from the same release?
  const { fail, clip, int, HttpError } = core;
  const { STAGE_SQL, CLIP_SELECT, stageOf, clipOut } = makeClips(core);

  const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
  const PV = 'sidq_pay_views(s.views_verified, s.views, s.views_source)';
  const COUNTED = `s.status IN ('approved','verified','completed')`;
  const MAX_VIDEO = 80 * 1024 * 1024, MAX_IMAGE = 6 * 1024 * 1024;

  const sendError = (r, e, q) => {
    if (e instanceof HttpError) return r.status(e.status).json({ error: e.message });
    if (e && (e.status === 413 || e.type === 'entity.too.large')) return r.status(413).json({ error: 'That file is too large. A screen recording can be up to 80 MB and a screenshot up to 6 MB. Record a shorter video, about 3 minutes is enough.' });
    if (e && e.type && /^(request\.aborted|request\.size\.invalid|stream\.encoding\.set)$/.test(e.type)) return r.status(400).json({ error: 'The upload was interrupted. Please try again.' });
    diag.reply(r, q, e, 'Something went wrong on our side. Please try again.'); // the owner also gets the real reason
  };
  const h = fn => (q, r, n) => Promise.resolve().then(() => fn(q, r, n)).catch(e => sendError(r, e, q));
  const ready = q => { if (!q.user.agreed_at) fail('Finish the start-up steps first (age and rules).'); };
  const paging = (q, per = 20) => { const page = int(q.query.page, 1, 1, 100000); return { page, per, offset: (page - 1) * per }; };
  const like = s => '%' + String(s).replace(/[\\%_]/g, '\\$&') + '%';
  const isOpen = c => c.status === 'live' && (!c.ends_at || new Date(c.ends_at) > new Date());
  const isSunday = () => new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Karachi' }) === 'Sunday';
  const ago = hrs => hrs < 1 ? 'less than an hour' : hrs < 48 ? Math.round(hrs) + ' hours' : Math.round(hrs / 24) + ' days';

  const campOut = (x, committed) => {
    const budgetCents = Math.round(Number(x.budget) * 100), used = committed || 0;
    return { id: x.id, title: x.title, label: x.label, image: x.image, rate: Number(x.rate), budget_cents: budgetCents, committed_cents: used,
      min_views: x.min_views, max_payout: x.max_payout == null ? null : Number(x.max_payout), platforms: x.platforms.split(','), submit_hours: x.submit_hours,
      min_followers: x.min_followers, status: x.status, ends_at: x.ends_at, requires_analytics: x.requires_analytics, track_days: x.track_days,
      open: isOpen(x) && !(budgetCents > 0 && used >= budgetCents), members: x.members == null ? undefined : Number(x.members), clips: x.clips == null ? undefined : Number(x.clips) };
  };

  // ---------------------------------------------------------------- me
  app.get('/api/me', h(async (q, r) => {
    const id = sessionUserId(q);
    const u = id && (await db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    if (!u) return r.json({ user: null });
    if (u.banned) return r.json({ user: null, banned: true, reason: u.ban_reason || '' });
    q.user = u; // lets an error on this page tell the owner the real reason
    const [accounts, balance, unread, st, needs] = await Promise.all([
      db.query(`SELECT a.id, a.platform, a.handle, a.followers, a.status, a.verify_code, a.reject_reason, a.verified_via, pc.status AS conn_status, pc.synced_at AS conn_synced
        FROM accounts a LEFT JOIN platform_connections pc ON pc.account_id = a.id WHERE a.user_id = $1 ORDER BY a.id`, [u.id]),
      core.balance(u.id),
      db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [u.id]),
      core.settings(),
      db.query(`SELECT count(*)::int AS n FROM submissions WHERE user_id = $1 AND status IN ('approved','verified') AND analytics_state = 'requested'`, [u.id])
    ]);
    const role = ROLES[u.role];
    r.json({
      user: { id: u.id, username: u.username, avatar: u.avatar, role: u.role, bio: u.bio, onboarded: !!u.agreed_at, xp: u.xp, show_earnings: u.show_earnings, ...core.rankOf(u.xp) },
      accounts: accounts.rows.map(a => ({ id: a.id, platform: a.platform, handle: a.handle, followers: a.followers, status: a.status, verify_code: a.verify_code, reject_reason: a.reject_reason,
        connected: a.verified_via === 'api', conn_status: a.verified_via === 'api' ? (a.conn_status || 'expired') : null, conn_synced: a.conn_synced })),
      balance_cents: balance, unread: unread.rows[0].n, needs: { analytics: needs.rows[0].n },
      staff: role ? { role: u.role, label: role.label, perms: role.perms } : null,
      settings: { min_payout_cents: st.min_payout_cents, payout_note: st.payout_note, referral_pct: st.referral_pct, methods: st.methods, show_payout_feed: st.show_payout_feed },
      staffHoliday: isSunday(), youtube: P.hasYoutubeKey(), auto: safe('me.auto', () => autoverify.status(), {}), connect: safe('me.connect', () => connect.status(), {})
    });
  }));
  app.post('/api/onboard', needUser, h(async (q, r) => {
    if (!(q.body && q.body.age && q.body.terms)) fail('Tick both boxes to continue');
    await db.query('UPDATE users SET agreed_at = COALESCE(agreed_at, now()) WHERE id = $1', [q.user.id]);
    r.json({ ok: true });
  }));
  app.put('/api/profile', needUser, h(async (q, r) => {
    const b = q.body || {};
    await db.query('UPDATE users SET bio = $1, show_earnings = $2 WHERE id = $3', [clip(b.bio, 200), b.show_earnings !== false, q.user.id]);
    r.json({ ok: true });
  }));

  // ---------------------------------------------------------------- accounts
  const cleanHandle = (platform, raw) => {
    let s = String(raw || '').trim();
    if (/^https?:\/\//i.test(s)) {
      try { const p = new URL(s).pathname.split('/').filter(Boolean); s = (p.find(x => x[0] === '@') || (platform === 'instagram' ? p[0] : '') || '').toString(); } catch (e) { s = ''; }
    }
    s = s.replace(/^@/, '');
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(s)) fail('Enter your username, like @yourname, or paste the link to your profile');
    return s;
  };
  app.post('/api/accounts', needUser, h(async (q, r) => {
    ready(q); core.limit('acct:' + q.user.id, 20, 3600e3);
    const platform = String(q.body.platform || '');
    if (!PLAT[platform]) fail('Pick YouTube, TikTok or Instagram');
    let handle = cleanHandle(platform, q.body.handle);
    if ((await db.query('SELECT count(*)::int AS c FROM accounts WHERE user_id = $1', [q.user.id])).rows[0].c >= 10) fail('You can connect up to 10 accounts');
    // "Is the account name correct?" Where the website can read the platform by itself, a wrong username is caught right now.
    const pr = await autoverify.lookup(platform, handle);
    if (pr && !pr.found) fail(`We could not find @${handle} on ${PLAT[platform]}. Check the spelling of the username and try again.`);
    if (pr && pr.isPrivate) fail(`@${handle} is a private account. Make it public so we can read your bio and your views, then add it again.`);
    if (pr && pr.handle && pr.handle.toLowerCase() === handle.toLowerCase()) handle = pr.handle; // the platform's own spelling
    const insert = () => db.query('INSERT INTO accounts (user_id, platform, handle, verify_code) VALUES ($1,$2,$3,$4) RETURNING id', [q.user.id, platform, handle, core.verifyCode()]);
    let a = null;
    try { a = (await insert()).rows[0]; }
    catch (e) {
      if (e.code !== '23505') throw e;
      // Somebody typed this username a day ago or more and never proved it was theirs (no code found, no clips). Anyone can type any username,
      // so such a claim must not keep the real owner out forever: it is dropped. A verified account, or one with clips, is never touched.
      const stale = await db.query(`DELETE FROM accounts x WHERE x.platform = $1 AND lower(x.handle) = lower($2) AND x.user_id <> $3 AND x.status IN ('pending','rejected')
        AND x.verified_via = 'code' AND x.external_id IS NULL AND x.code_at < now() - interval '24 hours' AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.account_id = x.id)`, [platform, handle, q.user.id]);
      if (stale.rowCount) { try { a = (await insert()).rows[0]; } catch (e2) { if (e2.code !== '23505') throw e2; } }
    }
    if (!a) {
      const own = (await db.query('SELECT user_id, status FROM accounts WHERE platform = $1 AND lower(handle) = lower($2)', [platform, handle])).rows[0];
      if (own && own.user_id === q.user.id) fail('You already added this account', 409);
      fail(own && own.status === 'approved' ? 'Another clipper already connected this account. If it is yours, open a support ticket.'
        : 'Another clipper added this username but has not verified it yet. If the account is yours, try again in a day, or open a support ticket.', 409);
    }
    r.json({ ok: true, id: a.id, handle, found: pr ? { followers: pr.followers } : null, auto: !!autoverify.sourceFor(platform) });
  }));
  const myAccount = async q => { const a = (await db.query('SELECT * FROM accounts WHERE id = $1 AND user_id = $2', [int(q.params.id), q.user.id])).rows[0]; if (!a) fail('Account not found', 404); return a; };
  app.delete('/api/accounts/:id', needUser, h(async (q, r) => {
    const a = await myAccount(q);
    if ((await db.query(`SELECT 1 FROM submissions WHERE account_id = $1 AND status IN ('pending','approved','verified') LIMIT 1`, [a.id])).rowCount) fail('This account still has clips in progress. Wait until they are finished, or open a support ticket.');
    await connect.revokeFor(a.id); // an account that was connected with the platform's login also signs out of it
    await db.query('DELETE FROM accounts WHERE id = $1', [a.id]); r.json({ ok: true });
  }));
  app.post('/api/accounts/:id/resubmit', needUser, h(async (q, r) => {
    const a = await myAccount(q);
    if (a.status !== 'rejected') fail('Only rejected accounts can be sent for review again');
    await db.query(`UPDATE accounts SET status = 'pending', reject_reason = '', verify_code = $2, code_at = now(), checked_at = NULL WHERE id = $1`, [a.id, core.verifyCode()]);
    r.json({ ok: true });
  }));
  // Look for the verification code in the bio, without a person: YouTube with the free API key, TikTok and Instagram through the data service.
  app.post('/api/accounts/:id/check', needUser, h(async (q, r) => {
    const a = await myAccount(q);
    core.limit('acctcheck:' + q.user.id, 15, 3600e3, 'You checked too many times. Wait a few minutes.');
    if (a.status === 'approved') return r.json({ ok: true, approved: true });
    if (a.status !== 'pending') fail('This account was not approved. Press Send for review again to get a new code.');
    if (!autoverify.sourceFor(a.platform)) fail('A team member will check this account. You do not need to do anything else.');
    const res = await autoverify.check(a, 'live'), where = a.platform === 'youtube' ? 'your channel description' : 'your bio';
    if (res.state === 'approved') return r.json({ ok: true, approved: true });
    if (res.state === 'not_found') fail(`We could not find @${a.handle} on ${PLAT[a.platform]}. Check the spelling of the username.`);
    if (res.state === 'private') fail(`@${a.handle} is a private account. Make it public so we can read your bio, then check again.`);
    if (res.state === 'no_code') fail(`We could not find ${a.verify_code} in ${where} yet. Save it, wait a minute, then check again.`);
    if (res.state === 'taken') fail('This account is already verified for another clipper. If it is yours, open a support ticket.', 409);
    if (res.state === 'unavailable') {
      console.error(`${a.platform} account check failed:`, res.error && res.error.message);
      if (res.error && ['capped', 'down', 'key'].includes(res.error.code)) fail('Automatic checking is not available right now. A team member will check this account.', 503);
      fail(`${PLAT[a.platform]} did not answer. Try again in a minute.`, 502);
    }
    fail('A team member will check this account. You do not need to do anything else.');
  }));

  // ---------------------------------------------------------------- campaigns
  const campList = async userId => {
    const rows = (await db.query(`SELECT c.*,
        (SELECT count(*)::int FROM campaign_members m WHERE m.campaign_id = c.id) AS members,
        (SELECT count(*)::int FROM submissions s WHERE s.campaign_id = c.id AND s.status IN ('approved','verified','completed')) AS clips,
        EXISTS (SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = $1) AS joined
      FROM campaigns c WHERE c.status IN ('live','ended') ORDER BY (c.status = 'live') DESC, c.id DESC`, [userId])).rows;
    const com = await core.committed(rows.map(x => x.id));
    return rows.map(x => ({ ...campOut(x, com.get(x.id)), joined: x.joined }));
  };
  app.get('/api/campaigns', needUser, h(async (q, r) => r.json(await campList(q.user.id))));

  app.get('/api/campaigns/:id', needUser, h(async (q, r) => {
    const id = int(q.params.id);
    const x = (await db.query(`SELECT c.*, (SELECT count(*)::int FROM campaign_members m WHERE m.campaign_id = c.id) AS members,
        EXISTS (SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = $2) AS joined
      FROM campaigns c WHERE c.id = $1 AND c.status IN ('live','ended')`, [id, q.user.id])).rows[0];
    if (!x) fail('Campaign not found', 404);
    const com = await core.committed([id]);
    const accounts = (await db.query(`SELECT id, platform, handle, followers FROM accounts WHERE user_id = $1 AND status = 'approved' ORDER BY id`, [q.user.id])).rows;
    const plats = x.platforms.split(',');
    const usable = accounts.filter(a => plats.includes(a.platform));
    const top = (await db.query(`SELECT u.id, u.username, u.avatar, u.show_earnings, count(*)::int AS clips,
        COALESCE(SUM(GREATEST(${PV}, 0)), 0)::bigint AS views, COALESCE(SUM(s.earned_cents), 0)::bigint AS earned
      FROM submissions s JOIN users u ON u.id = s.user_id AND NOT u.banned WHERE s.campaign_id = $1 AND ${COUNTED}
      GROUP BY u.id HAVING COALESCE(SUM(GREATEST(${PV}, 0)), 0) > 0 ORDER BY views DESC, u.id LIMIT 10`, [id])).rows
      .map(t => ({ id: t.id, username: t.username, avatar: t.avatar, clips: t.clips, views: Number(t.views), earned_cents: t.show_earnings ? Number(t.earned) : null }));
    const mine = x.joined ? (await db.query(`SELECT count(*)::int AS clips, COALESCE(SUM(GREATEST(${PV}, 0)) FILTER (WHERE ${COUNTED}), 0)::bigint AS views,
        COALESCE(SUM(s.earned_cents), 0)::bigint AS earned FROM submissions s WHERE s.campaign_id = $1 AND s.user_id = $2 AND s.status <> 'rejected'`, [id, q.user.id])).rows[0] : null;
    r.json({
      ...campOut(x, com.get(id)), brief: x.brief, analytics_note: x.analytics_note, joined: x.joined,
      rules: x.joined ? x.rules : null, assets_url: x.joined ? x.assets_url : null,
      me: mine && { clips: mine.clips, views: Number(mine.views), earned_cents: Number(mine.earned) },
      eligibility: { accounts: usable, has_account: usable.length > 0, meets_followers: usable.some(a => a.followers >= x.min_followers) },
      accounts: usable, top
    });
  }));

  app.post('/api/campaigns/:id/join', needUser, h(async (q, r) => {
    ready(q);
    const x = (await db.query('SELECT * FROM campaigns WHERE id = $1', [int(q.params.id)])).rows[0];
    if (!x || !isOpen(x)) fail('This campaign is not open for new clippers');
    const plats = x.platforms.split(',');
    const accts = (await db.query(`SELECT platform, followers FROM accounts WHERE user_id = $1 AND status = 'approved'`, [q.user.id])).rows.filter(a => plats.includes(a.platform));
    if (!accts.length) fail(`Connect and verify a ${plats.map(p => PLAT[p]).join(', ')} account first. Open Accounts to do that.`);
    if (x.min_followers > 0 && !accts.some(a => a.followers >= x.min_followers)) fail(`This campaign needs an account with at least ${x.min_followers.toLocaleString('en-US')} followers`);
    await db.query('INSERT INTO campaign_members (campaign_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [x.id, q.user.id]);
    r.json({ ok: true });
  }));

  // ---------------------------------------------------------------- clips
  app.post('/api/campaigns/:id/submit', needUser, h(async (q, r) => {
    const u = q.user; ready(q);
    core.limit('submit:' + u.id, 30, 3600e3, 'You are submitting too fast. Wait a few minutes and try again.');
    const camp = (await db.query('SELECT * FROM campaigns WHERE id = $1', [int(q.params.id)])).rows[0];
    if (!camp) fail('Campaign not found', 404);
    if (!isOpen(camp)) fail('This campaign is not accepting clips right now');
    if (!(await db.query('SELECT 1 FROM campaign_members WHERE campaign_id = $1 AND user_id = $2', [camp.id, u.id])).rowCount) fail('Join the campaign before you submit clips');
    const acct = (await db.query('SELECT * FROM accounts WHERE id = $1 AND user_id = $2', [int(q.body.account_id), u.id])).rows[0];
    if (!acct) fail('Pick the account you posted this clip on');
    if (acct.status !== 'approved') fail('That account is not verified yet');
    if (!camp.platforms.split(',').includes(acct.platform)) fail(`This campaign does not accept ${PLAT[acct.platform]} clips`);
    const budget = Math.round(Number(camp.budget) * 100);
    if (budget > 0 && ((await core.committed([camp.id])).get(camp.id) || 0) >= budget) fail('This campaign has used up its whole budget');

    let p = P.parseClipUrl(q.body.url);
    if (!p) fail('That is not a video link we can read. Paste the link of a YouTube video or Short, a TikTok video or an Instagram reel.');
    if (p.short) { p = await P.resolveShort(p); if (!p) fail('We could not open that share link. Open the video, copy its full link from the share menu and paste that instead.'); }
    if (p.platform !== acct.platform) fail(`That is a ${PLAT[p.platform]} link, but you picked your ${PLAT[acct.platform]} account`);
    // An account the clipper connected with the platform's own login is checked by asking the platform itself (below).
    const conn = acct.verified_via === 'api' ? await connect.loadConn(acct.id) : null;
    if (!conn && p.handle && p.handle.toLowerCase() !== acct.handle.toLowerCase()) fail(`This video was posted by @${p.handle}, not by your connected account @${acct.handle}`);

    const info = { title: '', thumb: '', views: 0, likes: 0, comments: 0, postedAt: p.postedAt || null, source: 'none', ref: null };
    const extraFlags = [];
    let linked = false;
    if (conn && !(p.platform === 'youtube' && P.hasYoutubeKey())) {
      const again = `Your ${PLAT[acct.platform]} connection has expired. Open Accounts, press Reconnect, then submit this clip again.`;
      if (conn.status !== 'active') fail(again);
      let found = null;
      try { found = await connect.lookup(conn, p); }
      catch (e) {
        if (e.auth) fail(again);
        console.error('connected lookup failed:', e.message); // a short outage of the platform must not stop clippers: staff check this clip by hand instead
        extraFlags.push({ code: 'lookup_failed', level: 'high', text: `${PLAT[acct.platform]} did not answer, so it was not checked that this video is on the connected account. Open the video and check that it is really the clipper's.` });
      }
      if (found && !found.found) {
        if (acct.platform === 'instagram') extraFlags.push({ code: 'not_on_account', level: 'high', text: 'This reel was not found among the recent posts of the connected Instagram account. Check that it is really theirs.' });
        else fail(`We could not find this video on your connected ${PLAT[acct.platform]} account @${acct.handle}. Make sure you posted it from that account and that it is public. If you posted it just now, wait a few minutes and try again.`);
      } else if (found) {
        const st = found.stats;
        if (acct.platform === 'youtube' && st.channelId && acct.external_id && st.channelId !== acct.external_id) fail(`This video is not on your connected channel @${acct.handle}`);
        Object.assign(info, { title: st.title, thumb: st.thumb, views: st.views, likes: st.likes, comments: st.comments, postedAt: st.postedAt || info.postedAt, source: 'api', ref: found.ref || null });
        linked = true;
      }
    }
    if (linked) { /* the platform already told us everything */ }
    else if (p.platform === 'youtube' && P.hasYoutubeKey()) {
      let map = null; try { map = await P.youtubeVideos([p.id]); } catch (e) { console.error('youtube lookup:', e.message); }
      if (map) {
        const v = map.get(p.id);
        if (!v) fail('We could not find this video. Make sure it is public or unlisted (not private) and try again.');
        let cid = acct.external_id;
        if (!cid) { try { const ch = await P.youtubeChannel(acct.handle); if (ch && ch.found) { cid = ch.id; await db.query('UPDATE accounts SET external_id = $2 WHERE id = $1', [acct.id, cid]); } } catch (e) { /* staff will check the channel by hand */ } }
        if (cid && v.channelId && cid !== v.channelId) fail(`This video is not on your connected channel @${acct.handle}`);
        Object.assign(info, { title: v.title, thumb: v.thumb, views: v.views, likes: v.likes, comments: v.comments, postedAt: v.postedAt || info.postedAt, source: 'api' });
      }
    } else if (p.platform === 'tiktok' || p.platform === 'instagram') {
      // The optional data service reads the public video: its author (so a clip that is not the clipper's is refused), its views and when it was posted.
      let v = null;
      if (service.enabled()) {
        try { v = await service.video(p.platform, p, { kind: 'live' }); }
        catch (e) {
          console.error(`${p.platform} data service lookup failed:`, e.message);
          if (!extraFlags.some(f => f.code === 'lookup_failed')) extraFlags.push({ code: 'lookup_failed', level: 'high', text: `${PLAT[p.platform]} could not be read automatically right now, so it was not checked that this video is on the clipper's account. Open the video and check that it is really the clipper's.` });
        }
      }
      if (v && !v.found) fail(`We could not find this video on ${PLAT[p.platform]}. Make sure it is public and posted from your account @${acct.handle}. If you posted it just now, wait a few minutes and try again.`);
      if (v && !v.isVideo) fail('That link is a photo post. Submit the link of a video or reel.');
      if (v) {
        const same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
        const mine = v.author ? same(v.author, acct.handle) || (v.coauthors || []).some(x => same(x, acct.handle)) : p.platform === 'tiktok' && !!p.handle && same(p.handle, acct.handle); // a TikTok link names its account
        if (v.author && !mine) fail(`This video was posted by @${v.author}, not by your account @${acct.handle}`);
        if (mine) {
          Object.assign(info, { title: v.title, thumb: v.thumb, views: v.views, likes: v.likes, comments: v.comments, postedAt: v.postedAt || info.postedAt, source: 'api' });
          for (let i = extraFlags.length - 1; i >= 0; i--) if (['lookup_failed', 'not_on_account'].includes(extraFlags[i].code)) extraFlags.splice(i, 1); // the data service has now shown whose video it is
        } else extraFlags.push({ code: 'not_on_account', level: 'high', text: 'The data service did not say who posted this reel. Open it and check that it is really the clipper\'s.' });
      } else if (p.platform === 'tiktok') {
        const t = await P.tiktokInfo(p.url);
        if (t) { info.title = t.title || ''; info.thumb = t.thumb || ''; if (t.handle && t.handle.toLowerCase() !== acct.handle.toLowerCase()) fail(`This video was posted by @${t.handle}, not by your connected account @${acct.handle}`); }
      }
    }
    if (info.postedAt && Number(camp.submit_hours) > 0) {
      const hrs = (Date.now() - new Date(info.postedAt)) / 36e5;
      if (hrs > Number(camp.submit_hours) + 0.25) fail(`This video was posted ${ago(hrs)} ago. This campaign only accepts clips submitted within ${camp.submit_hours} hours of posting.`);
    }

    const rejected30 = (await db.query(`SELECT count(*)::int AS n FROM submissions WHERE user_id = $1 AND status = 'rejected' AND updated_at > now() - interval '30 days'`, [u.id])).rows[0].n;
    let row;
    try {
      row = (await db.query(`INSERT INTO submissions (user_id, campaign_id, account_id, platform, url, external_id, title, thumb, posted_at, views, likes, comments, views_source, views_checked_at, api_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CASE WHEN $13 = 'api' THEN now() END, $14) RETURNING *`,
        [u.id, camp.id, acct.id, p.platform, p.url, p.id, clip(info.title, 200), clip(info.thumb, 500), info.postedAt, info.views, info.likes, info.comments, info.source, info.ref])).rows[0];
    } catch (e) { if (e.code === '23505') fail('This video was already submitted', 409); throw e; }
    const flags = core.assess({ sub: row, camp, userCreated: u.created_at, acctCreated: acct.created_at, snaps: [], rejected30 }).concat(extraFlags);
    if (flags.length) await db.query('UPDATE submissions SET flags = $2::jsonb WHERE id = $1', [row.id, JSON.stringify(flags)]);
    await core.event(null, row.id, u.username, 'submitted', 'Clip submitted for review');
    r.json({ ok: true, id: row.id });
  }));

  app.get('/api/clips', needUser, h(async (q, r) => {
    const pg = paging(q, 25), stage = String(q.query.stage || ''), camp = int(q.query.campaign, 0);
    const where = ['s.user_id = $1']; const args = [q.user.id];
    if (STAGE_SQL[stage]) where.push(STAGE_SQL[stage]);
    if (camp) { args.push(camp); where.push(`s.campaign_id = $${args.length}`); }
    const rows = (await db.query(`${CLIP_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT ${pg.per} OFFSET ${pg.offset}`, args)).rows;
    const counts = (await db.query('SELECT status, analytics_state, count(*)::int AS n FROM submissions s WHERE s.user_id = $1 GROUP BY 1, 2', [q.user.id])).rows;
    const by = {}; for (const c of counts) { const k = stageOf(c); by[k] = (by[k] || 0) + c.n; }
    r.json({ clips: rows.map(clipOut), counts: by, page: pg.page, more: rows.length === pg.per });
  }));
  const myClip = async q => { const s = (await db.query(`${CLIP_SELECT} WHERE s.id = $1 AND s.user_id = $2`, [int(q.params.id), q.user.id])).rows[0]; if (!s) fail('Clip not found', 404); return s; };
  app.get('/api/clips/:id', needUser, h(async (q, r) => {
    const s = await myClip(q);
    const [events, proofs, snaps] = await Promise.all([
      db.query(`SELECT at, actor, type, text FROM submission_events WHERE submission_id = $1 AND NOT internal ORDER BY id`, [s.id]),
      db.query('SELECT id, round, mime, COALESCE(bytes, octet_length(data)) AS bytes, created_at FROM proofs WHERE submission_id = $1 ORDER BY id', [s.id]),
      db.query('SELECT views, at FROM view_snapshots WHERE submission_id = $1 ORDER BY id DESC LIMIT 60', [s.id])
    ]);
    const who = e => ['submitted', 'analytics_submitted'].includes(e.type) ? 'You' : e.actor === 'system' ? 'System' : e.actor ? 'SIDQ team' : ''; // clippers never see staff names or the legacy owner login label
    r.json({ clip: clipOut(s), campaign_note: s.campaign_analytics_note, requires_analytics: s.requires_analytics, events: events.rows.map(e => ({ ...e, actor: who(e) })), proofs: proofs.rows, snapshots: snaps.rows.reverse().map(x => ({ views: Number(x.views), at: x.at })) });
  }));
  app.delete('/api/clips/:id', needUser, h(async (q, r) => {
    const s = await myClip(q);
    if (s.status !== 'pending') fail('Only clips that are still waiting for review can be removed. Open a support ticket for anything else.');
    await db.query('DELETE FROM submissions WHERE id = $1 AND status = $2', [s.id, 'pending']); r.json({ ok: true });
  }));

  // Audience analytics proof (views, countries, age, gender): a screen recording (mp4, mov, webm) or screenshots.
  // The browser sends the raw file as the request body. The file type is checked from the file itself, not from its name.
  const IMAGES = ['image/png', 'image/jpeg', 'image/webp'], VIDEOS = ['video/mp4', 'video/quicktime', 'video/webm'];
  const imageType = b => !b || b.length < 12 ? null : (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ? 'image/png'
    : (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? 'image/jpeg' : (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') ? 'image/webp' : null;
  const videoType = b => {
    if (!b || b.length < 16) return null;
    if (b.toString('ascii', 4, 8) === 'ftyp') return b.toString('ascii', 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4'; // mp4, m4v and iPhone .mov
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
    return null;
  };
  // A recording is held in memory while it arrives, so only a few can arrive at the same time.
  let videosBusy = 0;
  const videoGate = (q, r, n) => {
    if (!/^video\//i.test(q.get('content-type') || '')) return n();
    if (videosBusy >= 4) return r.status(503).json({ error: 'Many recordings are uploading right now. Please try again in a minute.' });
    videosBusy++; let freed = false; const free = () => { if (!freed) { freed = true; videosBusy--; } };
    r.on('finish', free); r.on('close', free); n();
  };
  // Look at the clip BEFORE the (large) body is read, so a clip that is not waiting for analytics never costs memory.
  const proofReady = h(async (q, r, n) => {
    const s = await myClip(q);
    core.limit('proof:' + q.user.id, 40, 3600e3);
    if (!['approved', 'verified'].includes(s.status) || !['requested', 'submitted'].includes(s.analytics_state)) fail('This clip is not waiting for analytics right now');
    const len = Number(q.get('content-length')) || 0, video = /^video\//i.test(q.get('content-type') || '');
    if (len > (video ? MAX_VIDEO : MAX_IMAGE)) fail(video ? 'That recording is too large. The limit is 80 MB. Record a shorter video, about 3 minutes is enough.' : 'That screenshot is too large. The limit is 6 MB.', 413);
    n();
  });
  app.post('/api/clips/:id/proof', needUser, proofReady, videoGate, express.raw({ type: IMAGES, limit: MAX_IMAGE }), express.raw({ type: VIDEOS, limit: MAX_VIDEO }), (err, q, r, n) => sendError(r, err, q), h(async (q, r) => {
    const s = await myClip(q);
    if (!['approved', 'verified'].includes(s.status) || !['requested', 'submitted'].includes(s.analytics_state)) fail('This clip is not waiting for analytics right now');
    const body = Buffer.isBuffer(q.body) && q.body.length ? q.body : null, mime = imageType(body) || videoType(body);
    if (!mime) fail('Upload a screen recording (MP4, MOV or WebM) or a PNG, JPG or WebP screenshot');
    const isVideo = mime.startsWith('video/');
    const have = (await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE mime LIKE 'video/%')::int AS v FROM proofs WHERE submission_id = $1 AND round = $2`, [s.id, s.analytics_round])).rows[0];
    if (have.n >= 6) fail('You can upload up to 6 files per request');
    if (isVideo && have.v >= 2) fail('You can upload up to 2 recordings per request');
    await db.query('INSERT INTO proofs (submission_id, user_id, round, mime, data, bytes) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, q.user.id, s.analytics_round, mime, body, body.length]);
    if (s.analytics_state !== 'submitted') {
      await db.query(`UPDATE submissions SET analytics_state = 'submitted', analytics_submitted_at = now(), analytics_note = $2, updated_at = now() WHERE id = $1`, [s.id, clip(q.query.note, 300)]);
      await core.event(null, s.id, q.user.username, 'analytics_submitted', isVideo ? 'Screen recording of the analytics uploaded' : 'Audience analytics uploaded');
    }
    r.json({ ok: true, kind: isVideo ? 'video' : 'image' });
  }));
  // Owner or staff can look at a proof. Staff using the old password send it as a header, so the staff panel fetches this as a blob.
  // Videos support "Range" requests, so a player can start quickly and jump around in a long recording.
  app.get('/api/proofs/:id', h(async (q, r) => {
    const id = int(q.params.id);
    const p = (await db.query('SELECT id, user_id, mime, COALESCE(bytes, octet_length(data)) AS size FROM proofs WHERE id = $1', [id])).rows[0];
    if (!p) fail('Not found', 404);
    const a = await actorOf(q), me = sessionUserId(q);
    const ok = (a && (a.perms.includes('review') || a.perms.includes('support'))) || (me != null && me === p.user_id); // staff, or the clipper who uploaded it
    if (!ok) fail('Not allowed', a || me ? 403 : 401);
    const size = Number(p.size);
    r.set({ 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=600', 'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes' });
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(q.get('range') || '').trim());
    if (m && (m[1] !== '' || m[2] !== '')) {
      const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
      let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
      if (m[2] === '' && m[1] !== '') end = Math.min(end, start + 4 * 1048576 - 1); // an open-ended request gets the next 4 MB; the player asks again for more
      if (!(start <= end) || start >= size) return r.set('Content-Range', `bytes */${size}`).status(416).end();
      const part = (await db.query('SELECT substring(data FROM $2::int FOR $3::int) AS part FROM proofs WHERE id = $1', [id, start + 1, end - start + 1])).rows[0].part;
      return r.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(part.length) }).end(part);
    }
    const data = (await db.query('SELECT data FROM proofs WHERE id = $1', [id])).rows[0].data;
    r.set('Content-Length', String(data.length)).end(data);
  }));

  // ---------------------------------------------------------------- dashboard
  app.get('/api/dashboard', needUser, h(async (q, r) => {
    const uid = q.user.id, st = await core.settings();
    const [bal, clips, pend, paid, life, chart, camps, news, accts, openPayout, analyticsClips] = await Promise.all([
      core.balance(uid),
      db.query('SELECT status, analytics_state, count(*)::int AS n FROM submissions WHERE user_id = $1 GROUP BY 1, 2', [uid]),
      db.query(`SELECT COALESCE(SUM(sidq_earn_cents(${PV}, c.rate, c.min_views, c.max_payout)), 0)::bigint AS c FROM submissions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.user_id = $1 AND s.status IN ('approved','verified')`, [uid]),
      db.query(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS c FROM payouts WHERE user_id = $1 AND status = 'paid'`, [uid]),
      db.query(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS c FROM ledger WHERE user_id = $1 AND type IN ('earning','referral','bonus')`, [uid]),
      db.query(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, SUM(amount_cents)::bigint AS c FROM ledger WHERE user_id = $1 AND amount_cents > 0 AND type IN ('earning','referral','bonus') AND created_at > now() - interval '30 days' GROUP BY 1`, [uid]),
      campList(uid),
      db.query('SELECT id, title, body, pinned, created_at FROM announcements ORDER BY pinned DESC, id DESC LIMIT 3'),
      db.query('SELECT status, count(*)::int AS n FROM accounts WHERE user_id = $1 GROUP BY 1', [uid]),
      db.query(`SELECT id, amount_cents, status FROM payouts WHERE user_id = $1 AND status IN ('requested','processing') LIMIT 1`, [uid]),
      db.query(`${CLIP_SELECT} WHERE s.user_id = $1 AND ${STAGE_SQL.analytics} ORDER BY s.id LIMIT 5`, [uid])
    ]);
    const counts = {}; for (const c of clips.rows) { const k = stageOf(c); counts[k] = (counts[k] || 0) + c.n; }
    const days = new Map(chart.rows.map(x => [x.d, Number(x.c)])), series = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); series.push({ d, cents: days.get(d) || 0 }); }
    const views = (await db.query(`SELECT COALESCE(SUM(GREATEST(${PV}, 0)), 0)::bigint AS v FROM submissions s WHERE s.user_id = $1 AND ${COUNTED}`, [uid])).rows[0].v;
    r.json({
      balance_cents: bal, pending_cents: Number(pend.rows[0].c), paid_cents: Number(paid.rows[0].c), lifetime_cents: Number(life.rows[0].c), views: Number(views),
      counts, series, campaigns: camps.filter(c => c.status === 'live').slice(0, 4), news: news.rows,
      accounts: Object.fromEntries(accts.rows.map(a => [a.status, a.n])), open_payout: openPayout.rows[0] || null,
      analytics_clips: analyticsClips.rows.map(clipOut), min_payout_cents: st.min_payout_cents
    });
  }));

  // ---------------------------------------------------------------- wallet & payouts
  const methodOut = m => ({ id: m.id, type: m.type, ...core.describeMethod(m.type, m.details), created_at: m.created_at });
  app.get('/api/wallet', needUser, h(async (q, r) => {
    const uid = q.user.id, st = await core.settings();
    const [bal, pend, methods, payouts, ledger, totals] = await Promise.all([
      core.balance(uid),
      db.query(`SELECT COALESCE(SUM(sidq_earn_cents(${PV}, c.rate, c.min_views, c.max_payout)), 0)::bigint AS c FROM submissions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.user_id = $1 AND s.status IN ('approved','verified')`, [uid]),
      db.query('SELECT * FROM payout_methods WHERE user_id = $1 ORDER BY id', [uid]),
      db.query('SELECT id, method_type, method, amount_cents, status, tx_ref, note, created_at, paid_at FROM payouts WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [uid]),
      db.query('SELECT id, type, amount_cents, note, submission_id, created_at FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 40', [uid]),
      db.query(`SELECT COALESCE(SUM(amount_cents) FILTER (WHERE type IN ('earning','referral','bonus')), 0)::bigint AS earned, COALESCE((SELECT SUM(amount_cents) FROM payouts WHERE user_id = $1 AND status = 'paid'), 0)::bigint AS paid FROM ledger WHERE user_id = $1`, [uid])
    ]);
    r.json({
      balance_cents: bal, pending_cents: Number(pend.rows[0].c), earned_cents: Number(totals.rows[0].earned), paid_cents: Number(totals.rows[0].paid),
      min_payout_cents: st.min_payout_cents, note: st.payout_note, enabled: st.methods, method_names: core.METHOD_NAMES,
      methods: methods.rows.map(methodOut),
      payouts: payouts.rows.map(p => ({ id: p.id, type: p.method_type, ...core.describeMethod(p.method_type, p.method), amount_cents: Number(p.amount_cents), status: p.status, tx_ref: p.tx_ref, note: p.note, created_at: p.created_at, paid_at: p.paid_at })),
      ledger: ledger.rows.map(l => ({ id: l.id, type: l.type, amount_cents: Number(l.amount_cents), note: l.note, submission_id: l.submission_id, at: l.created_at }))
    });
  }));
  app.post('/api/wallet/methods', needUser, h(async (q, r) => {
    ready(q); core.limit('method:' + q.user.id, 20, 3600e3);
    const type = String(q.body.type || ''), st = await core.settings();
    if (!core.METHOD_NAMES[type]) fail('Pick a payout method');
    if (!st.methods[type]) fail(`${core.METHOD_NAMES[type]} payouts are not available right now`);
    const details = core.cleanMethod(type, q.body);
    if ((await db.query('SELECT count(*)::int AS c FROM payout_methods WHERE user_id = $1', [q.user.id])).rows[0].c >= 5) fail('You can save up to 5 payout methods. Remove one first.');
    const m = (await db.query('INSERT INTO payout_methods (user_id, type, details) VALUES ($1,$2,$3::jsonb) RETURNING *', [q.user.id, type, JSON.stringify(core.seal(details))])).rows[0];
    r.json({ ok: true, method: methodOut(m) });
  }));
  app.delete('/api/wallet/methods/:id', needUser, h(async (q, r) => { await db.query('DELETE FROM payout_methods WHERE id = $1 AND user_id = $2', [int(q.params.id), q.user.id]); r.json({ ok: true }); }));
  app.post('/api/wallet/payout', needUser, h(async (q, r) => {
    ready(q); core.limit('payout:' + q.user.id, 15, 3600e3);
    const cents = q.body.all ? await core.balance(q.user.id) : core.parseMoney(q.body.amount);
    if (cents == null) fail('Enter the amount as a number, like 25 or 25.50');
    const p = await core.requestPayout(q.user, cents, int(q.body.method_id));
    await core.notify(q.user.id, 'payout_requested', 'Payout requested', `${core.usd(cents)} is waiting for our team. We will update you here.`, '#wallet');
    r.json({ ok: true, id: p.id });
  }));
  app.post('/api/wallet/payouts/:id/cancel', needUser, h(async (q, r) => {
    const p = (await db.query('SELECT user_id FROM payouts WHERE id = $1', [int(q.params.id)])).rows[0];
    if (!p || p.user_id !== q.user.id) fail('Payout not found', 404);
    await core.payoutAction(int(q.params.id), 'cancelled', { id: q.user.id, name: q.user.username }, { note: 'Cancelled by the clipper' });
    r.json({ ok: true });
  }));
  // Recent paid payouts (names shortened). Builds trust and is switched on or off in Settings.
  app.get('/api/payout-feed', needUser, h(async (q, r) => {
    const st = await core.settings(); if (!st.show_payout_feed) return r.json({ on: false });
    const rows = (await db.query(`SELECT p.amount_cents, p.method_type, p.paid_at, u.username FROM payouts p JOIN users u ON u.id = p.user_id WHERE p.status = 'paid' ORDER BY p.paid_at DESC NULLS LAST LIMIT 10`)).rows;
    const tot = (await db.query(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS c, count(*)::int AS n FROM payouts WHERE status = 'paid'`)).rows[0];
    const short = n => { n = String(n || 'Clipper'); return n.length <= 3 ? n[0] + '••' : n.slice(0, 2) + '•••' + n.slice(-1); };
    r.json({ on: true, total_cents: Number(tot.c), count: tot.n, items: rows.map(x => ({ who: short(x.username), amount_cents: Number(x.amount_cents), type: x.method_type, at: x.paid_at })) });
  }));

  // ---------------------------------------------------------------- leaderboard & directory
  app.get('/api/leaderboard', needUser, h(async (q, r) => {
    const period = String(q.query.period || 'week'), days = period === 'week' ? 7 : period === 'month' ? 30 : null, camp = int(q.query.campaign, 0) || null;
    const rows = (await db.query(`WITH t AS (
        SELECT u.id, u.username, u.avatar, u.xp, u.show_earnings, count(*)::int AS clips,
          COALESCE(SUM(GREATEST(${PV}, 0)), 0)::bigint AS views, COALESCE(SUM(s.earned_cents), 0)::bigint AS earned
        FROM submissions s JOIN users u ON u.id = s.user_id AND NOT u.banned
        WHERE ${COUNTED} AND ($1::int IS NULL OR s.approved_at >= now() - make_interval(days => $1::int)) AND ($2::int IS NULL OR s.campaign_id = $2)
        GROUP BY u.id
      ), r AS (SELECT t.*, row_number() OVER (ORDER BY views DESC, id) AS rk FROM t WHERE views > 0)
      SELECT * FROM r WHERE rk <= 50 OR id = $3 ORDER BY rk`, [days, camp, q.user.id])).rows;
    r.json({ period, rows: rows.map(x => ({ rank: Number(x.rk), id: x.id, username: x.username, avatar: x.avatar, tier: core.rankOf(x.xp).rank, clips: x.clips, views: Number(x.views), earned_cents: x.show_earnings ? Number(x.earned) : null, me: x.id === q.user.id })) });
  }));
  const clipperRow = x => ({ id: x.id, username: x.username, avatar: x.avatar, bio: x.bio, joined: x.created_at, staff: !!ROLES[x.role], ...core.rankOf(x.xp),
    clips: x.clips, views: Number(x.views), earned_cents: x.show_earnings ? Number(x.earned) : null });
  const CLIPPER_SQL = `SELECT u.id, u.username, u.avatar, u.bio, u.xp, u.role, u.created_at, u.show_earnings,
      (SELECT count(*)::int FROM submissions s WHERE s.user_id = u.id AND ${COUNTED}) AS clips,
      (SELECT COALESCE(SUM(GREATEST(${PV}, 0)), 0)::bigint FROM submissions s WHERE s.user_id = u.id AND ${COUNTED}) AS views,
      (SELECT COALESCE(SUM(s.earned_cents), 0)::bigint FROM submissions s WHERE s.user_id = u.id AND s.status = 'completed') AS earned
    FROM users u WHERE NOT u.banned AND u.agreed_at IS NOT NULL`;
  app.get('/api/clippers', needUser, h(async (q, r) => {
    const pg = paging(q, 24), s = clip(q.query.q, 40);
    const rows = (await db.query(`${CLIPPER_SQL} AND ($1 = '' OR u.username ILIKE $2) ORDER BY u.xp DESC, u.id LIMIT ${pg.per} OFFSET ${pg.offset}`, [s, like(s)])).rows;
    r.json({ clippers: rows.map(clipperRow), page: pg.page, more: rows.length === pg.per });
  }));
  app.get('/api/clippers/:id', needUser, h(async (q, r) => {
    const x = (await db.query(`${CLIPPER_SQL} AND u.id = $1`, [int(q.params.id)])).rows[0];
    if (!x) fail('Clipper not found', 404);
    const recent = (await db.query(`SELECT s.id, s.platform, s.url, s.title, s.thumb, c.title AS campaign, GREATEST(${PV}, 0)::bigint AS views
      FROM submissions s JOIN campaigns c ON c.id = s.campaign_id WHERE s.user_id = $1 AND ${COUNTED} ORDER BY s.id DESC LIMIT 8`, [x.id])).rows;
    const plats = (await db.query(`SELECT platform, count(*)::int AS n FROM accounts WHERE user_id = $1 AND status = 'approved' GROUP BY 1`, [x.id])).rows;
    r.json({ ...clipperRow(x), platforms: plats, recent: recent.map(c => ({ id: c.id, platform: c.platform, url: c.url, title: c.title, thumb: c.thumb, campaign: c.campaign, views: Number(c.views) })) });
  }));

  // ---------------------------------------------------------------- notifications & news
  app.get('/api/notifications', needUser, h(async (q, r) => {
    const rows = (await db.query('SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [q.user.id, int(q.query.limit, 30, 1, 100)])).rows;
    const n = (await db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [q.user.id])).rows[0].n;
    r.json({ unread: n, items: rows.map(x => ({ id: Number(x.id), type: x.type, title: x.title, body: x.body, link: x.link, read: !!x.read_at, at: x.created_at })) });
  }));
  app.post('/api/notifications/read', needUser, h(async (q, r) => {
    const ids = Array.isArray(q.body.ids) ? q.body.ids.map(x => int(x)).filter(Boolean).slice(0, 100) : null;
    if (ids) await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])', [q.user.id, ids]);
    else await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [q.user.id]);
    r.json({ ok: true });
  }));
  app.get('/api/announcements', needUser, h(async (q, r) => r.json((await db.query('SELECT id, title, body, pinned, author, created_at FROM announcements ORDER BY pinned DESC, id DESC LIMIT 20')).rows)));

  // ---------------------------------------------------------------- referral
  app.get('/api/referral', needUser, h(async (q, r) => {
    const st = await core.settings(), code = await core.refCode(q.user.id);
    const n = (await db.query('SELECT count(*)::int AS n FROM users WHERE referred_by = $1', [q.user.id])).rows[0].n;
    const e = (await db.query(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS c FROM ledger WHERE user_id = $1 AND type = 'referral'`, [q.user.id])).rows[0].c;
    r.json({ code, link: core.baseUrl(q) + '/r/' + code, pct: Number(st.referral_pct) || 0, invited: n, earned_cents: Number(e) });
  }));

  // ---------------------------------------------------------------- support tickets
  const CATS = ['payout', 'clip', 'account', 'campaign', 'bug', 'other'];
  app.get('/api/tickets', needUser, h(async (q, r) => {
    const rows = (await db.query(`SELECT t.id, t.category, t.subject, t.status, t.created_at, t.updated_at,
        (SELECT staff FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_staff
      FROM tickets t WHERE t.user_id = $1 ORDER BY t.updated_at DESC LIMIT 50`, [q.user.id])).rows;
    r.json(rows);
  }));
  app.post('/api/tickets', needUser, h(async (q, r) => {
    ready(q); core.limit('ticket:' + q.user.id, 8, 86400e3, 'You opened many tickets today. Please wait for a reply to the earlier ones.');
    const b = q.body || {}, subject = clip(b.subject, 100), body = clip(b.body, 4000), cat = CATS.includes(b.category) ? b.category : 'other';
    if (subject.length < 3) fail('Write a short subject, at least 3 characters');
    if (body.length < 10) fail('Describe the problem in a few words so we can help (at least 10 characters)');
    if ((await db.query(`SELECT count(*)::int AS n FROM tickets WHERE user_id = $1 AND status <> 'closed'`, [q.user.id])).rows[0].n >= 5) fail('You have 5 open tickets. Wait for replies or close one first.');
    const t = await core.tx(async c => {
      const row = (await c.query('INSERT INTO tickets (user_id, category, subject) VALUES ($1,$2,$3) RETURNING id', [q.user.id, cat, subject])).rows[0];
      await c.query('INSERT INTO ticket_messages (ticket_id, author_id, author, staff, body) VALUES ($1,$2,$3,false,$4)', [row.id, q.user.id, q.user.username, body]);
      return row;
    });
    core.hook('staff', { title: 'New support ticket', description: `**${q.user.username}**: ${subject}`, fields: [{ name: 'Category', value: cat, inline: true }, { name: 'Ticket', value: '#' + t.id, inline: true }] });
    r.json({ ok: true, id: t.id });
  }));
  const myTicket = async q => { const t = (await db.query('SELECT * FROM tickets WHERE id = $1 AND user_id = $2', [int(q.params.id), q.user.id])).rows[0]; if (!t) fail('Ticket not found', 404); return t; };
  app.get('/api/tickets/:id', needUser, h(async (q, r) => {
    const t = await myTicket(q);
    const msgs = (await db.query('SELECT id, author, staff, body, created_at FROM ticket_messages WHERE ticket_id = $1 ORDER BY id', [t.id])).rows;
    r.json({ ticket: t, messages: msgs.map(m => ({ ...m, id: Number(m.id) })) });
  }));
  app.post('/api/tickets/:id/reply', needUser, h(async (q, r) => {
    const t = await myTicket(q); core.limit('ticketmsg:' + q.user.id, 30, 3600e3);
    if (t.status === 'closed') fail('This ticket is closed. Open a new ticket if you still need help.');
    const body = clip(q.body.body, 4000); if (body.length < 2) fail('Write your message first');
    await core.tx(async c => {
      await c.query('INSERT INTO ticket_messages (ticket_id, author_id, author, staff, body) VALUES ($1,$2,$3,false,$4)', [t.id, q.user.id, q.user.username, body]);
      await c.query(`UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1`, [t.id]);
    });
    r.json({ ok: true });
  }));
  app.post('/api/tickets/:id/close', needUser, h(async (q, r) => {
    const t = await myTicket(q); await db.query(`UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = $1`, [t.id]); r.json({ ok: true });
  }));
};
