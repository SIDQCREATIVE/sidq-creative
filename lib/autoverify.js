'use strict';
// Checks an account that a clipper added by hand, without a person:
//   1. the username exists ("account name correct"), and
//   2. the verification code is in the bio, so the account really belongs to this clipper.
// A name alone can never prove ownership (anyone can type any username), so the code is what approves the account.
//  - YouTube is read with the free YOUTUBE_API_KEY.
//  - TikTok and Instagram are read through the optional data service (lib/dataservice.js).
//  - Without either, a person checks the code (Staff > Accounts) as before.
const P = require('./platforms');

const PLAT = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

module.exports = function makeAutoVerify({ db, core, service }) {
  // 'key' (YouTube with the free API key), 'service' (TikTok / Instagram data service) or null (a person checks)
  const sourceFor = platform => platform === 'youtube' ? (P.hasYoutubeKey() ? 'key' : null) : (platform === 'tiktok' || platform === 'instagram') && service.enabled() ? 'service' : null;
  // which platforms are checked by the website itself right now
  const status = () => ({ youtube: sourceFor('youtube') === 'key', tiktok: sourceFor('tiktok') === 'service', instagram: sourceFor('instagram') === 'service' });

  // { found, id, handle, followers, bio, isPrivate }, or null when this platform cannot be read automatically. Throws when the platform did not answer.
  const readProfile = async (platform, handle, kind) => {
    const src = sourceFor(platform); if (!src) return null;
    if (src === 'key') {
      const ch = await P.youtubeChannel(handle);
      return ch && ch.found ? { found: true, id: ch.id, handle, followers: ch.subs, bio: ch.description, isPrivate: false } : { found: false };
    }
    return service.profile(platform, handle, { kind });
  };
  const hasCode = (bio, code) => !!code && String(bio || '').toUpperCase().includes(String(code).toUpperCase());

  // Right after a clipper types a username: is there such an account? null = could not tell (the later checks still run).
  const lookup = async (platform, handle) => {
    try { return await readProfile(platform, handle, 'live'); }
    catch (e) { console.error(`[verify] ${platform} lookup failed:`, e.message); return null; }
  };

  const approve = async (a, pr) => {
    // The same real account must not end up verified for two clippers.
    if (pr.id && (await db.query(`SELECT 1 FROM accounts WHERE platform = $1 AND external_id = $2 AND id <> $3 AND status = 'approved' AND user_id <> $4 LIMIT 1`, [a.platform, pr.id, a.id, a.user_id])).rowCount) return { state: 'taken', profile: pr };
    const u = await db.query(`UPDATE accounts SET status = 'approved', followers = $2, external_id = $3, reject_reason = '', reviewed_at = now(), verified_via = 'code' WHERE id = $1 AND status = 'pending'`, [a.id, pr.followers, pr.id || null]);
    if (!u.rowCount) return { state: 'approved', profile: pr, already: true }; // a person or another check was faster
    await core.notify(a.user_id, 'account_approved', PLAT[a.platform] + ' account verified', `@${a.handle} is verified. You can join campaigns now.`, '#campaigns');
    return { state: 'approved', profile: pr };
  };

  // Looks at one pending account. state: approved | no_code | not_found | private | taken | unavailable | off
  const check = async (a, kind) => {
    let pr;
    try { pr = await readProfile(a.platform, a.handle, kind); }
    catch (e) { await db.query('UPDATE accounts SET checked_at = now() WHERE id = $1', [a.id]); return { state: 'unavailable', error: e }; }
    if (!pr) return { state: 'off' };
    await db.query('UPDATE accounts SET checked_at = now() WHERE id = $1', [a.id]);
    if (!pr.found) return { state: 'not_found' };
    if (pr.isPrivate) return { state: 'private', profile: pr };
    if (!hasCode(pr.bio, a.verify_code)) return { state: 'no_code', profile: pr };
    return approve(a, pr);
  };

  // Background job: every pending hand-added account. While the clipper is waiting (the first 2 hours after the code was given) it looks every
  // 9 minutes, later every 12 hours, and it stops after 3 days (the clipper can still press "Check now", and staff can approve by hand).
  // TikTok and Instagram cost one request each look and YouTube uses some of its free quota, so an abandoned account must not be looked at forever.
  const checkPending = async () => {
    const rows = (await db.query(`SELECT id, user_id, platform, handle, verify_code FROM accounts
      WHERE status = 'pending' AND verified_via = 'code' AND verify_code IS NOT NULL AND code_at > now() - interval '3 days'
        AND (checked_at IS NULL OR checked_at < now() - CASE WHEN code_at > now() - interval '2 hours' THEN interval '9 minutes' ELSE interval '12 hours' END)
      ORDER BY checked_at NULLS FIRST, id LIMIT 100`)).rows;
    let approved = 0, checked = 0, skipped = 0;
    for (const a of rows) {
      if (!sourceFor(a.platform)) { skipped++; continue; }
      const res = await check(a, 'job'); checked++;
      if (res.state === 'approved' && !res.already) approved++;
      if (res.state === 'unavailable') { console.error(`[verify] ${a.platform} check failed:`, res.error && res.error.message); if (res.error && ['capped', 'down', 'key'].includes(res.error.code)) break; }
    }
    return { checked, approved, ...(skipped ? { skipped } : {}) };
  };

  return { sourceFor, status, lookup, check, checkPending, hasCode };
};
