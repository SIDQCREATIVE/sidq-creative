'use strict';
// Reading video links, and reading view counts through the platforms' official APIs.
//  - YouTube: free official Data API. With YOUTUBE_API_KEY, views of any public video are read. A clipper who signed in with
//    Google ("Connect YouTube") can also be read with their own access token, so no key is needed for them.
//  - TikTok and Instagram: there is no free official way to read the views of someone else's video. When a clipper signs in
//    with TikTok / Instagram ("Connect"), the platform lets us read THEIR OWN videos through the official Display API and
//    Instagram API. For accounts that are not connected there is an optional paid data service (lib/dataservice.js) that reads
//    public pages; without it, views are checked by staff from the screen recording the clipper uploads.
//    The upload time is still read from the video id itself, so "posted too long ago" is detected automatically.

const sane = ms => (ms > Date.UTC(2016, 0, 1) && ms < Date.now() + 864e5) ? new Date(ms) : null;
const IG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// TikTok video ids start with the upload time in seconds (first 32 bits).
const tiktokTime = id => { try { return sane(Number(BigInt(id) >> 32n) * 1000); } catch (e) { return null; } };
// Instagram short codes are the media id in base 64. The id holds the upload time (ms since 2011-08-24, 23 bits of shift).
const instagramTime = code => {
  try { let n = 0n; for (const ch of code) { const i = IG.indexOf(ch); if (i < 0) return null; n = n * 64n + BigInt(i); } return sane(Number((n >> 23n) + 1314220021721n)); }
  catch (e) { return null; }
};

// Turns a pasted link into { platform, id, url, handle?, postedAt? } or { platform:'tiktok', short:true } for share links.
const parseClipUrl = raw => {
  let u; try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, ''), p = u.pathname.split('/').filter(Boolean);
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    let id = null, shorts = false;
    if (host === 'youtu.be') id = p[0];
    else if (p[0] === 'shorts') { id = p[1]; shorts = true; }
    else if (p[0] === 'watch') id = u.searchParams.get('v');
    else if (p[0] === 'live') id = p[1];
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return { platform: 'youtube', id, url: shorts ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` };
  }
  if (host === 'tiktok.com' || host === 'm.tiktok.com') {
    if (p[0] && p[0][0] === '@' && p[1] === 'video' && /^\d{15,25}$/.test(p[2] || '') && /^[\w.]{1,40}$/.test(p[0].slice(1))) {
      const handle = p[0].slice(1), id = p[2];
      return { platform: 'tiktok', id, handle, url: `https://www.tiktok.com/@${handle}/video/${id}`, postedAt: tiktokTime(id) };
    }
    if (p[0] === 't' && p[1]) return { platform: 'tiktok', short: true, url: u.href };
    return null;
  }
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return p[0] ? { platform: 'tiktok', short: true, url: u.href } : null;
  if (host === 'instagram.com' || host === 'm.instagram.com') {
    const kinds = ['reel', 'reels', 'p', 'tv'];
    const at = kinds.includes(p[0]) ? 0 : kinds.includes(p[1]) ? 1 : -1;
    const code = at >= 0 ? p[at + 1] : null;
    if (!code || !/^[\w-]{5,20}$/.test(code)) return null;
    return { platform: 'instagram', id: code, handle: at === 1 ? p[0].toLowerCase() : null, url: `https://www.instagram.com/reel/${code}/`, postedAt: instagramTime(code) };
  }
  return null;
};

