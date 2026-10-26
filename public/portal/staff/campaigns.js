/* Campaigns (list, create and edit) and announcements. Only the owner and people with the campaigns permission see this. */
const SQ = window.SQ;
const { h, $, $$, html, icon, usd, num, compact, date, dtime, ago, until, chip, plat, note, empty, get, post, put, del, act, ok, go, bgImg, toLocalInput } = SQ;

/* ================================================================ list */
const CP = { tab: 'live', items: [], where: 'list' };
const CAMP_STATUS = { live: ['Live', 'ok'], draft: ['Draft', 'warn'], ended: ['Ended', 'mu'] };
const pctOf = c => c.budget_cents ? Math.min(100, Math.round(c.committed_cents / c.budget_cents * 100)) : 0;

const campCard = c => {
  const [st, kind] = CAMP_STATUS[c.status] || [c.status, 'mu'], pct = pctOf(c), left = Math.max(0, c.budget_cents - c.committed_cents);
  return h`<div class="cc" data-go="#campaign/${c.id}" tabindex="0" role="link">
    <div class="cimg" style="${bgImg(c.image)}">${c.image ? '' : (c.title || '?')[0].toUpperCase()}<span class="st">${chip(st, kind)}</span></div>
    <div style="min-width:0"><h3 class="trunc">${c.title}</h3>
      <div class="meta">${chip(c.label, 'mu')}${c.platforms.map(p => plat(p))}${c.ends_at ? chip('Ends ' + date(c.ends_at), 'mu', 'calendar') : ''}${c.clips.pending ? h`<a class="chip warn" href="#clips?campaign=${c.id}" style="text-decoration:none">${c.clips.pending} to review</a>` : ''}</div>
      <div class="nums"><div><div class="l">Rate</div><div class="v">${usd(Math.round(c.rate * 100))} / 1K</div></div><div><div class="l">Clippers</div><div class="v">${num(c.members)}</div></div><div><div class="l">Views</div><div class="v">${compact(c.views)}</div></div>
        <div><div class="l">Clips tracking</div><div class="v">${num(c.clips.live)}</div></div><div><div class="l">Clips paid</div><div class="v">${num(c.clips.done)}</div></div><div><div class="l">Paid out</div><div class="v">${usd(c.paid_cents, { whole: true })}</div></div></div></div>
    <div class="go"><div><div class="xs mu" style="margin-bottom:6px">${usd(c.committed_cents, { whole: true })} of ${usd(c.budget_cents, { whole: true })} used</div>${SQ.bar(pct, pct >= 90 ? 'warn' : '')}<div class="xs mu" style="margin-top:6px">${usd(left, { whole: true })} left</div></div>
      <div class="row" style="gap:8px">${c.status === 'live' ? h`<button type="button" class="btn s" data-act="cp.status" data-id="${c.id}" data-v="ended">End</button>` : h`<button type="button" class="btn s p" data-act="cp.status" data-id="${c.id}" data-v="live">Go live</button>`}<a class="btn s" href="#clips?campaign=${c.id}">Clips</a><button type="button" class="btn s g" data-act="cp.dup" data-id="${c.id}" title="Copy this campaign as a new draft">${icon('copy')}</button></div></div></div>`;
};
function paintCampaigns() {
  const by = s => CP.items.filter(c => c.status === s), rows = CP.tab === 'all' ? CP.items : by(CP.tab);
  html($('#cptabs'), SQ.tabs([['live', 'Live', by('live').length], ['draft', 'Drafts', by('draft').length], ['ended', 'Ended', by('ended').length], ['all', 'All', CP.items.length]], CP.tab, 'cp.tab'));
  html($('#cplist'), rows.length ? h`<div>${rows.map(campCard)}</div>` : empty('megaphone', CP.items.length ? 'Nothing in this tab' : 'No campaigns yet', CP.items.length ? '' : 'Create your first campaign. Clippers see it in their portal once it is live.', CP.items.length ? '' : h`<a class="btn p" href="#campaign/new">${icon('plus')}New campaign</a>`));
}
SQ.route('campaigns', async ctx => {
  CP.where = 'list';
  CP.items = await get('/api/staff/campaigns');
  CP.tab = CP.items.some(c => c.status === 'live') ? 'live' : CP.items.some(c => c.status === 'draft') ? 'draft' : 'all';
  ctx.set(h`${SQ.head('Campaigns', 'Only you create campaigns. Clippers see the rate, budget and rules before they join.', h`<a class="btn p" href="#campaign/new">${icon('plus')}New campaign</a>`)}${SQ.isSunday() ? SQ.note('info', 'calendar', h`<b>Sunday is a staff day off.</b> Campaigns cannot go live today. You can still save drafts.`) : ''}<div id="cptabs"></div><div id="cplist"></div>`);
  paintCampaigns();
}, 'campaigns');
act('cp.tab', el => { CP.tab = el.dataset.v; paintCampaigns(); });
act('cp.status', async el => {
  const id = el.dataset.id, st = el.dataset.v;
  if (st === 'ended' && !await SQ.confirm({ title: 'End this campaign?', text: 'Clippers can no longer submit new clips. Clips that were already submitted are still tracked and paid.', ok: 'End campaign', kind: 'd' })) return;
  await post(`/api/staff/campaigns/${id}/status`, { status: st });
  ok(st === 'live' ? 'The campaign is live.' : st === 'ended' ? 'The campaign has ended.' : 'The campaign is a draft again.');
  if (CP.where === 'list') { CP.items = await get('/api/staff/campaigns'); paintCampaigns(); } else SQ.reload();
});
act('cp.dup', async el => { const r = await post(`/api/staff/campaigns/${el.dataset.id}/duplicate`, {}); ok('Copied as a draft. Change what you need and publish it.'); go('campaign/' + r.id); });

