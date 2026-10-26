/* Campaigns: the list clippers browse, and a campaign page with rules, the submit form and the leaderboard. */
const SQ = window.SQ;
const { h, $, $$, html, icon, usd, num, date, until, plat, chip, note, empty, bar, avatar, bgImg, get, post, act, ok, go } = SQ;

const pct = c => c.budget_cents > 0 ? Math.min(100, Math.round(c.committed_cents / c.budget_cents * 100)) : 0;
const left = c => Math.max(0, c.budget_cents - c.committed_cents);
const initial = c => c.image ? '' : (c.title || '?').trim().charAt(0).toUpperCase();
const closedWhy = c => c.status === 'ended' || (c.ends_at && new Date(c.ends_at) <= new Date()) ? 'Ended' : (c.budget_cents > 0 && c.committed_cents >= c.budget_cents) ? 'Budget used up' : 'Closed';
const stateChip = c => c.open ? chip('Open', 'ok') : chip(closedWhy(c), 'mu');
const badges = c => h`<span class="row nw" style="gap:6px">${c.platforms.map(p => plat(p))}</span>`;
const cap = c => c.max_payout == null ? 'No cap' : usd(c.max_payout * 100, { whole: true });
Object.assign(SQ, { campThumb: (c, cls) => h`<div class="${cls || 'cimg'}" style="${bgImg(c.image)}">${initial(c)}</div>`, campState: stateChip, campBadges: badges, campPct: pct, campLeft: left });

const card = c => h`<a class="cc" href="#campaign/${c.id}">
  <div class="cimg" style="${bgImg(c.image)}">${initial(c)}<span class="st">${stateChip(c)}</span></div>
  <div>
    <h3>${c.title}</h3>
    <div class="meta">${chip(c.label, 'mu')}${badges(c)}${c.joined ? chip('Joined', 'info', 'check') : ''}${c.min_followers > 0 ? chip(num(c.min_followers) + '+ followers', 'mu') : ''}${c.requires_analytics ? chip('Analytics required', 'mu') : ''}</div>
    <div class="nums">
      <div><div class="l">Minimum views</div><div class="v">${num(c.min_views)}</div></div>
      <div><div class="l">Max payout per clip</div><div class="v">${cap(c)}</div></div>
      <div><div class="l">Clippers</div><div class="v">${num(c.members || 0)}</div></div>
    </div>
  </div>
  <div class="go">
    <div class="rate">${usd(c.rate * 100)}<small> per 1K views</small></div>
    <div>${bar(pct(c))}<div class="xs mu" style="margin:7px 0 12px">${usd(left(c), { whole: true })} left of ${usd(c.budget_cents, { whole: true })}</div>
      <span class="btn ${c.open && !c.joined ? 'p' : ''} s blk">${c.joined ? 'Open campaign' : c.open ? 'View and join' : 'View'}</span></div>
  </div></a>`;

/* ---------- list ---------- */
let LIST = [], FILTER = 'open', QUERY = '';
const matches = c => (FILTER === 'open' ? c.open : FILTER === 'joined' ? c.joined : !c.open) && (!QUERY || (c.title + ' ' + c.label).toLowerCase().includes(QUERY.toLowerCase()));
function paintList() {
  const n = { open: LIST.filter(c => c.open).length, joined: LIST.filter(c => c.joined).length, closed: LIST.filter(c => !c.open).length };
  html($('#camptabs'), SQ.tabs([['open', 'Open', n.open], ['joined', 'Joined', n.joined], ['closed', 'Closed', n.closed]], FILTER, 'camp.f'));
  const rows = LIST.filter(matches);
  html($('#camplist'), rows.length ? rows.map(card) : FILTER === 'joined'
    ? empty('megaphone', 'You have not joined a campaign yet', 'Open a campaign, read the rules and press Join.')
    : QUERY ? empty('search', 'No campaigns match that search', 'Try a different word.')
      : FILTER === 'open' ? empty('megaphone', 'No open campaigns right now', 'New campaigns are announced here and in our Discord server. Check back soon.')
        : empty('megaphone', 'No closed campaigns yet'));
}
SQ.route('campaigns', async ctx => {
  LIST = await get('/api/campaigns'); QUERY = '';
  FILTER = ctx.q.f || (LIST.some(c => c.open) ? 'open' : 'closed');
  ctx.set(h`<div class="ph"><div class="t"><h1>Campaigns</h1><p>Pick a campaign, read its rules and post clips to earn per 1,000 views.</p></div>
    <div class="search">${icon('search')}<input class="in" type="search" placeholder="Search campaigns" aria-label="Search campaigns" data-search="camp"></div></div>
    <div id="camptabs"></div><div id="camplist"></div>`);
  paintList();
}, 'campaigns');
SQ.onSearch('camp', v => { QUERY = v; paintList(); });
act('camp.f', el => { FILTER = el.dataset.v; paintList(); });

