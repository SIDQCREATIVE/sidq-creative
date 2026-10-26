/* Support: the ticket queue and one ticket with reply shortcuts. */
const SQ = window.SQ;
const { h, $, html, icon, usd, date, dtime, ago, chip, note, empty, get, post, act, ok, go, qs, avatar } = SQ;

const CATS = { payout: 'Payout', clip: 'Clip or views', account: 'Account', campaign: 'Campaign', bug: 'Bug or problem', other: 'Something else' };
const CANNED = [
  ['Payout timing', 'Hi! Payouts are sent within 3 to 7 working days after you ask for them, and our team is off on Sundays. Yours is in the queue and you will get a notification as soon as it is sent.'],
  ['Analytics recording', 'Hi! To verify your clip, please record your screen while you open its analytics. Show your username, the views, then the top countries, age and gender. Open the clip page and press Record my screen. On a phone, use the built-in screen recorder and upload the video there. Please do not cut or edit it. Thank you!'],
  ['Account code', 'Hi! To verify your account, paste the code shown in Accounts into your bio or channel description and keep it there until we approve it. After that you can remove it.'],
  ['Clip rejected', 'Hi! Your clip was rejected because it did not follow the campaign rules. The reason is on the clip page. You are welcome to submit a new clip that follows the rules.'],
  ['Closing', 'Thanks for reaching out! I am closing this ticket now. If you still need help, open a new ticket any time.']
];

const TK = { status: 'waiting', q: '', page: 1 };
const short = (s, n) => String(s || '').length > n ? String(s).slice(0, n - 1) + '...' : String(s || '');
const ticketRow = t => h`<div class="li hv" data-go="#ticket/${t.id}" tabindex="0" role="link"><div>${avatar({ username: t.username, avatar: t.avatar }, 'md')}</div>
  <div class="m"><div class="t">${t.subject}${t.status === 'open' ? SQ.waiting(t.updated_at, 'Waiting') : ''}</div><div class="d"><span>${t.username}</span><span>${CATS[t.category] || t.category}</span><span>Ticket #${t.id}</span></div>
    <div class="sm mu trunc" style="margin-top:6px;max-width:640px">${t.last_staff ? 'You: ' : ''}${short(t.last_body, 140)}</div></div>
  <div class="e">${SQ.status('tickets', t.status)}<span class="xs mu">${ago(t.updated_at)}</span></div></div>`;
async function loadTickets() {
  const box = $('#tklist'); if (!box) return;
  SQ.busy(box, true);
  let r; try { r = await get('/api/staff/tickets' + qs({ status: TK.status, q: TK.q, page: TK.page > 1 ? TK.page : '' })); } catch (e) { SQ.busy(box, false); return SQ.err(e); }
  SQ.busy(box, false);
  const c = r.counts, n = k => c[k] || 0;
  html($('#tktabs'), SQ.tabs([['waiting', 'Needs a reply', n('open'), n('open') > 0], ['open', 'All open', n('open') + n('answered')], ['closed', 'Closed', n('closed')]], TK.status, 'tk.status'));
  html(box, r.tickets.length ? h`<div class="list">${r.tickets.map(ticketRow)}</div>${SQ.pager(r, 'tk.page')}` : empty('lifebuoy', TK.q ? 'Nothing matches that search' : TK.status === 'waiting' ? 'No tickets need a reply' : 'No tickets here', TK.status === 'waiting' && !TK.q ? 'Clippers write to you from the Support page of their portal.' : ''));
}
SQ.route('tickets', async ctx => {
  Object.assign(TK, { status: ['waiting', 'open', 'closed'].includes(ctx.q.status) ? ctx.q.status : 'waiting', q: ctx.q.q || '', page: 1 });
  ctx.set(h`${SQ.head('Support', 'Questions from clippers. The oldest ticket that needs a reply is at the top.')}<div id="tktabs"></div>${SQ.bar2(SQ.searchBox('tk', TK.q, 'Search by clipper or subject'))}<div id="tklist" style="transition:opacity .15s"></div>`);
  await loadTickets();
}, 'tickets');
act('tk.status', el => { TK.status = el.dataset.v; TK.page = 1; return loadTickets(); });
act('tk.page', el => { TK.page = +el.dataset.page; window.scrollTo(0, 0); return loadTickets(); });
SQ.onSearch('tk', v => { TK.q = v; TK.page = 1; return loadTickets().catch(SQ.err); });

