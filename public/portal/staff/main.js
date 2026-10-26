/* Staff panel shell: login, sidebar (only what the role may use), top bar, badge counts, start-up. Pages live in the other files. */
const SQ = window.SQ;
const { h, $, $$, html, icon, avatar, get, post, act, toast, setTok, debounce } = SQ;

// [route, label, icon, permission needed, badge key]
const NAV = [
  [null, [['overview', 'Overview', 'home', 'overview']]],
  ['Review', [['clips', 'Clips', 'film', 'review', 'clips'], ['accounts', 'Accounts', 'usercheck', 'review', 'accounts']]],
  ['Money', [['payouts', 'Payouts', 'wallet', 'payouts', 'payouts']]],
  ['Campaigns', [['campaigns', 'Campaigns', 'megaphone', 'campaigns'], ['news', 'Announcements', 'bell', 'campaigns']]],
  ['People', [['clippers', 'Clippers', 'users', 'users'], ['tickets', 'Support', 'lifebuoy', 'support', 'tickets'], ['team', 'Team', 'shield', 'staff']]],
  ['Website', [['leads', 'Applications', 'inbox', 'website', 'leads'], ['content', 'Page content', 'file', 'website'], ['blog', 'Blog', 'book', 'website'], ['seo', 'Search settings', 'globe', 'website']]],
  ['System', [['settings', 'Settings', 'sliders', 'settings'], ['audit', 'Audit log', 'list', 'audit']]]
];

const sideHtml = () => {
  const me = SQ.staff;
  const groups = NAV.map(([g, items]) => [g, items.filter(i => SQ.can(i[3]))]).filter(x => x[1].length);
  return h`<a class="brand" href="#overview"><img src="/logo-mark.png" alt="" data-hide><span>SIDQ</span><small>Staff</small></a>
    <nav aria-label="Main">${groups.map(([g, items]) => h`${g ? h`<div class="ng">${g}</div>` : ''}${items.map(([k, t, ic, , b]) => h`<a class="ni ${k === SQ.curNav ? 'on' : ''}" href="#${k}" data-nav="${k}">${icon(ic)}<span>${t}</span>${b ? h`<span class="cnt red" data-badge="${b}" ${SQ.badges[b] ? '' : 'hidden'}>${SQ.badges[b] > 99 ? '99+' : SQ.badges[b] || ''}</span>` : ''}</a>`)}`)}</nav>
    <div class="foot"><div class="row nw" style="gap:10px;margin-bottom:6px">${avatar({ username: me.name, avatar: me.avatar })}<div class="trunc" style="flex:1"><div class="b trunc">${me.name}</div><div class="xs mu">${me.label}</div></div><button type="button" class="iconbtn sm" data-act="logout" aria-label="Log out" title="Log out">${icon('logout')}</button></div>
      <a class="ni" href="/clipper">${icon('user')}<span>Clipper portal</span></a></div>`;
};
const topHtml = () => h`<button type="button" class="iconbtn burger" data-act="menu" aria-label="Open menu">${icon('menu')}</button><div class="ttl"></div>
  <div class="right row nw" style="gap:12px">
    ${SQ.isSunday() ? SQ.chip('Sunday: staff day off', 'info', 'calendar') : ''}
    ${SQ.can('users') ? h`<div class="search topsearch">${icon('search')}<input class="in" type="search" id="qclip" placeholder="Find a clipper" aria-label="Find a clipper"></div>` : ''}
    ${SQ.chip(SQ.staff.label, 'ok')}
  </div>`;

function renderShell() {
  html($('#root'), h`<div class="app"><aside class="side staff" id="side">${sideHtml()}</aside><div class="mainwrap" style="min-width:0"><header class="top">${topHtml()}</header><main class="main" id="main"><div class="page" id="view"></div></main></div></div>`);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'qclip') { const v = e.target.value.trim(); if (v) { SQ.go('clippers' + SQ.qs({ q: v })); e.target.value = ''; e.target.blur(); } }
});