// Share links (vm.tiktok.com/XXXX) hide the real address. Follow the redirect to find it.
const resolveShort = async short => {
  try {
    const r = await fetch(short.url, { redirect: 'follow', signal: AbortSignal.timeout(7000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; SIDQ-Creative/1.0)' } });
    try { r.body && r.body.cancel(); } catch (e) { /* not needed */ }
    const p = parseClipUrl(r.url);
    return p && !p.short ? p : null;
  } catch (e) { return null; }
};

// ---------------------------------------------------------------- where the platforms live
// PLATFORM_MOCK_URL is for automated tests only: every platform call goes to a fake server instead of the real one.
// It is only honoured for an address on this same machine, so a wrong value in production can never send sign-ins to a stranger's server.
const MOCK_RAW = (process.env.PLATFORM_MOCK_URL || '').replace(/\/$/, '');
const MOCK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(MOCK_RAW) ? MOCK_RAW : '';
if (MOCK_RAW && !MOCK) console.warn('[platforms] PLATFORM_MOCK_URL ignored: it must be http://127.0.0.1 or http://localhost');
if (MOCK) console.warn('[platforms] PLATFORM_MOCK_URL is set, so YouTube, TikTok and Instagram calls go to', MOCK, '(test mode, remove it in production)');
const URLS = MOCK ? {
  google: { auth: MOCK + '/google/auth', token: MOCK + '/google/token', revoke: MOCK + '/google/revoke', yt: MOCK + '/google/youtube/v3/' },
  tiktok: { auth: MOCK + '/tiktok/v2/auth/authorize/', api: MOCK + '/tiktok/v2/' },
  instagram: { auth: MOCK + '/instagram/oauth/authorize', short: MOCK + '/instagram/oauth/access_token', graph: MOCK + '/instagram/' },
  service: MOCK + '/scrapecreators/'
} : {
  google: { auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', yt: 'https://www.googleapis.com/youtube/v3/' },
  tiktok: { auth: 'https://www.tiktok.com/v2/auth/authorize/', api: 'https://open.tiktokapis.com/v2/' },
  instagram: { auth: 'https://www.instagram.com/oauth/authorize', short: 'https://api.instagram.com/oauth/access_token', graph: 'https://graph.instagram.com/' },
  service: 'https://api.scrapecreators.com/'
};
const env = k => process.env[k] || '';
// The app credentials of each platform (set as variables in Railway).
const KEYS = { youtube: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], instagram: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'] };
const creds = p => ({ id: env(KEYS[p][0]), secret: env(KEYS[p][1]) });
const hasConnect = p => !!(KEYS[p] && creds(p).id && creds(p).secret);
const IGV = () => env('INSTAGRAM_API_VERSION') || 'v23.0';

// An error from a platform. auth = the access was revoked or expired, so the clipper must connect again.
// rate = temporary, try again later. Everything else is a normal failure.
class ApiError extends Error {
  constructor(message, o = {}) { super(message); this.status = o.status || 0; this.auth = !!o.auth; this.rate = !!o.rate; this.code = o.code || ''; }
}
const call = async (url, o = {}) => {
  let r;
  try { r = await fetch(url, { ...o, signal: AbortSignal.timeout(o.timeout || 12000) }); }
  catch (e) { throw new ApiError('Could not reach the platform. ' + (e && e.message || ''), { status: 0, rate: true }); }
  const text = await r.text(); let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { ok: r.ok, status: r.status, json, text };
};
const form = o => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
const bearer = t => ({ headers: { Authorization: 'Bearer ' + t } });

// ---------------------------------------------------------------- YouTube Data API
const ytKey = () => process.env.YOUTUBE_API_KEY || '';
const ytGet = async (path, params, token) => {
  const url = URLS.google.yt + path + '?' + new URLSearchParams(token ? params : { ...params, key: ytKey() });
  const r = await call(url, token ? bearer(token) : {});
  if (!r.ok) {
    const e = r.json && r.json.error, reason = e && e.errors && e.errors[0] && e.errors[0].reason || '';
    throw new ApiError('YouTube said ' + r.status + (reason ? ' (' + reason + ')' : ''), { status: r.status, auth: token ? r.status === 401 : false, rate: r.status === 429 || reason === 'quotaExceeded' || reason === 'rateLimitExceeded' });
  }
  return r.json || {};
};
// Up to 50 videos per call. Returns Map(id -> stats). Videos that are private or deleted are simply missing from the map.
// With a clipper's access token the call is made as that clipper, otherwise with YOUTUBE_API_KEY.
const youtubeVideos = async (ids, token) => {
  const out = new Map(); if ((!ytKey() && !token) || !ids.length) return null;
  for (let i = 0; i < ids.length; i += 50) { // the API takes 50 ids per call
    const part = ids.slice(i, i + 50);
    const j = await ytGet('videos', { part: 'snippet,statistics', id: part.join(','), maxResults: String(part.length) }, token);
    for (const it of j.items || []) {
      const st = it.statistics || {}, sn = it.snippet || {};
      out.set(it.id, { views: Number(st.viewCount) || 0, likes: Number(st.likeCount) || 0, comments: Number(st.commentCount) || 0, title: sn.title || '', thumb: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default) || {}).url || '', channelId: sn.channelId || '', postedAt: sn.publishedAt ? new Date(sn.publishedAt) : null });
    }
  }
  return out;
};
// Finds a channel by @handle: its id, description (where the clipper put the verification code) and subscribers.
const youtubeChannel = async handle => {
  if (!ytKey()) return null;
  const j = await ytGet('channels', { part: 'snippet,statistics', forHandle: '@' + String(handle).replace(/^@/, '') });
  const it = (j.items || [])[0]; if (!it) return { found: false };
  return { found: true, id: it.id, description: (it.snippet || {}).description || '', subs: Number((it.statistics || {}).subscriberCount) || 0 };
};
// TikTok's public oEmbed tells us the author and thumbnail. Failure just means "unknown", never "rejected".
const tiktokInfo = async url => {
  try {
    const r = await fetch('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = await r.json(), m = /@([\w.]+)/.exec(j.author_url || '');
    return { handle: m ? m[1] : null, title: j.title || '', thumb: j.thumbnail_url || '' };
  } catch (e) { return null; }
};

// ---------------------------------------------------------------- sign in with the platform ("Connect")
// Every provider has the same shape:
//   authUrl({ redirectUri, state })        where to send the clipper
//   exchange(code, redirectUri)            code -> { accessToken, refreshToken, expiresIn, refreshExpiresIn, scopes }
//   refresh(token)                         refresh token (Instagram: the long-lived access token) -> same shape
//   profile(accessToken)                   -> { externalId, handle, followers, name, avatar }
//   revoke(accessToken)                    best effort
const tokenShape = (j, extra) => ({ accessToken: j.access_token, refreshToken: j.refresh_token || null, expiresIn: Number(j.expires_in) || null, refreshExpiresIn: Number(j.refresh_expires_in) || null, scopes: String(j.scope || j.scopes || ''), ...extra });

const google = {
  scopes: 'https://www.googleapis.com/auth/youtube.readonly',
  authUrl: ({ redirectUri, state }) => URLS.google.auth + '?' + new URLSearchParams({ client_id: creds('youtube').id, redirect_uri: redirectUri, response_type: 'code', scope: google.scopes, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state }),
  async token(params) {
    const c = creds('youtube');
    const r = await call(URLS.google.token, form({ client_id: c.id, client_secret: c.secret, ...params }));
    const j = r.json || {};
    if (!r.ok || !j.access_token) throw new ApiError('Google did not accept the sign-in' + (j.error ? ' (' + j.error + ')' : ''), { status: r.status, auth: j.error === 'invalid_grant', code: j.error || '' });
    return tokenShape(j);
  },
  exchange(code, redirectUri) { return google.token({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' }); },
  async refresh(refreshToken) { const t = await google.token({ refresh_token: refreshToken, grant_type: 'refresh_token' }); return { ...t, refreshToken: t.refreshToken || refreshToken }; },
  async profile(accessToken) {
    const j = await ytGet('channels', { part: 'snippet,statistics', mine: 'true' }, accessToken);
    const it = (j.items || [])[0];
    if (!it) throw new ApiError('This Google account has no YouTube channel. Create a channel first, then connect again.', { code: 'no_channel' });
    const sn = it.snippet || {}, st = it.statistics || {};
    return { externalId: it.id, handle: String(sn.customUrl || '').replace(/^@/, '') || it.id, followers: st.hiddenSubscriberCount ? 0 : Number(st.subscriberCount) || 0, name: sn.title || '', avatar: ((sn.thumbnails || {}).default || {}).url || '' };
  },
  async revoke(token) { try { await call(URLS.google.revoke + '?' + new URLSearchParams({ token }), { method: 'POST' }); } catch (e) { /* best effort */ } }
};

const tiktok = {
  // user.info.profile gives the @username, user.info.stats the follower count, video.list the views of the clipper's own videos
  scopes: 'user.info.basic,user.info.profile,user.info.stats,video.list',
  required: ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list'], // the person can untick permissions on TikTok's page, so every one is checked
  authUrl: ({ redirectUri, state }) => URLS.tiktok.auth + '?' + new URLSearchParams({ client_key: creds('tiktok').id, scope: tiktok.scopes, response_type: 'code', redirect_uri: redirectUri, state }),
  async token(params) {
    const c = creds('tiktok');
    const r = await call(URLS.tiktok.api + 'oauth/token/', form({ client_key: c.id, client_secret: c.secret, ...params }));
    const j = r.json || {};
    if (!r.ok || !j.access_token) throw new ApiError('TikTok did not accept the sign-in' + (j.error ? ' (' + j.error + ')' : ''), { status: r.status, auth: j.error === 'invalid_grant', code: j.error || '' });
    return { ...tokenShape(j), openId: j.open_id || '' };
  },
  exchange(code, redirectUri) { return tiktok.token({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' }); },
  async refresh(refreshToken) { const t = await tiktok.token({ refresh_token: refreshToken, grant_type: 'refresh_token' }); return { ...t, refreshToken: t.refreshToken || refreshToken }; }, // TikTok may hand out a new refresh token
  // TikTok answers { data, error: { code: 'ok' | 'access_token_invalid' | ... } }
  async api(path, accessToken, o) {
    const r = await call(URLS.tiktok.api + path, { ...bearer(accessToken), ...o, headers: { ...bearer(accessToken).headers, ...(o && o.headers) } });
    const e = r.json && r.json.error, code = e && e.code || '';
    if (r.ok && (!code || code === 'ok')) return (r.json && r.json.data) || {};
    throw new ApiError('TikTok said ' + (code || r.status) + (e && e.message ? ': ' + e.message : ''), { status: r.status, code, auth: /^(access_token_invalid|token_expired|invalid_token)/.test(code) || r.status === 401, rate: /rate_limit/.test(code) || r.status === 429 });
  },
  async profile(accessToken) {
    const d = await tiktok.api('user/info/?fields=' + encodeURIComponent('open_id,union_id,avatar_url,display_name,username,follower_count'), accessToken);
    const u = d.user || {};
    if (!u.open_id) throw new ApiError('TikTok did not return the account. Please try again.', { code: 'no_user' });
    return { externalId: u.open_id, handle: String(u.username || '').replace(/^@/, ''), followers: Number(u.follower_count) || 0, name: u.display_name || '', avatar: u.avatar_url || '' };
  },
  // The clipper's own videos by id (20 per call). Videos that are private, deleted or not theirs are missing from the map.
  async videos(accessToken, ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 20) {
      const d = await tiktok.api('video/query/?fields=' + encodeURIComponent('id,title,video_description,cover_image_url,share_url,create_time,view_count,like_count,comment_count,share_count'), accessToken,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { video_ids: ids.slice(i, i + 20) } }) });
      for (const v of d.videos || []) out.set(String(v.id), { views: Number(v.view_count) || 0, likes: Number(v.like_count) || 0, comments: Number(v.comment_count) || 0, title: v.title || v.video_description || '', thumb: v.cover_image_url || '', postedAt: v.create_time ? new Date(Number(v.create_time) * 1000) : null });
    }
    return out;
  },
  async revoke(token) { try { const c = creds('tiktok'); await call(URLS.tiktok.api + 'oauth/revoke/', form({ client_key: c.id, client_secret: c.secret, token })); } catch (e) { /* best effort */ } }
};

const instagram = {
  // Instagram API with Instagram Login: Creator and Business accounts only
  scopes: 'instagram_business_basic,instagram_business_manage_insights',
  required: ['instagram_business_basic', 'instagram_business_manage_insights'],
  authUrl: ({ redirectUri, state }) => URLS.instagram.auth + '?' + new URLSearchParams({ client_id: creds('instagram').id, redirect_uri: redirectUri, response_type: 'code', scope: instagram.scopes, state }),
  // Graph errors look like { error: { message, type, code } }. Code 190 means the access token is no longer valid.
  err(r, what) {
    const e = (r.json && r.json.error) || {}, code = Number(e.code) || 0;
    return new ApiError(`Instagram ${what || 'request'} failed${e.message ? ': ' + e.message : ' (' + r.status + ')'}`, { status: r.status, code: String(code || r.json && r.json.error_type || ''), auth: code === 190 || code === 102 || r.status === 401, rate: [4, 17, 32, 613, 80002, 80004].includes(code) || r.status === 429 || r.status >= 500 });
  },
  graph: (path, token, params) => URLS.instagram.graph + path + '?' + new URLSearchParams({ ...params, access_token: token }),
  async exchange(code, redirectUri) {
    const c = creds('instagram');
    const r = await call(URLS.instagram.short, form({ client_id: c.id, client_secret: c.secret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }));
    const d = r.json && (Array.isArray(r.json.data) ? r.json.data[0] : r.json); // the docs show { data: [ {...} ] }
    if (!r.ok || !d || !d.access_token) throw new ApiError('Instagram did not accept the sign-in' + (r.json && (r.json.error_message || r.json.error_type) ? ' (' + (r.json.error_message || r.json.error_type) + ')' : ''), { status: r.status, auth: false, code: r.json && r.json.error_type || '' });
    // swap the 1 hour token for the 60 day token
    const l = await call(instagram.graph('access_token', d.access_token, { grant_type: 'ig_exchange_token', client_secret: c.secret }));
    if (!l.ok || !l.json || !l.json.access_token) throw instagram.err(l, 'token exchange');
    return { accessToken: l.json.access_token, refreshToken: null, expiresIn: Number(l.json.expires_in) || 5184000, refreshExpiresIn: null, scopes: String(d.permissions || instagram.scopes), userId: String(d.user_id || '') };
  },
  // Long-lived tokens are refreshed with themselves (must be at least 24 hours old and not expired yet).
  async refresh(token) {
    const l = await call(instagram.graph('refresh_access_token', token, { grant_type: 'ig_refresh_token' }));
    if (!l.ok || !l.json || !l.json.access_token) throw instagram.err(l, 'token refresh');
    return { accessToken: l.json.access_token, refreshToken: null, expiresIn: Number(l.json.expires_in) || 5184000, refreshExpiresIn: null, scopes: '' };
  },
  async profile(token) {
    const r = await call(instagram.graph(IGV() + '/me', token, { fields: 'user_id,username,account_type,followers_count,name,profile_picture_url' }));
    if (!r.ok || !r.json) throw instagram.err(r, 'profile');
    const j = r.json;
    if (j.account_type && !/^(BUSINESS|MEDIA_CREATOR|CREATOR)$/i.test(j.account_type)) throw new ApiError('This Instagram account is not a Creator or Business account.', { code: 'not_professional' });
    return { externalId: String(j.user_id || j.id || ''), handle: String(j.username || '').replace(/^@/, ''), followers: Number(j.followers_count) || 0, name: j.name || '', avatar: j.profile_picture_url || '' };
  },
  // Walks through the account's own posts (newest first) once, looking for the posts with these link codes.
  // Returns Map(code -> media). A code that is missing was not found among the latest posts.
  async findMedia(token, codes, maxPages = 6) {
    const want = new Set(codes), found = new Map(), host = new URL(URLS.instagram.graph).host;
    let url = instagram.graph(IGV() + '/me/media', token, { fields: 'id,permalink,timestamp,media_product_type,like_count,comments_count,thumbnail_url,caption', limit: '50' });
    for (let page = 0; page < maxPages && url && found.size < want.size; page++) {
      const r = await call(url);
      if (!r.ok || !r.json) throw instagram.err(r, 'media list');
      for (const m of r.json.data || []) {
        const code = String(m.permalink || '').split('/').filter(Boolean).find(seg => want.has(seg));
        if (code && !found.has(code)) found.set(code, m);
      }
      const next = r.json.paging && r.json.paging.next;
      url = next && (() => { try { return new URL(next).host === host ? next : null; } catch (e) { return null; } })();
    }
    return found;
  },
  // Numbers for one post: views from the insights, likes and comments from the post itself.
  async mediaStats(token, mediaId) {
    const [m, ins] = await Promise.all([
      call(instagram.graph(IGV() + '/' + encodeURIComponent(mediaId), token, { fields: 'like_count,comments_count,timestamp,thumbnail_url,caption' })),
      call(instagram.graph(IGV() + '/' + encodeURIComponent(mediaId) + '/insights', token, { metric: 'views' }))
    ]);
    if (m.status === 404 || (m.json && m.json.error && Number(m.json.error.code) === 100 && /does not exist|unsupported get request/i.test(m.json.error.message || ''))) return null; // deleted
    if (!m.ok || !m.json) throw instagram.err(m, 'post');
    // The docs: "the API returns an empty data set instead of 0", so a missing value means 0 views so far.
    let views = 0;
    if (ins.ok && ins.json) { const d = (ins.json.data || []).find(x => x.name === 'views'); const v = d && (d.total_value ? d.total_value.value : d.values && d.values[0] && d.values[0].value); views = Number(v) || 0; }
    else if (ins.json && ins.json.error && ![10, 100].includes(Number(ins.json.error.code))) throw instagram.err(ins, 'insights');
    return { views, likes: Number(m.json.like_count) || 0, comments: Number(m.json.comments_count) || 0, title: String(m.json.caption || '').slice(0, 200), thumb: m.json.thumbnail_url || '', postedAt: m.json.timestamp ? new Date(m.json.timestamp) : null };
  },
  async revoke() { /* Instagram has no revoke call: the clipper removes the app in Instagram, or the token simply expires */ }
};

const PROVIDERS = { youtube: google, tiktok, instagram };

module.exports = {
  parseClipUrl, resolveShort, tiktokTime, instagramTime, youtubeVideos, youtubeChannel, tiktokInfo, hasYoutubeKey: () => !!ytKey(),
  PROVIDERS, ApiError, KEYS, hasConnect, URLS, call
};