/* ---------- one campaign ---------- */
const req = c => SQ.kv([
  ['Platforms', badges(c)],
  c.min_followers > 0 && ['Followers needed', num(c.min_followers) + ' on the account you post from'],
  c.submit_hours > 0 && ['Submit within', c.submit_hours + ' hours of posting the video'],
  ['Minimum views to earn', c.min_views > 0 ? num(c.min_views) + ' views per clip' : 'None'],
  ['Max payout per clip', cap(c)],
  ['Tracking window', c.track_days + ' days after your clip is approved'],
  ['Audience analytics', c.requires_analytics ? 'Required. After your clip passes the rules check you send a screen recording of your analytics.' : 'Not required'],
  ['Ends', c.ends_at ? date(c.ends_at) + ' (' + until(c.ends_at) + ')' : 'No end date']
]);

SQ.route('campaign/:id', async ctx => {
  const c = await get('/api/campaigns/' + encodeURIComponent(ctx.params.id));
  ctx.title(c.title);
  const e = c.eligibility, names = c.platforms.map(p => SQ.PLAT[p]).join(', ');
  const blocker = !c.joined && c.open && (!e.has_account
    ? note('warn', 'alert', h`<b>Connect an account first.</b> This campaign accepts ${names}. Add one in Accounts and wait for it to be verified.<div style="margin-top:10px"><a class="btn s" href="#accounts">Open accounts</a></div>`)
    : c.min_followers > 0 && !e.meets_followers ? note('warn', 'alert', h`<b>Not enough followers yet.</b> This campaign needs an account with at least ${num(c.min_followers)} followers.`) : '');
  const cta = c.joined ? h`${c.open ? h`<button type="button" class="btn p" data-act="camp.jump" data-to="submit">${icon('upload')}Submit a clip</button>` : ''}${c.assets_url ? h`<a class="btn" href="${c.assets_url}" target="_blank" rel="noopener">${icon('download')}Assets</a>` : ''}`
    : c.open ? h`<button type="button" class="btn p l" data-act="camp.join" data-id="${c.id}" ${blocker ? 'disabled' : ''}>Join campaign</button>` : '';
  const form = c.joined && (c.open ? h`<div class="card" id="submit"><div class="ch"><h3>Submit a clip</h3></div>
      ${e.accounts.length ? h`<div id="subform">
        <label class="f"><span class="h">Account you posted it on</span><select class="in" name="account_id" id="subacct">${e.accounts.map(a => h`<option value="${a.id}" data-p="${a.platform}">@${a.handle} on ${SQ.PLAT[a.platform]}</option>`)}</select></label>
        <label class="f"><span class="h">Video link</span><input class="in" name="url" id="suburl" inputmode="url" autocomplete="off" placeholder="Paste the link of your YouTube Short, TikTok or Instagram reel"><div class="hint" id="subdet" style="min-height:18px"></div></label>
        <div id="suberr"></div>
        <button type="button" class="btn p" data-act="camp.submit" data-id="${c.id}">Submit clip</button>
        <p class="hint">Post the video on your own account first, then paste its link. ${c.submit_hours > 0 ? 'It must be submitted within ' + c.submit_hours + ' hours of posting.' : ''}</p></div>`
      : note('warn', 'alert', h`<b>You have no verified account for this campaign.</b> Add one in <a href="#accounts" style="color:var(--g)">Accounts</a> to submit clips.`)}</div>`
    : note('info', 'info', 'This campaign is closed for new clips. Clips you already submitted keep tracking and are still paid.'));
  const rules = c.joined ? h`<div class="card"><div class="ch"><h3>Rules</h3></div><div class="pre">${c.rules || 'No extra rules for this campaign. Follow the Clipper Guidelines.'}</div></div>`
    : h`<div class="card"><div class="empty" style="padding:24px 10px">${icon('lock')}<h3>Rules and assets are for clippers who joined</h3><p>Join the campaign to read the full rules${c.open ? '' : ' (this campaign is closed)'}.</p></div></div>`;
  const top = c.top.length ? h`<div class="card pad0"><div class="ch" style="padding:20px 20px 0"><h3>Top clippers</h3></div><div class="tw" style="border:0;border-radius:0"><table class="tbl"><thead><tr><th>#</th><th>Clipper</th><th class="r">Clips</th><th class="r">Views</th><th class="r">Earned</th></tr></thead><tbody>${c.top.map((t, i) => h`<tr><td class="num">${i + 1}</td><td><div class="row nw" style="gap:10px">${avatar(t, 'xs')}<span class="trunc">${t.username}</span></div></td><td class="r num">${num(t.clips)}</td><td class="r num">${num(t.views)}</td><td class="r num">${t.earned_cents == null ? '' : usd(t.earned_cents)}</td></tr>`)}</tbody></table></div></div>` : '';
  ctx.set(h`<a class="back" href="#campaigns">${icon('chevl')}All campaigns</a>
    <div class="hero"><div class="cimg" style="${bgImg(c.image)}">${initial(c)}</div>
      <div style="flex:1;min-width:240px"><div class="row" style="margin-bottom:8px">${stateChip(c)}${chip(c.label, 'mu')}${badges(c)}</div><h1>${c.title}</h1>
        <p class="mu" style="margin-top:6px"><b style="color:var(--g)">${usd(c.rate * 100)}</b> for every 1,000 views${c.ends_at ? ', ends ' + date(c.ends_at) : ''}</p></div>
      <div class="row">${cta}</div></div>
    ${blocker || ''}
    <div class="two"><div class="col" style="gap:14px">
      <div class="card"><div class="ch"><h3>About this campaign</h3></div><div class="pre">${c.brief || 'No description yet.'}</div></div>
      <div class="card"><div class="ch"><h3>Requirements</h3></div>${req(c)}${c.requires_analytics && c.analytics_note ? h`<div class="note" style="margin:14px 0 0">${icon('info')}<div class="x"><b>What to upload:</b> ${c.analytics_note}</div></div>` : ''}</div>
      ${rules}${form || ''}${top}</div>
    <div class="col sticky" style="gap:14px">
      <div class="card"><div class="ch"><h3>Budget</h3>${chip(pct(c) + '% used', pct(c) >= 90 ? 'warn' : 'mu')}</div>${bar(pct(c), pct(c) >= 90 ? 'warn' : '')}
        <div class="row" style="margin-top:10px;justify-content:space-between"><span><b class="num">${usd(left(c), { whole: true })}</b> <span class="mu sm">left</span></span><span class="mu sm">of ${usd(c.budget_cents, { whole: true })}</span></div>
        <hr class="dv"><div class="row" style="justify-content:space-between"><span class="mu">Clippers</span><b class="num">${num(c.members || 0)}</b></div></div>
      <div class="card"><div class="ch"><h3>How you earn</h3></div><ul class="sm" style="padding-left:18px;display:grid;gap:8px;color:#cfcfd5">
        <li>You earn <b>${usd(c.rate * 100)}</b> for every 1,000 views.</li>
        ${c.min_views > 0 ? h`<li>A clip needs at least <b>${num(c.min_views)}</b> views to earn.</li>` : ''}
        ${c.max_payout != null ? h`<li>One clip can earn up to <b>${usd(c.max_payout * 100, { whole: true })}</b>.</li>` : ''}
        <li>Views count for <b>${c.track_days} days</b> after approval. Then the money goes to your wallet.</li></ul></div>
      ${c.me ? h`<div class="card"><div class="ch"><h3>Your results</h3></div><div class="g3" style="gap:8px;text-align:center"><div><div class="num b" style="font-size:20px">${num(c.me.clips)}</div><div class="xs mu">Clips</div></div><div><div class="num b" style="font-size:20px">${SQ.compact(c.me.views)}</div><div class="xs mu">Views</div></div><div><div class="num b" style="font-size:20px;color:var(--g)">${usd(c.me.earned_cents, { whole: true })}</div><div class="xs mu">Earned</div></div></div><a class="btn blk s" style="margin-top:14px" href="#clips?campaign=${c.id}">View my clips</a></div>` : ''}
    </div></div>`);
}, 'campaigns');

