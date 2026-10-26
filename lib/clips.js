'use strict';
// Clip helpers shared by the clipper API and the staff API: which stage a clip is in,
// the SQL for each stage, and the JSON shape sent to the browser.

// A verified clip can be asked for a second ("final") analytics upload when its tracking window ends
// and its views cannot be read automatically (TikTok, Instagram), so analytics stages cover both statuses.
const STAGE_SQL = {
  review:    `s.status = 'pending'`,
  analytics: `s.status IN ('approved','verified') AND s.analytics_state = 'requested'`,
  checking:  `s.status IN ('approved','verified') AND s.analytics_state = 'submitted'`,
  tracking:  `s.status = 'approved' AND s.analytics_state NOT IN ('requested','submitted')`,
  verified:  `s.status = 'verified' AND s.analytics_state NOT IN ('requested','submitted')`,
  completed: `s.status = 'completed'`,
  rejected:  `s.status = 'rejected'`
};

const CLIP_SELECT = `SELECT s.*, c.title AS campaign_title, c.rate, c.min_views, c.max_payout, c.track_days,
    c.requires_analytics, c.analytics_note AS campaign_analytics_note, c.submit_hours
  FROM submissions s JOIN campaigns c ON c.id = s.campaign_id`;

// Same as CLIP_SELECT plus who posted it, which account, and how many analytics screenshots exist (staff panel).
const STAFF_SELECT = `SELECT s.*, c.title AS campaign_title, c.rate, c.min_views, c.max_payout, c.track_days,
    c.requires_analytics, c.analytics_note AS campaign_analytics_note, c.submit_hours,
    u.username, u.avatar, u.created_at AS user_created, a.handle AS account_handle, a.followers AS account_followers, a.verified_via AS account_via,
    (SELECT count(*)::int FROM proofs p WHERE p.submission_id = s.id) AS proof_count
  FROM submissions s JOIN campaigns c ON c.id = s.campaign_id JOIN users u ON u.id = s.user_id LEFT JOIN accounts a ON a.id = s.account_id`;

// review = staff have not looked yet | analytics = clipper must upload analytics | checking = staff check the analytics
// tracking = approved and counting views | verified = analytics accepted, waiting for the tracking window to end
const stageOf = s => (s.status === 'approved' || s.status === 'verified') && s.analytics_state === 'requested' ? 'analytics'
  : (s.status === 'approved' || s.status === 'verified') && s.analytics_state === 'submitted' ? 'checking'
  : s.status === 'approved' ? 'tracking'
  : ({ pending: 'review', verified: 'verified', completed: 'completed', rejected: 'rejected' })[s.status] || s.status;

const STAGE_LABEL = { review: 'In review', analytics: 'Analytics needed', checking: 'Checking analytics', tracking: 'Tracking views', verified: 'Verified', completed: 'Paid to wallet', rejected: 'Rejected' };

module.exports = function makeClips(core) {
  const num = v => (v == null ? null : Number(v));
  // `s` is a row from CLIP_SELECT.
  const clipOut = s => {
    const pv = core.payViews(s);
    const live = s.status === 'approved' || s.status === 'verified';
    const ends = s.approved_at ? new Date(new Date(s.approved_at).getTime() + (Number(s.track_days) || 7) * 864e5) : null;
    return {
      id: s.id, campaign_id: s.campaign_id, campaign: s.campaign_title, platform: s.platform, url: s.url, title: s.title, thumb: s.thumb,
      status: s.status, stage: stageOf(s), stage_label: STAGE_LABEL[stageOf(s)],
      views: num(s.views), views_verified: num(s.views_verified), pay_views: pv, est_cents: live ? core.earnCents(pv, s) : null, earned_cents: num(s.earned_cents),
      analytics_state: s.analytics_state, analytics_round: s.analytics_round, analytics_feedback: s.analytics_feedback,
      reject_reason: s.reject_reason, submitted_at: s.submitted_at, approved_at: s.approved_at, posted_at: s.posted_at,
      tracking_ends: live ? ends : null, track_error: s.track_error, views_source: s.views_source
    };
  };
  // What the staff panel gets for one clip: everything the clipper sees plus who, flags and internal notes.
  const staffClipOut = s => {
    const base = clipOut(s), ends = s.approved_at ? new Date(new Date(s.approved_at).getTime() + (Number(s.track_days) || 7) * 864e5) : null;
    return { ...base, user: { id: s.user_id, username: s.username, avatar: s.avatar }, account: { handle: s.account_handle, followers: num(s.account_followers), connected: s.account_via === 'api' },
      likes: num(s.likes), comments: num(s.comments), flags: s.flags || [], review_note: s.review_note, proof_count: s.proof_count, views_checked_at: s.views_checked_at,
      final_requested_at: s.final_requested_at, analytics_requested_at: s.analytics_requested_at, analytics_submitted_at: s.analytics_submitted_at, analytics_note: s.analytics_note, requires_analytics: s.requires_analytics,
      needs_views: s.views_source !== 'api' && s.views_verified == null, window_over: !!(ends && ends <= new Date()), tracking_ends: ends };
  };
  return { STAGE_SQL, CLIP_SELECT, STAFF_SELECT, stageOf, STAGE_LABEL, clipOut, staffClipOut };
};
module.exports.STAGE_SQL = STAGE_SQL;
module.exports.stageOf = stageOf;
module.exports.STAGE_LABEL = STAGE_LABEL;
