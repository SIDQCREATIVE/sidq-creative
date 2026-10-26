/* Payouts: the queue finance works through. Payout details can be copied one field at a time. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, date, ago, chip, plat, note, empty, get, post, act, ok, qs } = SQ;

const PY = { status: 'open', q: '', page: 1, rows: [], rate: 280 };
const FIELD = { email: 'PayPal email', network: 'Network', address: 'Wallet address', holder: 'Account holder', bank: 'Bank', account: 'IBAN or account number', country: 'Country', swift: 'SWIFT code', phone: 'Mobile number' };
const label = k => FIELD[k] || k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const pkrText = p => p.pkr != null ? 'PKR ' + num(p.pkr) : '';

const payCard = p => {
  const m = p.method, u = p.user, open = p.status === 'requested' || p.status === 'processing';
  return h`<div class="card pay"><div class="pay-who"><div class="row nw" style="gap:12px">${SQ.who({ id: u.id, username: u.username, avatar: u.avatar }, 'md')}</div>
      <div class="row" style="gap:6px;margin:12px 0 4px">${u.paid_before === 0 ? chip('First payout', 'info', 'star') : chip(SQ.plural(u.paid_before, 'payout') + ' paid before', 'mu')}${u.rejected_clips ? chip(SQ.plural(u.rejected_clips, 'rejected clip'), 'warn', 'flag') : ''}</div>
      <div class="xs mu">Joined ${date(u.joined)}. Wallet after this payout: ${usd(u.balance_cents)}</div></div>
    <div class="pay-m"><div class="row" style="gap:8px;margin-bottom:10px"><b>${m.name || SQ.METHODS[p.type] || p.type}</b></div>
      ${m.error ? note('warn', 'alert', m.error) : h`<div class="col" style="gap:8px">${(m.fields || []).map(([k, v]) => SQ.copyLine(label(k), v))}</div>`}</div>
    <div class="pay-a"><div class="amt num">${usd(p.amount_cents)}</div>${p.pkr != null ? h`<div class="sm" style="color:var(--g)">${pkrText(p)} <span class="xs mu">at ${PY.rate} per $1</span></div>` : ''}
      <div class="row" style="gap:8px;margin:8px 0 12px;justify-content:flex-end">${SQ.status('payout', p.status)}<span class="xs mu">${open ? 'Asked ' + ago(p.created_at) : p.status === 'paid' ? 'Paid ' + ago(p.paid_at) : ago(p.updated_at)}</span></div>
      ${open ? h`<div class="col" style="gap:8px"><button type="button" class="btn p" data-act="py.paid" data-id="${p.id}">Mark as paid</button>${p.status === 'requested' ? h`<button type="button" class="btn" data-act="py.processing" data-id="${p.id}">Start processing</button>` : ''}<button type="button" class="btn d" data-act="py.reject" data-id="${p.id}">Reject</button></div>`
        : h`${p.tx_ref ? h`<div class="xs mu">Reference</div><div class="sm mono" style="word-break:break-all">${p.tx_ref}</div>` : ''}${p.note ? h`<div class="xs mu" style="margin-top:6px">${p.note}</div>` : ''}`}</div></div>`;
};

async function loadPayouts() {
  const box = $('#pylist'); if (!box) return;
  SQ.busy(box, true);
  let r; try { r = await get('/api/staff/payouts' + qs({ status: PY.status, q: PY.q, page: PY.page > 1 ? PY.page : '' })); } catch (e) { SQ.busy(box, false); return SQ.err(e); }
  SQ.busy(box, false); PY.rows = r.payouts; PY.rate = r.pkr_rate;
  const c = r.counts, g = k => c[k] || { n: 0, cents: 0 };
  const openN = g('requested').n + g('processing').n, openC = g('requested').cents + g('processing').cents;
  html($('#pystats'), h`${SQ.stat('Waiting to be sent', usd(openC), openN ? SQ.plural(openN, 'payout') + ' open' : 'Nothing open', { icon: 'wallet', hero: openN > 0 })}${SQ.stat('Processing', usd(g('processing').cents), SQ.plural(g('processing').n, 'payout') + ' in progress', { icon: 'clock' })}${SQ.stat('Paid in total', usd(g('paid').cents, { whole: true }), SQ.plural(g('paid').n, 'payout'), { icon: 'checkc', g: true })}${SQ.stat('EasyPaisa and JazzCash rate', 'PKR ' + r.pkr_rate, 'For every $1 sent' + (SQ.can('settings') ? '' : ''), { icon: 'dollar' })}`);
  html($('#pytabs'), SQ.tabs([['open', 'Open', openN, openN > 0], ['requested', 'Requested', g('requested').n], ['processing', 'Processing', g('processing').n], ['paid', 'Paid', g('paid').n], ['rejected', 'Rejected', g('rejected').n], ['cancelled', 'Cancelled', g('cancelled').n]], PY.status, 'py.status'));
  html(box, r.payouts.length ? h`<div class="col" style="gap:14px">${r.payouts.map(payCard)}</div>${SQ.pager(r, 'py.page')}` : empty('wallet', PY.q ? 'Nothing matches that name' : PY.status === 'open' ? 'No payouts to send' : 'Nothing here', PY.status === 'open' && !PY.q ? 'When a clipper asks for a payout it shows up here.' : ''));
}
SQ.route('payouts', async ctx => {
  Object.assign(PY, { status: ['open', 'requested', 'processing', 'paid', 'rejected', 'cancelled'].includes(ctx.q.status) ? ctx.q.status : 'open', q: ctx.q.q || '', page: 1 });
  ctx.set(h`${SQ.head('Payouts', 'Send the money, then mark it as paid so the clipper is told. Staff are off on Sundays.', h`<button type="button" class="btn" data-act="py.csv">${icon('download')}Export CSV</button>`)}
    <div class="g4" id="pystats" style="margin-bottom:18px"></div><div id="pytabs"></div>${SQ.bar2(SQ.searchBox('pay', PY.q, 'Search by clipper name'))}<div id="pylist" style="transition:opacity .15s"></div>`);
  await loadPayouts();
}, 'payouts');
act('py.status', el => { PY.status = el.dataset.v; PY.page = 1; return loadPayouts(); });
act('py.page', el => { PY.page = +el.dataset.page; window.scrollTo(0, 0); return loadPayouts(); });
SQ.onSearch('pay', v => { PY.q = v; PY.page = 1; return loadPayouts().catch(SQ.err); });
act('py.csv', () => SQ.download('/api/staff/payouts.csv' + qs({ status: PY.status, q: PY.q }), 'sidq-payouts.csv'));
const find = id => PY.rows.find(x => x.id === +id);
const after = msg => { ok(msg); SQ.pingBadges(); return loadPayouts(); };

act('py.processing', async el => { await post(`/api/staff/payouts/${el.dataset.id}/processing`, {}); await after('Marked as processing. The clipper was told.'); });
act('py.paid', el => {
  const p = find(el.dataset.id); if (!p) return;
  SQ.dialog({
    title: 'Mark as paid',
    body: h`<p class="mu" style="margin-bottom:14px">Send <b>${usd(p.amount_cents)}</b>${p.pkr != null ? h` (<b>${pkrText(p)}</b>)` : ''} to <b>${p.user.username}</b> by ${p.method.name || p.type} first. Then record it here and the clipper gets a notification.</p>
      <label class="f"><span class="h">Transaction reference (optional)</span><input class="in" name="tx_ref" maxlength="120" autocomplete="off" placeholder="Transaction ID, hash or receipt number"></label>
      <label class="f"><span class="h">Note (optional)</span><input class="in" name="note" maxlength="300" autocomplete="off" placeholder="Only staff see this"></label>`,
    buttons: [{ text: 'Cancel', kind: 'g', value: false }, { text: 'I sent it, mark as paid', kind: 'p', run: async dm => { const f = SQ.fields(dm.box); await post(`/api/staff/payouts/${p.id}/paid`, { tx_ref: f.tx_ref, note: f.note }); await after('Marked as paid. The clipper was told.'); } }]
  });
});
act('py.reject', async el => {
  const p = find(el.dataset.id); if (!p) return;
  const done = await SQ.reason({ title: 'Reject this payout', label: 'Reason for the clipper', text: `${usd(p.amount_cents)} goes back to their wallet and they see this reason.`, presets: SQ.REASONS.payout, ok: 'Reject payout', kind: 'd' }, v => post(`/api/staff/payouts/${p.id}/reject`, { reason: v }));
  if (done) await after('Payout rejected. The money is back in the wallet.');
});