act('camp.join', async el => {
  await post(`/api/campaigns/${el.dataset.id}/join`);
  ok('You joined the campaign. Read the rules, then submit your first clip.'); SQ.reload();
});
act('camp.jump', el => { const t = $('#' + el.dataset.to); if (t) t.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); });
act('camp.submit', async el => {
  const f = SQ.fields($('#subform')), box = $('#suberr'); box.innerHTML = '';
  if (!String(f.url || '').trim()) { html(box, note('bad', 'alert', 'Paste the link of your video first.')); return; }
  try {
    const r = await post(`/api/campaigns/${el.dataset.id}/submit`, { account_id: +f.account_id, url: f.url.trim() });
    ok('Clip submitted. Our team will check it soon.'); go('clip/' + r.id);
  } catch (e) { if (e.status !== 401) html(box, note('bad', 'alert', e.message)); }
});
document.addEventListener('input', e => {
  const t = e.target; if (t.id !== 'suburl') return;
  const p = SQ.detectPlat(t.value), det = $('#subdet'), sel = $('#subacct');
  det.innerHTML = p ? h`${plat(p)} ${SQ.PLAT[p]} link` : (t.value ? 'Paste the full link of your video.' : '');
  if (p && sel) { const m = Array.from(sel.options).filter(o => o.dataset.p === p); if (m.length === 1) sel.value = m[0].value; }
});
