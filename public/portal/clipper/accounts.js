/* Accounts: connect YouTube, TikTok and Instagram with the platform's own sign-in (verified at once, views counted automatically),
   or add an account by hand and verify it with a code in the bio. */
const SQ = window.SQ;
const { h, $, html, icon, num, plat, chip, note, empty, post, del, act, ok, go } = SQ;

const WHERE = {
  youtube: 'your channel description (Customize channel, Basic info, Description)',
  tiktok: 'your TikTok bio (Edit profile, Bio)',
  instagram: 'your Instagram bio (Edit profile, Bio)'
};
const profile = a => a.platform === 'youtube' ? `https://www.youtube.com/@${a.handle}` : a.platform === 'tiktok' ? `https://www.tiktok.com/@${a.handle}` : `https://www.instagram.com/${a.handle}/`;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null;
const pname = k => own(SQ.PLAT, k) || 'the platform';
// What each answer from the connect page means for the clipper (the address carries ?connect_error=<code>&p=<platform>).
const WHY = {
  denied: p => `You cancelled the connection on ${p}. Nothing was changed. Press Connect to try again.`,
  noscope: p => `${p} did not give us every permission we need. Press Connect again and keep all the permissions switched on.`,
  taken: p => `This ${p} account is already connected to another clipper. If it is yours, open a support ticket and we will sort it out.`,
  not_professional: () => 'Instagram only lets us read views from Business or Creator accounts. In the Instagram app open Settings, Account type and tools, then Switch to professional account and choose Creator. It is free and takes a minute. Then press Connect again.',
  no_channel: () => 'That Google account does not have a YouTube channel. Create one on youtube.com, or sign in with the Google account that owns your channel, then try again.',
  limit: () => 'You already have 10 accounts. Remove one before connecting another.',
  nohandle: p => `We could not read the username of that ${p} account. Try again, or add it by hand below.`,
  failed: p => `The connection to ${p} did not finish. Please try again. If it keeps failing, open a support ticket.`
};
let PICK = 'youtube', FLASH = null;

const connectLink = (platform, label, cls) => h`<a class="btn ${cls || 'p'}" href="/connect/${platform}/start">${label}</a>`;

const accountRow = (a, yt, can) => {
  const live = a.connected && a.conn_status === 'active', dead = a.connected && a.conn_status !== 'active', byHand = !a.connected && a.status !== 'approved', P = pname(a.platform);
  return h`<div class="li" style="align-items:start">${plat(a.platform, true)}
    <div class="m"><div class="t">@${a.handle}${SQ.status('acct', a.status)}${a.status === 'approved' ? h`<span class="xs mu">${num(a.followers)} followers</span>` : ''}${live ? chip('Connected', 'ok', 'link') : ''}</div>
      <div class="d" style="margin-top:6px"><span>${P}</span><a href="${profile(a)}" target="_blank" rel="noopener" style="color:var(--g)">Open profile ${icon('ext')}</a>${live ? h`<span>Views are counted automatically</span>` : ''}</div>
      ${dead ? h`<div style="margin-top:10px">${note('warn', 'alert', h`<b>The connection to ${P} expired.</b> Views of your clips are not counted until you reconnect. It takes a few seconds.`)}</div>` : ''}
      ${a.status === 'rejected' ? h`<div style="margin-top:10px">${note('bad', 'xc', h`<b>Rejected.</b> ${a.reject_reason || 'Please check your username and the code in your bio.'}`)}</div>` : ''}
      ${byHand && a.status === 'pending' ? h`<div style="margin-top:10px" class="sm">${can[a.platform] ? h`The quickest way: press <b>Verify instantly</b> and sign in on ${P}. Or put this code in ${WHERE[a.platform]}:` : h`Put this code in ${WHERE[a.platform]}:`}
        <div class="row nw" style="margin-top:8px;gap:8px"><span class="chip" style="font:600 15px var(--f2);letter-spacing:.06em;padding:6px 14px;color:var(--g)">${a.verify_code}</span>${SQ.copyBtn(a.verify_code, 'Copy code')}</div>
        <div class="xs mu" style="margin-top:8px">${a.platform === 'youtube' && yt ? 'Save it. We look for the code in your channel description by ourselves every few minutes. You can also press Check now.' : 'Save it. Our team checks it within about a day and you get a notification.'}</div></div>` : ''}</div>
    <div class="e">${dead ? connectLink(a.platform, 'Reconnect', 'p s') : ''}
      ${byHand && can[a.platform] ? connectLink(a.platform, 'Verify instantly', 'p s') : ''}
      ${a.platform === 'youtube' && yt && a.status === 'pending' && !a.connected ? h`<button type="button" class="btn s" data-act="acct.check" data-id="${a.id}">Check now</button>` : ''}
      ${a.status === 'rejected' ? h`<button type="button" class="btn s" data-act="acct.resubmit" data-id="${a.id}">Send for review again</button>` : ''}
      <button type="button" class="iconbtn sm" data-act="acct.delete" data-id="${a.id}" data-h="${a.handle}" data-conn="${a.connected ? 1 : ''}" title="Remove account" aria-label="Remove @${a.handle}">${icon('trash')}</button></div></div>`;
};

