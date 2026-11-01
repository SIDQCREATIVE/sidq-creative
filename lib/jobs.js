'use strict';
// Background work, run inside the web server:
//  - read fresh view numbers for clips that are still counting:
//      YouTube through the free official API key, every clip on an account the clipper CONNECTED (YouTube, TikTok, Instagram)
//      through that platform's official API using the clipper's own sign-in, and TikTok / Instagram clips of all other accounts
//      through the optional data service (SCRAPECREATORS_API_KEY)
//  - when a clip's tracking window ends: pay it (views read automatically) or ask the clipper for the final analytics recording
//  - end campaigns on their end date, keep connections healthy, and tidy old data
// Every job takes a database lock first, so two server copies running at once never do the same work twice.
const P = require('./platforms');

module.exports = function makeJobs(ctx) {
  const { db, core, connect } = ctx;
  const { service, autoverify } = require('./wire')(ctx); // built here when server.js did not build them (an older server.js)
  const running = new Set();
  const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

  const guarded = (name, lockKey, fn) => async () => {
    if (running.has(name)) return { skipped: true };
    running.add(name);
    let c;
    try {
      c = await db.connect();
      const ok = (await c.query('SELECT pg_try_advisory_lock($1) AS ok', [lockKey])).rows[0].ok;
      if (!ok) return { skipped: true };
      try { return await fn(); }
      finally { try { await c.query('SELECT pg_advisory_unlock($1)', [lockKey]); } catch (e) { /* connection closes anyway */ } }
    } catch (e) { console.error(`[jobs] ${name} failed:`, e.message); return { error: e.message }; }
    finally { if (c) c.release(); running.delete(name); }
  };

  const ASSESS_SQL = `SELECT s.*, c.submit_hours, u.created_at AS user_created, a.created_at AS acct_created, a.verified_via, a.handle AS account_handle,
      (SELECT count(*)::int FROM submissions r WHERE r.user_id = s.user_id AND r.status = 'rejected' AND r.updated_at > now() - interval '30 days') AS rejected30
    FROM submissions s JOIN campaigns c ON c.id = s.campaign_id JOIN users u ON u.id = s.user_id LEFT JOIN accounts a ON a.id = s.account_id`;

  const lastViews = async ids => {
    const prev = (await db.query('SELECT DISTINCT ON (submission_id) submission_id, views FROM view_snapshots WHERE submission_id = ANY($1::int[]) ORDER BY submission_id, id DESC', [ids])).rows;
    return new Map(prev.map(p => [p.submission_id, Number(p.views)]));
  };
  // Saves fresh numbers for one clip: the clip itself, a snapshot for the views chart, and the warning flags for staff.
  const applyStats = async (s, v, last) => {
    const flags = core.assess({ sub: { ...s, views: v.views, likes: v.likes, comments: v.comments, views_source: 'api' }, camp: { submit_hours: s.submit_hours },
      userCreated: s.user_created, acctCreated: s.acct_created, snaps: last != null ? [last] : [], rejected30: s.rejected30 });
    await db.query(`UPDATE submissions SET views = $2, likes = $3, comments = $4, views_source = 'api', views_checked_at = now(), read_failed_at = NULL, track_error = '', flags = $5::jsonb,
        title = CASE WHEN title = '' THEN $6 ELSE title END, thumb = CASE WHEN thumb = '' THEN $7 ELSE thumb END,
        posted_at = COALESCE(posted_at, $8), api_ref = COALESCE($9, api_ref) WHERE id = $1`,
      [s.id, v.views, v.likes, v.comments, JSON.stringify(flags), String(v.title || '').slice(0, 200), String(v.thumb || '').slice(0, 500), v.postedAt || null, v.ref || null]);
    if (last !== v.views) await db.query('INSERT INTO view_snapshots (submission_id, views, likes, comments) VALUES ($1,$2,$3,$4)', [s.id, v.views, v.likes, v.comments]);
  };
  const setError = (s, msg) => s.track_error === msg ? null : db.query('UPDATE submissions SET track_error = $2, views_checked_at = now() WHERE id = $1', [s.id, msg]);

  // YouTube with the free API key: up to 50 videos per call, any public video.
  const refreshYoutube = async rows => {
    let n = 0;
    for (let i = 0; i < rows.length; i += 50) {
      const part = rows.slice(i, i + 50);
      let map; try { map = await P.youtubeVideos(part.map(r => r.external_id)); } catch (e) { console.error('[jobs] youtube:', e.message); continue; }
      if (!map) continue;
      const last = await lastViews(part.map(r => r.id));
      for (const s of part) {
        const v = map.get(s.external_id);
        if (!v) { await setError(s, 'Video not found. It may be private or deleted.'); continue; }
        await applyStats(s, v, last.get(s.id)); n++;
      }
    }
    return n;
  };

  // Clips on accounts the clipper connected: one connection at a time, using that clipper's own sign-in.
  // Returns { n, fallback }: fallback = clips whose sign-in is gone or expired but that the data service can still read.
  const viaService = platform => (platform === 'tiktok' || platform === 'instagram') && service.enabled();
  const refreshConnected = async rows => {
    let n = 0; const fallback = []; const byAccount = new Map();
    for (const r of rows) { if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, []); byAccount.get(r.account_id).push(r); }
    for (const [accountId, clips] of byAccount) {
      const conn = await connect.loadConn(accountId);
      if (!conn) { if (viaService(clips[0].platform)) fallback.push(...clips); else for (const s of clips) await setError(s, 'This account is no longer connected. Ask the clipper to connect it again, or check the views by hand.'); continue; }
      let map;
      try { map = await connect.readClips(conn, clips); }
      catch (e) {
        if (e.auth) { if (viaService(conn.platform)) fallback.push(...clips); else for (const s of clips) await setError(s, `The ${PLAT[conn.platform]} connection has expired. Ask the clipper to connect again, or check the views by hand.`); }
        else console.error(`[jobs] ${conn.platform} read failed (${e.rate ? 'busy, will retry' : 'error'}):`, e.message);
        continue;
      }
      const last = await lastViews(clips.map(s => s.id));
      for (const s of clips) {
        const v = map.get(s.id);
        if (!v) { await setError(s, `Video not found on the connected ${PLAT[conn.platform]} account. It may be private or deleted.`); continue; }
        await applyStats(s, v, last.get(s.id)); n++;
      }
    }
    return { n, fallback };
  };

  // TikTok and Instagram clips of accounts that did not sign in: the optional data service reads the public video, one request per clip, a few at a time.
  // The video must have been posted by the clipper's own account (that is what the code in the bio proved). Anything unclear is left for a person.
  const sameHandle = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
  const refreshService = async (rows, kind) => {
    if (!rows.length || !service.enabled()) return 0;
    const last = await lastViews(rows.map(r => r.id));
    let n = 0, stop = false, next = 0;
    const one = async s => {
      if (!s.account_handle) return; // the account was removed: a person decides
      let v;
      try { v = await service.video(s.platform, { id: s.external_id, url: s.url }, { kind }); }
      catch (e) {
        if (['capped', 'down', 'key'].includes(e.code)) { stop = true; return; } // nothing was asked of the service, so nothing to hold back
        console.error(`[jobs] ${s.platform} read failed:`, e.message);
        await db.query('UPDATE submissions SET read_failed_at = now() WHERE id = $1', [s.id]); // try this clip again only after the usual wait
        return;
      }
      if (!v.found) { await setError(s, 'Video not found. It may be private or deleted.'); return; }
      if (!v.isVideo) { await setError(s, 'This post is a photo, not a video.'); return; }
      if (!v.author) { await setError(s, 'The data service did not say who posted this video, so it was not checked that it is the clipper\'s. Check it by hand.'); return; }
      if (!sameHandle(v.author, s.account_handle) && !(v.coauthors || []).some(x => sameHandle(x, s.account_handle))) { await setError(s, `This video was posted by @${v.author}, not by the clipper's account @${s.account_handle}. Check it by hand.`); return; }
      await applyStats(s, v, last.get(s.id)); n++;
    };
    const worker = async () => { while (!stop) { const s = rows[next++]; if (!s) return; await one(s); } };
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker));
    return n;
  };

  // How long to wait before the data service reads the same clip again (Settings, 1 to 48 hours).
  const pollHours = async () => Math.min(48, Math.max(1, Math.floor(Number((await core.settings()).service_poll_hours)) || 6));

  // Reads fresh numbers for these clips (ids = submission ids). Returns how many were updated.
  // opts.final = a person is waiting or a clip is about to be paid: the data service is asked now and may use the whole daily limit.
  const refreshClips = async (ids, opts = {}) => {
    if (!ids.length) return 0;
    const rows = (await db.query(`${ASSESS_SQL} WHERE s.id = ANY($1::int[])`, [ids])).rows, key = P.hasYoutubeKey();
    let n = 0;
    const yt = rows.filter(r => r.platform === 'youtube' && key);
    if (yt.length) n += await refreshYoutube(yt);
    const linked = rows.filter(r => r.verified_via === 'api' && r.account_id && !(r.platform === 'youtube' && key));
    let fallback = [];
    if (linked.length) { const out = await refreshConnected(linked); n += out.n; fallback = out.fallback; }
    // accounts that did not sign in (and signed-in accounts whose login stopped working): the optional data service.
    // The fallback clips are picked up on every run, so they wait for the usual interval like every other clip the service reads.
    const cutoff = Date.now() - (await pollHours()) * 36e5, older = t => !t || new Date(t).getTime() < cutoff;
    const svc = rows.filter(r => (r.platform === 'tiktok' || r.platform === 'instagram') && r.verified_via !== 'api')
      .concat(opts.final ? fallback : fallback.filter(s => older(s.views_checked_at) && older(s.read_failed_at)));
    if (svc.length) n += await refreshService(svc.slice(0, 400), opts.final ? 'live' : 'job');
    return n;
  };
  // Right after an account is connected: clips that were already on it get real numbers at once.
  const refreshAccount = async accountId => refreshClips((await db.query(`SELECT id FROM submissions WHERE account_id = $1 AND status IN ('pending','approved','verified')`, [accountId])).rows.map(r => r.id));

  const trackViews = guarded('trackViews', 727101, async () => {
    const key = P.hasYoutubeKey(), svc = service.enabled(), hours = await pollHours();
    // Instagram allows fewer official calls, so its connected clips are read every 2 hours. The data service costs a request per clip,
    // so its clips are read every few hours (Settings). The others every run.
    const ids = (await db.query(`SELECT s.id FROM submissions s LEFT JOIN accounts a ON a.id = s.account_id
      WHERE s.status IN ('pending','approved','verified') AND (
        (s.platform = 'youtube' AND $1::boolean)
        OR (a.verified_via = 'api' AND (s.platform <> 'instagram' OR s.views_checked_at IS NULL OR s.views_checked_at < now() - interval '2 hours'))
        OR ($2::boolean AND s.platform IN ('tiktok','instagram') AND COALESCE(a.verified_via, 'code') <> 'api' AND (s.views_source = 'api' OR s.views_verified IS NULL)
            AND (s.views_checked_at IS NULL OR s.views_checked_at < now() - make_interval(hours => $3::int))
            AND (s.read_failed_at IS NULL OR s.read_failed_at < now() - make_interval(hours => $3::int))))
      ORDER BY s.views_checked_at NULLS FIRST, s.id LIMIT 1000`, [key, svc, hours])).rows.map(r => r.id);
    if (!ids.length) return { skipped: key || svc ? 'No clips to read' : 'No YOUTUBE_API_KEY, no data service key and no connected accounts yet' };
    return { updated: await refreshClips(ids) };
  });

  // Clips whose tracking window (campaign.track_days after approval) is over.
  const finalizeDue = guarded('finalizeDue', 727102, async () => {
    const due = (await db.query(`SELECT s.id, s.status, s.platform, s.views_source, s.analytics_state, s.final_requested_at, s.track_error, s.flags, s.user_id, c.title AS campaign
      FROM submissions s JOIN campaigns c ON c.id = s.campaign_id
      WHERE s.status IN ('approved','verified') AND s.approved_at IS NOT NULL AND s.approved_at + make_interval(days => c.track_days) <= now()
      ORDER BY s.id LIMIT 300`)).rows;
    if (!due.length) return { paid: 0, asked: 0 };
    // Fresh numbers right before paying (YouTube, connected accounts and the data service), but only for clips that could be paid now.
    // A clip that is waiting for a person (analytics, a warning, a missing video) must not cost a data service request every 10 minutes.
    const payable = d => d.views_source === 'api' && !d.track_error && !['requested', 'submitted'].includes(d.analytics_state)
      && (d.status === 'verified' || (d.analytics_state === 'none' && !(d.flags || []).some(f => f.level === 'high')));
    await refreshClips(due.filter(payable).map(s => s.id), { final: true });
    let paid = 0, asked = 0;
    for (const d of due) {
      try {
        // re-read after the refresh: staff may have acted meanwhile
        const s = (await db.query('SELECT * FROM submissions WHERE id = $1', [d.id])).rows[0];
        if (!s || !['approved', 'verified'].includes(s.status) || s.track_error) continue; // a missing video needs a person to look at it
        // Never pay on old numbers: if the platform has not answered for more than 36 hours, a person decides (the clip shows a warning to staff and to the clipper).
        if (s.views_source === 'api' && (!s.views_checked_at || Date.now() - new Date(s.views_checked_at).getTime() > 36 * 36e5)) { await setError(s, 'We could not read the views of this video for more than a day. Check the connection, or a person can enter the views.'); continue; }
        const settled = !['requested', 'submitted'].includes(s.analytics_state);
        if (s.views_source === 'api' || s.views_verified != null && s.final_requested_at) {
          if (!settled) continue; // staff still have analytics to check
          if (s.status === 'approved') {
            const high = (s.flags || []).some(f => f.level === 'high');
            if (s.analytics_state !== 'none' || high) continue; // analytics were involved, or something looks off: a person decides
            const u = await db.query(`UPDATE submissions SET status = 'verified', verified_at = now(), updated_at = now() WHERE id = $1 AND status = 'approved'`, [s.id]);
            if (!u.rowCount) continue;
            await core.event(null, s.id, 'system', 'verified', 'Views were read automatically at the end of tracking');
          }
          const res = await core.finalize(s.id, null); if (res) paid++;
        } else if (settled && !s.final_requested_at) {
          // Views of this platform cannot be read automatically, so ask the clipper for the final numbers.
          const u = await db.query(`UPDATE submissions SET analytics_state = 'requested', analytics_round = analytics_round + 1, analytics_requested_at = now(), final_requested_at = now(),
              analytics_feedback = $2, updated_at = now() WHERE id = $1 AND status IN ('approved','verified') AND analytics_state NOT IN ('requested','submitted') AND final_requested_at IS NULL`,
            [s.id, 'Tracking has ended. Upload a screen recording of your analytics that shows the total views and the audience (countries, age, gender).']);
          if (!u.rowCount) continue;
          await core.event(null, s.id, 'system', 'analytics_requested', 'Tracking ended. Final analytics requested');
          await core.notify(s.user_id, 'analytics_requested', 'Final analytics needed', `${d.campaign}: tracking has ended. Upload your final analytics so we can pay this clip.`, '#submission/' + s.id);
          asked++;
        }
      } catch (e) { console.error('[jobs] finalize clip', d.id, e.message); }
    }
    return { paid, asked };
  });

  const endCampaigns = guarded('endCampaigns', 727103, async () => {
    const r = await db.query(`UPDATE campaigns SET status = 'ended', updated_at = now() WHERE status = 'live' AND ends_at IS NOT NULL AND ends_at < now() RETURNING id, title`);
    for (const c of r.rows) core.hook('campaigns', { title: 'Campaign ended', description: `**${c.title}** has reached its end date and is closed to new clips.` });
    return { ended: r.rowCount };
  });

  const tidy = guarded('tidy', 727104, async () => {
    const a = await db.query(`DELETE FROM notifications WHERE (read_at IS NOT NULL AND created_at < now() - interval '90 days') OR created_at < now() - interval '365 days'`);
    // Screen recordings are large. Keep them 90 days after the clip is finished (paid or rejected), then free the space.
    const v = await db.query(`DELETE FROM proofs WHERE mime LIKE 'video/%' AND created_at < now() - interval '90 days' AND submission_id IN (SELECT id FROM submissions WHERE status IN ('completed','rejected'))`);
    await db.query(`DELETE FROM api_usage WHERE day < (now() AT TIME ZONE 'UTC')::date - 400`);
    return { notifications: a.rowCount, recordings: v.rowCount };
  });

  // Keeps connected accounts healthy: refreshes login tokens, follower counts and @usernames, and notices a connection that stopped working.
  const syncConnections = guarded('syncConnections', 727105, async () => connect.syncDue());

  // Accounts that a clipper added by hand: look for the verification code in the bio (YouTube with the free API key, TikTok and Instagram through the
  // optional data service) and approve by itself. Without either key, a person checks them (Staff > Accounts).
  const checkAccounts = guarded('checkAccounts', 727106, async () => {
    if (!P.hasYoutubeKey() && !service.enabled()) return { skipped: 'No YOUTUBE_API_KEY and no data service key' };
    return autoverify.checkPending();
  });

  const JOBS = { trackViews, finalizeDue, endCampaigns, tidy, syncConnections, checkAccounts };
  const start = () => {
    if (process.env.DISABLE_JOBS) return;
    const every = (fn, ms, first) => { setTimeout(fn, first).unref(); setInterval(fn, ms).unref(); };
    every(trackViews, 20 * 60e3, 45e3);
    every(finalizeDue, 10 * 60e3, 75e3);
    every(endCampaigns, 5 * 60e3, 20e3);
    every(syncConnections, 3 * 3600e3, 150e3);
    every(checkAccounts, 5 * 60e3, 100e3);
    every(tidy, 24 * 3600e3, 120e3);
  };
  return { start, refreshClips, refreshAccount, run: async name => { if (!JOBS[name]) throw new Error('Unknown job'); return JOBS[name](); }, names: Object.keys(JOBS) };
};
