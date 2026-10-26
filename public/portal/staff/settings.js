/* Settings (payouts, methods, system status, background jobs) and the audit log. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, dtime, ago, chip, note, empty, get, post, put, act, ok, qs } = SQ;

const SYS = [
  ['youtube_key', 'YouTube view tracking', 'YOUTUBE_API_KEY', 'YouTube views are read automatically for every account.', 'Off. YouTube views are still read for clippers who connect their account. Add a free YouTube API key to read them for every account.', true],
  ['discord_login', 'Discord login', 'DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET', 'Clippers and staff can log in with Discord.', 'Missing. Nobody can log in with Discord until both are set.', false],
  ['data_key', 'Payout details encryption', 'DATA_KEY', 'Saved payout details are encrypted.', 'Missing. Set a long random DATA_KEY before clippers save payout details. If you change it later, saved details cannot be read.', false],
  ['site_url', 'Website address', 'SITE_URL', null, 'Missing. Set it to your website address so Discord login and invite links use the right domain.', false],
  ['bot_token', 'Discord bot', 'DISCORD_BOT_TOKEN', 'The bot token is set.', 'Optional. Needed later for the Discord server bot.', true]
];
const LINKS = [['youtube', 'Connect YouTube', 'Clippers can sign in with Google and have their channel verified and views counted automatically.'], ['tiktok', 'Connect TikTok', 'Clippers can sign in with TikTok. Needs the TikTok app to be approved for the video list.'], ['instagram', 'Connect Instagram', 'Clippers with a Business or Creator account can sign in with Instagram. Needs Meta app review.']];
const HOOKS = [['staff', 'Staff alerts', 'New payout requests and tickets post to your staff channel.'], ['payouts', 'Payout feed', 'Paid payouts post to your payout-alerts channel.'], ['campaigns', 'Campaign news', 'New campaigns and announcements post to your campaigns channel.']];
const JOBS = {
  trackViews: ['Read views automatically', 'Reads fresh views for YouTube clips (with the API key) and for every clip on a connected account. Runs every 20 minutes. Instagram clips are read every 2 hours.'],
  checkAccounts: ['Check YouTube codes', 'Looks for the verification code in the channel description of YouTube accounts that clippers added by hand, and approves them. Runs every 5 minutes. Needs YOUTUBE_API_KEY.'],
  syncConnections: ['Keep connections healthy', 'Refreshes logins before they expire and updates follower counts and usernames of connected accounts. Runs every 3 hours.'],
  finalizeDue: ['Pay finished clips', 'Pays clips whose tracking window is over, or asks the clipper for final analytics. Runs every 10 minutes.'],
  endCampaigns: ['End finished campaigns', 'Ends campaigns that reached their end date. Runs every 5 minutes.'],
  tidy: ['Clean up', 'Deletes old read notifications. Runs once a day.']
};

SQ.route('settings', async ctx => {
  const r = await get('/api/staff/settings'), s = r.settings, sys = r.system;
  const row = (ok_, name, env, on, off, optional) => h`<div class="row nw" style="gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--line)"><span style="color:${ok_ ? 'var(--g)' : optional ? 'var(--mu2)' : 'var(--warn)'};margin-top:2px">${icon(ok_ ? 'checkc' : optional ? 'info' : 'alert')}</span><div style="flex:1;min-width:0"><div class="b">${name}</div><div class="xs mu">${ok_ ? on || '' : off}</div><div class="xs mono mu2" style="margin-top:2px">${env}</div></div>${chip(ok_ ? 'On' : optional ? 'Off' : 'Missing', ok_ ? 'ok' : optional ? 'mu' : 'warn')}</div>`;
  ctx.set(h`${SQ.head('Settings', 'How payouts work and whether the connections are in place.')}
    <div class="two"><div class="col" style="gap:14px"><form id="stform" onsubmit="return false" class="col" style="gap:14px">
      <div class="card"><div class="ch"><h3>Payouts</h3></div><div class="g2">
        <label class="f"><span class="h">Minimum payout (USD)</span><input class="in" name="min" inputmode="decimal" value="${SQ.dollars(s.min_payout_cents)}" autocomplete="off"><div class="hint">Clippers cannot ask for less than this.</div></label>
        <label class="f"><span class="h">EasyPaisa and JazzCash rate (PKR per $1)</span><input class="in" name="pkr" inputmode="decimal" value="${s.pkr_rate}" autocomplete="off"><div class="hint">Used to show how many rupees to send.</div></label></div>
        <label class="f"><span class="h">Note shown to clippers about payouts</span><textarea class="in" name="note" rows="2" maxlength="300">${s.payout_note || ''}</textarea></label>
        <label class="chk" style="margin:0"><span class="sw"><input type="checkbox" name="feed" ${s.show_payout_feed ? 'checked' : ''}><i></i></span><span>Show recent payouts on the clipper home page<div class="hint">Names are partly hidden. It shows new clippers that people get paid.</div></span></label></div>
      <div class="card"><div class="ch"><h3>Payout methods</h3></div><p class="sm mu" style="margin-bottom:8px">Turn a method off when you cannot send it right now. Clippers see only the methods that are on.</p>
        ${Object.keys(r.method_names).map(k => h`<label class="chk" style="margin:12px 0"><span class="sw"><input type="checkbox" name="m_${k}" ${s.methods[k] ? 'checked' : ''}><i></i></span><span>${r.method_names[k]}</span></label>`)}</div>
      <div class="card"><div class="ch"><h3>Referrals</h3></div><label class="f" style="margin:0"><span class="h">Referral bonus (percent)</span><input class="in" name="ref" inputmode="numeric" value="${s.referral_pct}" autocomplete="off" style="max-width:160px"><div class="hint">When a clipper invites someone, they earn this percent of what the new clipper earns, paid by you on top. Use 0 to turn referrals off. The most you can set is 50.</div></label></div>
      <div class="savebar"><span class="sm mu">Changes apply right away.</span><button type="button" class="btn p" data-act="st.save">Save settings</button></div></form></div>
      <div class="col sticky" style="gap:14px"><div class="card"><div class="ch" style="margin-bottom:0"><h3>Connections</h3></div>
        ${SYS.map(([k, name, env, on, off, opt]) => row(!!sys[k], name, env, k === 'site_url' ? sys.site_url : on, off, opt))}
        ${LINKS.map(([k, name, text]) => { const c = (sys.connect || {})[k] || { keys: [] }, missing = c.keys.filter(x => !x[1]).map(x => x[0]); return row(c.configured && !!sys.connect_key, name, c.keys.map(x => x[0]).join(' and '), text, c.configured ? 'The keys are set but DATA_KEY is missing, so the button stays hidden. Set a long random DATA_KEY.' : 'Not set up yet. Missing: ' + missing.join(', ') + '. The clipper can still add this account by hand and verify it with a code.', true); })}
        ${HOOKS.map(([k, name, text]) => row(!!sys.webhooks[k], name + ' (Discord)', 'DISCORD_WEBHOOK_' + k.toUpperCase(), text, 'Not set. ' + text.replace(/ post to /, ' would post to '), true))}
        ${row(!sys.jobs_off, 'Background jobs', 'DISABLE_JOBS', 'Views are read, finished clips are paid and campaigns end by themselves.', 'Off. Nothing happens automatically. Remove DISABLE_JOBS in Railway.', false)}
        <p class="xs mu" style="margin-top:12px">These are set as variables in Railway. Never paste secrets into a chat or a file. <a href="/connect/setup" target="_blank" rel="noopener" style="color:var(--g)">Open the page with the redirect addresses for the Google, TikTok and Instagram apps</a>.</p></div>
        <div class="card"><div class="ch"><h3>Background jobs</h3></div><p class="sm mu" style="margin-bottom:10px">They run by themselves. Run one now if you do not want to wait.</p>
          ${r.jobs.map(j => h`<div class="row nw" style="gap:12px;padding:10px 0;border-top:1px solid var(--line)"><div style="flex:1;min-width:0"><div class="b">${(JOBS[j] || [j])[0]}</div><div class="xs mu">${(JOBS[j] || [])[1] || ''}</div></div><button type="button" class="btn s" data-act="st.job" data-name="${j}">Run now</button></div>`)}</div></div></div>`);
}, 'settings');
act('st.save', async () => {
  const f = SQ.fields($('#stform')), cents = SQ.toCents(f.min);
  if (cents == null) throw new Error('Enter the minimum payout as a number like 10 or 10.50.');
  const methods = {}; Object.keys(f).filter(k => k.startsWith('m_')).forEach(k => { methods[k.slice(2)] = !!f[k]; });
  await put('/api/staff/settings', { min_payout_cents: cents, pkr_rate: f.pkr, payout_note: f.note, show_payout_feed: !!f.feed, referral_pct: f.ref, methods });
  ok('Settings saved.');
});
act('st.job', async el => {
  const r = await post(`/api/staff/jobs/${el.dataset.name}/run`, {}), x = r.result || {};
  ok(x.skipped ? 'That job is already running.' : x.error ? 'It failed: ' + x.error : 'Done. ' + (Object.keys(x).length ? Object.entries(x).map(([k, v]) => k + ': ' + v).join(', ') : ''));
});

/* ================================================================ audit log */
const ACTION = {
  'clip.approve': 'Approved a clip', 'clip.reject': 'Rejected a clip', 'clip.verify': 'Verified a clip', 'clip.set_views': 'Set counted views', 'clip.request_analytics': 'Asked for analytics', 'clip.decline_analytics': 'Declined analytics', 'clip.finalize': 'Paid a clip',
  'account.approve': 'Approved an account', 'account.reject': 'Rejected an account', 'payout.processing': 'Started a payout', 'payout.paid': 'Marked a payout as paid', 'payout.reject': 'Rejected a payout', 'payout.export': 'Exported payouts',
  'campaign.create': 'Created a campaign', 'campaign.update': 'Edited a campaign', 'campaign.status': 'Changed a campaign status', 'campaign.duplicate': 'Copied a campaign', 'campaign.delete': 'Deleted a campaign', 'announcement.create': 'Posted an announcement', 'announcement.delete': 'Deleted an announcement',
  'user.ban': 'Banned a clipper', 'user.unban': 'Unbanned a clipper', 'user.note': 'Edited a staff note', 'user.message': 'Messaged a clipper', 'wallet.bonus': 'Added a bonus', 'wallet.adjustment': 'Corrected a wallet', 'staff.set_role': 'Changed a role', 'staff.remove': 'Removed a staff member',
  'ticket.reply': 'Replied to a ticket', 'ticket.close': 'Closed a ticket', 'ticket.reopen': 'Reopened a ticket', 'settings.update': 'Changed settings', 'job.run': 'Ran a background job'
};
const targetLink = x => {
  const id = x.target_id, t = x.target_type;
  if (!id) return '';
  const href = t === 'clip' ? '#clip/' + id : t === 'user' ? '#clipper/' + id : t === 'campaign' ? '#campaign/' + id : t === 'ticket' ? '#ticket/' + id : t === 'payout' ? '#payouts' : '';
  return href ? h`<a href="${href}" style="color:var(--g)">${t} #${id}</a>` : h`${t} ${id}`;
};
const detail = meta => Object.entries(meta || {}).map(([k, v]) => k.replace(/_cents$/, '').replace(/_/g, ' ') + ': ' + (k.endsWith('_cents') ? usd(v) : v !== null && typeof v === 'object' ? JSON.stringify(v) : v)).join(', ');
const AU = { q: '', page: 1 };
async function loadAudit() {
  const box = $('#aulist'); if (!box) return;
  SQ.busy(box, true);
  let r; try { r = await get('/api/staff/audit' + qs({ q: AU.q, page: AU.page > 1 ? AU.page : '' })); } catch (e) { SQ.busy(box, false); return SQ.err(e); }
  SQ.busy(box, false);
  html(box, r.rows.length ? h`<div class="tw"><table class="tbl rt"><thead><tr><th>When</th><th>Who</th><th>Did what</th><th>To</th><th>Details</th></tr></thead><tbody>${r.rows.map(x => { const d = detail(x.meta); return h`<tr><td class="mu xs nowrap full-sm">${dtime(x.at)}</td><td class="b">${x.actor}</td><td>${ACTION[x.action] || x.action}</td><td class="nowrap">${targetLink(x)}</td><td class="sm mu full-sm" title="${d}" style="max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d}</td></tr>`; })}</tbody></table></div>${SQ.pager(r, 'au.page')}`
    : empty('list', AU.q ? 'Nothing matches that search' : 'Nothing logged yet', AU.q ? '' : 'Every decision staff make about money, clips, accounts and people is written here.'));
}
SQ.route('audit', async ctx => {
  Object.assign(AU, { q: ctx.q.q || '', page: 1 });
  ctx.set(h`${SQ.head('Audit log', 'Everything staff do about money, clips, accounts, campaigns and people. It cannot be edited.')}${SQ.bar2(SQ.searchBox('au', AU.q, 'Search by person, action or ID'))}<div id="aulist" style="transition:opacity .15s"></div>`);
  await loadAudit();
}, 'audit');
act('au.page', el => { AU.page = +el.dataset.page; window.scrollTo(0, 0); return loadAudit(); });
SQ.onSearch('au', v => { AU.q = v; AU.page = 1; return loadAudit().catch(SQ.err); });