/* ---------- one ticket ---------- */
const CURT = { t: null };
SQ.route('ticket/:id', async ctx => {
  const r = await get('/api/staff/tickets/' + encodeURIComponent(ctx.params.id)), t = r.ticket, closed = t.status === 'closed'; CURT.t = t;
  ctx.title('Ticket #' + t.id);
  ctx.set(h`<a class="back" href="#tickets">${icon('chevl')}Support</a>
    <div class="ph"><div class="t"><h1 style="font-size:24px">${t.subject}</h1><div class="row" style="margin-top:8px;gap:8px">${SQ.status('tickets', t.status)}${chip(CATS[t.category] || t.category, 'mu')}<span class="xs mu">Ticket #${t.id}, opened ${date(t.created_at)}</span></div></div>
      ${closed ? h`<button type="button" class="btn" data-act="tk.reopen">Reopen ticket</button>` : h`<button type="button" class="btn" data-act="tk.close">Close ticket</button>`}</div>
    <div class="two"><div><div class="col" style="gap:12px;margin-bottom:16px">${r.messages.map(m => h`<div class="msg ${m.staff ? 'me' : ''}"><div class="who">${m.staff ? h`<b>${m.author}</b> ${chip('Team', 'info')}` : h`<b>${m.author || t.username}</b>`} ${dtime(m.created_at)}</div><div class="pre">${m.body}</div></div>`)}</div>
      <div class="card"><div class="xs mu" style="margin-bottom:8px">Quick replies. Click one to start from it, then edit.</div><div class="row" style="gap:8px;margin-bottom:12px">${CANNED.map((c, i) => h`<button type="button" class="chip" style="cursor:pointer" data-act="tk.canned" data-i="${i}">${c[0]}</button>`)}</div>
        <label class="f" style="margin:0"><span class="h">${closed ? 'Reply and reopen' : 'Your reply'}</span><textarea class="in" id="tkreply" rows="6" maxlength="4000" placeholder="Write to ${t.username}. They get a notification."></textarea></label>
        <div class="row" style="gap:10px;margin-top:12px"><button type="button" class="btn p" data-act="tk.reply">${icon('send')}Send reply</button>${closed ? '' : h`<button type="button" class="btn" data-act="tk.reply" data-close="1">Send and close</button>`}</div></div></div>
      <div class="col sticky" style="gap:14px"><div class="card"><div class="ch"><h3>Clipper</h3></div><div class="row nw" style="gap:12px;margin-bottom:12px">${SQ.who({ id: t.user_id, username: t.username, avatar: t.avatar }, 'md')}</div>
        ${r.balance_cents != null ? h`<dl class="kv" style="grid-template-columns:100px 1fr"><dt>Wallet</dt><dd><b class="num">${usd(r.balance_cents)}</b></dd></dl>` : ''}
        ${SQ.can('users') ? h`<a class="btn blk" style="margin-top:12px" href="#clipper/${t.user_id}">Open their page</a>` : ''}</div></div></div>`);
}, 'tickets');
act('tk.canned', el => { const box = $('#tkreply'), txt = CANNED[+el.dataset.i][1]; box.value = box.value.trim() ? box.value.trim() + '\n\n' + txt : txt; box.focus(); });
act('tk.reply', async el => {
  const body = $('#tkreply').value.trim(), close = el.dataset.close === '1';
  if (body.length < 2) throw new Error('Write your reply first.');
  await post(`/api/staff/tickets/${CURT.t.id}/reply`, { body, close }); SQ.pingBadges();
  if (close) { ok('Reply sent and ticket closed.'); go('tickets'); } else { ok('Reply sent.'); SQ.reload(); }
});
act('tk.close', async () => { await post(`/api/staff/tickets/${CURT.t.id}/close`, {}); ok('Ticket closed.'); SQ.pingBadges(); go('tickets'); });
act('tk.reopen', async () => { await post(`/api/staff/tickets/${CURT.t.id}/reopen`, {}); ok('Ticket reopened.'); SQ.pingBadges(); SQ.reload(); });