/* ================================================================ create and edit */
const BLANK = { title: '', label: 'Content', brief: '', rules: '', image: '', rate: 1, budget: 500, min_views: 1000, max_payout: null, platforms: ['youtube', 'tiktok', 'instagram'], submit_hours: 48, min_followers: 0, requires_analytics: true, analytics_note: '', assets_url: '', track_days: 7, ends_at: null };
const LABELS = ['Gaming', 'Podcast', 'Streaming', 'Business', 'Music', 'Sports', 'Education', 'Entertainment', 'Lifestyle', 'Content'];
const num0 = s => String(s == null ? '' : s).replace(/[,\s]/g, '');

function formHtml(c, locked, isNew) {
  const lk = locked ? 'disabled' : '';
  const field = (label, name, val, o) => { o = o || {}; return h`<label class="f"><span class="h">${label}</span><input class="in" name="${name}" value="${val == null ? '' : val}" ${o.ph ? h`placeholder="${o.ph}"` : ''} ${o.mode ? h`inputmode="${o.mode}"` : ''} ${o.max ? h`maxlength="${o.max}"` : ''} ${o.dis || ''} autocomplete="off">${o.hint ? h`<div class="hint">${o.hint}</div>` : ''}</label>`; };
  return h`<form id="cpform" onsubmit="return false">
    <div class="card"><div class="ch"><h3>The basics</h3></div>
      ${field('Title', 'title', c.title, { max: 100, ph: 'For example Podcast Clips: Money Talks' })}
      <div class="g2"><label class="f"><span class="h">Category</span><input class="in" name="label" value="${c.label}" maxlength="30" list="cplabels" autocomplete="off"><datalist id="cplabels">${LABELS.map(l => h`<option value="${l}">`)}</datalist></label>
        ${field('Cover image link (optional)', 'image', c.image, { ph: 'https://...', hint: 'A square picture works best.' })}</div>
      <label class="f"><span class="h">Short brief</span><textarea class="in" name="brief" rows="4" maxlength="4000" placeholder="What the clips should be about, the style, the source">${c.brief}</textarea></label>
      <label class="f" style="margin:0"><span class="h">Rules clippers must follow</span><textarea class="in" name="rules" rows="6" maxlength="6000" placeholder="One rule per line. Clippers read these before they join.">${c.rules}</textarea><div class="hint">Staff read the same rules when they check a clip.</div></label></div>
    <div class="card"><div class="ch"><h3>How clippers are paid</h3></div>
      ${locked ? note('info', 'lock', h`<b>Some fields are locked.</b> Clips already exist, so the rate, minimum views, max payout and tracking days cannot change. Nobody is paid a different amount than promised. Copy the campaign to change them.`) : ''}
      <div class="g2">${field('Rate per 1,000 views (USD)', 'rate', Number(c.rate).toFixed(2), { mode: 'decimal', dis: lk })}${field('Total budget (USD)', 'budget', Number(c.budget).toFixed(2), { mode: 'decimal', hint: 'The campaign closes to new clips when the budget is used.' })}</div>
      <div class="g2">${field('Minimum views to earn', 'min_views', c.min_views, { mode: 'numeric', dis: lk, hint: 'A clip under this number earns nothing.' })}${field('Max payout per clip (USD, optional)', 'max_payout', c.max_payout == null ? '' : Number(c.max_payout).toFixed(2), { mode: 'decimal', dis: lk, hint: 'Leave empty for no cap.' })}</div>
      ${field('Tracking days', 'track_days', c.track_days, { mode: 'numeric', dis: lk, hint: 'Views are counted for this many days after approval. The money goes to the wallet when the window ends.' })}</div>
    <div class="card"><div class="ch"><h3>Who can join</h3></div>
      <div class="f" style="margin-bottom:10px"><span class="h" style="display:block;margin-bottom:6px;color:var(--mu);font-size:13px">Platforms</span><div class="row" style="gap:18px">${['youtube', 'tiktok', 'instagram'].map(p => h`<label class="row nw" style="gap:8px;cursor:pointer"><input type="checkbox" name="platforms" value="${p}" data-multi ${c.platforms.includes(p) ? 'checked' : ''} style="accent-color:var(--g);width:16px;height:16px">${plat(p)}${SQ.PLAT[p]}</label>`)}</div></div>
      <div class="g2">${field('Submit within (hours after posting)', 'submit_hours', c.submit_hours, { mode: 'numeric', hint: '0 means no time limit.' })}${field('Minimum followers', 'min_followers', c.min_followers, { mode: 'numeric', hint: '0 means anyone can join.' })}</div>
      <label class="chk" style="margin-top:0"><span class="sw"><input type="checkbox" name="requires_analytics" ${c.requires_analytics ? 'checked' : ''}><i></i></span><span>Ask for audience analytics after a clip passes the rules check<div class="hint">Clippers send a screen recording of views, countries, age and gender. It proves the audience is real. Views of connected accounts are read automatically either way.</div></span></label>
      <label class="f" style="margin:12px 0 0"><span class="h">What should the analytics show? (optional)</span><textarea class="in" name="analytics_note" rows="2" maxlength="600" placeholder="Leave empty to send the standard request">${c.analytics_note}</textarea></label></div>
    <div class="card"><div class="ch"><h3>Extras</h3></div><div class="g2">
      ${field('Assets link (optional)', 'assets_url', c.assets_url, { ph: 'https://drive.google.com/...', hint: 'Source videos or a brand kit. Shown as an Assets button.' })}
      <label class="f"><span class="h">End date (optional)</span><input class="in" type="datetime-local" name="ends_at" value="${toLocalInput(c.ends_at)}"><div class="hint">The campaign ends by itself at this time.</div></label></div></div></form>`;
}
function readForm() {
  const f = SQ.fields($('#cpform'));
  return { title: f.title, label: f.label, image: f.image, brief: f.brief, rules: f.rules, rate: num0(f.rate), budget: num0(f.budget), min_views: num0(f.min_views), max_payout: num0(f.max_payout), platforms: f.platforms || [],
    submit_hours: num0(f.submit_hours), min_followers: num0(f.min_followers), requires_analytics: !!f.requires_analytics, analytics_note: f.analytics_note, assets_url: f.assets_url, track_days: num0(f.track_days),
    ends_at: f.ends_at ? new Date(f.ends_at).toISOString() : '' };
}
// "At $1.00 per 1,000 views, $500 pays for about 500K views." Updates while typing.
function summary() {
  const el = $('#cpsum'); if (!el || !$('#cpform')) return;
  const f = SQ.fields($('#cpform')), rate = parseFloat(num0(f.rate)), budget = parseFloat(num0(f.budget));
  el.textContent = rate > 0 && budget > 0 ? `At ${usd(Math.round(rate * 100))} per 1,000 views, ${usd(Math.round(budget * 100), { whole: true })} pays for about ${compact(budget / rate * 1000)} views.` : 'Enter a rate and a budget to see how many views the budget covers.';
}
document.addEventListener('input', e => { if (e.target.closest && e.target.closest('#cpform')) summary(); });

