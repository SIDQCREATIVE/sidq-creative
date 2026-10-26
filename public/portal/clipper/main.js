/* Clipper portal shell: login screen, sidebar, top bar, notifications, start-up steps. Pages live in the other files. */
const SQ = window.SQ;
const { h, $, $$, html, icon, usd, num, avatar, get, post, act, dialog, toast, err, go, ago, safeUrl } = SQ;

SQ.me = null;
SQ.home = 'home';

const NAV = [
  ['General', [['home', 'Home', 'home'], ['leaderboard', 'Leaderboard', 'trophy'], ['community', 'Community', 'users']]],
  ['Activity', [['campaigns', 'Campaigns', 'megaphone'], ['clips', 'My clips', 'film'], ['wallet', 'Wallet', 'wallet'], ['accounts', 'Accounts', 'link']]],
  ['Support', [['support', 'Support', 'lifebuoy'], ['help', 'Help center', 'help']]]
];

const rankCard = u => {
  const left = u.next ? u.next - u.xp : 0;
  const pct = u.next ? ((u.xp - u.floor) / Math.max(1, u.next - u.floor)) * 100 : 100;
  return h`<div class="card" style="padding:14px"><div class="row nw" style="gap:10px;margin-bottom:10px">${avatar(u, 'md')}<div class="trunc"><div class="b trunc">${u.username}</div><div class="xs mu">Rank: ${u.rank}</div></div></div>${SQ.bar(pct)}<div class="xs mu" style="margin-top:7px">${u.next ? h`${num(left)} more views to reach ${u.nextRank}` : 'Top rank reached'}</div></div>`;
};
const sideHtml = () => {
  const me = SQ.me, u = me.user, needs = (me.needs && me.needs.analytics) || 0;
  return h`<a class="brand" href="#home"><img src="/logo-mark.png" alt="" data-hide><span>SIDQ</span><small>Clippers</small></a>
    <nav aria-label="Main">${NAV.map(([g, items]) => h`<div class="ng">${g}</div>${items.map(([k, t, ic]) => h`<a class="ni ${k === SQ.curNav ? 'on' : ''}" href="#${k}" data-nav="${k}">${icon(ic)}<span>${t}</span>${k === 'clips' && needs ? h`<span class="cnt red" title="Clips waiting for your analytics">${needs}</span>` : ''}</a>`)}`)}</nav>
    <div class="foot">${me.staff ? h`<a class="ni" href="/staff">${icon('shield')}<span>Staff panel</span></a>` : ''}<div style="margin-top:8px">${rankCard(u)}</div></div>`;
};
const topHtml = () => {
  const me = SQ.me;
  return h`<button type="button" class="iconbtn burger" data-act="menu" aria-label="Open menu">${icon('menu')}</button><div class="ttl"></div>
    <div class="right row nw" style="gap:12px">
      <a class="chipw" href="#wallet" title="Your wallet balance">${icon('wallet')}<span id="walbal">${usd(me.balance_cents)}</span></a>
      <div class="pw"><button type="button" class="iconbtn" data-act="notif" aria-label="Notifications" aria-haspopup="true">${icon('bell')}<span class="dot" id="nbadge" ${me.unread ? '' : 'hidden'}>${me.unread > 99 ? '99+' : me.unread}</span></button></div>
      <div class="pw"><button type="button" class="iconbtn" style="padding:0;overflow:hidden" data-act="umenu" aria-label="Account menu" aria-haspopup="true">${avatar(me.user)}</button></div>
    </div>`;
};

function renderShell() {
  html($('#root'), h`<div class="app"><aside class="side" id="side">${sideHtml()}</aside><div class="mainwrap" style="min-width:0"><header class="top">${topHtml()}</header><main class="main" id="main"><div class="page" id="view"></div></main></div></div>`);
}

/* ---------- login screen ---------- */
function renderLogin(state) {
  html($('#root'), h`<div class="login"><div class="lc">
    <img src="/logo-mark.png" alt="SIDQ Creative" data-hide>
    <h1>Get paid to clip</h1>
    <p>Join live campaigns, post your clips on YouTube, TikTok and Instagram, and earn for every 1,000 views.</p>
    ${state && state.banned ? SQ.note('bad', 'ban', h`<b>This account is blocked.</b><br>${state.reason || 'Contact us if you think this is a mistake.'}`) : ''}
    <div class="feat">
      <div>${icon('target')}<span>Campaigns show the rate, the budget and the rules before you join.</span></div>
      <div>${icon('eye')}<span>Views are tracked for you. We only ask for audience analytics after a clip passes the rules check.</span></div>
      <div>${icon('wallet')}<span>Cash out from $10 to PayPal, bank transfer, USDT, EasyPaisa or JazzCash.</span></div>
    </div>
    <a class="btn p l blk" href="/auth/discord">${icon('discord')}Continue with Discord</a>
    <p class="xs" style="margin:16px 0 0">By continuing you accept our <a href="/terms" target="_blank" rel="noopener" style="color:var(--g)">Terms</a> and <a href="/privacy" target="_blank" rel="noopener" style="color:var(--g)">Privacy Policy</a>.</p>
  </div></div>`);
  SQ.setTitle('Log in');
}
function renderFail(e) {
  html($('#root'), h`<div class="login"><div class="lc"><h1>We could not load the portal</h1><p>${e.message}</p><button type="button" class="btn p" onclick="location.reload()">Try again</button></div></div>`);
}

