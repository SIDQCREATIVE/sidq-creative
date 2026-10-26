/* Review work: the clip queue, the clip review page and social account checks. */
const SQ = window.SQ;
const { h, $, $$, html, icon, usd, num, compact, date, dtime, ago, until, chip, plat, note, empty, get, post, act, ok, qs, dayLabel, go } = SQ;

const short = (s, n) => String(s || '').length > n ? String(s).slice(0, n - 1) + '...' : String(s || '');
const hoursSince = at => (Date.now() - new Date(at).getTime()) / 36e5;
const late = at => hoursSince(at) > 24 ? SQ.waiting(at, 'Waiting') : '';
const flagChip = f => h`<span class="chip ${f.level === 'high' ? 'bad' : 'warn'}" title="${f.text}">${icon('flag')}${short(f.text, 46)}</span>`;
const countedViews = c => c.pay_views != null ? c.pay_views : c.views;
const clipTitle = c => c.title || (({ youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' })[c.platform] || 'Video') + ' clip by ' + (c.account && c.account.handle ? '@' + c.account.handle : c.user.username);
const shortUrl = u => short(String(u || '').replace(/^https?:\/\/(www\.)?/, ''), 64);
const hrsText = n => n < 1 ? 'less than an hour' : SQ.plural(Math.round(n), 'hour');
const byRisk = flags => [...(flags || [])].sort((a, b) => (b.level === 'high') - (a.level === 'high'));

/* ================================================================ clip queue */
const CL = { stage: 'review', q: '', platform: '', flag: '', campaign: '', user: '', page: 1, counts: {}, name: {} };

const clipRow = c => {
  const flags = byRisk(c.flags), v = countedViews(c);
  return h`<div class="li hv" data-go="#clip/${c.id}" tabindex="0" role="link">${SQ.clipThumb(c)}
    <div class="m"><div class="t">${plat(c.platform)}<span class="trunc" style="max-width:min(100%,520px)">${clipTitle(c)}</span>${c.stage === 'review' || c.stage === 'checking' ? late(c.stage === 'review' ? c.submitted_at : c.analytics_submitted_at || c.submitted_at) : ''}</div>
      <div class="d"><span>${c.user.username}${c.account.handle ? ' on @' + c.account.handle : ''}${c.account.followers ? ', ' + compact(c.account.followers) + ' followers' : ''}</span><button type="button" class="lnk" data-act="cl.camp" data-id="${c.campaign_id}" data-name="${c.campaign}">${c.campaign}</button><span>Submitted ${ago(c.submitted_at)}</span></div>
      ${flags.length ? h`<div class="row" style="gap:6px;margin-top:8px">${flags.slice(0, 2).map(flagChip)}${flags.length > 2 ? chip('+' + (flags.length - 2) + ' more', 'mu') : ''}</div>` : ''}</div>
    <div class="e">${v != null ? h`<div style="text-align:right"><b class="num">${compact(v)}</b> <span class="xs mu">views</span>${c.est_cents != null ? h`<div class="xs mu">${usd(c.est_cents)} estimated</div>` : c.earned_cents ? h`<div class="xs" style="color:var(--g)">${usd(c.earned_cents)} paid</div>` : ''}</div>` : ''}
      ${c.stage === 'review' ? h`<button type="button" class="btn s p" data-act="cl.approve" data-id="${c.id}">Approve</button><button type="button" class="btn s d" data-act="cl.reject" data-id="${c.id}">Reject</button>`
        : c.stage === 'checking' ? h`<a class="btn s p" href="#clip/${c.id}">Check analytics</a>` : SQ.stageChip(c.stage, c.stage_label)}</div></div>`;
};
function paintClipTabs() {
  html($('#cltabs'), SQ.tabs(SQ.STAGES.map(([k, t]) => [k, t, CL.counts[k] || 0, (k === 'review' || k === 'checking') && (CL.counts[k] || 0) > 0]), CL.stage, 'cl.stage'));
}
function paintClipChips() {
  const chips = [];
  if (CL.campaign) chips.push(h`<button type="button" class="chip info" data-act="cl.clear" data-k="campaign" title="Remove this filter">${icon('megaphone')}${CL.name['c' + CL.campaign] || 'Campaign ' + CL.campaign}${icon('x')}</button>`);
  if (CL.user) chips.push(h`<button type="button" class="chip info" data-act="cl.clear" data-k="user" title="Remove this filter">${icon('user')}${CL.name['u' + CL.user] || 'Clipper ' + CL.user}${icon('x')}</button>`);
  html($('#clchips'), chips);
}
function paintClipFilters() {
  html($('#clfilters'), h`${SQ.searchBox('clips', CL.q, 'Search clipper, handle, title or link')}
    <select class="in" id="clplat" aria-label="Platform" style="width:auto"><option value="">All platforms</option>${SQ.opts([['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['instagram', 'Instagram']], CL.platform)}</select>
    <label class="row nw" style="gap:8px;cursor:pointer;color:var(--mu);font-size:13px"><span class="sw"><input type="checkbox" id="clflag" ${CL.flag ? 'checked' : ''}><i></i></span>Only risky clips</label><span class="row" id="clchips" style="gap:8px"></span>`);
  paintClipChips();
}
async function loadClips() {
  const box = $('#cllist'); if (!box) return;
  SQ.busy(box, true);
  let r; try { r = await get('/api/staff/clips' + qs({ stage: CL.stage, q: CL.q, platform: CL.platform, flag: CL.flag, campaign: CL.campaign, user: CL.user, page: CL.page > 1 ? CL.page : '' })); }
  catch (e) { SQ.busy(box, false); return SQ.err(e); }
  SQ.busy(box, false);
  CL.counts = r.counts; paintClipTabs();
  if (r.clips[0]) { if (CL.campaign) CL.name['c' + CL.campaign] = r.clips[0].campaign; if (CL.user) CL.name['u' + CL.user] = r.clips[0].user.username; paintClipChips(); }
  const help = SQ.STAGE_HELP[CL.stage];
  html(box, r.clips.length ? h`<div class="list">${r.clips.map(clipRow)}</div>${SQ.pager(r, 'cl.page')}`
    : empty(CL.stage === 'review' ? 'checkc' : 'film', CL.q || CL.platform || CL.flag || CL.campaign || CL.user ? 'Nothing matches these filters' : 'Nothing here', CL.q || CL.platform || CL.flag || CL.campaign || CL.user ? 'Remove a filter or change the search.' : help));
  $('#clhelp').textContent = help;
  history.replaceState(null, '', '#clips' + qs({ stage: CL.stage === 'review' ? '' : CL.stage, q: CL.q, platform: CL.platform, flag: CL.flag, campaign: CL.campaign, user: CL.user }));
}
SQ.route('clips', async ctx => {
  const q = ctx.q;
  Object.assign(CL, { stage: SQ.STAGES.some(s => s[0] === q.stage) ? q.stage : 'review', q: q.q || '', platform: q.platform || '', flag: q.flag || '', campaign: q.campaign || '', user: q.user || '', page: 1 });
  ctx.set(h`${SQ.head('Clip queue', 'Every submitted clip, from the first check to payment.')}<div id="cltabs"></div><p class="sm mu" id="clhelp" style="margin:-6px 0 14px"></p><div class="row" id="clfilters" style="gap:10px;margin-bottom:16px"></div><div id="cllist" style="transition:opacity .15s"></div>`);
  paintClipFilters(); paintClipTabs();
  await loadClips();
}, 'clips');
act('cl.stage', el => { CL.stage = el.dataset.v; CL.page = 1; return loadClips(); });
act('cl.page', el => { CL.page = +el.dataset.page; window.scrollTo(0, 0); return loadClips(); });
act('cl.camp', el => { CL.campaign = el.dataset.id; CL.name['c' + el.dataset.id] = el.dataset.name; CL.page = 1; paintClipChips(); return loadClips(); });
act('cl.clear', el => { CL[el.dataset.k] = ''; CL.page = 1; paintClipChips(); return loadClips(); });
SQ.onSearch('clips', v => { CL.q = v; CL.page = 1; return loadClips().catch(SQ.err); });
document.addEventListener('change', e => {
  if (e.target.id === 'clplat') { CL.platform = e.target.value; CL.page = 1; loadClips(); }
  if (e.target.id === 'clflag') { CL.flag = e.target.checked ? 'high' : ''; CL.page = 1; loadClips(); }
});
act('cl.approve', async el => {
  await post(`/api/staff/clips/${el.dataset.id}/approve`, {}); ok('Clip approved. The clipper was told.'); SQ.pingBadges(); await loadClips();
});
act('cl.reject', async el => {
  const done = await SQ.reason({ title: 'Reject this clip', label: 'Reason for the clipper', text: 'The clipper sees this reason, so keep it short and clear.', presets: SQ.REASONS.clip, ok: 'Reject clip', kind: 'd' }, v => post(`/api/staff/clips/${el.dataset.id}/reject`, { reason: v }));
  if (done) { ok('Clip rejected. The clipper was told.'); SQ.pingBadges(); await loadClips(); }
});

/* ================================================================ one clip */
const EVCLS = { approved: 'k', verified: 'k', completed: 'k', rejected: 'x', analytics_declined: 'x', analytics_requested: 'i', analytics_submitted: 'i' };
const PN = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
const srcLabel = c => c.views_verified != null ? 'Entered by staff' : c.views_source === 'api' ? 'Read from ' + (PN[c.platform] || 'the platform') : 'Not known yet';
const DEFAULT_ASK = 'Record your screen while you open the analytics of this video, then upload the recording. It must show the views and where your viewers are from (countries, age, gender). Do not cut or edit it.';

const viewsField = (c, label) => h`<label class="f"><span class="h">${label}</span><input class="in" id="cdviews" inputmode="numeric" autocomplete="off" placeholder="${c.views_source === 'api' ? 'Leave empty to keep reading from ' + (PN[c.platform] || 'the platform') : 'For example 12500'}" value="${c.views_verified != null ? c.views_verified : ''}"><div class="hint">${c.views_source === 'api' ? (PN[c.platform] || 'The platform') + ' views are read automatically and keep counting until the window ends. Fill this in only if the recording shows a different number.' : 'Read it from the analytics recording. Clippers are paid on this number.'}</div></label>`;
const checkList = items => h`<ul class="checks">${items.filter(Boolean).map(([k, t]) => h`<li class="${k}">${icon(k === 'ok' ? 'checkc' : k === 'bad' ? 'xc' : 'info')}<span>${t}</span></li>`)}</ul>`;
const btnStack = list => h`<div class="col" style="gap:10px">${list}</div>`;

function decisionPanel(r) {
  const c = r.clip, cp = r.campaign, st = c.stage, id = c.id, u = r.clipper;
  const lateH = c.posted_at ? (new Date(c.submitted_at) - new Date(c.posted_at)) / 36e5 : null;
  const noteBtn = h`<button type="button" class="btn g blk" data-act="cd.note">${icon('pencil')}Add an internal note</button>`;
  const rejectBtn = h`<button type="button" class="btn d blk" data-act="cd.reject">Reject clip</button>`;
  const analyticsBtn = h`<button type="button" class="btn blk" data-act="cd.reqan">${icon('image')}Ask for analytics</button>`;
  let body;
  if (st === 'review') {
    body = h`<div class="ch"><h3>Rules check</h3></div>
      ${checkList([
        ['ok', `Posted on @${c.account.handle || 'unknown'}, a verified account of this clipper${c.account.connected ? ' (connected with its own login)' : ''}`],
        lateH == null ? ['mu', 'The posting time is not known. Look at the date on the video yourself.'] : !(cp.submit_hours > 0) || lateH <= cp.submit_hours ? ['ok', `Submitted ${hrsText(Math.max(0, lateH))} after posting${cp.submit_hours > 0 ? ' (limit ' + cp.submit_hours + ' hours)' : ''}`] : ['bad', `Submitted ${Math.round(lateH)} hours after posting. The limit is ${cp.submit_hours} hours.`],
        r.same_video.length ? ['bad', 'This video was already submitted before (see below)'] : ['ok', 'Nobody else submitted this video'],
        cp.min_followers && c.account.followers < cp.min_followers ? ['bad', `The account has ${num(c.account.followers)} followers. The campaign needs ${num(cp.min_followers)}.`] : null,
        ['mu', 'The clip follows the campaign rules and has no watermark from another app']
      ])}
      ${cp.requires_analytics ? h`<label class="f" style="margin:16px 0 0"><span class="h">Message for the analytics request (optional)</span><textarea class="in" id="cdmsg" rows="3" maxlength="400" placeholder="${short(cp.analytics_note || DEFAULT_ASK, 110)}"></textarea><div class="hint">When you approve, the clipper is asked for analytics right away. Leave this empty to send the campaign default.</div></label>` : ''}
      <div style="margin-top:16px">${btnStack(h`<button type="button" class="btn p blk" data-act="cd.approve">Approve clip</button>${rejectBtn}`)}</div>`;
  } else if (st === 'checking') {
    body = h`<div class="ch"><h3>Check the analytics</h3>${chip('Round ' + c.analytics_round, 'mu')}</div>
      ${checkList([['mu', 'The recording shows this video and its views'], ['mu', 'Countries, age and gender look like a real audience'], ['mu', 'It is one continuous recording, not cut or edited'], c.account.connected ? ['ok', `Views are read from the connected ${PN[c.platform] || ''} account, so you do not need to type them`] : null])}
      <div style="margin-top:14px">${viewsField(c, 'Views shown in the analytics')}</div>
      <label class="f"><span class="h">Note for the clipper (optional)</span><input class="in" id="cdnote" maxlength="200" placeholder="They see this in the clip history"></label>
      ${btnStack(h`<button type="button" class="btn p blk" data-act="cd.verify">Verify clip</button><button type="button" class="btn blk" data-act="cd.decline">Ask for a new recording</button>${rejectBtn}`)}`;
  } else if (st === 'analytics') {
    body = h`<div class="ch"><h3>Waiting for the clipper</h3>${chip('Round ' + c.analytics_round, 'mu')}</div>
      ${note('warn', 'clock', h`<b>${u.username}</b> was asked for analytics ${ago(c.analytics_requested_at || c.approved_at)}. The clip moves to "Checking analytics" when they upload.`)}
      ${c.analytics_feedback ? h`<div class="xs mu" style="margin-bottom:6px">What we asked</div><p class="sm pre" style="margin-bottom:14px">${c.analytics_feedback}</p>` : ''}
      ${btnStack(h`${rejectBtn}`)}`;
  } else if (st === 'tracking') {
    const manual = c.views_source !== 'api';
    body = h`<div class="ch"><h3>Counting views</h3></div>
      <p class="sm mu" style="margin-bottom:14px">Approved ${ago(c.approved_at)}. ${c.window_over ? 'The tracking window is over.' : 'Tracking ends ' + until(c.tracking_ends) + '.'} The clip is paid when the window ends and its views are verified.</p>
      ${manual ? h`${viewsField(c, 'Views counted')}` : ''}
      ${btnStack(h`<button type="button" class="btn p blk" data-act="cd.verify">${manual ? 'Verify with these views' : 'Verify now'}</button>${manual ? h`<button type="button" class="btn blk" data-act="cd.saveviews">Save views only</button>` : ''}${analyticsBtn}${c.account.connected || (c.platform === 'youtube' && r.youtube_api) ? h`<button type="button" class="btn blk" data-act="cd.refresh">${icon('refresh')}Read views from ${PN[c.platform] || 'the platform'} now</button>` : ''}${rejectBtn}`)}`;
  } else if (st === 'verified') {
    body = h`<div class="ch"><h3>Verified</h3>${chip('Counting ' + compact(c.pay_views) + ' views', 'ok', 'check')}</div>
      <p class="sm mu" style="margin-bottom:14px">${c.window_over ? 'The tracking window is over. The clip is paid within minutes.' : 'It is paid ' + until(c.tracking_ends) + ' when the tracking window ends.'}${c.est_cents != null ? ' Estimated payment: ' + usd(c.est_cents) + '.' : ''}</p>
      ${btnStack(h`${SQ.can('campaigns') ? h`<button type="button" class="btn p blk" data-act="cd.pay">Pay now</button>` : ''}${analyticsBtn}${rejectBtn}`)}`;
  } else if (st === 'completed') {
    body = h`<div class="ch"><h3>Paid</h3>${chip('Paid to wallet', 'ok', 'checkc')}</div><p class="sm mu">${usd(c.earned_cents)} was added to ${u.username}'s wallet for ${num(c.pay_views)} views. To change the amount, use a wallet correction on their page.</p>`;
  } else {
    body = h`<div class="ch"><h3>Rejected</h3>${chip('Rejected', 'bad', 'xc')}</div>${note('bad', 'xc', h`<b>Reason shown to the clipper</b><br>${c.reject_reason}`)}`;
  }
  return h`<div class="card">${body}</div>
    <div class="card"><div class="ch"><h3>Clipper</h3>${u.banned ? chip('Banned', 'bad', 'ban') : ''}</div>
      <div class="row nw" style="gap:12px;margin-bottom:14px">${SQ.who(u, 'md')}</div>
      <dl class="kv" style="grid-template-columns:110px 1fr">${[['Joined', date(u.created_at)], ['Paid clips', num(u.completed)], ['Rejected clips', u.rejected ? h`<span style="color:var(--bad)">${num(u.rejected)}</span>` : '0'], ['Clips in progress', num(u.open)], ['Earned so far', usd(u.earned_cents)]].map(x => h`<dt>${x[0]}</dt><dd>${x[1]}</dd>`)}</dl>
      ${u.staff_note ? h`<div class="dv"></div><div class="xs mu" style="margin-bottom:4px">Staff note</div><p class="sm pre">${u.staff_note}</p>` : ''}</div>
    ${noteBtn}`;
}

SQ.route('clip/:id', async ctx => {
  const r = await get('/api/staff/clips/' + encodeURIComponent(ctx.params.id)), c = r.clip, cp = r.campaign;
  ctx.title('Clip #' + c.id);
  const lateH = c.posted_at ? (new Date(c.submitted_at) - new Date(c.posted_at)) / 36e5 : null;
  const rounds = [...new Set(r.proofs.map(p => p.round))];
  const pts = r.snapshots.map(s => ({ x: new Date(s.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), full: dtime(s.at), y: s.views }));
  ctx.set(h`<a class="back" href="#clips?stage=${c.stage}">${icon('chevl')}Clip queue</a>
    <div class="ph" style="margin-bottom:16px"><div class="row nw" style="gap:14px;flex:1;min-width:240px;align-items:flex-start">${SQ.clipThumb(c, 64)}<div style="min-width:0"><h1 style="font-size:23px;word-break:break-word">${clipTitle(c)}</h1><div class="xs mu mono trunc" style="margin-top:4px">${shortUrl(c.url)}</div><div class="row" style="gap:8px;margin-top:8px">${SQ.stageChip(c.stage, c.stage_label)}${chip(({ youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' })[c.platform] || c.platform, 'mu')}<span class="xs mu">Clip #${c.id}</span></div></div></div>
      <a class="btn" href="${SQ.safeUrl(c.url)}" target="_blank" rel="noopener">${icon('ext')}Open the video</a></div>
    ${c.track_error ? note('warn', 'alert', h`<b>The video could not be read.</b> ${c.track_error} It may be deleted or private. Open the link to check.`) : ''}
    <div class="two"><div class="col" style="gap:14px">
      ${(c.flags || []).length ? h`<div>${byRisk(c.flags).map(f => note(f.level === 'high' ? 'bad' : 'warn', 'flag', f.text))}</div>` : ''}
      ${r.same_video.length ? note('bad', 'copy', h`<b>This video was submitted before.</b> ${r.same_video.map(s => h`<a href="#clip/${s.id}" style="color:var(--g)">Clip #${s.id}</a> (${s.status}) `)}`) : ''}
      <div class="card"><div class="ch"><h3>Details</h3></div>${SQ.kv([
        ['Account', h`<a href="${SQ.safeUrl(r.profile_url)}" target="_blank" rel="noopener" style="color:var(--g)">@${c.account.handle || 'unknown'} ${icon('ext')}</a>${c.account.followers ? ', ' + num(c.account.followers) + ' followers' : ''}`],
        ['Campaign', SQ.can('campaigns') ? h`<a href="#campaign/${cp.id}" style="color:var(--g)">${cp.title}</a>` : cp.title],
        ['Pays', `${usd(Math.round(cp.rate * 100))} per 1,000 views. At least ${num(cp.min_views)} views to earn${cp.max_payout != null ? ', up to ' + usd(Math.round(cp.max_payout * 100), { whole: true }) + ' per clip' : ''}.`],
        ['Posted', c.posted_at ? dtime(c.posted_at) : 'Not known for this platform'],
        ['Submitted', h`${dtime(c.submitted_at)}${lateH != null && cp.submit_hours > 0 ? h` ${chip(lateH <= cp.submit_hours ? hrsText(Math.max(0, lateH)) + ' after posting' : hrsText(lateH) + ' after posting. Limit ' + cp.submit_hours + ' hours.', lateH <= cp.submit_hours ? 'ok' : 'bad')}` : ''}`],
        c.approved_at ? ['Tracking', c.window_over ? 'Window is over' : 'Ends ' + until(c.tracking_ends) + ' (' + dtime(c.tracking_ends) + ')'] : null,
        ['Views counted', c.pay_views != null ? h`<b class="num">${num(c.pay_views)}</b> <span class="xs mu">${srcLabel(c)}</span>` : h`Not known yet <span class="xs mu">${c.account.connected ? 'They are read automatically from the connected account' : c.platform === 'youtube' ? 'YouTube is read automatically when YOUTUBE_API_KEY is set' : 'Enter them from the analytics recording'}</span>`],
        c.views != null && c.views_source === 'api' ? ['Views on ' + (PN[c.platform] || 'the platform'), h`${num(c.views)}${c.likes ? ', ' + num(c.likes) + ' likes' : ''}${c.comments ? ', ' + num(c.comments) + ' comments' : ''}${c.views_checked_at ? h` <span class="xs mu">checked ${ago(c.views_checked_at)}</span>` : ''}`] : null,
        c.est_cents != null ? ['Estimated pay', usd(c.est_cents)] : c.earned_cents ? ['Paid', usd(c.earned_cents)] : null,
        c.review_note ? ['Review note', c.review_note] : null
      ])}
        ${cp.rules || cp.brief ? h`<details class="faq" style="margin-top:16px"><summary>Campaign brief and rules</summary><div class="pre">${[cp.brief, cp.rules].filter(Boolean).join('\n\n')}</div></details>` : ''}</div>
      ${r.proofs.length ? h`<div class="card"><div class="ch"><h3>Analytics recording</h3>${chip(SQ.plural(r.proofs.length, 'file'), 'mu')}</div>${c.analytics_feedback ? note('info', 'info', h`<b>What we asked:</b> ${c.analytics_feedback}`) : ''}
        ${rounds.map(rd => { const list = r.proofs.filter(p => p.round === rd); return h`<div class="xs mu" style="margin:12px 0 8px">Request ${rd}, uploaded ${dtime(list[0].at)}</div><div class="thumbs big">${list.map(p => /^video\//.test(p.mime || '')
          ? h`<div class="t v" data-vid="${p.id}"><video data-proof="${p.id}" controls preload="metadata" playsinline></video><div class="cap">Screen recording${p.bytes ? ' · ' + SQ.mb(p.bytes) : ''}</div></div>`
          : h`<div class="t"><img data-proof="${p.id}" data-act="zoom" alt="Analytics screenshot ${p.id}" tabindex="0"></div>`)}</div>`; })}</div>` : ''}
      ${pts.length > 1 ? h`<div class="card"><div class="ch"><h3>Views over time</h3></div>${SQ.areaChart(pts, { label: 'Views over time', unit: 'views', xlabel: 'Time', ylabel: 'Views' })}</div>` : ''}
      <div class="card"><div class="ch"><h3>History</h3></div><div class="tl">${r.events.map(e => h`<div class="e ${EVCLS[e.type] || ''}"><div>${e.internal ? chip('Internal', 'warn') + ' ' : ''}${e.text}</div><small>${e.actor === 'system' ? 'System' : e.actor}, ${dtime(e.at)}</small></div>`)}</div></div>
    </div>
    <div class="col sticky" style="gap:14px">${decisionPanel(r)}</div></div>`);
  $$('img[data-proof]').forEach(async img => { try { img.src = await SQ.blobUrl('/api/proofs/' + img.dataset.proof); } catch (e) { img.alt = 'This image could not be loaded'; } });
  // Recordings stream straight from the server when the staff member is signed in with Discord. With the old password sign-in the browser cannot send the password with a video tag,
  // so the recording is loaded on request (it can be large) and played from memory.
  $$('video[data-proof]').forEach(v => {
    const path = '/api/proofs/' + v.dataset.proof;
    if (!SQ.tok()) { v.src = path; return; }
    const box = v.closest('.t'), size = $('.cap', box).textContent.split(' · ')[1] || '';
    v.hidden = true; box.insertAdjacentHTML('afterbegin', `<div style="padding:34px 16px;text-align:center"><button type="button" class="btn p s" data-act="cd.loadvid" data-path="${path}">Load the recording${size ? ' (' + size + ')' : ''}</button></div>`);
  });
  ctx.clip = c; CUR.clip = c; CUR.camp = cp;
}, 'clips');

const CUR = { clip: null, camp: null };
const clipId = () => CUR.clip && CUR.clip.id;
const toNext = async (stage, id, msg) => {
  ok(msg); SQ.pingBadges();
  const n = await SQ.nextClip(stage, id);
  if (n) go('clip/' + n); else go('clips?stage=' + stage);
};
const num0 = s => String(s == null ? '' : s).replace(/[,\s]/g, '');

act('cd.approve', async () => {
  const id = clipId(), m = $('#cdmsg');
  await post(`/api/staff/clips/${id}/approve`, { message: m ? m.value.trim() : '' });
  await toNext('review', id, 'Clip approved. The clipper was told.');
});
act('cd.reject', async () => {
  const c = CUR.clip, id = c.id;
  const done = await SQ.reason({ title: 'Reject this clip', label: 'Reason for the clipper', text: 'The clipper sees this reason, so keep it short and clear.', presets: SQ.REASONS.clip, ok: 'Reject clip', kind: 'd' }, v => post(`/api/staff/clips/${id}/reject`, { reason: v }));
  if (!done) return;
  if (c.stage === 'review' || c.stage === 'checking') await toNext(c.stage, id, 'Clip rejected. The clipper was told.'); else { ok('Clip rejected. The clipper was told.'); SQ.pingBadges(); SQ.reload(); }
});
act('cd.verify', async () => {
  const c = CUR.clip, v = $('#cdviews'), n = $('#cdnote');
  const res = await post(`/api/staff/clips/${c.id}/verify`, { views: v ? num0(v.value) : '', note: n ? n.value.trim() : '' });
  const msg = res.paid_cents != null ? `Verified and paid ${usd(res.paid_cents)} to the clipper wallet.` : 'Verified. The clip is paid when its tracking window ends.';
  if (c.stage === 'checking') await toNext('checking', c.id, msg); else { ok(msg); SQ.pingBadges(); SQ.reload(); }
});
act('cd.decline', async () => {
  const id = clipId();
  const done = await SQ.reason({ title: 'Ask for a new recording', label: 'What is wrong with it?', text: 'The clipper gets this message and sends analytics again.', presets: SQ.REASONS.analytics, ok: 'Send request' }, v => post(`/api/staff/clips/${id}/decline-analytics`, { reason: v }));
  if (done) await toNext('checking', id, 'The clipper was asked to send analytics again.');
});
act('cd.reqan', async () => {
  const id = clipId(), camp = CUR.camp;
  const done = await SQ.ask({ title: 'Ask for analytics', label: 'Message to the clipper', text: 'They get a notification and can record their screen or upload files on the clip page.', value: (camp && camp.analytics_note) || DEFAULT_ASK, rows: 4, max: 400, ok: 'Send request', submit: v => post(`/api/staff/clips/${id}/request-analytics`, { message: v }) });
  if (done) { ok('The clipper was asked for analytics.'); SQ.pingBadges(); SQ.reload(); }
});
act('cd.saveviews', async () => {
  const id = clipId();
  await post(`/api/staff/clips/${id}/views`, { views: num0($('#cdviews').value) }); ok('Views saved.'); SQ.reload();
});
act('cd.loadvid', async el => {
  const box = el.closest('.t'), v = $('video', box), u = await SQ.blobUrl(el.dataset.path);
  v.src = u; v.hidden = false; el.parentElement.remove(); v.play().catch(() => { });
});
act('cd.refresh', async () => {
  const id = clipId(); const r = await post(`/api/staff/clips/${id}/refresh`, {}); ok(r.updated ? 'Views updated.' : (r.message || 'The platform returned no new numbers.')); SQ.reload();
});
act('cd.pay', async () => {
  const c = CUR.clip;
  if (!await SQ.confirm({ title: 'Pay this clip now?', text: `${usd(c.est_cents || 0)} for ${num(c.pay_views)} views goes to the clipper wallet. This cannot be undone.`, ok: 'Pay now' })) return;
  const r = await post(`/api/staff/clips/${c.id}/finalize`, {}); ok(`${usd(r.amount_cents)} added to the clipper wallet.`); SQ.pingBadges(); SQ.reload();
});
act('cd.note', async () => {
  const id = clipId();
  const done = await SQ.ask({ title: 'Internal note', label: 'Note', text: 'Only staff see this. It shows in the clip history.', rows: 3, max: 400, ok: 'Save note', min: 2, submit: v => post(`/api/staff/clips/${id}/note`, { text: v }) });
  if (done) { ok('Note saved.'); SQ.reload(); }
});

/* ================================================================ social accounts */
const AC = { status: 'pending', q: '', page: 1, counts: {} };
const acctRow = a => h`<div class="li" style="align-items:start">${plat(a.platform, true)}
  <div class="m"><div class="t"><a href="${a.profile_url}" target="_blank" rel="noopener" style="color:inherit">@${a.handle}</a>${a.verified_via === 'api' ? chip('Connected', 'ok', 'link') : ''}${a.followers ? chip(compact(a.followers) + ' followers', 'mu') : ''}${a.rejected_clips ? chip(a.rejected_clips + ' rejected clips', 'warn', 'flag') : ''}</div>
    <div class="d"><span>${SQ.who({ id: a.user_id, username: a.username, avatar: a.avatar })}</span><span>Added ${ago(a.created_at)}</span><span>${SQ.plural(a.approved_accounts, 'verified account')}</span></div>
    ${a.status === 'pending' ? h`<div style="margin-top:10px;max-width:420px">${SQ.copyLine('Code to find in the bio', a.verify_code)}</div>` : ''}
    ${a.status === 'rejected' && a.reject_reason ? h`<div class="sm mu" style="margin-top:8px">Reason: ${a.reject_reason}</div>` : ''}</div>
  <div class="e">${a.status === 'pending' ? h`<a class="btn s" href="${a.profile_url}" target="_blank" rel="noopener">${icon('ext')}Open profile</a><button type="button" class="btn s p" data-act="ac.approve" data-id="${a.id}">Approve</button><button type="button" class="btn s d" data-act="ac.reject" data-id="${a.id}">Reject</button>`
    : h`${SQ.status('acct', a.status)}<span class="xs mu">${ago(a.reviewed_at)}</span>`}</div></div>`;
async function loadAccounts() {
  const box = $('#aclist'); if (!box) return;
  SQ.busy(box, true);
  let r; try { r = await get('/api/staff/accounts' + qs({ status: AC.status, q: AC.q, page: AC.page > 1 ? AC.page : '' })); } catch (e) { SQ.busy(box, false); return SQ.err(e); }
  SQ.busy(box, false); AC.counts = r.counts; AC.rows = r.accounts;
  html($('#actabs'), SQ.tabs([['pending', 'Waiting for review', r.counts.pending || 0, (r.counts.pending || 0) > 0], ['approved', 'Verified', r.counts.approved || 0], ['rejected', 'Rejected', r.counts.rejected || 0]], AC.status, 'ac.status'));
  html(box, r.accounts.length ? h`<div class="list">${r.accounts.map(acctRow)}</div>${SQ.pager(r, 'ac.page')}` : empty('usercheck', AC.q ? 'Nothing matches that search' : AC.status === 'pending' ? 'No accounts waiting' : 'Nothing here', AC.status === 'pending' && !AC.q ? 'Accounts added by hand show up here until you check their code.' : ''));
}
SQ.route('accounts', async ctx => {
  Object.assign(AC, { status: ['pending', 'approved', 'rejected'].includes(ctx.q.status) ? ctx.q.status : 'pending', q: ctx.q.q || '', page: 1 });
  ctx.set(h`${SQ.head('Accounts', 'Clippers who press Connect are verified automatically and never wait here. This list is for accounts added by hand: find the code in the bio, enter the follower count and approve.')}<div id="actabs"></div>${SQ.bar2(SQ.searchBox('acc', AC.q, 'Search by clipper or handle'))}<div id="aclist" style="transition:opacity .15s"></div>`);
  await loadAccounts();
}, 'accounts');
act('ac.status', el => { AC.status = el.dataset.v; AC.page = 1; return loadAccounts(); });
act('ac.page', el => { AC.page = +el.dataset.page; return loadAccounts(); });
SQ.onSearch('acc', v => { AC.q = v; AC.page = 1; return loadAccounts().catch(SQ.err); });
act('ac.approve', el => {
  const a = AC.rows.find(x => x.id === +el.dataset.id); if (!a) return;
  SQ.dialog({
    title: 'Approve this account',
    body: h`<p class="mu" style="margin-bottom:14px">Open <b>@${a.handle}</b> and look for this code in the bio or channel description.</p>${SQ.copyLine('Code', a.verify_code)}
      <div style="margin:14px 0"><a class="btn s" href="${a.profile_url}" target="_blank" rel="noopener">${icon('ext')}Open the profile</a></div>
      <label class="f"><span class="h">Followers on the profile</span><input class="in" name="followers" inputmode="numeric" value="${a.followers || ''}" placeholder="For example 12500"><div class="hint">Some campaigns need a minimum number of followers.</div></label>`,
    buttons: [{ text: 'Cancel', kind: 'g', value: false }, { text: 'The code is there, approve', kind: 'p', run: async dm => { await post(`/api/staff/accounts/${a.id}/approve`, { followers: num0(SQ.fields(dm.box).followers) || 0 }); ok('Account approved. The clipper was told.'); SQ.pingBadges(); loadAccounts(); } }]
  });
});
act('ac.reject', async el => {
  const id = el.dataset.id;
  const done = await SQ.reason({ title: 'Reject this account', label: 'Reason for the clipper', text: 'They see this and can fix it and send the account again.', presets: SQ.REASONS.account, ok: 'Reject account', kind: 'd' }, v => post(`/api/staff/accounts/${id}/reject`, { reason: v }));
  if (done) { ok('Account rejected. The clipper was told.'); SQ.pingBadges(); loadAccounts(); }
});
