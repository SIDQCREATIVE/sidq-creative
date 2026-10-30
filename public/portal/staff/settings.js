/* Settings (payouts, methods, system status, background jobs) and the audit log. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, dtime, ago, chip, note, empty, get, post, put, act, ok, qs } = SQ;

const SYS = [
  ['youtube_key', 'YouTube view tracking', 'YOUTUBE_API_KEY', 'YouTube views are read automatically for every account.', 'Off. YouTube views are still read for clippers who connect their account. Add a free YouTube API key to read them for every account.', true],
  ['discord_login', 'Discord login', 'DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET', 'Clippers and staff can log in with Discord.', 'Missing. Nobody can log in with Discord until both are set.', false],
  ['service_on', 'TikTok and Instagram data service', 'SCRAPECREATORS_API_KEY', 'Bios and views of TikTok and Instagram accounts are read automatically, even when the clipper did not sign in.', 'Off. TikTok and Instagram accounts added by hand are checked by your team and their views come from the screen recordings. Add a ScrapeCreators key to read them automatically.', true],
  ['data_key', 'Payout details encryption', 'DATA_KEY', 'Saved payout details are encrypted.', 'Missing. Set a long random DATA_KEY before clippers save payout details. If you change it later, saved details cannot be read.', false],
  ['site_url', 'Website address', 'SITE_URL', null, 'Missing. Set it to your website address so Discord login and invite links use the right domain.', false],
  ['bot_token', 'Discord bot', 'DISCORD_BOT_TOKEN', 'The bot token is set.', 'Optional. Needed later for the Discord server bot.', true]
];
const LINKS = [['youtube', 'Connect YouTube', 'Clippers can sign in with Google and have their channel verified and views counted automatically.'], ['tiktok', 'Connect TikTok', 'Clippers can sign in with TikTok. Needs the TikTok app to be approved for the video list.'], ['instagram', 'Connect Instagram', 'Clippers with a Business or Creator account can sign in with Instagram. Needs Meta app review.']];
const HOOKS = [['staff', 'Staff alerts', 'New payout requests and tickets post to your staff channel.'], ['payouts', 'Payout feed', 'Paid payouts post to your payout-alerts channel.'], ['campaigns', 'Campaign news', 'New campaigns and announcements post to your campaigns channel.']];
const JOBS = {
  trackViews: ['Read views automatically', 'Reads fresh views for YouTube clips (with the API key), for every clip on a connected account, and for TikTok and Instagram clips through the data service. Runs every 20 minutes. Connected Instagram clips are read every 2 hours, data service clips as often as set above.'],
  checkAccounts: ['Check codes in bios', 'Looks for the verification code in the bio of accounts that clippers added by hand and approves them: YouTube with the API key, TikTok and Instagram through the data service. Runs every 5 minutes. An account is looked at every 9 minutes during the 2 hours after the clipper got the code, then every 12 hours, and not after 3 days (the clipper can still press Check now). Needs YOUTUBE_API_KEY or the data service key.'],
  syncConnections: ['Keep connections healthy', 'Refreshes logins before they expire and updates follower counts and usernames of connected accounts. Runs every 3 hours.'],
  finalizeDue: ['Pay finished clips', 'Pays clips whose tracking window is over, or asks the clipper for final analytics. Runs every 10 minutes.'],
  endCampaigns: ['End finished campaigns', 'Ends campaigns that reached their end date. Runs every 5 minutes.'],
  tidy: ['Clean up', 'Deletes old read notifications. Runs once a day.']
};

SQ.route('settings', async ctx => {
  const r = await get('/api/staff/settings'), s = r.settings, sys = r.system;
  sys.service_on = !!(sys.service && sys.service.configured);
  const sv = sys.service || {};
  const svcCard = h`<div class="card"><div class="ch"><h3>TikTok and Instagram data service</h3>${sv.configured ? (sv.paused ? chip('Paused', 'warn') : chip('On', 'ok')) : chip('Off', 'mu')}</div>
      <p class="sm mu" style="margin-bottom:12px">TikTok and Instagram have no free key like YouTube. With a ${sv.name || 'ScrapeCreators'} key, the website checks that a username exists, finds the code in the bio and reads the views of a video by itself, without the clipper signing in. It is a paid service that reads public pages and is not an official API. Accounts that sign in with Connect never use it.</p>
      ${sv.configured ? h`<div class="row nw" style="gap:18px;flex-wrap:wrap;margin-bottom:12px"><div><div class="xs mu">Requests today</div><div class="b num">${num(sv.today)} of ${num(sv.cap)}</div></div>${sv.credits != null ? h`<div><div class="xs mu">Credits left</div><div class="b num">${num(sv.credits)}</div></div>` : ''}</div>
        ${sv.paused ? note('warn', 'alert', h`<b>Paused for a few minutes.</b> ${sv.paused}`) : ''}${sv.last_error ? note('warn', 'alert', h`<b>Last problem:</b> ${sv.last_error.message} <span class="xs mu">${ago(sv.last_error.at)}</span>`) : ''}`
        : h`<p class="sm" style="margin-bottom:12px">Not set. Add <span class="mono">SCRAPECREATORS_API_KEY</span> in Railway Variables, then press Test.</p>`}
      <div class="g2"><label class="f"><span class="h">Daily request limit</span><input class="in" name="svccap" inputmode="numeric" value="${s.service_daily_cap}" autocomplete="off"><div class="hint">Protects you from a surprise bill. One request costs about one credit. 0 pauses the service.</div></label>
        <label class="f"><span class="h">Read each clip again every (hours)</span><input class="in" name="svchours" inputmode="numeric" value="${s.service_poll_hours}" autocomplete="off"><div class="hint">From 1 to 48. A lower number is more accurate and uses more requests.</div></label></div>
      <div class="row nw" style="gap:10px"><button type="button" class="btn" data-act="st.svctest">Test the key</button><span class="xs mu">Looks up two public accounts. Costs 2 requests.</span></div><div id="svcres" style="margin-top:12px"></div></div>`;
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
      ${svcCard}
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
  await put('/api/staff/settings', { min_payout_cents: cents, pkr_rate: f.pkr, payout_note: f.note, show_payout_feed: !!f.feed, referral_pct: f.ref, methods, service_daily_cap: f.svccap, service_poll_hours: f.svchours });
  ok('Settings saved.');
});
act('st.svctest', async () => {
  const box = $('#svcres'); html(box, note('info', 'clock', 'Testing the key...'));
  let r; try { r = await post('/api/staff/service/test', {}); } catch (e) { html(box, ''); throw e; }
  html(box, !r.configured ? note('warn', 'alert', h`<b>No key found.</b> Add SCRAPECREATORS_API_KEY in Railway Variables first, then press Test again.`)
    : h`<div class="col" style="gap:8px">${r.checks.map(c => note(c.ok ? 'ok' : 'bad', c.ok ? 'checkc' : 'xc', h`<b>${SQ.PLAT[c.platform] || c.platform}:</b> ${c.message}`))}${r.checks.every(c => c.ok) ? '' : h`<div class="xs mu">Something failed. Check the key and the credits in your ScrapeCreators account, then test again.</div>`}</div>`);
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
  'ticket.reply': 'Replied to a ticket', 'ticket.close': 'Closed a ticket', 'ticket.reopen': 'Reopened a ticket', 'settings.update': 'Changed settings', 'job.run': 'Ran a background job', 'service.test': 'Tested the data service key'
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
