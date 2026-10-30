/* Support tickets and the help center. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, date, dtime, ago, chip, note, empty, get, post, act, ok, go } = SQ;

const CATS = { payout: ['Payout', 'wallet'], clip: ['Clip or views', 'film'], account: ['Account', 'link'], campaign: ['Campaign', 'megaphone'], bug: ['Bug or problem', 'alert'], other: ['Something else', 'message'] };
const TIPS = {
  payout: 'Include the payout amount and the date you asked for it. Payouts are sent within 3 to 7 working days and staff are off on Sundays.',
  clip: 'Paste the link of the clip and tell us what looks wrong, for example the views or the status.',
  account: 'Tell us which account is affected (platform and @username) and what happened.',
  campaign: 'Tell us which campaign you mean and what you need to know.',
  bug: 'Tell us what you did, what you expected and what happened instead. A screenshot link helps.',
  other: 'Tell us how we can help.'
};
let TICKETS = [], TFILTER = 'open';

const ticketRow = t => h`<div class="li hv" data-go="#ticket/${t.id}" tabindex="0" role="link"><span style="color:var(--mu2)">${icon((CATS[t.category] || CATS.other)[1])}</span>
  <div class="m"><div class="t">${t.subject}${t.status === 'answered' && t.last_staff ? chip('New reply', 'ok') : ''}</div><div class="d"><span>${(CATS[t.category] || CATS.other)[0]}</span><span>Ticket #${t.id}</span></div></div>
  <div class="e">${SQ.status('ticket', t.status)}<span class="xs mu">${ago(t.updated_at)}</span></div></div>`;
function paintTickets() {
  const open = TICKETS.filter(t => t.status !== 'closed'), closed = TICKETS.filter(t => t.status === 'closed'), rows = TFILTER === 'open' ? open : closed;
  html($('#tktabs'), SQ.tabs([['open', 'Open', open.length], ['closed', 'Closed', closed.length]], TFILTER, 'tk.f'));
  html($('#tklist'), rows.length ? h`<div class="list">${rows.map(ticketRow)}</div>`
    : empty('lifebuoy', TFILTER === 'open' ? 'No open tickets' : 'No closed tickets', TFILTER === 'open' ? 'Questions about payouts, clips or your account? Open a ticket and our team will reply here.' : '', TFILTER === 'open' ? h`<button type="button" class="btn p" data-act="tk.new">${icon('plus')}New ticket</button>` : ''));
}
SQ.route('support', async ctx => {
  TICKETS = await get('/api/tickets'); TFILTER = TICKETS.some(t => t.status !== 'closed') || !TICKETS.length ? 'open' : 'closed';
  ctx.set(h`<div class="ph"><div class="t"><h1>Support</h1><p>Our team replies here and sends you a notification. Check the <a href="#help" style="color:var(--g)">Help center</a> for quick answers.</p></div><button type="button" class="btn p" data-act="tk.new">${icon('plus')}New ticket</button></div><div id="tktabs"></div><div id="tklist"></div>`);
  paintTickets();
}, 'support');
act('tk.f', el => { TFILTER = el.dataset.v; paintTickets(); });
act('tk.new', () => {
  SQ.dialog({
    title: 'Open a ticket', wide: true,
    body: h`<label class="f"><span class="h">What is it about?</span><select class="in" name="category" id="tcat">${Object.entries(CATS).map(([k, v]) => h`<option value="${k}">${v[0]}</option>`)}</select><div class="hint" id="ttip">${TIPS.payout}</div></label>
      <label class="f"><span class="h">Subject</span><input class="in" name="subject" maxlength="100" autocomplete="off" placeholder="A short title"></label>
      <label class="f"><span class="h">Message</span><textarea class="in" name="body" rows="6" maxlength="4000" placeholder="Explain the problem in a few words"></textarea></label>`,
    buttons: [{ text: 'Cancel', kind: 'g', value: false }, {
      text: 'Send ticket', kind: 'p', run: async dm => { const r = await post('/api/tickets', SQ.fields(dm.box)); ok('Ticket sent. We will reply here.'); go('ticket/' + r.id); }
    }]
  });
});
document.addEventListener('change', e => { if (e.target.id === 'tcat') { const t = $('#ttip'); if (t) t.textContent = TIPS[e.target.value] || ''; } });

SQ.route('ticket/:id', async ctx => {
  const r = await get('/api/tickets/' + encodeURIComponent(ctx.params.id)), t = r.ticket, closed = t.status === 'closed';
  ctx.title('Ticket #' + t.id);
  ctx.set(h`<a class="back" href="#support">${icon('chevl')}Support</a>
    <div class="ph"><div class="t"><h1 style="font-size:24px">${t.subject}</h1><div class="row" style="margin-top:8px;gap:8px">${SQ.status('ticket', t.status)}${chip((CATS[t.category] || CATS.other)[0], 'mu')}<span class="xs mu">Ticket #${t.id}, opened ${date(t.created_at)}</span></div></div>
      ${closed ? '' : h`<button type="button" class="btn" data-act="tk.close" data-id="${t.id}">Close ticket</button>`}</div>
    <div class="col" style="gap:12px;margin-bottom:16px" id="thread">${r.messages.map(m => h`<div class="msg ${m.staff ? '' : 'me'}"><div class="who">${m.staff ? h`<b>${m.author}</b> ${chip('Team', 'info')}` : 'You'} ${dtime(m.created_at)}</div><div class="pre">${m.body}</div></div>`)}</div>
    ${closed ? note('info', 'lock', h`<b>This ticket is closed.</b> Open a new ticket if you still need help. <button type="button" class="btn s" style="margin-left:8px" data-act="tk.new">New ticket</button>`)
      : h`<div class="card"><label class="f" style="margin:0"><span class="h">${t.status === 'answered' ? 'Reply to our team' : 'Add more details'}</span><textarea class="in" id="tkreply" rows="4" maxlength="4000" placeholder="Write your message"></textarea></label><div id="tkerr"></div><button type="button" class="btn p" style="margin-top:12px" data-act="tk.reply" data-id="${t.id}">${icon('send')}Send reply</button></div>`}`);
}, 'support');
act('tk.reply', async el => {
  const box = $('#tkerr'); box.innerHTML = '';
  try { await post(`/api/tickets/${el.dataset.id}/reply`, { body: $('#tkreply').value }); ok('Reply sent.'); SQ.reload(); }
  catch (e) { if (e.status !== 401) html(box, note('bad', 'alert', e.message)); }
});
act('tk.close', async el => {
  if (!await SQ.confirm({ title: 'Close this ticket?', text: 'You can open a new ticket any time.', ok: 'Close ticket' })) return;
  await post(`/api/tickets/${el.dataset.id}/close`); ok('Ticket closed.'); go('support');
});

/* ---------- help center ---------- */
const faq = (q, a) => h`<details class="faq"><summary>${q}</summary><div class="pre">${a}</div></details>`;
SQ.route('help', async ctx => {
  const st = SQ.me.settings, L = await SQ.links();
  const min = usd(st.min_payout_cents, { whole: true }), canConnect = !!(SQ.me.connect && Object.values(SQ.me.connect).some(Boolean));
  const viewsAnswer = (connect, auto) => {
    const on = ['youtube', 'tiktok', 'instagram'].filter(k => auto[k]).map(k => SQ.PLAT[k]), off = ['youtube', 'tiktok', 'instagram'].filter(k => !auto[k]).map(k => SQ.PLAT[k]);
    const list = a => a.join(', ').replace(/, ([^,]*)$/, ' and $1');
    const hand = on.length === 3 ? 'For an account you added by hand, the views are read automatically too.'
      : on.length ? `For an account you added by hand, ${list(on)} views are read automatically. ${list(off)} views come from the screen recording of your analytics.`
      : 'For an account you added by hand, the views come from the screen recording of your analytics, so make sure the numbers are clearly visible.';
    return (connect ? 'When you connect an account, we read the views of its clips from YouTube, TikTok or Instagram by ourselves, so you never type them in. ' : '') + hand;
  };
  const methods = Object.keys(SQ.METHODS).filter(k => st.methods[k]).map(k => SQ.METHODS[k]).join(', ');
  ctx.set(h`<div class="ph"><div class="t"><h1>Help center</h1><p>Short answers to the questions clippers ask most.</p></div><a class="btn p" href="#support">${icon('lifebuoy')}Contact support</a></div>
    <div class="g4" style="margin-bottom:18px">${[
      ['user', 'Connect an account', canConnect ? 'Sign in with YouTube, TikTok or Instagram. It is verified at once.' : 'Add your username and put the code in your bio.'], ['megaphone', 'Join a campaign', 'Read the rate, budget and rules first.'],
      ['upload', 'Post and submit', 'Post the clip on your account and paste its link.'], ['wallet', 'Get paid', 'Earnings reach your wallet when tracking ends.']
    ].map(([i, t, s]) => h`<div class="card"><div style="color:var(--g)">${icon(i)}</div><div class="b" style="margin:8px 0 4px">${t}</div><div class="sm mu">${s}</div></div>`)}</div>
    <div class="two"><div class="col" style="gap:10px">
      ${faq('How do I earn money?', 'Every campaign pays a rate per 1,000 views, for example $1.00 per 1,000 views. When a clip passes the rules check, its views are counted for the campaign tracking window (7 days unless the campaign says otherwise). When the window ends, the money goes to your wallet.')}
      ${faq('When can I withdraw?', `Once your balance is at least ${min}. ${st.payout_note || ''} You can have one payout request open at a time.`)}
      ${faq('Which payout methods can I use?', methods ? `${methods}. EasyPaisa and JazzCash are paid in Pakistani rupees at our rate on the day we send the money.` : 'Payouts are paused right now.')}
      ${faq('How are my views counted?', viewsAnswer(canConnect, SQ.me.auto || {}))}
      ${faq('Why do you ask for audience analytics?', 'A screen recording of your audience analytics (views, countries, age and gender) shows that the views are real and have not been edited. We only ask after your clip passes the rules check. If the recording is unclear we ask you to send it again.')}
      ${faq('How do I record my screen?', 'On a computer, open the clip page and press Record my screen. Choose Entire screen, then open your analytics, show the views and the audience tabs, and come back to press Stop. On a phone, use the built-in screen recorder (iPhone: Control Center, Screen Recording. Android: Quick settings, Screen record), then upload the video on the clip page. The limit is 80 MB. One to three minutes is enough. Please do not cut or edit it.')}
      ${faq('Why was my clip rejected?', 'The reason is on the clip page and in your notifications. Common reasons are posting on an account that is not connected, submitting after the time limit, or content that breaks the campaign rules or the Clipper Guidelines. If you disagree, open a ticket.')}
      ${faq('Can I connect more than one account?', 'Yes, up to 10. Connecting an account verifies it on the spot. An account added by hand is verified with a code in its bio, and it must be public. An account can only belong to one clipper.')}
      ${canConnect ? faq('Is it safe to connect my account?', 'We only ask to read your profile and your video numbers. We cannot post, delete or change anything, and we never see your password. Our access is stored encrypted and is deleted when you remove the account in the portal. You can also remove our app in your YouTube (Google account security), TikTok or Instagram settings at any time.') : ''}
      ${faq('What are ranks?', 'Your rank grows with the views counted on your approved clips: Noob, Rookie (1,200 views), Clipper (5,000), Pro (20,000) and Elite (100,000).')}
      ${faq('Can I delete a clip I submitted?', 'Only before our team reviews it. Open the clip and press Remove. After review, open a support ticket.')}</div>
    <div class="col sticky" style="gap:14px"><div class="card"><div class="ch"><h3>Still need help?</h3></div><p class="sm mu" style="margin-bottom:14px">Open a ticket and our team replies in the portal. Staff are off on Sundays.</p><a class="btn p blk" href="#support">Open a ticket</a>
      ${L.discord ? h`<a class="btn blk" style="margin-top:10px" href="${L.discord}" target="_blank" rel="noopener">${icon('discord')}Join the Discord server</a>` : ''}</div>
      <div class="card"><div class="ch"><h3>Rules to know</h3></div><div class="col" style="gap:10px"><a href="/clipper-guidelines" target="_blank" rel="noopener" style="color:var(--g)">Clipper Guidelines ${icon('ext')}</a><a href="/content-standards" target="_blank" rel="noopener" style="color:var(--g)">Content Standards ${icon('ext')}</a><a href="/terms" target="_blank" rel="noopener" style="color:var(--g)">Terms ${icon('ext')}</a></div></div></div></div>`);
}, 'help');
