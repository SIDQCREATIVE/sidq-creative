/* Leaderboard, the clipper directory with profile cards, and the settings page. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, compact, date, ago, plat, chip, note, empty, stat, avatar, bgImg, get, put, act, ok, qs } = SQ;

/* ---------- leaderboard ---------- */
const LB = { period: 'week', camp: '' };
const tierChip = t => chip(t, t === 'Elite' ? 'ok' : t === 'Pro' ? 'info' : 'mu');
const podiumCard = (r, cls) => r ? h`<div class="pc ${cls}"><div class="medal">${r.rank}</div><div>${avatar(r, 'lg')}</div><div class="b" style="margin-top:8px">${r.username}${r.me ? chip('You', 'ok') : ''}</div><div style="margin-top:6px">${tierChip(r.tier)}</div><div class="v">${compact(r.views)}<span class="xs mu"> views</span></div><div class="xs mu" style="margin-top:4px">${SQ.plural(r.clips, 'clip')}${r.earned_cents == null ? '' : h`, ${usd(r.earned_cents, { whole: true })} earned`}</div></div>` : h`<div></div>`;

async function paintLb() {
  const box = $('#lbbody'); if (!box) return;
  box.style.opacity = '.5';
  let r; try { r = await get('/api/leaderboard' + qs({ period: LB.period, campaign: LB.camp })); } catch (e) { box.style.opacity = ''; return SQ.err(e); }
  box.style.opacity = '';
  const rows = r.rows, top = rows.slice(0, 3), rest = rows.slice(3), me = rows.find(x => x.me);
  html(box, rows.length ? h`${me ? '' : note('info', 'info', 'You are not ranked in this period yet. Get a clip approved and it counts toward your rank.')}
    <div class="podium">${podiumCard(top[1], 'p2')}${podiumCard(top[0], 'p1')}${podiumCard(top[2], 'p3')}</div>
    ${rest.length ? h`<div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Clipper</th><th>Rank</th><th class="r">Clips</th><th class="r">Views</th><th class="r">Earned</th></tr></thead><tbody>${rest.map(x => h`<tr style="${x.me ? 'background:var(--gl)' : ''}"><td class="num">${x.rank}</td><td><div class="row nw" style="gap:10px">${avatar(x, 'xs')}<span class="trunc">${x.username}</span>${x.me ? chip('You', 'ok') : ''}</div></td><td>${tierChip(x.tier)}</td><td class="r num">${num(x.clips)}</td><td class="r num">${num(x.views)}</td><td class="r num">${x.earned_cents == null ? '' : usd(x.earned_cents)}</td></tr>`)}</tbody></table></div>` : ''}`
    : empty('trophy', 'No ranked clippers yet', 'Be the first. Views on approved clips decide the ranking.'));
}
SQ.route('leaderboard', async ctx => {
  const camps = await get('/api/campaigns').catch(() => []);
  ctx.set(h`<div class="ph"><div class="t"><h1>Leaderboard</h1><p>Ranked by views counted on approved clips.</p></div>
    <select class="in" id="lbcamp" aria-label="Campaign" style="width:auto;min-width:200px"><option value="">All campaigns</option>${camps.map(c => h`<option value="${c.id}" ${String(c.id) === LB.camp ? 'selected' : ''}>${c.title}</option>`)}</select></div>
    <div style="margin-bottom:16px" id="lbseg"></div><div id="lbbody" style="transition:opacity .15s"></div>`);
  html($('#lbseg'), SQ.seg([['week', 'This week'], ['month', 'This month'], ['all', 'All time']], LB.period, 'lb.period'));
  await paintLb();
}, 'leaderboard');
act('lb.period', el => { LB.period = el.dataset.v; html($('#lbseg'), SQ.seg([['week', 'This week'], ['month', 'This month'], ['all', 'All time']], LB.period, 'lb.period')); return paintLb(); });
document.addEventListener('change', e => { if (e.target.id === 'lbcamp') { LB.camp = e.target.value; paintLb(); } });