SQ.route('campaign/:id', async ctx => {
  CP.where = 'edit';
  const isNew = ctx.params.id === 'new';
  const r = isNew ? { campaign: BLANK, locked: false, top: [] } : await get('/api/staff/campaigns/' + encodeURIComponent(ctx.params.id));
  const c = { ...BLANK, ...r.campaign }; c.platforms = r.campaign.platforms || BLANK.platforms; c.label = c.label || 'Content';
  CP.cur = isNew ? null : c;
  ctx.title(isNew ? 'New campaign' : c.title);
  const [st, kind] = CAMP_STATUS[c.status] || ['Draft', 'warn'], left = Math.max(0, (c.budget_cents || 0) - (c.committed_cents || 0));
  ctx.set(h`<a class="back" href="#campaigns">${icon('chevl')}Campaigns</a>
    ${SQ.head(isNew ? 'New campaign' : c.title, isNew ? 'Fill this in once. Clippers see the rate, budget and rules before they join.' : null, isNew ? '' : h`<div class="row" style="gap:8px">${chip(st, kind)}<a class="btn s" href="#clips?campaign=${c.id}">Open the clips</a></div>`)}
    ${SQ.isSunday() ? SQ.note('info', 'calendar', h`<b>Sunday is a staff day off.</b> A campaign cannot go live today. Save it as a draft and launch it on Monday.`) : ''}
    <div class="two"><div>${formHtml(c, r.locked, isNew)}</div>
      <div class="col sticky" style="gap:14px"><div class="card"><div class="ch"><h3>Summary</h3></div><p class="sm" id="cpsum"></p>
        ${isNew ? '' : h`<div class="dv"></div><div class="xs mu" style="margin-bottom:6px">${usd(c.committed_cents, { whole: true })} of ${usd(c.budget_cents, { whole: true })} earned or promised</div>${SQ.bar(pctOf(c))}<div class="xs mu" style="margin-top:6px">${usd(left, { whole: true })} left. ${c.ends_at ? 'Ends ' + until(c.ends_at) + '.' : 'No end date.'}</div>`}</div>
        <div class="card"><div class="ch"><h3>${isNew ? 'Publish' : 'Save'}</h3></div><div class="col" style="gap:10px">
          ${isNew ? h`<button type="button" class="btn p blk" data-act="cp.create" data-live="1">Save and go live</button><button type="button" class="btn blk" data-act="cp.create" data-live="0">Save as draft</button>`
            : h`<button type="button" class="btn p blk" data-act="cp.save">Save changes</button>${c.status === 'live' ? h`<button type="button" class="btn blk" data-act="cp.status" data-id="${c.id}" data-v="ended">End campaign</button>` : h`<button type="button" class="btn blk" data-act="cp.status" data-id="${c.id}" data-v="live">Go live</button>`}${c.status === 'live' ? '' : c.status === 'ended' ? h`<button type="button" class="btn blk" data-act="cp.status" data-id="${c.id}" data-v="draft">Move back to draft</button>` : ''}<button type="button" class="btn blk" data-act="cp.dup" data-id="${c.id}">${icon('copy')}Copy as a new draft</button><button type="button" class="btn d blk" data-act="cp.delete" data-id="${c.id}">${icon('trash')}Delete</button>`}</div></div>
        ${r.top.length ? h`<div class="card pad0"><div class="ch" style="padding:18px 20px 0"><h3>Top clippers</h3></div><div class="tw"><table class="tbl"><tbody>${r.top.map((t, i) => h`<tr><td class="num">${i + 1}</td><td>${SQ.who(t)}</td><td class="r num">${compact(t.views)}</td><td class="r num">${usd(t.earned_cents)}</td></tr>`)}</tbody></table></div></div>` : ''}</div></div>`);
  summary();
}, 'campaigns');
act('cp.create', async el => {
  const r = await post('/api/staff/campaigns', { ...readForm(), live: el.dataset.live === '1' });
  ok(el.dataset.live === '1' ? 'The campaign is live.' : 'Saved as a draft.'); go('campaign/' + r.id);
});
act('cp.save', async () => { await put('/api/staff/campaigns/' + CP.cur.id, readForm()); ok('Saved.'); SQ.reload(); });
act('cp.delete', async el => {
  if (!await SQ.confirm({ title: 'Delete this campaign?', text: 'Campaigns that have clips cannot be deleted. End them instead.', ok: 'Delete', kind: 'd' })) return;
  await del('/api/staff/campaigns/' + el.dataset.id); ok('Campaign deleted.'); go('campaigns');
});

