'use strict';
// API for the staff panel. Every route names the permission it needs (see lib/roles.js), so a moderator
// can never open the payouts queue and a finance person can never approve a clip.
// Everything staff do to money, clips, accounts, campaigns, people or settings is written to the audit log.
const makeClips = require('../lib/clips');
const makeHttp = require('../lib/http');
const P = require('../lib/platforms');

module.exports = function mountStaff(app, ctx) {
  const { db, core, gate, actorOf, sessionUserId, ROLES, STAFF_ROLES, jobs, connect, service, autoverify } = ctx;
  const { fail, clip, int, usd } = core;
  const { STAGE_SQL, STAFF_SELECT, stageOf, staffClipOut } = makeClips(core);
  const { h, paging, like, isSunday, csvCell } = makeHttp(core);

  const num = v => Number(v) || 0;
  const rankOf = role => (ROLES[role] && ROLES[role].rank) || 0;
  const PV = 'sidq_pay_views(s.views_verified, s.views, s.views_source)';
  const COUNTED = `s.status IN ('approved','verified','completed')`;
  const PLATFORMS = ['youtube', 'tiktok', 'instagram'];
  const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
  const DEFAULT_ASK = 'Record your screen while you open the analytics of this video, then upload the recording. It must show the views and where your viewers are from (countries, age, gender). Do not cut or edit it.';
  const profileUrl = (platform, handle) => platform === 'youtube' ? `https://www.youtube.com/@${handle}` : platform === 'tiktok' ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}/`;
  const one = async (sql, args) => (await db.query(sql, args)).rows[0];
  const series = (rows, n) => {
    const m = new Map(rows.map(x => [x.d, Number(x.v)])), out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); out.push({ d, v: m.get(d) || 0 }); }
    return out;
  };

  // ================================================================ who am I
  app.get('/api/staff/me', h(async (q, r) => {
    const a = await actorOf(q);
    if (!a) return r.status(sessionUserId(q) ? 403 : 401).json({ error: sessionUserId(q) ? 'This Discord account is not on the team.' : 'Please log in' });
    r.json({ id: a.id, name: a.name, role: a.role, label: ROLES[a.role].label, perms: a.perms, password_login: !!a.token, avatar: a.user ? a.user.avatar : '',
      roles: Object.fromEntries(STAFF_ROLES.map(k => [k, { label: ROLES[k].label, about: ROLES[k].about, perms: ROLES[k].perms }])) });
  }));

  // ================================================================ overview
  app.get('/api/staff/overview', gate('overview'), h(async (q, r) => {
    const can = p => q.actor.perms.includes(p), out = { role: q.actor.role, name: q.actor.name };
    if (can('review')) {
      const c = await one(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS review,
          count(*) FILTER (WHERE status IN ('approved','verified') AND analytics_state = 'submitted')::int AS checking,
          count(*) FILTER (WHERE status IN ('approved','verified') AND analytics_state = 'requested')::int AS analytics,
          count(*) FILTER (WHERE status = 'approved' AND analytics_state NOT IN ('requested','submitted'))::int AS tracking,
          COALESCE(EXTRACT(EPOCH FROM now() - min(submitted_at) FILTER (WHERE status = 'pending')) / 3600, 0)::float AS oldest_hours FROM submissions`);
      out.review = { ...c, accounts: (await one(`SELECT count(*)::int AS n FROM accounts WHERE status = 'pending'`)).n };
      out.activity = (await db.query(`SELECT e.at, e.type, e.actor, e.text, e.submission_id, u.username, c.title AS campaign
        FROM submission_events e JOIN submissions s ON s.id = e.submission_id JOIN users u ON u.id = s.user_id JOIN campaigns c ON c.id = s.campaign_id
        WHERE NOT e.internal ORDER BY e.id DESC LIMIT 8`)).rows;
    }
    if (can('payouts')) {
      const p = await one(`SELECT count(*) FILTER (WHERE status IN ('requested','processing'))::int AS open,
          COALESCE(SUM(amount_cents) FILTER (WHERE status IN ('requested','processing')), 0)::bigint AS open_cents,
          COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_cents,
          COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid' AND paid_at > now() - interval '30 days'), 0)::bigint AS paid30_cents,
          COALESCE(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE status = 'requested')) / 3600, 0)::float AS oldest_hours FROM payouts`);
      const w = await one(`SELECT COALESCE(SUM(b), 0)::bigint AS c FROM (SELECT SUM(amount_cents) AS b FROM ledger GROUP BY user_id HAVING SUM(amount_cents) > 0) t`);
      out.payouts = { open: p.open, open_cents: num(p.open_cents), paid_cents: num(p.paid_cents), paid30_cents: num(p.paid30_cents), oldest_hours: p.oldest_hours, wallets_cents: num(w.c) };
      out.paid_series = series((await db.query(`SELECT to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, SUM(amount_cents)::bigint AS v FROM payouts WHERE status = 'paid' AND paid_at > now() - interval '14 days' GROUP BY 1`)).rows, 14);
    }
    if (can('support')) out.support = await one(`SELECT count(*) FILTER (WHERE status <> 'closed')::int AS open, count(*) FILTER (WHERE status = 'open')::int AS waiting FROM tickets`);
    if (can('campaigns') || can('review')) {
      out.campaigns = await one(`SELECT count(*) FILTER (WHERE status = 'live')::int AS live, count(*) FILTER (WHERE status = 'draft')::int AS draft FROM campaigns`);
      out.views = num((await one(`SELECT COALESCE(SUM(GREATEST(${PV}, 0)), 0)::bigint AS v FROM submissions s WHERE ${COUNTED}`)).v);
      out.clips_series = series((await db.query(`SELECT to_char(submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS v FROM submissions WHERE submitted_at > now() - interval '14 days' GROUP BY 1`)).rows, 14);
    }
    if (can('users')) {
      out.users = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS new7,
        count(*) FILTER (WHERE last_seen > now() - interval '24 hours')::int AS active24, count(*) FILTER (WHERE banned)::int AS banned FROM users`);
      out.signups_series = series((await db.query(`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, count(*)::int AS v FROM users WHERE created_at > now() - interval '14 days' GROUP BY 1`)).rows, 14);
    }
    if (can('website')) out.leads = await one(`SELECT count(*) FILTER (WHERE NOT seen AND type = 'customer')::int AS customers, count(*) FILTER (WHERE NOT seen AND type = 'clipper')::int AS clippers FROM leads`);
    r.json(out);
  }));

  // ================================================================ social accounts
  app.get('/api/staff/accounts', gate('review'), h(async (q, r) => {
    const pg = paging(q, 30), st = ['pending', 'approved', 'rejected'].includes(q.query.status) ? q.query.status : 'pending', s = clip(q.query.q, 40);
    const rows = (await db.query(`SELECT a.id, a.platform, a.handle, a.followers, a.status, a.verify_code, a.reject_reason, a.verified_via, a.created_at, a.reviewed_at,
        u.id AS user_id, u.username, u.avatar, u.created_at AS user_created,
        (SELECT count(*)::int FROM accounts x WHERE x.user_id = u.id AND x.status = 'approved') AS approved_accounts,
        (SELECT count(*)::int FROM submissions z WHERE z.user_id = u.id AND z.status = 'rejected') AS rejected_clips
      FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.status = $1 AND ($2 = '' OR a.handle ILIKE $3 OR u.username ILIKE $3)
      ORDER BY a.id ${st === 'pending' ? 'ASC' : 'DESC'} LIMIT ${pg.per} OFFSET ${pg.offset}`, [st, s, like(s)])).rows;
    const counts = Object.fromEntries((await db.query('SELECT status, count(*)::int AS n FROM accounts GROUP BY 1')).rows.map(x => [x.status, x.n]));
    r.json({ accounts: rows.map(a => ({ ...a, profile_url: profileUrl(a.platform, a.handle) })), counts, page: pg.page, more: rows.length === pg.per });
  }));
  const loadAccount = async id => { const a = (await db.query('SELECT a.*, u.username FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = $1', [int(id)])).rows[0]; if (!a) fail('Account not found', 404); return a; };
  app.post('/api/staff/accounts/:id/approve', gate('review'), h(async (q, r) => {
    const a = await loadAccount(q.params.id);
    if (a.status === 'approved') return r.json({ ok: true });
    const followers = int(q.body.followers, a.followers, 0, 2e9);
    await db.query(`UPDATE accounts SET status = 'approved', followers = $2, reject_reason = '', reviewed_by = $3, reviewed_at = now() WHERE id = $1`, [a.id, followers, q.actor.id]);
    await core.audit(q.actor, 'account.approve', 'account', a.id, { clipper: a.username, platform: a.platform, handle: a.handle, followers });
    await core.notify(a.user_id, 'account_approved', 'Account approved', `@${a.handle} on ${PLAT[a.platform] || a.platform} is verified. You can join campaigns now.`, '#campaigns');
    r.json({ ok: true });
  }));
  app.post('/api/staff/accounts/:id/reject', gate('review'), h(async (q, r) => {
    const a = await loadAccount(q.params.id), reason = clip(q.body.reason, 200);
    if (reason.length < 3) fail('Write the reason so the clipper knows what to fix');
    if ((await db.query(`SELECT 1 FROM submissions WHERE account_id = $1 AND status IN ('pending','approved','verified') LIMIT 1`, [a.id])).rowCount) fail('This account still has clips in progress. Handle those clips first.', 409);
    await db.query(`UPDATE accounts SET status = 'rejected', reject_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`, [a.id, reason, q.actor.id]);
    await core.audit(q.actor, 'account.reject', 'account', a.id, { clipper: a.username, platform: a.platform, handle: a.handle, reason });
    await core.notify(a.user_id, 'account_rejected', 'Account not approved', `@${a.handle}: ${reason}. Fix it and send it for review again from Accounts.`, '#accounts');
    r.json({ ok: true });
  }));

  // ================================================================ clips: queues
  const ORDER = { review: 's.submitted_at ASC, s.id', checking: 's.analytics_submitted_at ASC NULLS LAST, s.id', analytics: 's.analytics_requested_at ASC NULLS LAST, s.id' };
  app.get('/api/staff/clips', gate('review'), h(async (q, r) => {
    const pg = paging(q, 25), stage = String(q.query.stage || 'review'), where = [], args = [];
    if (STAGE_SQL[stage]) where.push(STAGE_SQL[stage]);
    const camp = int(q.query.campaign, 0), plat = String(q.query.platform || ''), s = clip(q.query.q, 60), user = int(q.query.user, 0);
    if (camp) { args.push(camp); where.push(`s.campaign_id = $${args.length}`); }
    if (user) { args.push(user); where.push(`s.user_id = $${args.length}`); }
    if (PLATFORMS.includes(plat)) { args.push(plat); where.push(`s.platform = $${args.length}`); }
    if (s) { args.push(like(s)); where.push(`(u.username ILIKE $${args.length} OR a.handle ILIKE $${args.length} OR s.title ILIKE $${args.length} OR s.url ILIKE $${args.length})`); }
    if (q.query.flag === 'high') where.push(`s.flags @> '[{"level":"high"}]'::jsonb`);
    const rows = (await db.query(`${STAFF_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${ORDER[stage] || 's.id DESC'} LIMIT ${pg.per} OFFSET ${pg.offset}`, args)).rows;
    const by = {};
    for (const c of (await db.query('SELECT status, analytics_state, count(*)::int AS n FROM submissions GROUP BY 1, 2')).rows) { const k = stageOf(c); by[k] = (by[k] || 0) + c.n; }
    r.json({ clips: rows.map(staffClipOut), counts: by, page: pg.page, more: rows.length === pg.per });
  }));

  app.get('/api/staff/clips/:id', gate('review'), h(async (q, r) => {
    const s = (await db.query(`${STAFF_SELECT} WHERE s.id = $1`, [int(q.params.id)])).rows[0];
    if (!s) fail('Clip not found', 404);
    const [events, proofs, snaps, who, camp, same] = await Promise.all([
      db.query('SELECT at, actor, type, text, internal FROM submission_events WHERE submission_id = $1 ORDER BY id', [s.id]),
      db.query('SELECT id, round, mime, COALESCE(bytes, octet_length(data)) AS bytes, created_at FROM proofs WHERE submission_id = $1 ORDER BY id', [s.id]),
      db.query('SELECT views, likes, comments, at FROM view_snapshots WHERE submission_id = $1 ORDER BY id DESC LIMIT 80', [s.id]),
      one(`SELECT u.id, u.username, u.avatar, u.created_at, u.banned, u.staff_note,
          (SELECT count(*)::int FROM submissions z WHERE z.user_id = u.id AND z.status = 'completed') AS completed,
          (SELECT count(*)::int FROM submissions z WHERE z.user_id = u.id AND z.status = 'rejected') AS rejected,
          (SELECT count(*)::int FROM submissions z WHERE z.user_id = u.id AND z.status IN ('pending','approved','verified')) AS open,
          (SELECT COALESCE(SUM(amount_cents), 0) FROM ledger l WHERE l.user_id = u.id AND l.type = 'earning')::bigint AS earned
        FROM users u WHERE u.id = $1`, [s.user_id]),
      one('SELECT id, title, label, status, brief, rules, rate, min_views, max_payout, submit_hours, min_followers, requires_analytics, analytics_note, track_days, platforms, budget FROM campaigns WHERE id = $1', [s.campaign_id]),
      db.query(`SELECT id, status, url FROM submissions WHERE platform = $1 AND external_id = $2 AND id <> $3 ORDER BY id DESC LIMIT 5`, [s.platform, s.external_id, s.id])
    ]);
    const committed = (await core.committed([s.campaign_id])).get(s.campaign_id) || 0;
    r.json({ clip: staffClipOut(s), events: events.rows, proofs: proofs.rows.map(p => ({ id: p.id, round: p.round, mime: p.mime, bytes: num(p.bytes), at: p.created_at })), snapshots: snaps.rows.reverse().map(x => ({ views: num(x.views), likes: num(x.likes), comments: num(x.comments), at: x.at })),
      clipper: { ...who, earned_cents: num(who.earned) }, campaign: { ...camp, rate: Number(camp.rate), max_payout: camp.max_payout == null ? null : Number(camp.max_payout), budget_cents: Math.round(Number(camp.budget) * 100), committed_cents: committed },
      same_video: same.rows, profile_url: profileUrl(s.platform, s.account_handle || ''), youtube_api: ctx.hasYoutubeKey(), auto: autoverify.status() });
  }));

  // ================================================================ clips: decisions
  const lockClip = async (c, id) => {
    const s = (await c.query(`SELECT s.*, cp.title AS campaign_title, cp.requires_analytics, cp.analytics_note AS campaign_analytics_note, cp.track_days
      FROM submissions s JOIN campaigns cp ON cp.id = s.campaign_id WHERE s.id = $1 FOR UPDATE OF s`, [id])).rows[0];
    if (!s) fail('Clip not found', 404);
    return s;
  };
  const link = id => '#submission/' + id;
  const views0 = v => { const n = Math.floor(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 2e9) fail('Enter the views as a whole number, like 12500'); return n; };

  // Rules are fine: the clip starts counting views and, if the campaign needs it, the clipper is asked for analytics.
  app.post('/api/staff/clips/:id/approve', gate('review'), h(async (q, r) => {
    const id = int(q.params.id), note = clip(q.body.note, 300), msg = clip(q.body.message, 400);
    const res = await core.tx(async c => {
      const s = await lockClip(c, id);
      if (s.status !== 'pending') fail('Someone already reviewed this clip.', 409);
      const ask = !!s.requires_analytics, text = msg || s.campaign_analytics_note || DEFAULT_ASK;
      await c.query(`UPDATE submissions SET status = 'approved', approved_at = now(), reviewed_by = $2, reviewed_at = now(), review_note = $3, reject_reason = '',
          analytics_state = CASE WHEN $4::boolean THEN 'requested' ELSE analytics_state END,
          analytics_round = analytics_round + CASE WHEN $4::boolean THEN 1 ELSE 0 END,
          analytics_requested_at = CASE WHEN $4::boolean THEN now() ELSE analytics_requested_at END,
          analytics_feedback = CASE WHEN $4::boolean THEN $5 ELSE analytics_feedback END, updated_at = now() WHERE id = $1`, [id, q.actor.id, note, ask, text]);
      await core.event(c, id, q.actor.name, 'approved', 'Rules check passed. The clip is now counting views.' + (note ? ' ' + note : ''));
      if (ask) await core.event(c, id, q.actor.name, 'analytics_requested', text);
      return { s, ask, text };
    });
    await core.audit(q.actor, 'clip.approve', 'clip', id, { campaign: res.s.campaign_title });
    if (res.ask) await core.notify(res.s.user_id, 'analytics_requested', 'Clip approved. Analytics needed', `${res.s.campaign_title}: ${res.text}`, link(id));
    else await core.notify(res.s.user_id, 'submission_approved', 'Clip approved', `${res.s.campaign_title}: your clip passed the rules check and is now counting views.`, link(id));
    jobs.refreshClips([id]).catch(() => {});
    r.json({ ok: true });
  }));

  app.post('/api/staff/clips/:id/reject', gate('review'), h(async (q, r) => {
    const id = int(q.params.id), reason = clip(q.body.reason, 300);
    if (reason.length < 3) fail('Write the reason so the clipper knows what to fix');
    const s = await core.tx(async c => {
      const s = await lockClip(c, id);
      if (!['pending', 'approved', 'verified'].includes(s.status)) fail(s.status === 'completed' ? 'This clip is already paid. Use a wallet correction instead.' : 'This clip is already rejected.', 409);
      await c.query(`UPDATE submissions SET status = 'rejected', reject_reason = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1`, [id, reason, q.actor.id]);
      await core.event(c, id, q.actor.name, 'rejected', reason);
      return s;
    });
    await core.audit(q.actor, 'clip.reject', 'clip', id, { campaign: s.campaign_title, reason });
    await core.notify(s.user_id, 'submission_rejected', 'Clip rejected', `${s.campaign_title}: ${reason}`, link(id));
    r.json({ ok: true });
  }));

  // Ask for (new) analytics: used when the first upload was not enough, or later on.
  app.post('/api/staff/clips/:id/request-analytics', gate('review'), h(async (q, r) => {
    const id = int(q.params.id), msg = clip(q.body.message, 400);
    const s = await core.tx(async c => {
      const s = await lockClip(c, id);
      if (!['approved', 'verified'].includes(s.status)) fail('Analytics can only be requested for approved clips.', 409);
      if (s.analytics_state === 'requested') fail('Analytics were already requested. Waiting for the clipper.', 409);
      if (s.analytics_state === 'submitted') fail('The clipper already uploaded analytics. Check them, or decline them with a reason.', 409);
      const text = msg || s.campaign_analytics_note || DEFAULT_ASK;
      await c.query(`UPDATE submissions SET analytics_state = 'requested', analytics_round = analytics_round + 1, analytics_requested_at = now(), analytics_feedback = $2, updated_at = now() WHERE id = $1`, [id, text]);
      await core.event(c, id, q.actor.name, 'analytics_requested', text);
      return { ...s, text };
    });
    await core.audit(q.actor, 'clip.request_analytics', 'clip', id, {});
    await core.notify(s.user_id, 'analytics_requested', 'Analytics needed', `${s.campaign_title}: ${s.text}`, link(id));
    r.json({ ok: true });
  }));

  // The recording or screenshots were unclear or do not match: send the clipper back to upload them again.
  app.post('/api/staff/clips/:id/decline-analytics', gate('review'), h(async (q, r) => {
    const id = int(q.params.id), reason = clip(q.body.reason, 300);
    if (reason.length < 3) fail('Tell the clipper what is wrong with the recording');
    const s = await core.tx(async c => {
      const s = await lockClip(c, id);
      if (s.analytics_state !== 'submitted' || !['approved', 'verified'].includes(s.status)) fail('There are no analytics waiting to be checked on this clip.', 409);
      await c.query(`UPDATE submissions SET analytics_state = 'requested', analytics_round = analytics_round + 1, analytics_requested_at = now(), analytics_feedback = $2, updated_at = now() WHERE id = $1`, [id, reason]);
      await core.event(c, id, q.actor.name, 'analytics_declined', reason);
      return s;
    });
    await core.audit(q.actor, 'clip.decline_analytics', 'clip', id, { reason });
    await core.notify(s.user_id, 'analytics_declined', 'Please upload your analytics again', `${s.campaign_title}: ${reason}`, link(id));
    r.json({ ok: true });
  }));

  // Analytics look right and the views are real: the clip is verified. It is paid when its tracking window ends
  // (or right now when that already happened, or when it was the final analytics).
  app.post('/api/staff/clips/:id/verify', gate('review'), h(async (q, r) => {
    const id = int(q.params.id), has = q.body.views !== undefined && q.body.views !== null && String(q.body.views).trim() !== '', views = has ? views0(q.body.views) : null, note = clip(q.body.note, 300);
    const res = await core.tx(async c => {
      const s = await lockClip(c, id);
      if (!['approved', 'verified'].includes(s.status)) fail('Only approved clips can be verified.', 409);
      if (s.analytics_state === 'requested') fail('Still waiting for the clipper to upload analytics. You can reject the clip if they do not.', 409);
      if (s.status === 'verified' && s.analytics_state !== 'submitted') fail('This clip is already verified.', 409);
      if (s.views_source !== 'api' && s.views_verified == null && views == null) fail(`${PLAT[s.platform] || s.platform} views cannot be read automatically. Enter the views shown in the analytics recording.`);
      await c.query(`UPDATE submissions SET status = 'verified', views_verified = COALESCE($2::bigint, views_verified),
          analytics_state = CASE WHEN analytics_state = 'submitted' THEN 'accepted' ELSE analytics_state END, verified_by = $3, verified_at = now(), review_note = CASE WHEN $4 = '' THEN review_note ELSE $4 END, updated_at = now() WHERE id = $1`, [id, views, q.actor.id, note]);
      await core.event(c, id, q.actor.name, 'verified', (views != null ? `Verified. Counting ${views.toLocaleString('en-US')} views.` : 'Verified.') + (note ? ' ' + note : ''));
      const over = s.approved_at && new Date(s.approved_at).getTime() + (Number(s.track_days) || 7) * 864e5 <= Date.now();
      return { s, due: !!over || !!s.final_requested_at };
    });
    await core.audit(q.actor, 'clip.verify', 'clip', id, { views });
    if (res.s.analytics_state === 'submitted') await core.notify(res.s.user_id, 'analytics_accepted', 'Analytics accepted', `${res.s.campaign_title}: your analytics were checked and your clip is verified.`, link(id));
    const paid = res.due ? await core.finalize(id, q.actor) : null;
    r.json({ ok: true, paid_cents: paid ? paid.amt : null });
  }));

  // Staff read the views from the clipper's analytics (TikTok, Instagram) without verifying yet.
  app.post('/api/staff/clips/:id/views', gate('review'), h(async (q, r) => {
    const id = int(q.params.id), views = views0(q.body.views);
    await core.tx(async c => {
      const s = await lockClip(c, id);
      if (!['pending', 'approved', 'verified'].includes(s.status)) fail('The views of a finished clip cannot be changed.', 409);
      await c.query('UPDATE submissions SET views_verified = $2, updated_at = now() WHERE id = $1', [id, views]);
      await core.event(c, id, q.actor.name, 'views', `Counted views set to ${views.toLocaleString('en-US')}`);
    });
    await core.audit(q.actor, 'clip.set_views', 'clip', id, { views });
    r.json({ ok: true });
  }));

  app.post('/api/staff/clips/:id/note', gate('review'), h(async (q, r) => {
    const id = int(q.params.id), text = clip(q.body.text, 400);
    if (text.length < 2) fail('Write the note first');
    if (!(await db.query('SELECT 1 FROM submissions WHERE id = $1', [id])).rowCount) fail('Clip not found', 404);
    await core.event(null, id, q.actor.name, 'note', text, true);
    r.json({ ok: true });
  }));

  app.post('/api/staff/clips/:id/refresh', gate('review'), h(async (q, r) => {
    const id = int(q.params.id);
    const s = (await db.query('SELECT s.platform, a.verified_via FROM submissions s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.id = $1', [id])).rows[0];
    if (!s) fail('Clip not found', 404);
    const viaKey = s.platform === 'youtube' && ctx.hasYoutubeKey(), viaLogin = s.verified_via === 'api', viaService = s.platform !== 'youtube' && service.enabled();
    if (!viaKey && !viaLogin && !viaService) fail(s.platform === 'youtube' ? 'Automatic tracking is off. Add YOUTUBE_API_KEY in Railway, or ask the clipper to connect their YouTube.' : `${PLAT[s.platform] || s.platform} views are read automatically only for accounts the clipper connected, or when the data service key (SCRAPECREATORS_API_KEY) is set in Railway.`, 409);
    core.limit('refresh:' + (q.actor.id || 'owner'), 60, 600e3);
    r.json({ ok: true, updated: await jobs.refreshClips([id], { final: true }) });
  }));

  // Pay a verified clip now instead of waiting for the end of its tracking window.
  app.post('/api/staff/clips/:id/finalize', gate('campaigns'), h(async (q, r) => {
    const id = int(q.params.id), res = await core.finalize(id, q.actor);
    if (!res) fail('This clip is not ready. It has to be verified and have counted views.', 409);
    await core.audit(q.actor, 'clip.finalize', 'clip', id, { amount_cents: res.amt });
    r.json({ ok: true, amount_cents: res.amt });
  }));

  // ================================================================ payouts
  const payoutOut = (p, pkr) => ({
    id: p.id, amount_cents: num(p.amount_cents), status: p.status, tx_ref: p.tx_ref, note: p.note, created_at: p.created_at, updated_at: p.updated_at, paid_at: p.paid_at,
    method: core.staffMethod(p.method_type, p.method), type: p.method_type,
    pkr: (p.method_type === 'easypaisa' || p.method_type === 'jazzcash') && pkr ? Math.round(num(p.amount_cents) / 100 * pkr) : null,
    user: { id: p.user_id, username: p.username, avatar: p.avatar, joined: p.user_created, balance_cents: num(p.balance), paid_before: p.paid_before, rejected_clips: p.rejected_clips }
  });
  const payoutQuery = (q, limitSql) => {
    const f = String(q.query.status || 'open'), s = clip(q.query.q, 40), where = [], args = [];
    if (f === 'open') where.push(`p.status IN ('requested','processing')`); else if (['requested', 'processing', 'paid', 'rejected', 'cancelled'].includes(f)) { args.push(f); where.push(`p.status = $${args.length}`); }
    if (s) { args.push(like(s)); where.push(`u.username ILIKE $${args.length}`); }
    return { f, sql: `SELECT p.*, u.username, u.avatar, u.created_at AS user_created,
        COALESCE((SELECT SUM(amount_cents) FROM ledger l WHERE l.user_id = u.id), 0)::bigint AS balance,
        (SELECT count(*)::int FROM payouts x WHERE x.user_id = u.id AND x.status = 'paid') AS paid_before,
        (SELECT count(*)::int FROM submissions z WHERE z.user_id = u.id AND z.status = 'rejected') AS rejected_clips
      FROM payouts p JOIN users u ON u.id = p.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${f === 'open' ? 'p.id ASC' : 'p.id DESC'} ${limitSql}`, args };
  };
  app.get('/api/staff/payouts', gate('payouts'), h(async (q, r) => {
    const pg = paging(q, 30), st = await core.settings(), x = payoutQuery(q, `LIMIT ${pg.per} OFFSET ${pg.offset}`), rate = Number(st.pkr_rate) || 0;
    const rows = (await db.query(x.sql, x.args)).rows;
    const counts = (await db.query(`SELECT status, count(*)::int AS n, COALESCE(SUM(amount_cents), 0)::bigint AS c FROM payouts GROUP BY 1`)).rows;
    r.json({ payouts: rows.map(p => payoutOut(p, rate)), counts: Object.fromEntries(counts.map(c => [c.status, { n: c.n, cents: num(c.c) }])), pkr_rate: rate, page: pg.page, more: rows.length === pg.per });
  }));
  app.get('/api/staff/payouts.csv', gate('payouts'), h(async (q, r) => {
    const x = payoutQuery(q, 'LIMIT 5000'), rows = (await db.query(x.sql, x.args)).rows;
    const head = ['id', 'date', 'clipper', 'status', 'amount_usd', 'method', 'details', 'reference', 'note'];
    const lines = [head.join(',')].concat(rows.map(p => {
      const m = core.staffMethod(p.method_type, p.method);
      return [p.id, new Date(p.created_at).toISOString().slice(0, 10), p.username, p.status, (num(p.amount_cents) / 100).toFixed(2), m.name || p.method_type, m.error || (m.fields || []).map(f => f.join(': ')).join(' | '), p.tx_ref, p.note].map(csvCell).join(',');
    }));
    await core.audit(q.actor, 'payout.export', 'payout', '', { rows: rows.length });
    r.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sidq-payouts.csv"' });
    r.send(lines.join('\n') + '\n');
  }));
  const loadPayout = async id => { const p = (await db.query('SELECT p.*, u.username FROM payouts p JOIN users u ON u.id = p.user_id WHERE p.id = $1', [int(id)])).rows[0]; if (!p) fail('Payout not found', 404); return p; };
  app.post('/api/staff/payouts/:id/processing', gate('payouts'), h(async (q, r) => {
    const p = await loadPayout(q.params.id); await core.payoutAction(p.id, 'processing', q.actor);
    await core.audit(q.actor, 'payout.processing', 'payout', p.id, { clipper: p.username, amount_cents: num(p.amount_cents) });
    await core.notify(p.user_id, 'payout_processing', 'Your payout is being processed', `${usd(num(p.amount_cents))} via ${core.METHOD_NAMES[p.method_type]}. We will tell you when it is sent.`, '#wallet');
    r.json({ ok: true });
  }));
  app.post('/api/staff/payouts/:id/paid', gate('payouts'), h(async (q, r) => {
    const p = await loadPayout(q.params.id), ref = clip(q.body.tx_ref, 120);
    await core.payoutAction(p.id, 'paid', q.actor, { tx_ref: ref, note: q.body.note });
    await core.audit(q.actor, 'payout.paid', 'payout', p.id, { clipper: p.username, amount_cents: num(p.amount_cents), method: p.method_type, ref });
    await core.notify(p.user_id, 'payout_paid', 'Payout sent', `${usd(num(p.amount_cents))} was sent via ${core.METHOD_NAMES[p.method_type]}${ref ? '. Reference: ' + ref : ''}.`, '#wallet');
    const n = String(p.username || 'Clipper'), who = n.length <= 3 ? n[0] + '••' : n.slice(0, 2) + '•••' + n.slice(-1);
    core.hook('payouts', { title: 'Payout sent', description: `**${who}** was paid **${usd(num(p.amount_cents))}** via ${core.METHOD_NAMES[p.method_type]}.` });
    r.json({ ok: true });
  }));
  app.post('/api/staff/payouts/:id/reject', gate('payouts'), h(async (q, r) => {
    const p = await loadPayout(q.params.id), reason = clip(q.body.reason, 300);
    if (reason.length < 3) fail('Write the reason. The clipper sees it and the money goes back to their wallet.');
    await core.payoutAction(p.id, 'rejected', q.actor, { note: reason });
    await core.audit(q.actor, 'payout.reject', 'payout', p.id, { clipper: p.username, amount_cents: num(p.amount_cents), reason });
    await core.notify(p.user_id, 'payout_rejected', 'Payout not sent', `${usd(num(p.amount_cents))} is back in your wallet. Reason: ${reason}`, '#wallet');
    r.json({ ok: true });
  }));

  // ================================================================ campaigns
  const cleanCampaign = b => {
    b = b || {};
    const title = clip(b.title, 100); if (!title) fail('Give the campaign a title');
    const money = (v, label, min, max) => { const s = String(v == null ? '' : v).trim(); if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) fail(`${label} must be a number like 12 or 12.50`); const n = parseFloat(s); if (n < min || n > max) fail(`${label} must be between ${min} and ${max}`); return n; };
    const url = (v, label, allowPath) => { const s = clip(v, 400); if (!s) return ''; if (/^https:\/\//i.test(s) || (allowPath && /^\/[\w./-]+$/.test(s))) return s; return fail(`${label} must be a full link starting with https://`); };
    const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter(x => PLATFORMS.includes(x));
    if (!platforms.length) fail('Pick at least one platform');
    let ends = null;
    if (b.ends_at) { const d = new Date(b.ends_at); if (Number.isNaN(d.getTime())) fail('The end date is not valid'); ends = d.toISOString(); }
    return {
      title, label: clip(b.label, 30) || 'Content', brief: clip(b.brief, 4000), rules: clip(b.rules, 6000), image: url(b.image, 'The image', true),
      rate: money(b.rate, 'Rate per 1,000 views', 0.01, 1000), budget: money(b.budget, 'Budget', 1, 10000000),
      min_views: int(b.min_views, 1000, 0, 1e9), max_payout: b.max_payout === '' || b.max_payout == null ? null : money(b.max_payout, 'Max payout per clip', 0.01, 100000),
      platforms: platforms.join(','), submit_hours: int(b.submit_hours, 24, 0, 720), min_followers: int(b.min_followers, 0, 0, 1e8),
      requires_analytics: b.requires_analytics !== false, analytics_note: clip(b.analytics_note, 600), assets_url: url(b.assets_url, 'The assets link', false),
      track_days: int(b.track_days, 7, 1, 60), ends_at: ends
    };
  };
  const CAMP_COLS = ['title', 'label', 'brief', 'rules', 'image', 'rate', 'budget', 'min_views', 'max_payout', 'platforms', 'submit_hours', 'min_followers', 'requires_analytics', 'analytics_note', 'assets_url', 'track_days', 'ends_at'];
  const LOCKED = ['rate', 'min_views', 'max_payout', 'track_days'];
  const campRow = (x, com) => ({ ...x, rate: Number(x.rate), budget: Number(x.budget), max_payout: x.max_payout == null ? null : Number(x.max_payout), platforms: x.platforms.split(','),
    committed_cents: com || 0, budget_cents: Math.round(Number(x.budget) * 100) });
  const sundayBlock = () => { if (isSunday()) fail('Sunday is a staff holiday: campaigns cannot go live today. Save it as a draft and launch it on Monday.', 403); };

  app.get('/api/staff/campaigns', gate('campaigns'), h(async (q, r) => {
    const rows = (await db.query(`SELECT c.*, (SELECT count(*)::int FROM campaign_members m WHERE m.campaign_id = c.id) AS members,
        count(s.id) FILTER (WHERE s.status = 'pending')::int AS c_pending, count(s.id) FILTER (WHERE s.status IN ('approved','verified'))::int AS c_live,
        count(s.id) FILTER (WHERE s.status = 'completed')::int AS c_done, count(s.id) FILTER (WHERE s.status = 'rejected')::int AS c_rejected,
        COALESCE(SUM(GREATEST(${PV}, 0)) FILTER (WHERE ${COUNTED}), 0)::bigint AS views,
        COALESCE((SELECT SUM(amount_cents) FROM ledger l WHERE l.campaign_id = c.id AND l.type = 'earning'), 0)::bigint AS paid
      FROM campaigns c LEFT JOIN submissions s ON s.campaign_id = c.id GROUP BY c.id ORDER BY (c.status = 'live') DESC, (c.status = 'draft') DESC, c.id DESC`)).rows;
    const com = await core.committed(rows.map(x => x.id));
    r.json(rows.map(x => ({ ...campRow(x, com.get(x.id)), members: x.members, clips: { pending: x.c_pending, live: x.c_live, done: x.c_done, rejected: x.c_rejected }, views: num(x.views), paid_cents: num(x.paid) })));
  }));
  app.get('/api/staff/campaigns/:id', gate('campaigns'), h(async (q, r) => {
    const id = int(q.params.id), x = (await db.query('SELECT * FROM campaigns WHERE id = $1', [id])).rows[0];
    if (!x) fail('Campaign not found', 404);
    const top = (await db.query(`SELECT u.id, u.username, u.avatar, count(*)::int AS clips, COALESCE(SUM(GREATEST(${PV}, 0)), 0)::bigint AS views, COALESCE(SUM(s.earned_cents), 0)::bigint AS earned
      FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.campaign_id = $1 AND ${COUNTED} GROUP BY u.id ORDER BY views DESC LIMIT 10`, [id])).rows;
    const locked = (await db.query(`SELECT 1 FROM submissions WHERE campaign_id = $1 AND status <> 'rejected' LIMIT 1`, [id])).rowCount > 0;
    r.json({ campaign: campRow(x, (await core.committed([id])).get(id)), locked, top: top.map(t => ({ ...t, views: num(t.views), earned_cents: num(t.earned) })) });
  }));
  app.post('/api/staff/campaigns', gate('campaigns'), h(async (q, r) => {
    const c = cleanCampaign(q.body), live = !!q.body.live;
    if (live) sundayBlock();
    if (live && c.ends_at && new Date(c.ends_at) < new Date()) fail('The end date is in the past');
    const x = (await db.query(`INSERT INTO campaigns (${CAMP_COLS.join(',')}, status) VALUES (${CAMP_COLS.map((_, i) => '$' + (i + 1)).join(',')}, $${CAMP_COLS.length + 1}) RETURNING *`,
      [...CAMP_COLS.map(k => c[k]), live ? 'live' : 'draft'])).rows[0];
    await core.audit(q.actor, 'campaign.create', 'campaign', x.id, { title: x.title, status: x.status });
    if (live) core.hook('campaigns', { title: 'New campaign is live', description: `**${x.title}**\n$${Number(x.rate).toFixed(2)} per 1,000 views · $${Number(x.budget).toLocaleString('en-US')} budget` });
    r.json({ ok: true, id: x.id });
  }));
  app.put('/api/staff/campaigns/:id', gate('campaigns'), h(async (q, r) => {
    const id = int(q.params.id), c = cleanCampaign(q.body);
    const res = await core.tx(async cn => {
      const old = (await cn.query('SELECT * FROM campaigns WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!old) fail('Campaign not found', 404);
      const used = (await cn.query(`SELECT 1 FROM submissions WHERE campaign_id = $1 AND status <> 'rejected' LIMIT 1`, [id])).rowCount > 0;
      if (used) {
        const changed = LOCKED.filter(k => String(c[k] == null ? '' : c[k]) !== String(old[k] == null ? '' : (k === 'rate' || k === 'max_payout') ? Number(old[k]) : old[k]));
        if (changed.length) fail('Rate, minimum views, max payout and tracking days are locked once clips exist, so nobody is paid a different amount than they were promised. Create a new campaign instead.', 409);
      }
      const committed = (await core.committed([id])).get(id) || 0;
      if (Math.round(c.budget * 100) < committed) fail(`The budget cannot be lower than the ${usd(committed)} already earned or promised`, 409);
      await cn.query(`UPDATE campaigns SET ${CAMP_COLS.map((k, i) => `${k} = $${i + 1}`).join(', ')}, updated_at = now() WHERE id = $${CAMP_COLS.length + 1}`, [...CAMP_COLS.map(k => c[k]), id]);
      return old;
    });
    await core.audit(q.actor, 'campaign.update', 'campaign', id, { title: c.title });
    r.json({ ok: true, was: res.title });
  }));
  app.post('/api/staff/campaigns/:id/status', gate('campaigns'), h(async (q, r) => {
    const id = int(q.params.id), st = String(q.body.status || '');
    if (!['draft', 'live', 'ended'].includes(st)) fail('Unknown status');
    const x = (await db.query('SELECT * FROM campaigns WHERE id = $1', [id])).rows[0]; if (!x) fail('Campaign not found', 404);
    if (st === 'live' && x.status !== 'live') { sundayBlock(); if (x.ends_at && new Date(x.ends_at) < new Date()) fail('The end date is in the past. Edit the campaign first.'); }
    if (st === 'draft' && x.status !== 'draft' && (await db.query('SELECT 1 FROM campaign_members WHERE campaign_id = $1 LIMIT 1', [id])).rowCount) fail('Clippers already joined this campaign. End it instead of moving it back to draft.', 409);
    await db.query('UPDATE campaigns SET status = $2, updated_at = now() WHERE id = $1', [id, st]);
    await core.audit(q.actor, 'campaign.status', 'campaign', id, { title: x.title, from: x.status, to: st });
    if (st === 'live' && x.status !== 'live') core.hook('campaigns', { title: 'New campaign is live', description: `**${x.title}**\n$${Number(x.rate).toFixed(2)} per 1,000 views · $${Number(x.budget).toLocaleString('en-US')} budget` });
    r.json({ ok: true });
  }));
  app.post('/api/staff/campaigns/:id/duplicate', gate('campaigns'), h(async (q, r) => {
    const x = (await db.query('SELECT * FROM campaigns WHERE id = $1', [int(q.params.id)])).rows[0]; if (!x) fail('Campaign not found', 404);
    const n = (await db.query(`INSERT INTO campaigns (${CAMP_COLS.join(',')}, status) SELECT ${CAMP_COLS.map(k => k === 'title' ? `left(title, 90) || ' (copy)'` : k === 'ends_at' ? 'NULL' : k).join(',')}, 'draft' FROM campaigns WHERE id = $1 RETURNING id`, [x.id])).rows[0];
    await core.audit(q.actor, 'campaign.duplicate', 'campaign', n.id, { from: x.id });
    r.json({ ok: true, id: n.id });
  }));
  app.delete('/api/staff/campaigns/:id', gate('campaigns'), h(async (q, r) => {
    const id = int(q.params.id), x = (await db.query('SELECT title FROM campaigns WHERE id = $1', [id])).rows[0]; if (!x) fail('Campaign not found', 404);
    if ((await db.query('SELECT 1 FROM submissions WHERE campaign_id = $1 LIMIT 1', [id])).rowCount) fail('This campaign has clips, so it cannot be deleted. End it instead.', 409);
    await db.query('DELETE FROM campaigns WHERE id = $1', [id]);
    await core.audit(q.actor, 'campaign.delete', 'campaign', id, { title: x.title });
    r.json({ ok: true });
  }));

  // ================================================================ announcements
  app.get('/api/staff/announcements', gate('campaigns'), h(async (q, r) => r.json((await db.query('SELECT id, title, body, pinned, author, created_at FROM announcements ORDER BY pinned DESC, id DESC LIMIT 50')).rows)));
  app.post('/api/staff/announcements', gate('campaigns'), h(async (q, r) => {
    const title = clip(q.body.title, 100), body = clip(q.body.body, 1000);
    if (title.length < 3) fail('Write a title');
    const x = (await db.query('INSERT INTO announcements (title, body, pinned, author) VALUES ($1,$2,$3,$4) RETURNING id', [title, body, !!q.body.pinned, q.actor.name])).rows[0];
    await core.audit(q.actor, 'announcement.create', 'announcement', x.id, { title });
    core.hook('campaigns', { title: '📣 ' + title, description: body });
    r.json({ ok: true, id: x.id });
  }));
  app.delete('/api/staff/announcements/:id', gate('campaigns'), h(async (q, r) => {
    await db.query('DELETE FROM announcements WHERE id = $1', [int(q.params.id)]);
    await core.audit(q.actor, 'announcement.delete', 'announcement', q.params.id, {});
    r.json({ ok: true });
  }));

  // ================================================================ clippers
  app.get('/api/staff/users', gate('users'), h(async (q, r) => {
    const pg = paging(q, 30), s = clip(q.query.q, 40), f = String(q.query.filter || 'all'), where = [`($1 = '' OR u.username ILIKE $2 OR u.discord_id = $1)`];
    if (f === 'banned') where.push('u.banned'); else if (f === 'staff') where.push(`u.role <> 'clipper'`); else if (f === 'new') where.push(`u.created_at > now() - interval '7 days'`);
    const rows = (await db.query(`SELECT u.id, u.discord_id, u.username, u.avatar, u.role, u.banned, u.created_at, u.last_seen, u.xp, u.agreed_at,
        (SELECT count(*)::int FROM accounts a WHERE a.user_id = u.id AND a.status = 'approved') AS accounts,
        (SELECT count(*)::int FROM submissions z WHERE z.user_id = u.id) AS clips,
        (SELECT COALESCE(SUM(GREATEST(sidq_pay_views(z.views_verified, z.views, z.views_source), 0)), 0) FROM submissions z WHERE z.user_id = u.id AND z.status IN ('approved','verified','completed'))::bigint AS views,
        COALESCE((SELECT SUM(amount_cents) FROM ledger l WHERE l.user_id = u.id), 0)::bigint AS balance
      FROM users u WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ${pg.per} OFFSET ${pg.offset}`, [s, like(s)])).rows;
    r.json({ users: rows.map(u => ({ ...u, views: num(u.views), balance_cents: num(u.balance), tier: core.rankOf(u.xp).rank, staff: u.role !== 'clipper' })), page: pg.page, more: rows.length === pg.per });
  }));
  app.get('/api/staff/users/:id', gate('users'), h(async (q, r) => {
    const id = int(q.params.id), can = p => q.actor.perms.includes(p), u = (await db.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
    if (!u) fail('Clipper not found', 404);
    const [accounts, camps, clips, ledger, payouts, methods, totals, tickets] = await Promise.all([
      db.query('SELECT id, platform, handle, followers, status, created_at FROM accounts WHERE user_id = $1 ORDER BY id', [id]),
      db.query('SELECT c.id, c.title FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id WHERE m.user_id = $1 ORDER BY m.joined_at DESC LIMIT 20', [id]),
      db.query(`${STAFF_SELECT} WHERE s.user_id = $1 ORDER BY s.id DESC LIMIT 20`, [id]),
      db.query('SELECT id, type, amount_cents, note, created_at FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [id]),
      db.query('SELECT id, method_type, amount_cents, status, tx_ref, created_at, paid_at FROM payouts WHERE user_id = $1 ORDER BY id DESC LIMIT 10', [id]),
      can('payouts') ? db.query('SELECT id, type, details FROM payout_methods WHERE user_id = $1 ORDER BY id', [id]) : { rows: [] },
      one(`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS balance, COALESCE(SUM(amount_cents) FILTER (WHERE type IN ('earning','referral','bonus')), 0)::bigint AS earned FROM ledger WHERE user_id = $1`, [id]),
      one(`SELECT count(*)::int AS n FROM tickets WHERE user_id = $1 AND status <> 'closed'`, [id])
    ]);
    r.json({
      user: { id: u.id, discord_id: u.discord_id, username: u.username, avatar: u.avatar, role: u.role, banned: u.banned, ban_reason: u.ban_reason, bio: u.bio, email: can('users_manage') ? u.email : null,
        created_at: u.created_at, last_seen: u.last_seen, agreed_at: u.agreed_at, xp: u.xp, ...core.rankOf(u.xp), staff_note: u.staff_note, referred_by: u.referred_by },
      balance_cents: num(totals.balance), earned_cents: num(totals.earned), open_tickets: tickets.n,
      accounts: accounts.rows, campaigns: camps.rows, clips: clips.rows.map(staffClipOut),
      ledger: ledger.rows.map(l => ({ ...l, id: num(l.id), amount_cents: num(l.amount_cents) })),
      payouts: payouts.rows.map(p => ({ ...p, amount_cents: num(p.amount_cents) })),
      methods: methods.rows.map(m => core.staffMethod(m.type, m.details))
    });
  }));
  const canTouch = async (q, id) => {
    const u = (await db.query('SELECT id, role, username FROM users WHERE id = $1', [id])).rows[0];
    if (!u) fail('Clipper not found', 404);
    if (q.actor.id === u.id) fail('You cannot do this to your own account');
    if (rankOf(u.role) >= q.actor.rank) fail('You cannot change someone with the same or a higher role than yours');
    return u;
  };
  app.post('/api/staff/users/:id/ban', gate('users_manage'), h(async (q, r) => {
    const u = await canTouch(q, int(q.params.id)), reason = clip(q.body.reason, 200);
    if (reason.length < 3) fail('Write the reason. It is shown to the clipper when they try to log in.');
    await db.query('UPDATE users SET banned = true, ban_reason = $2 WHERE id = $1', [u.id, reason]);
    await core.audit(q.actor, 'user.ban', 'user', u.id, { username: u.username, reason });
    r.json({ ok: true });
  }));
  app.post('/api/staff/users/:id/unban', gate('users_manage'), h(async (q, r) => {
    const u = await canTouch(q, int(q.params.id));
    await db.query(`UPDATE users SET banned = false, ban_reason = '' WHERE id = $1`, [u.id]);
    await core.audit(q.actor, 'user.unban', 'user', u.id, { username: u.username });
    r.json({ ok: true });
  }));
  app.post('/api/staff/users/:id/note', gate('users_manage'), h(async (q, r) => {
    const id = int(q.params.id); if (!(await db.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) fail('Clipper not found', 404);
    await db.query('UPDATE users SET staff_note = $2 WHERE id = $1', [id, clip(q.body.note, 1000)]);
    await core.audit(q.actor, 'user.note', 'user', id, {});
    r.json({ ok: true });
  }));
  app.post('/api/staff/users/:id/message', gate('users_manage'), h(async (q, r) => {
    const id = int(q.params.id), title = clip(q.body.title, 100), body = clip(q.body.body, 400);
    if (title.length < 3) fail('Write a title');
    if (!(await db.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount) fail('Clipper not found', 404);
    await core.notify(id, 'message', title, body, '');
    await core.audit(q.actor, 'user.message', 'user', id, { title });
    r.json({ ok: true });
  }));
  // A bonus (adds money) or a correction (adds or removes money). Always needs a reason, always in the ledger and audit log.
  app.post('/api/staff/users/:id/adjust', gate('payouts'), h(async (q, r) => {
    const id = int(q.params.id), note = clip(q.body.note, 150), raw = String(q.body.amount == null ? '' : q.body.amount).trim(), sign = raw.startsWith('-') ? -1 : 1;
    const cents = core.parseMoney(raw.replace(/^[-+]/, ''));
    if (cents == null || cents === 0) fail('Enter an amount like 5 or -5.50');
    if (cents > 10000000) fail('That amount is too large');
    if (note.length < 3) fail('Write a short reason. The clipper sees it.');
    const kind = sign > 0 && q.body.kind === 'bonus' ? 'bonus' : 'adjustment';
    await core.tx(async c => {
      if (!(await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id])).rowCount) fail('Clipper not found', 404);
      await c.query(`INSERT INTO ledger (user_id, type, amount_cents, note, actor_id) VALUES ($1,$2,$3,$4,$5)`, [id, kind, sign * cents, note, q.actor.id]);
    });
    await core.audit(q.actor, 'wallet.' + kind, 'user', id, { amount_cents: sign * cents, note });
    await core.notify(id, 'message', sign > 0 ? 'Bonus added to your wallet' : 'Wallet correction', `${usd(sign * cents)}: ${note}`, '#wallet');
    r.json({ ok: true });
  }));

  // ================================================================ staff team (owner only)
  app.get('/api/staff/team', gate('staff'), h(async (q, r) => {
    const rows = (await db.query(`SELECT id, discord_id, username, avatar, role, last_seen, created_at FROM users WHERE role <> 'clipper' ORDER BY id`)).rows;
    r.json({ team: rows, roles: Object.fromEntries(STAFF_ROLES.map(k => [k, { label: ROLES[k].label, about: ROLES[k].about, perms: ROLES[k].perms }])) });
  }));
  const pickRole = v => { const role = String(v || ''); if (!STAFF_ROLES.includes(role) || role === 'owner') fail('Pick a role'); return role; };
  app.post('/api/staff/team', gate('staff'), h(async (q, r) => {
    const role = pickRole(q.body.role), who = clip(q.body.who, 60).replace(/^@/, '');
    if (!who) fail('Enter their Discord user ID or username');
    let t = /^\d{15,25}$/.test(who) ? (await db.query('SELECT id, role, username FROM users WHERE discord_id = $1', [who])).rows[0] : null;
    if (!t) {
      const rows = (await db.query('SELECT id, role, username FROM users WHERE lower(username) = lower($1) LIMIT 2', [who])).rows;
      if (rows.length > 1) fail('More than one person has that name. Use their Discord user ID instead.');
      t = rows[0];
    }
    if (!t) fail('We could not find them. They need to log in to the clipper portal with Discord once first.', 404);
    if (t.role === 'owner') fail('The owner role cannot be changed');
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [t.id, role]);
    await core.audit(q.actor, 'staff.set_role', 'user', t.id, { username: t.username, from: t.role, to: role });
    r.json({ ok: true });
  }));
  app.put('/api/staff/team/:id', gate('staff'), h(async (q, r) => {
    const id = int(q.params.id), role = pickRole(q.body.role), t = (await db.query('SELECT id, role, username FROM users WHERE id = $1', [id])).rows[0];
    if (!t) fail('Person not found', 404);
    if (t.role === 'owner') fail('The owner role cannot be changed');
    await db.query('UPDATE users SET role = $2 WHERE id = $1', [id, role]);
    await core.audit(q.actor, 'staff.set_role', 'user', id, { username: t.username, from: t.role, to: role });
    r.json({ ok: true });
  }));
  app.delete('/api/staff/team/:id', gate('staff'), h(async (q, r) => {
    const id = int(q.params.id), t = (await db.query('SELECT id, role, username FROM users WHERE id = $1', [id])).rows[0];
    if (!t) fail('Person not found', 404);
    if (t.role === 'owner') fail('The owner role cannot be removed');
    await db.query(`UPDATE users SET role = 'clipper' WHERE id = $1`, [id]);
    await core.audit(q.actor, 'staff.remove', 'user', id, { username: t.username, was: t.role });
    r.json({ ok: true });
  }));

  // ================================================================ support tickets
  app.get('/api/staff/tickets', gate('support'), h(async (q, r) => {
    const pg = paging(q, 30), f = String(q.query.status || 'open'), s = clip(q.query.q, 40), where = [], args = [];
    if (f === 'open') where.push(`t.status <> 'closed'`); else if (f === 'closed') where.push(`t.status = 'closed'`); else if (f === 'waiting') where.push(`t.status = 'open'`);
    if (s) { args.push(like(s)); where.push(`(u.username ILIKE $${args.length} OR t.subject ILIKE $${args.length})`); }
    const rows = (await db.query(`SELECT t.id, t.category, t.subject, t.status, t.created_at, t.updated_at, u.id AS user_id, u.username, u.avatar,
        (SELECT body FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT staff FROM ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_staff
      FROM tickets t JOIN users u ON u.id = t.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${f === 'closed' ? 't.updated_at DESC' : 't.updated_at ASC'} LIMIT ${pg.per} OFFSET ${pg.offset}`, args)).rows;
    const counts = Object.fromEntries((await db.query('SELECT status, count(*)::int AS n FROM tickets GROUP BY 1')).rows.map(x => [x.status, x.n]));
    r.json({ tickets: rows, counts, page: pg.page, more: rows.length === pg.per });
  }));
  app.get('/api/staff/tickets/:id', gate('support'), h(async (q, r) => {
    const id = int(q.params.id), t = (await db.query('SELECT t.*, u.username, u.avatar FROM tickets t JOIN users u ON u.id = t.user_id WHERE t.id = $1', [id])).rows[0];
    if (!t) fail('Ticket not found', 404);
    const msgs = (await db.query('SELECT id, author, staff, body, created_at FROM ticket_messages WHERE ticket_id = $1 ORDER BY id', [id])).rows;
    const bal = q.actor.perms.includes('users') ? await core.balance(t.user_id) : null;
    r.json({ ticket: t, messages: msgs.map(m => ({ ...m, id: num(m.id) })), balance_cents: bal });
  }));
  app.post('/api/staff/tickets/:id/reply', gate('support'), h(async (q, r) => {
    const id = int(q.params.id), body = clip(q.body.body, 4000), t = (await db.query('SELECT * FROM tickets WHERE id = $1', [id])).rows[0];
    if (!t) fail('Ticket not found', 404);
    if (body.length < 2) fail('Write your reply first');
    const close = !!q.body.close;
    await core.tx(async c => {
      await c.query('INSERT INTO ticket_messages (ticket_id, author_id, author, staff, body) VALUES ($1,$2,$3,true,$4)', [id, q.actor.id, q.actor.name, body]);
      await c.query('UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1', [id, close ? 'closed' : 'answered']);
    });
    await core.audit(q.actor, 'ticket.reply', 'ticket', id, { closed: close });
    await core.notify(t.user_id, 'ticket_reply', 'New reply to your ticket', `${t.subject}: ${body}`, '#ticket/' + id);
    r.json({ ok: true });
  }));
  app.post('/api/staff/tickets/:id/close', gate('support'), h(async (q, r) => { await db.query(`UPDATE tickets SET status = 'closed', updated_at = now() WHERE id = $1`, [int(q.params.id)]); await core.audit(q.actor, 'ticket.close', 'ticket', q.params.id, {}); r.json({ ok: true }); }));
  app.post('/api/staff/tickets/:id/reopen', gate('support'), h(async (q, r) => { await db.query(`UPDATE tickets SET status = 'open', updated_at = now() WHERE id = $1`, [int(q.params.id)]); await core.audit(q.actor, 'ticket.reopen', 'ticket', q.params.id, {}); r.json({ ok: true }); }));

  // ================================================================ settings, system, audit
  app.get('/api/staff/settings', gate('settings'), h(async (q, r) => {
    const st = await core.settings(), env = k => !!process.env[k];
    r.json({ settings: st, method_names: core.METHOD_NAMES, jobs: jobs.names,
      system: { youtube_key: ctx.hasYoutubeKey(), service: await service.state(), connect_key: connect.keyReady(), connect: Object.fromEntries(['youtube', 'tiktok', 'instagram'].map(k => [k, { configured: P.hasConnect(k), keys: P.KEYS[k].map(v => [v, env(v)]) }])), discord_login: env('DISCORD_CLIENT_ID') && env('DISCORD_CLIENT_SECRET'), bot_token: env('DISCORD_BOT_TOKEN'), data_key: env('DATA_KEY'),
        webhooks: { staff: env('DISCORD_WEBHOOK_STAFF'), payouts: env('DISCORD_WEBHOOK_PAYOUTS'), campaigns: env('DISCORD_WEBHOOK_CAMPAIGNS') }, site_url: process.env.SITE_URL || '', jobs_off: env('DISABLE_JOBS') } });
  }));
  app.put('/api/staff/settings', gate('settings'), h(async (q, r) => {
    const b = q.body || {}, patch = {};
    if (b.min_payout_cents !== undefined) { const v = int(b.min_payout_cents, NaN, 100, 1000000); if (!Number.isFinite(v)) fail('The minimum payout must be between $1 and $10,000'); patch.min_payout_cents = v; }
    if (b.referral_pct !== undefined) patch.referral_pct = int(b.referral_pct, 0, 0, 50);
    if (b.pkr_rate !== undefined) { const v = Number(b.pkr_rate); if (!(v >= 50 && v <= 1000)) fail('Enter the PKR rate for $1, between 50 and 1000'); patch.pkr_rate = v; }
    if (b.service_daily_cap !== undefined) { const v = Number(b.service_daily_cap); if (String(b.service_daily_cap).trim() === '' || !Number.isInteger(v) || v < 0 || v > 100000) fail('The daily limit must be a whole number from 0 to 100,000 (0 pauses the data service)'); patch.service_daily_cap = v; }
    if (b.service_poll_hours !== undefined) { const v = Number(b.service_poll_hours); if (!Number.isInteger(v) || v < 1 || v > 48) fail('Read a clip again every 1 to 48 hours'); patch.service_poll_hours = v; }
    if (b.show_payout_feed !== undefined) patch.show_payout_feed = !!b.show_payout_feed;
    if (b.payout_note !== undefined) patch.payout_note = clip(b.payout_note, 300);
    if (b.methods && typeof b.methods === 'object') { patch.methods = {}; for (const k of Object.keys(core.METHOD_NAMES)) if (b.methods[k] !== undefined) patch.methods[k] = !!b.methods[k]; patch.methods = { ...(await core.settings()).methods, ...patch.methods }; }
    if (!Object.keys(patch).length) fail('Nothing to save');
    await core.saveSettings(patch);
    await core.audit(q.actor, 'settings.update', 'settings', '', patch);
    r.json({ ok: true });
  }));
  // The Test button next to the data service key: two small lookups that show whether the key works and the answer can be read.
  app.post('/api/staff/service/test', gate('settings'), h(async (q, r) => {
    core.limit('svctest', 10, 600e3, 'Wait a few minutes before testing again.');
    const out = await service.test();
    await core.audit(q.actor, 'service.test', 'settings', '', { configured: out.configured, ok: out.checks.every(c => c.ok) });
    r.json({ ok: true, ...out, state: await service.state() });
  }));
  app.post('/api/staff/jobs/:name/run', gate('settings'), h(async (q, r) => {
    if (!jobs.names.includes(q.params.name)) fail('Unknown job', 404);
    core.limit('job:' + q.params.name, 10, 600e3);
    const out = await jobs.run(q.params.name);
    await core.audit(q.actor, 'job.run', 'job', q.params.name, { result: out });
    r.json({ ok: true, result: out });
  }));
  app.get('/api/staff/audit', gate('audit'), h(async (q, r) => {
    const pg = paging(q, 40), s = clip(q.query.q, 40);
    const rows = (await db.query(`SELECT id, at, actor, action, target_type, target_id, meta FROM audit_log WHERE ($1 = '' OR actor ILIKE $2 OR action ILIKE $2 OR target_id = $1)
      ORDER BY id DESC LIMIT ${pg.per} OFFSET ${pg.offset}`, [s, like(s)])).rows;
    r.json({ rows: rows.map(x => ({ ...x, id: num(x.id) })), page: pg.page, more: rows.length === pg.per });
  }));
};