/* ---------- community ---------- */
const COMM = { q: '', page: 1, more: false, items: [] };
const personCard = p => h`<button type="button" class="card" data-act="comm.open" data-id="${p.id}" style="text-align:left;cursor:pointer;display:block;width:100%">
  <div class="row nw" style="gap:12px">${avatar(p, 'md')}<div class="trunc" style="flex:1"><div class="b trunc">${p.username}</div><div class="row" style="gap:6px;margin-top:4px">${tierChip(p.rank)}${p.staff ? chip('Team', 'info') : ''}</div></div></div>
  <p class="sm mu" style="margin:12px 0;min-height:40px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${p.bio || 'No bio yet.'}</p>
  <div class="row" style="gap:18px"><span><b class="num">${num(p.clips)}</b> <span class="xs mu">clips</span></span><span><b class="num">${compact(p.views)}</b> <span class="xs mu">views</span></span></div></button>`;
function paintComm() {
  const box = $('#commlist'); if (!box) return;
  html(box, COMM.items.length ? h`<div class="ga">${COMM.items.map(personCard)}</div>${COMM.more ? h`<div class="pg"><button type="button" class="btn" data-act="comm.more">Load more</button></div>` : ''}`
    : empty('users', COMM.q ? 'Nobody matches that name' : 'No clippers to show yet', COMM.q ? 'Check the spelling or try fewer letters.' : ''));
}
async function loadComm(append) {
  const r = await get('/api/clippers' + qs({ q: COMM.q, page: COMM.page > 1 ? COMM.page : '' }));
  COMM.items = append ? COMM.items.concat(r.clippers) : r.clippers; COMM.more = r.more; paintComm();
}
SQ.route('community', async ctx => {
  COMM.q = ''; COMM.page = 1;
  ctx.set(h`<div class="ph"><div class="t"><h1>Community</h1><p>Meet the clippers on SIDQ Creative.</p></div><div class="search">${icon('search')}<input class="in" type="search" placeholder="Search by name" aria-label="Search clippers" data-search="comm"></div></div><div id="commlist"></div>`);
  await loadComm(false);
}, 'community');
SQ.onSearch('comm', v => { COMM.q = v; COMM.page = 1; return loadComm(false).catch(SQ.err); });
act('comm.more', () => { COMM.page++; return loadComm(true); });
act('comm.open', async el => {
  const p = await get('/api/clippers/' + el.dataset.id);
  SQ.dialog({
    title: 'Clipper profile', wide: true,
    body: h`<div class="row nw" style="gap:16px;align-items:flex-start">${avatar(p, 'lg')}<div style="min-width:0"><h2 style="font-size:22px">${p.username}</h2><div class="row" style="gap:8px;margin:8px 0">${tierChip(p.rank)}${p.staff ? chip('Team', 'info') : ''}<span class="xs mu">Joined ${date(p.joined)}</span></div><p class="mu">${p.bio || 'No bio yet.'}</p></div></div>
      <div class="g3" style="margin:20px 0;text-align:center"><div class="card"><div class="num b" style="font-size:22px">${num(p.clips)}</div><div class="xs mu">Clips</div></div><div class="card"><div class="num b" style="font-size:22px">${compact(p.views)}</div><div class="xs mu">Views</div></div><div class="card"><div class="num b" style="font-size:22px;color:var(--g)">${p.earned_cents == null ? 'Private' : usd(p.earned_cents, { whole: true })}</div><div class="xs mu">Earned</div></div></div>
      ${p.platforms.length ? h`<div class="row" style="margin-bottom:16px;gap:14px">${p.platforms.map(x => h`<span class="row nw" style="gap:6px">${plat(x.platform)}<span class="sm">${SQ.plural(x.n, 'account')}</span></span>`)}</div>` : ''}
      ${p.recent.length ? h`<h4 style="margin-bottom:10px">Recent clips</h4><div class="list">${p.recent.map(c => h`<a class="li" href="${c.url}" target="_blank" rel="noopener"><div class="th" style="width:48px;height:48px;${bgImg(c.thumb)}">${c.thumb ? '' : plat(c.platform)}</div><div class="m"><div class="t trunc">${c.title || c.campaign}</div><div class="d"><span>${c.campaign}</span></div></div><div class="e"><b class="num">${compact(c.views)}</b><span class="xs mu">views</span></div></a>`)}</div>` : ''}`,
    buttons: [{ text: 'Close', kind: '', value: false }]
  });
});