/* ---------- popovers (notifications, account menu) ---------- */
let pop = null;
const closePop = () => { if (pop) { pop.remove(); pop = null; } };
function openPop(anchor, content, cls) {
  const same = pop && pop._for === anchor; closePop(); if (same) return null;
  const d = document.createElement('div'); d.className = 'pop ' + (cls || ''); html(d, content);
  anchor.closest('.pw').appendChild(d); d._for = anchor; pop = d; return d;
}
document.addEventListener('click', e => { if (pop && !e.target.closest('.pw')) closePop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });
window.addEventListener('hashchange', closePop);

const setBadge = n => { const b = $('#nbadge'); if (!b) return; b.hidden = !n; b.textContent = n > 99 ? '99+' : n; if (SQ.me) SQ.me.unread = n; };
const noteItem = n => h`<a ${n.link && n.link[0] === '#' ? h`href="${n.link}"` : h`role="button" tabindex="0"`} class="${n.read ? '' : 'un'}" data-act="nread" data-id="${n.id}"><b>${n.title}</b><span>${n.body}</span><small>${ago(n.at)}</small></a>`;
act('notif', async el => {
  const d = openPop(el, h`<div class="nh"><b>Notifications</b><button type="button" class="btn g s right" data-act="readall">Mark all as read</button></div><div class="nl"><div class="empty" style="padding:30px">Loading...</div></div>`, 'notif');
  if (!d) return;
  const r = await get('/api/notifications?limit=30');
  setBadge(r.unread);
  const list = $('.nl', d); if (!list) return;
  html(list, r.items.length ? r.items.map(noteItem) : SQ.empty('bell', 'Nothing new', 'Updates about your clips, payouts and account show up here.'));
});
act('nread', el => {
  if (!el.classList.contains('un')) return;
  el.classList.remove('un'); setBadge(Math.max(0, ((SQ.me && SQ.me.unread) || 1) - 1));
  return post('/api/notifications/read', { ids: [+el.dataset.id] }).catch(() => { });
});
act('readall', async () => {
  await post('/api/notifications/read', {});
  $$('.notif a.un').forEach(a => a.classList.remove('un')); setBadge(0);
});
act('umenu', el => {
  const me = SQ.me, u = me.user;
  openPop(el, h`<div style="padding:10px 12px"><div class="b">${u.username}</div><div class="mu xs">Rank: ${u.rank}${me.staff ? h`, ${me.staff.label}` : ''}</div></div><hr>
    <a href="#settings">${icon('sliders')}Settings</a><a href="#help">${icon('help')}Help center</a>${me.staff ? h`<a href="/staff">${icon('shield')}Staff panel</a>` : ''}<hr><a href="/auth/logout">${icon('logout')}Log out</a>`);
});
async function pollBell() {
  if (!SQ.me || document.hidden) return;
  try { const r = await get('/api/notifications?limit=1', { quiet: true }); setBadge(r.unread); } catch (e) { /* try again next time */ }
}
setInterval(pollBell, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollBell(); });

/* ---------- keep the numbers in the shell fresh after actions ---------- */
SQ.refreshMe = async () => {
  const me = await get('/api/me');
  if (!me.user) { SQ.on401(); return null; }
  SQ.me = me;
  const w = $('#walbal'); if (w) w.textContent = usd(me.balance_cents);
  setBadge(me.unread);
  const s = $('#side'); if (s) html(s, sideHtml());
  return me;
};
SQ.on401 = () => {
  if (!SQ.me) return;
  SQ.me = null; closePop();
  $$('.ov').forEach(o => o.remove()); document.documentElement.style.overflow = '';
  renderLogin({}); toast('Your session ended. Log in again to continue.', 'warn');
};

/* ---------- start-up steps for new clippers ---------- */
function onboarding() {
  const m = dialog({
    title: 'Welcome to SIDQ Creative', sticky: true,
    body: h`<p class="mu" style="margin-bottom:16px">Two quick things before you start clipping.</p>
      <label class="chk"><input type="checkbox" id="c1"><span>I am 18 or older, or I have my parent or guardian's permission.</span></label>
      <label class="chk"><input type="checkbox" id="c2"><span>I agree to the <a href="/content-standards" target="_blank" rel="noopener" style="color:var(--g)">Content Standards</a> and <a href="/clipper-guidelines" target="_blank" rel="noopener" style="color:var(--g)">Clipper Guidelines</a>.</span></label>`,
    buttons: [{
      text: 'Continue', kind: 'p', run: async dm => {
        if (!$('#c1', dm.box).checked || !$('#c2', dm.box).checked) throw new Error('Tick both boxes to continue.');
        await post('/api/onboard', { age: true, terms: true });
        await SQ.refreshMe(); SQ.reload();
        setTimeout(() => go('accounts'), 120);
      }
    }]
  });
  return m;
}

async function boot() {
  let me;
  try { me = await get('/api/me', { quiet: true }); } catch (e) { return renderFail(e); }
  if (!me.user) return renderLogin(me);
  SQ.me = me;
  renderShell();
  if (!location.hash) history.replaceState(null, '', '#home');
  SQ.dispatch();
  if (!me.user.onboarded) onboarding();
}
boot();