/* ---------- login ---------- */
function renderLogin(st) {
  st = st || {};
  html($('#root'), h`<div class="login"><div class="lc">
    <img src="/logo-mark.png" alt="SIDQ Creative" data-hide>
    <h1>Staff panel</h1>
    <p>Review clips, pay clippers and manage campaigns. Log in with the Discord account the owner gave a role to.</p>
    ${st.status === 403 ? SQ.note('bad', 'ban', h`<b>This Discord account is not on the team.</b><br>Ask the owner to add you under Team, then log in again.`) : ''}
    <a class="btn p l blk" href="/auth/discord?next=staff">${icon('discord')}Continue with Discord</a>
    <details class="faq" style="margin-top:18px;text-align:left"><summary>Owner password</summary>
      <form id="pwform" style="padding-bottom:16px"><label class="f"><span class="h">Admin password</span><input class="in" type="password" id="pw" autocomplete="current-password" placeholder="The ADMIN_PASSWORD you set in Railway"></label><div id="pwerr"></div><button class="btn p blk" type="submit">Log in</button></form></details>
    ${st.status === 403 ? h`<p class="xs" style="margin-top:14px"><a href="/auth/logout?next=staff" style="color:var(--g)">Log out of Discord on this site</a></p>` : ''}
  </div></div>`);
  SQ.setTitle('Log in');
}
document.addEventListener('submit', async e => {
  if (e.target.id !== 'pwform') return;
  e.preventDefault();
  const btn = $('button', e.target), box = $('#pwerr'); html(box, '');
  btn.classList.add('busy');
  try { const r = await post('/api/login', { password: $('#pw').value }); setTok(r.token); await boot(); }
  catch (x) { html(box, SQ.note('bad', 'alert', x.message)); }
  finally { btn.classList.remove('busy'); }
});
function renderFail(e) {
  html($('#root'), h`<div class="login"><div class="lc"><h1>We could not load the panel</h1><p>${e.message}</p><button type="button" class="btn p" onclick="location.reload()">Try again</button></div></div>`);
}
act('logout', () => { setTok(''); location.href = '/auth/logout?next=staff'; });
SQ.on401 = () => {
  if (!SQ.staff) return;
  SQ.staff = null; SQ.$$('.ov').forEach(o => o.remove()); document.documentElement.style.overflow = '';
  renderLogin({}); toast('Your session ended. Log in again to continue.', 'warn');
};

/* ---------- the numbers next to the menu items ---------- */
SQ.refreshBadges = async () => {
  if (!SQ.staff || document.hidden || !SQ.can('overview')) return;
  try {
    const o = await get('/api/staff/overview', { quiet: true });
    SQ.setBadges({ clips: o.review ? o.review.review + o.review.checking : 0, accounts: o.review ? o.review.accounts : 0, payouts: o.payouts ? o.payouts.open : 0, tickets: o.support ? o.support.waiting : 0, leads: o.leads ? o.leads.customers + o.leads.clippers : 0 });
    const n = (SQ.badges.clips || 0) + (SQ.badges.accounts || 0) + (SQ.badges.payouts || 0) + (SQ.badges.tickets || 0);
    document.documentElement.dataset.todo = n;
    return o;
  } catch (e) { /* try again next time */ }
};
SQ.pingBadges = debounce(() => SQ.refreshBadges(), 500);
setInterval(() => SQ.refreshBadges(), 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) SQ.refreshBadges(); });

async function boot() {
  let me;
  try { me = await get('/api/staff/me', { quiet: true }); }
  catch (e) { if (e.status === 401 || e.status === 403) return renderLogin({ status: e.status }); return renderFail(e); }
  SQ.staff = me;
  renderShell();
  if (!location.hash) history.replaceState(null, '', '#overview');
  SQ.dispatch();
  SQ.refreshBadges();
}
boot();
