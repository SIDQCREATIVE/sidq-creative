'use strict';
// An OPTIONAL paid data service that reads PUBLIC TikTok and Instagram pages for us. With one key (SCRAPECREATORS_API_KEY) the website can do
// for TikTok and Instagram what it does for YouTube with a free key: check that a username exists, find the verification code in the bio,
// and read the views of a video, without the clipper signing in.
//  - TikTok has no official key for this at all. Instagram's official way needs every clipper to sign in, or a Facebook Page of your own.
//  - This is NOT an official API. The service reads public pages. It can be slow, be wrong or be blocked, and it costs a little per request.
//  - It is only used for accounts that did NOT sign in with the platform ("Connect"): the platform's own login gives exact numbers for free.
//  - Safe by design: an answer that cannot be read is an error, never a guess. Nothing is approved or paid from an unreadable answer.
//  - A daily limit on requests (Staff > Settings) protects you from a surprise bill.
// Endpoints and fields follow the service's documentation (docs.scrapecreators.com): TikTok profile and video, Instagram profile and post.
const P = require('./platforms');

const NAME = 'ScrapeCreators';
const KEY = () => process.env.SCRAPECREATORS_API_KEY || '';
const intOrNull = v => { if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
const text = v => typeof v === 'string' ? v : '';
const at = sec => { const ms = Number(sec) * 1000; return ms > Date.UTC(2016, 0, 1) && ms < Date.now() + 864e5 ? new Date(ms) : null; };
// What the service says when the account or video simply is not there (as opposed to the service failing).
const GONE = /not found|does not exist|doesn't exist|no such|couldn'?t find|could not find|invalid (handle|username|url)|unavailable|private|removed|deleted/i;

module.exports = function makeService({ db, core }) {
  let down = null;      // { until, message }: the key was refused, credits ran out or the service is busy, so stop calling for a short while
  let lastError = null; // { at, message } shown to staff in Settings
  let credits = null;   // credits left, as reported by the service in its last answer

  const configured = () => !!KEY();
  const enabled = () => configured() && !(down && down.until > Date.now());
  const remember = message => { lastError = { at: new Date().toISOString(), message: String(message).slice(0, 300) }; };

  // Counts one request against today's limit (UTC day). Background jobs may use 90% of it, so a clipper adding an account still works late in the day.
  const reserve = async kind => {
    const cap = Math.floor(Number((await core.settings()).service_daily_cap));
    if (!(cap > 0)) return false;
    const limit = kind === 'job' ? Math.max(1, Math.floor(cap * 0.9)) : cap;
    const r = await db.query(`INSERT INTO api_usage (day, service, n) VALUES ((now() AT TIME ZONE 'UTC')::date, 'service', 1)
      ON CONFLICT (day, service) DO UPDATE SET n = api_usage.n + 1 WHERE api_usage.n < $1 RETURNING n`, [limit]);
    return r.rowCount > 0;
  };

  // One request. kind = 'live' (a person is waiting) or 'job' (background). force = ignore the pause (used by the Test button).
  const get = async (path, params, o = {}) => {
    if (!configured() || (!o.force && !enabled())) throw new P.ApiError('The data service is not available right now.', { code: 'down' });
    if (!(await reserve(o.kind))) throw new P.ApiError('The daily limit of data service requests has been reached. It starts again tomorrow (UTC time), or raise the limit in Settings.', { code: 'capped' });
    let r;
    try { r = await P.call(P.URLS.service + path + '?' + new URLSearchParams(params), { headers: { 'x-api-key': KEY(), accept: 'application/json' }, timeout: 30000 }); }
    catch (e) { remember(e.message); throw e; }
    if (r.status === 401 || r.status === 402 || r.status === 403) {
      const message = r.status === 402 ? `${NAME} says there are no credits left. Add credits in your ${NAME} account.` : `${NAME} did not accept the API key (HTTP ${r.status}). Check SCRAPECREATORS_API_KEY in Railway.`;
      down = { until: Date.now() + 10 * 60e3, message }; remember(message);
      throw new P.ApiError(message, { status: r.status, code: 'key' });
    }
    if (r.status === 429) { down = { until: Date.now() + 60e3, message: `${NAME} is busy` }; remember(`${NAME} is busy (HTTP 429)`); throw new P.ApiError(`${NAME} is busy. Try again in a minute.`, { status: 429, rate: true }); }
    if (r.status >= 500) { remember(`${NAME} had a problem (HTTP ${r.status})`); throw new P.ApiError(`${NAME} had a problem (HTTP ${r.status}). Try again later.`, { status: r.status, rate: true }); }
    down = null;
    if (r.json && Number.isFinite(Number(r.json.credits_remaining))) credits = Number(r.json.credits_remaining);
    return r;
  };
  const missing = r => r.status === 404 || (r.json && r.json.success === false && GONE.test(String(r.json.message || r.json.error || '')));
  const unreadable = (r, what) => { const e = new P.ApiError(`${NAME} answered, but not in a form we can read (${what}).`, { status: r.status }); remember(e.message); return e; };
  const refused = (r, what) => { const m = r.json && (r.json.message || r.json.error); const e = new P.ApiError(`${NAME} could not ${what} (HTTP ${r.status}${m ? ': ' + String(m).slice(0, 120) : ''}).`, { status: r.status, rate: r.status >= 500 }); remember(e.message); return e; };
  // false = the account or video is not there. Throws when the service itself failed (even if it answered with HTTP 200 and success:false), so a failure is never mistaken for "not found".
  const verdict = (r, what) => { if (missing(r)) return false; if (!r.ok || (r.json && r.json.success === false)) throw refused(r, what); return true; };
  const same = (r, expected, got) => { if (expected && got && String(expected) !== String(got)) { const e = new P.ApiError(`${NAME} returned a different video than the one asked for.`, { status: r.status }); remember(e.message); throw e; } };

  // ---------- profiles: { found, id, handle, followers, bio, isPrivate } ----------
  const tiktokProfile = async (handle, o) => {
    const r = await get('v1/tiktok/profile', { handle }, o);
    if (!verdict(r, 'read this TikTok profile')) return { found: false };
    const j = r.json; if (!j || typeof j !== 'object') throw unreadable(r, 'TikTok profile');
    const u = j.user, s = j.stats || {};
    if (!u || typeof u !== 'object' || !(u.uniqueId || u.id)) return { found: false };
    const followers = intOrNull(s.followerCount);
    if (followers === null) throw unreadable(r, 'no follower count');
    return { found: true, id: String(u.id || ''), handle: text(u.uniqueId) || handle, followers, bio: text(u.signature), isPrivate: !!(u.privateAccount || u.secret) };
  };
  const instagramProfile = async (handle, o) => {
    const r = await get('v1/instagram/profile', { handle }, o);
    if (!verdict(r, 'read this Instagram profile')) return { found: false };
    const j = r.json; if (!j || typeof j !== 'object') throw unreadable(r, 'Instagram profile');
    const u = j.data && j.data.user;
    if (!u || typeof u !== 'object' || !u.username) return { found: false };
    const followers = intOrNull(u.edge_followed_by && u.edge_followed_by.count);
    if (followers === null) throw unreadable(r, 'no follower count');
    return { found: true, id: String(u.id || ''), handle: text(u.username) || handle, followers, bio: text(u.biography), isPrivate: !!u.is_private };
  };

  // ---------- videos: { found, views, likes, comments, title, thumb, postedAt, author, coauthors, isVideo } ----------
  // p = a parsed clip link from parseClipUrl: { id, url }
  const tiktokVideo = async (p, o) => {
    const r = await get('v2/tiktok/video', { url: p.url }, o);
    if (!verdict(r, 'read this TikTok video')) return { found: false };
    const j = r.json; if (!j || typeof j !== 'object') throw unreadable(r, 'TikTok video');
    const d = j.aweme_detail || (j.data && j.data.aweme_detail);
    if (!d || typeof d !== 'object') throw unreadable(r, 'no video in the answer');
    const st = d.statistics || d.stats || {};
    const views = intOrNull(st.play_count !== undefined ? st.play_count : st.playCount);
    if (views === null) throw unreadable(r, 'no view count');
    same(r, p.id, d.aweme_id || d.id);
    const cover = d.video && d.video.cover && Array.isArray(d.video.cover.url_list) ? d.video.cover.url_list[0] : '';
    const a = d.author || {};
    return { found: true, isVideo: true, views, likes: intOrNull(st.digg_count !== undefined ? st.digg_count : st.diggCount) || 0, comments: intOrNull(st.comment_count !== undefined ? st.comment_count : st.commentCount) || 0,
      title: text(d.desc), thumb: text(cover), postedAt: at(d.create_time), author: text(a.unique_id || a.uniqueId), coauthors: [] };
  };
  const instagramVideo = async (p, o) => {
    const r = await get('v1/instagram/post', { url: p.url }, o);
    if (!verdict(r, 'read this Instagram post')) return { found: false };
    const j = r.json; if (!j || typeof j !== 'object') throw unreadable(r, 'Instagram post');
    const m = j.data && j.data.xdt_shortcode_media;
    if (!m || typeof m !== 'object') throw unreadable(r, 'no post in the answer');
    const isVideo = !!m.is_video, views = isVideo ? intOrNull(m.video_play_count !== undefined && m.video_play_count !== null ? m.video_play_count : m.video_view_count) : 0;
    if (isVideo && views === null) throw unreadable(r, 'no view count');
    same(r, p.id, m.shortcode);
    const cap = m.edge_media_to_caption && m.edge_media_to_caption.edges && m.edge_media_to_caption.edges[0] && m.edge_media_to_caption.edges[0].node;
    return { found: true, isVideo, views: views || 0, likes: intOrNull(m.edge_media_preview_like && m.edge_media_preview_like.count) || 0, comments: intOrNull(m.edge_media_to_parent_comment && m.edge_media_to_parent_comment.count) || 0,
      title: text(cap && cap.text).slice(0, 200), thumb: text(m.display_url || m.thumbnail_src), postedAt: at(m.taken_at_timestamp), author: text(m.owner && m.owner.username),
      coauthors: (Array.isArray(m.coauthor_producers) ? m.coauthor_producers : []).map(x => text(x && x.username)).filter(Boolean) };
  };

  const profile = (platform, handle, o = {}) => platform === 'tiktok' ? tiktokProfile(handle, o) : platform === 'instagram' ? instagramProfile(handle, o) : Promise.reject(new P.ApiError('Not supported', { code: 'down' }));
  const video = (platform, p, o = {}) => platform === 'tiktok' ? tiktokVideo(p, o) : platform === 'instagram' ? instagramVideo(p, o) : Promise.reject(new P.ApiError('Not supported', { code: 'down' }));

  // The Test button: two small, certain lookups. Shows staff straight away whether the key works and whether the answer can be read.
  const test = async () => {
    const out = { name: NAME, configured: configured(), checks: [] };
    if (!configured()) return out;
    for (const [platform, handle] of [['tiktok', 'tiktok'], ['instagram', 'instagram']]) {
      try {
        const pr = await profile(platform, handle, { kind: 'live', force: true });
        out.checks.push({ platform, ok: !!(pr.found && pr.followers > 0), message: pr.found ? `Found @${pr.handle}, ${pr.followers.toLocaleString('en-US')} followers` : 'The test account was not found' });
      } catch (e) { out.checks.push({ platform, ok: false, message: e.message }); }
    }
    return out;
  };

  const usage = async () => {
    const [st, row] = await Promise.all([core.settings(), db.query(`SELECT n FROM api_usage WHERE day = (now() AT TIME ZONE 'UTC')::date AND service = 'service'`)]);
    return { today: row.rows[0] ? Number(row.rows[0].n) : 0, cap: Math.floor(Number(st.service_daily_cap)) || 0, poll_hours: Number(st.service_poll_hours) || 6 };
  };
  // What Staff > Settings shows. A usage counter that cannot be read (the table is missing, the database is busy) must not break that page.
  const state = async () => {
    let u;
    try { u = await usage(); } catch (e) { console.error('The data service usage could not be read:', e.message); u = { today: 0, cap: 0, poll_hours: 6, unreadable: true }; }
    return { name: NAME, configured: configured(), enabled: enabled(), ...u, paused: down && down.until > Date.now() ? down.message : '', credits, last_error: lastError };
  };

  return { name: NAME, configured, enabled, profile, video, test, usage, state };
};