/* ================================================================ announcements */
SQ.route('news', async ctx => {
  const items = await get('/api/staff/announcements');
  ctx.set(h`${SQ.head('Announcements', 'Short news clippers see on their home page. It is also posted to your Discord campaigns channel when that webhook is set.')}
    <div class="two"><div>${items.length ? h`<div class="col" style="gap:12px">${items.map(a => h`<div class="card"><div class="ch" style="margin-bottom:6px"><h3>${a.title}</h3>${a.pinned ? chip('Pinned', 'ok', 'pin') : ''}<button type="button" class="iconbtn sm" data-act="news.del" data-id="${a.id}" aria-label="Delete this announcement" title="Delete">${icon('trash')}</button></div>${a.body ? h`<p class="pre sm" style="color:#cfcfd5">${a.body}</p>` : ''}<div class="xs mu" style="margin-top:10px">${a.author}, ${dtime(a.created_at)}</div></div>`)}</div>` : SQ.empty('bell', 'No announcements yet', 'Post news about a new campaign or a change in how payouts work.')}</div>
      <div class="card sticky"><div class="ch"><h3>New announcement</h3></div><form id="newsform" onsubmit="return false">
        <label class="f"><span class="h">Title</span><input class="in" name="title" maxlength="100" autocomplete="off" placeholder="For example New campaign: Streamer Highlights"></label>
        <label class="f"><span class="h">Text</span><textarea class="in" name="body" rows="5" maxlength="1000" placeholder="What clippers need to know"></textarea></label>
        <label class="chk" style="margin-top:0"><span class="sw"><input type="checkbox" name="pinned"><i></i></span><span>Pin it to the top</span></label>
        <button type="button" class="btn p blk" data-act="news.post" style="margin-top:8px">Post announcement</button></form></div></div>`);
}, 'news');
act('news.post', async () => { await post('/api/staff/announcements', SQ.fields($('#newsform'))); ok('Posted. Clippers see it on their home page.'); SQ.reload(); });
act('news.del', async el => {
  if (!await SQ.confirm({ title: 'Delete this announcement?', text: 'It disappears from the clipper home page.', ok: 'Delete', kind: 'd' })) return;
  await del('/api/staff/announcements/' + el.dataset.id); ok('Deleted.'); SQ.reload();
});