/* ---------- settings ---------- */
SQ.route('settings', async ctx => {
  const me = await SQ.refreshMe(); if (!me) return;
  const u = me.user, ref = me.settings.referral_pct > 0 ? await get('/api/referral') : null;
  const left = u.next ? u.next - u.xp : 0;
  ctx.title('Settings');
  ctx.set(h`<div class="ph"><div class="t"><h1>Settings</h1><p>How you appear to other clippers.</p></div></div>
    <div class="two"><div class="col" style="gap:14px"><div class="card"><div class="ch"><h3>Profile</h3></div>
      <div class="row nw" style="gap:14px;margin-bottom:16px">${avatar(u, 'lg')}<div><div class="b" style="font-size:18px">${u.username}</div><div class="sm mu">Your name and picture come from Discord.</div></div></div>
      <label class="f"><span class="h">Bio</span><textarea class="in" id="bio" rows="3" maxlength="200" placeholder="Tell other clippers what you clip">${u.bio || ''}</textarea><div class="hint">Up to 200 characters. Shown on your profile in Community.</div></label>
      <label class="chk" style="margin-top:0"><span class="sw"><input type="checkbox" id="showearn" ${u.show_earnings ? 'checked' : ''}><i></i></span><span>Show my earnings on the leaderboard and my profile<div class="hint">Turn this off to keep your earnings private. Your views and clips still show.</div></span></label>
      <button type="button" class="btn p" data-act="settings.save" style="margin-top:8px">Save changes</button></div>
      ${ref ? h`<div class="card"><div class="ch"><h3>Invite clippers</h3>${chip(ref.pct + '% bonus', 'ok')}</div><p class="sm mu" style="margin-bottom:12px">When someone joins with your link, you earn ${ref.pct}% of what they earn. We pay it on top, so they lose nothing.</p>
        <div class="row nw" style="gap:8px"><input class="in" readonly value="${ref.link}" aria-label="Your invite link" style="flex:1" onclick="this.select()">${SQ.copyBtn(ref.link, 'Copy invite link')}</div>
        <div class="g2" style="margin-top:14px"><div><div class="num b" style="font-size:20px">${num(ref.invited)}</div><div class="xs mu">Clippers invited</div></div><div><div class="num b" style="font-size:20px;color:var(--g)">${usd(ref.earned_cents)}</div><div class="xs mu">Bonus earned</div></div></div></div>` : ''}</div>
    <div class="col sticky" style="gap:14px"><div class="card"><div class="ch"><h3>Your rank</h3>${tierChip(u.rank)}</div>${SQ.bar(u.next ? (u.xp - u.floor) / Math.max(1, u.next - u.floor) * 100 : 100)}<p class="sm mu" style="margin-top:10px">${num(u.xp)} views counted. ${u.next ? num(left) + ' more to reach ' + u.nextRank + '.' : 'You reached the top rank.'}</p></div>
      <div class="card"><div class="ch"><h3>Account</h3></div><div class="col" style="gap:10px"><a class="btn blk" href="#help">${icon('help')}Help center</a><a class="btn blk" href="/auth/logout">${icon('logout')}Log out</a></div></div></div></div>`);
}, null);
act('settings.save', async () => {
  await put('/api/profile', { bio: $('#bio').value, show_earnings: $('#showearn').checked });
  ok('Settings saved.'); await SQ.refreshMe();
});