SQ.route('accounts', async ctx => {
  // The platform sends the clipper back here with the result in the address. Keep the message, clean the address, then draw the page.
  if (ctx.q.connected || ctx.q.connect_error) {
    const P = pname(ctx.q.p || ctx.q.connected);
    FLASH = ctx.q.connected ? { good: `${pname(ctx.q.connected)} connected. Your account is verified and its views are counted automatically. You can join campaigns now.` }
      : { bad: (own(WHY, ctx.q.connect_error) || WHY.failed)(P) };
    return SQ.go('accounts', true);
  }
  const me = await SQ.refreshMe(); if (!me) return;
  const list = me.accounts, yt = me.youtube, can = me.connect || {}, anyConnect = !!(can.youtube || can.tiktok || can.instagram);
  const flash = FLASH; FLASH = null;
  ctx.set(h`<div class="ph"><div class="t"><h1>Accounts</h1><p>${anyConnect ? 'Connect the accounts you post clips from. Your views are then counted automatically.' : 'Add the accounts you post clips from. Each one is verified before you can use it in a campaign.'}</p></div></div>
    ${flash && flash.good ? note('ok', 'checkc', h`<b>${flash.good}</b>`) : ''}${flash && flash.bad ? note('bad', 'xc', flash.bad) : ''}
    <div class="two"><div class="col" style="gap:14px">
      ${list.length ? h`<div class="list">${list.map(a => accountRow(a, yt, can))}</div>` : h`<div class="card">${empty('link', 'No accounts yet', anyConnect ? 'Press one of the Connect buttons on the right. It takes about a minute.' : 'Add your first account on the right. It takes a minute.')}</div>`}
    </div>
    <div class="col" style="gap:14px">
      ${anyConnect ? h`<div class="card"><div class="ch"><h3>Connect an account</h3>${chip('Fastest', 'ok')}</div>
        <p class="sm mu" style="margin-bottom:14px">Sign in on the platform and we verify your account on the spot. No code, no waiting. Your views are read from the platform by themselves.</p>
        <div class="col" style="gap:10px">${['youtube', 'tiktok', 'instagram'].filter(k => can[k]).map(k => h`<a class="btn blk" href="/connect/${k}/start" style="justify-content:flex-start">${plat(k, true)}Connect ${pname(k)}</a>`)}</div>
        ${can.instagram ? h`<div class="xs mu" style="margin-top:12px">Instagram needs a Business or Creator account. Switching is free in the Instagram app.</div>` : ''}</div>` : ''}
      <div class="card"><div class="ch"><h3>${anyConnect ? 'Or add an account by hand' : 'Add an account'}</h3></div>
      ${anyConnect ? h`<p class="sm mu" style="margin-bottom:14px">You paste a short code in your bio and our team checks it, usually within a day.</p>` : ''}
      <div id="acctseg" style="margin-bottom:14px"></div>
      <label class="f"><span class="h">Username or profile link</span><input class="in" id="acctname" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="@yourname" data-noenter></label>
      <div id="accterr"></div>
      <button type="button" class="btn blk${anyConnect ? '' : ' p'}" data-act="acct.add">Add account</button></div>
      <div class="card"><div class="ch"><h3>How it works</h3></div>${anyConnect
        ? h`<ol class="sm" style="padding-left:18px;display:grid;gap:10px;color:#cfcfd5">
          <li><b>Connect.</b> Press Connect, sign in on the platform and allow access. Your account is verified on the spot.</li>
          <li>We read your video views from the platform ourselves. You never type them in. Some campaigns also ask for a screen recording of your analytics.</li>
          <li>Rather not sign in? Add the username by hand, put the code in your bio and our team checks it.</li></ol>
          <p class="xs mu" style="margin-top:12px">We can only read your profile and your video numbers. We cannot post, delete or see your password. Removing an account here also removes our access.</p>`
        : h`<ol class="sm" style="padding-left:18px;display:grid;gap:10px;color:#cfcfd5">
          <li>Add your username. We give you a short code.</li>
          <li>Paste the code anywhere in your bio or channel description.</li>
          <li>${yt ? 'YouTube is checked by itself within minutes (or press Check now). TikTok and Instagram are checked by our team, usually within a day.' : 'Our team checks the code in your bio, usually within a day.'}</li>
          <li>Once verified you can join campaigns. You can remove the code afterwards.</li></ol>`}</div></div></div>`);
  paintSeg();
}, 'accounts');

function paintSeg() {
  const s = $('#acctseg'); if (!s) return;
  html(s, SQ.seg([['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['instagram', 'Instagram']], PICK, 'acct.pick'));
}
act('acct.pick', el => { PICK = el.dataset.v; paintSeg(); const i = $('#acctname'); if (i) i.focus(); });
act('acct.add', async () => {
  const box = $('#accterr'); box.innerHTML = '';
  try {
    await post('/api/accounts', { platform: PICK, handle: $('#acctname').value });
    ok('Account added. Now put the code in your bio.'); SQ.reload();
  } catch (e) { if (e.status !== 401) html(box, note('bad', 'alert', e.message)); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'acctname') { e.preventDefault(); const b = $('[data-act="acct.add"]'); if (b) b.click(); } });
act('acct.check', async el => {
  const r = await post(`/api/accounts/${el.dataset.id}/check`);
  if (r.approved) { ok('Account verified. You can join campaigns now.'); await SQ.refreshMe(); SQ.reload(); }
});
act('acct.resubmit', async el => { await post(`/api/accounts/${el.dataset.id}/resubmit`); ok('Sent for review again. You have a new code.'); SQ.reload(); });
act('acct.delete', async el => {
  const c = !!el.dataset.conn;
  if (!await SQ.confirm({ title: `Remove @${el.dataset.h}?`, text: c ? 'We also delete our access to this account. You can connect it again later. It cannot be removed while it has clips in progress.' : 'You can add it again later. It cannot be removed while it has clips in progress.', ok: 'Remove account', kind: 'd' })) return;
  await del('/api/accounts/' + el.dataset.id); ok('Account removed.'); await SQ.refreshMe(); SQ.reload();
});
