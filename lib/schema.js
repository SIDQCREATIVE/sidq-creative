'use strict';
// Database migrations for the clipper platform. Every statement is idempotent
// (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so it is safe to run on every start and
// safe on the live database: nothing is dropped and no existing data is changed.

const STATEMENTS = [
  // ---- existing tables: new columns ----
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ref_code TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by INT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_note TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS show_earnings BOOLEAN NOT NULL DEFAULT true`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code ON users (ref_code) WHERE ref_code IS NOT NULL`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verify_code TEXT`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS external_id TEXT`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS reject_reason TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS reviewed_by INT`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS requires_analytics BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS analytics_note TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS assets_url TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS track_days INT NOT NULL DEFAULT 7`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  // one account per platform+username, regardless of upper/lower case (skipped if old data already clashes)
  `DO $$ BEGIN CREATE UNIQUE INDEX IF NOT EXISTS accounts_platform_handle_ci ON accounts (platform, lower(handle)); EXCEPTION WHEN unique_violation THEN NULL; END $$`,

  // ---- clips ----
  // status: pending (waiting for the rules check) > approved > verified (counting toward pay) > completed (money is in the wallet)
  //         or rejected at any point before completed.
  // analytics_state: none | requested | submitted | accepted
  `CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    account_id INT REFERENCES accounts(id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    thumb TEXT NOT NULL DEFAULT '',
    posted_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending',
    views BIGINT NOT NULL DEFAULT 0,
    likes BIGINT NOT NULL DEFAULT 0,
    comments BIGINT NOT NULL DEFAULT 0,
    views_source TEXT NOT NULL DEFAULT 'none',
    views_verified BIGINT,
    views_checked_at TIMESTAMPTZ,
    track_error TEXT NOT NULL DEFAULT '',
    flags JSONB NOT NULL DEFAULT '[]',
    review_note TEXT NOT NULL DEFAULT '',
    reject_reason TEXT NOT NULL DEFAULT '',
    reviewed_by INT,
    reviewed_at TIMESTAMPTZ,
    analytics_state TEXT NOT NULL DEFAULT 'none',
    analytics_round INT NOT NULL DEFAULT 0,
    analytics_requested_at TIMESTAMPTZ,
    analytics_submitted_at TIMESTAMPTZ,
    analytics_note TEXT NOT NULL DEFAULT '',
    analytics_feedback TEXT NOT NULL DEFAULT '',
    verified_by INT,
    verified_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    earned_cents BIGINT,
    finalized_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // set when the tracking window ended and staff/clipper were asked for the final analytics (TikTok and Instagram views cannot be read automatically)
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS final_requested_at TIMESTAMPTZ`,
  `CREATE UNIQUE INDEX IF NOT EXISTS submissions_one_live_video ON submissions (platform, external_id) WHERE status <> 'rejected'`,
  `CREATE INDEX IF NOT EXISTS submissions_user ON submissions (user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS submissions_campaign ON submissions (campaign_id, status)`,
  `CREATE INDEX IF NOT EXISTS submissions_status ON submissions (status, submitted_at)`,

  // Audience analytics screenshots a clipper uploads when staff ask for them. Kept in the database
  // (Railway containers lose local files on every deploy).
  `CREATE TABLE IF NOT EXISTS proofs (
    id SERIAL PRIMARY KEY,
    submission_id INT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    user_id INT NOT NULL,
    round INT NOT NULL DEFAULT 1,
    mime TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS proofs_submission ON proofs (submission_id)`,
  // Proof can also be a screen recording (mp4, mov, webm). Videos are never compressed by Postgres (EXTERNAL storage),
  // so a viewer who jumps to the middle of a recording only reads that part from the database.
  `ALTER TABLE proofs ADD COLUMN IF NOT EXISTS bytes INT`,
  `ALTER TABLE proofs ALTER COLUMN data SET STORAGE EXTERNAL`,

  // ---- accounts connected through the platform's own login (YouTube, TikTok, Instagram) ----
  // verified_via: 'code' = a code in the bio checked by staff or the YouTube API, 'api' = the clipper signed in on the platform.
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verified_via TEXT NOT NULL DEFAULT 'code'`,
  // The platform's id for the connected video (Instagram media id). TikTok and YouTube ids are already in external_id.
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS api_ref TEXT`,
  // Access tokens are stored encrypted (see lib/connect.js). One connection per account.
  `CREATE TABLE IF NOT EXISTS platform_connections (
    id SERIAL PRIMARY KEY,
    account_id INT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    external_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ,
    refresh_expires_at TIMESTAMPTZ,
    scopes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    last_error TEXT NOT NULL DEFAULT '',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    refreshed_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ
  )`,
  // the same platform identity can be connected by one clipper only
  `CREATE UNIQUE INDEX IF NOT EXISTS platform_connections_identity ON platform_connections (platform, external_id)`,
  `CREATE INDEX IF NOT EXISTS platform_connections_user ON platform_connections (user_id)`,

  `CREATE TABLE IF NOT EXISTS view_snapshots (
    id BIGSERIAL PRIMARY KEY,
    submission_id INT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    views BIGINT NOT NULL, likes BIGINT NOT NULL DEFAULT 0, comments BIGINT NOT NULL DEFAULT 0,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS view_snapshots_sub ON view_snapshots (submission_id, id)`,

  // ---- hand-added accounts are checked by the website itself (see lib/autoverify.js) ----
  // checked_at = when the website last looked at the bio. code_at = when the current code was handed out.
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS code_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
  // read_failed_at = the last time a background read of this clip's views did not work (the data service failed or its answer could not be read).
  // It spaces out the retries, so a video that cannot be read never costs a request every 20 minutes.
  `ALTER TABLE submissions ADD COLUMN IF NOT EXISTS read_failed_at TIMESTAMPTZ`,
  // Requests to the optional paid data service per UTC day (the daily limit in Settings protects against a surprise bill).
  `CREATE TABLE IF NOT EXISTS api_usage (
    day DATE NOT NULL,
    service TEXT NOT NULL,
    n INT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, service)
  )`,

  // What happened to a clip, in order. internal = only staff see it.
  `CREATE TABLE IF NOT EXISTS submission_events (
    id BIGSERIAL PRIMARY KEY,
    submission_id INT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    internal BOOLEAN NOT NULL DEFAULT false
  )`,
  `CREATE INDEX IF NOT EXISTS submission_events_sub ON submission_events (submission_id, id)`,

  // ---- money: an append-only ledger. A clipper's balance is the sum of their rows. ----
  `CREATE TABLE IF NOT EXISTS ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    amount_cents BIGINT NOT NULL,
    submission_id INT REFERENCES submissions(id) ON DELETE SET NULL,
    campaign_id INT,
    payout_id INT,
    note TEXT NOT NULL DEFAULT '',
    actor_id INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_user ON ledger (user_id, id DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_earning ON ledger (submission_id) WHERE type = 'earning'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_referral ON ledger (submission_id) WHERE type = 'referral'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_payout_debit ON ledger (payout_id) WHERE type = 'payout'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_payout_refund ON ledger (payout_id) WHERE type = 'payout_refund'`,

  `CREATE TABLE IF NOT EXISTS payout_methods (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS payout_methods_user ON payout_methods (user_id)`,

  // status: requested > processing > paid, or rejected / cancelled (the money goes back to the wallet)
  `CREATE TABLE IF NOT EXISTS payouts (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    method_type TEXT NOT NULL,
    method JSONB NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    status TEXT NOT NULL DEFAULT 'requested',
    tx_ref TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    processed_by INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_open ON payouts (user_id) WHERE status IN ('requested','processing')`,
  `CREATE INDEX IF NOT EXISTS payouts_status ON payouts (status, id DESC)`,

  // ---- support ----
  `CREATE TABLE IF NOT EXISTS tickets (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'other',
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS tickets_user ON tickets (user_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS ticket_messages (
    id BIGSERIAL PRIMARY KEY,
    ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id INT,
    author TEXT NOT NULL DEFAULT '',
    staff BOOLEAN NOT NULL DEFAULT false,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS ticket_messages_ticket ON ticket_messages (ticket_id, id)`,

  // ---- notifications, news, settings, audit trail ----
  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS notifications_user ON notifications (user_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    pinned BOOLEAN NOT NULL DEFAULT false,
    author TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id INT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    meta JSONB NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log (id DESC)`,

  // ---- money helpers, kept in SQL so every query agrees on the formula ----
  // Views that count toward pay: staff-verified views if set, otherwise automatically tracked views.
  // Views that nobody has read from the platform or verified are never paid.
  `CREATE OR REPLACE FUNCTION sidq_pay_views(verified BIGINT, tracked BIGINT, source TEXT) RETURNS BIGINT AS $$
     SELECT COALESCE(verified, CASE WHEN source = 'api' THEN tracked END)
   $$ LANGUAGE sql IMMUTABLE`,
  // Earnings in cents: nothing below the campaign's minimum views; otherwise views/1000 * rate,
  // rounded down to the cent and capped by the campaign's max payout per video.
  `CREATE OR REPLACE FUNCTION sidq_earn_cents(v BIGINT, rate NUMERIC, minv INT, maxp NUMERIC) RETURNS BIGINT AS $$
     SELECT CASE WHEN v IS NULL OR v <= 0 OR v < minv THEN 0
       ELSE LEAST(FLOOR(v * ROUND(rate * 100) / 1000)::BIGINT, COALESCE(ROUND(maxp * 100)::BIGINT, 9223372036854775807)) END
   $$ LANGUAGE sql IMMUTABLE`,
];

module.exports = async function migrate(db) {
  const c = await db.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727001)'); // two deploys starting together must not migrate at once
    for (const s of STATEMENTS) await c.query(s);
  } finally {
    try { await c.query('SELECT pg_advisory_unlock(727001)'); } catch (e) { /* connection is closing anyway */ }
    c.release();
  }
};
