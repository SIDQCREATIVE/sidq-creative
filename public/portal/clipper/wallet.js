/* Wallet: balance, payout methods, payout requests and the money history. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, date, dtime, ago, chip, note, empty, stat, get, post, del, act, ok, go } = SQ;

const LEDGER = { earning: ['Clip earnings', 'film'], referral: ['Referral bonus', 'users'], bonus: ['Bonus', 'gift'], adjustment: ['Adjustment', 'sliders'], payout: ['Payout request', 'upload'], payout_refund: ['Payout returned', 'undo'] };
let WALLET = null;

const methodFields = type => ({
  paypal: h`<label class="f"><span class="h">PayPal email</span><input class="in" name="email" type="email" autocomplete="off" placeholder="you@example.com"></label>`,
  usdt: h`<label class="f"><span class="h">Network</span><select class="in" name="network"><option value="TRC20">TRC20 (Tron)</option><option value="BEP20">BEP20 (BNB Smart Chain)</option><option value="ERC20">ERC20 (Ethereum)</option></select></label>
    <label class="f"><span class="h">Wallet address</span><input class="in" name="address" autocomplete="off" spellcheck="false" placeholder="Paste your USDT address"><div class="hint">Check the address and the network twice. Crypto sent to the wrong address cannot be recovered.</div></label>`,
  bank: h`<label class="f"><span class="h">Account holder name</span><input class="in" name="holder" autocomplete="off"></label>
    <div class="g2"><label class="f"><span class="h">Bank name</span><input class="in" name="bank" autocomplete="off"></label><label class="f"><span class="h">Country</span><input class="in" name="country" autocomplete="off"></label></div>
    <label class="f"><span class="h">IBAN or account number</span><input class="in" name="account" autocomplete="off" spellcheck="false"></label>
    <label class="f"><span class="h">SWIFT or BIC code (optional)</span><input class="in" name="swift" autocomplete="off" spellcheck="false"></label>`,
  easypaisa: h`<label class="f"><span class="h">Account holder name</span><input class="in" name="holder" autocomplete="off"></label><label class="f"><span class="h">EasyPaisa mobile number</span><input class="in" name="phone" inputmode="tel" autocomplete="off" placeholder="0300 1234567"></label>`,
  jazzcash: h`<label class="f"><span class="h">Account holder name</span><input class="in" name="holder" autocomplete="off"></label><label class="f"><span class="h">JazzCash mobile number</span><input class="in" name="phone" inputmode="tel" autocomplete="off" placeholder="0300 1234567"></label>`
})[type] || '';

function addMethod(w) {
  const types = Object.keys(SQ.METHODS).filter(k => w.enabled[k]);
  if (!types.length) return SQ.toast('Payouts are paused right now. Please check back later.', 'warn');
  const m = SQ.dialog({
    title: 'Add a payout method',
    body: h`<label class="f"><span class="h">Method</span><select class="in" name="type" id="mtype">${types.map(k => h`<option value="${k}">${SQ.METHODS[k]}</option>`)}</select></label><div id="mfields">${methodFields(types[0])}</div>
      <div class="hint">Only our finance team can see your full payment details.</div>`,
    buttons: [{ text: 'Cancel', kind: 'g', value: false }, {
      text: 'Save method', kind: 'p', run: async dm => {
        await post('/api/wallet/methods', SQ.fields(dm.box)); ok('Payout method saved.');
        WALLET = await get('/api/wallet'); SQ.reload();
        if (dm.opt.thenRequest) setTimeout(() => requestPayout(), 60);
      }
    }]
  });
  return m;
}
document.addEventListener('change', e => { if (e.target.id === 'mtype') html($('#mfields'), methodFields(e.target.value)); });

function requestPayout() {
  const w = WALLET, min = w.min_payout_cents;
  if (!w.methods.length) { const m = addMethod(w); if (m) m.opt.thenRequest = true; return; }
  const open = w.payouts.find(p => p.status === 'requested' || p.status === 'processing');
  if (open) return SQ.toast('You already have a payout in progress. Wait until it is finished.', 'warn');
  if (w.balance_cents < min) return SQ.toast(`You need at least ${usd(min, { whole: true })} to cash out. Your balance is ${usd(w.balance_cents)}.`, 'warn');
  SQ.dialog({
    title: 'Request a payout',
    body: h`<div class="note ok" style="margin-bottom:16px">${icon('wallet')}<div class="x">Available to withdraw: <b>${usd(w.balance_cents)}</b></div></div>
      <label class="f"><span class="h">Amount in US dollars</span><div class="row nw" style="gap:8px"><input class="in" name="amount" inputmode="decimal" autocomplete="off" placeholder="${(min / 100).toFixed(2)}" style="flex:1"><button type="button" class="btn" data-act="wallet.max" data-v="${(w.balance_cents / 100).toFixed(2)}">Max</button></div><div class="hint">Minimum ${usd(min, { whole: true })}.</div></label>
      <label class="f"><span class="h">Send it to</span><select class="in" name="method_id">${w.methods.map(x => h`<option value="${x.id}">${x.title}, ${x.sub}</option>`)}</select><div class="hint">${w.note || ''} EasyPaisa and JazzCash payouts are sent in Pakistani rupees at our rate on the day we send them.</div></label>`,
    buttons: [{ text: 'Cancel', kind: 'g', value: false }, {
      text: 'Request payout', kind: 'p', run: async dm => {
        const f = SQ.fields(dm.box), inp = $('[name=amount]', dm.box), body = { method_id: +f.method_id };
        if (inp.dataset.all) body.all = true; else { if (!String(f.amount).trim()) throw new Error('Enter the amount you want to withdraw.'); body.amount = f.amount; }
        await post('/api/wallet/payout', body); ok('Payout requested. We will update you here.');
        await SQ.refreshMe(); SQ.reload();
      }
    }]
  });
}
document.addEventListener('input', e => { if (e.target.name === 'amount' && e.target.dataset.all) delete e.target.dataset.all; });
act('wallet.max', el => { const i = $('[name=amount]', el.closest('.modal')); i.value = el.dataset.v; i.dataset.all = '1'; i.focus(); });
act('wallet.request', () => requestPayout());
act('wallet.addmethod', () => { addMethod(WALLET); });
act('wallet.delmethod', async el => {
  if (!await SQ.confirm({ title: 'Remove this payout method?', text: 'You can add it again later. Payouts already requested are not affected.', ok: 'Remove', kind: 'd' })) return;
  await del('/api/wallet/methods/' + el.dataset.id); ok('Payout method removed.'); SQ.reload();
});
act('wallet.cancel', async el => {
  if (!await SQ.confirm({ title: 'Cancel this payout?', text: 'The money goes back to your wallet and you can request it again.', ok: 'Cancel payout', cancel: 'Keep it', kind: 'd' })) return;
  await post(`/api/wallet/payouts/${el.dataset.id}/cancel`); ok('Payout cancelled. The money is back in your wallet.'); await SQ.refreshMe(); SQ.reload();
});

const payoutRow = p => h`<div class="li" style="grid-template-columns:minmax(0,1fr) auto"><div class="m"><div class="t">${p.title}${SQ.status('payout', p.status)}</div>
    <div class="d"><span>${p.sub}</span><span>Requested ${date(p.created_at)}</span>${p.paid_at ? h`<span>Sent ${date(p.paid_at)}</span>` : ''}${p.tx_ref ? h`<span>Reference: ${p.tx_ref}</span>` : ''}</div>
    ${p.status === 'rejected' && p.note ? h`<div class="sm" style="margin-top:6px;color:var(--bad)">${p.note}</div>` : ''}</div>
  <div class="e"><b class="num" style="font-size:17px">${usd(p.amount_cents)}</b>${p.status === 'requested' ? h`<button type="button" class="btn s" data-act="wallet.cancel" data-id="${p.id}">Cancel</button>` : ''}</div></div>`;
const ledgerRow = l => { const t = LEDGER[l.type] || [l.type, 'dollar']; return h`<div class="li" style="grid-template-columns:auto minmax(0,1fr) auto;padding:12px 18px"><span style="color:var(--mu2)">${icon(t[1])}</span><div class="m"><div class="t" style="font-weight:500">${t[0]}</div><div class="d"><span class="trunc">${l.submission_id ? h`<a href="#clip/${l.submission_id}" style="color:var(--mu)">${l.note || 'Clip'}</a>` : l.note}</span><span>${ago(l.at)}</span></div></div>
  <b class="num" style="color:${l.amount_cents > 0 ? 'var(--g)' : 'var(--tx)'}">${usd(l.amount_cents, { sign: true })}</b></div>`; };

SQ.route('wallet', async ctx => {
  const w = WALLET = await get('/api/wallet');
  const wb = $('#walbal'); if (wb) wb.textContent = usd(w.balance_cents);
  const open = w.payouts.find(p => p.status === 'requested' || p.status === 'processing');
  const can = w.balance_cents >= w.min_payout_cents && !open;
  ctx.set(h`<div class="ph"><div class="t"><h1>Wallet</h1><p>${w.note || ''}</p></div><button type="button" class="btn p" data-act="wallet.request" ${can ? '' : 'disabled'}>${icon('upload')}Request payout</button></div>
    ${open ? note('info', 'clock', h`<b>Your payout of ${usd(open.amount_cents)} is ${open.status === 'processing' ? 'being processed' : 'waiting for our team'}.</b> You will get a notification when it is sent.${open.status === 'requested' ? h` <button type="button" class="btn s" style="margin-left:8px" data-act="wallet.cancel" data-id="${open.id}">Cancel payout</button>` : ''}`) : ''}
    ${!open && w.balance_cents > 0 && w.balance_cents < w.min_payout_cents ? note('info', 'info', h`You can cash out once your balance reaches <b>${usd(w.min_payout_cents, { whole: true })}</b>. You need ${usd(w.min_payout_cents - w.balance_cents)} more.`) : ''}
    <div class="g4" style="margin-bottom:14px">
      ${stat('Available balance', usd(w.balance_cents), 'Ready to withdraw', { hero: true, g: true, icon: 'wallet' })}
      ${stat('Pending earnings', usd(w.pending_cents), 'Estimated from clips still counting views', { icon: 'clock' })}
      ${stat('Total earned', usd(w.earned_cents), 'Everything credited to your wallet', { icon: 'trend' })}
      ${stat('Paid out', usd(w.paid_cents), 'Sent to your payout methods', { icon: 'dollar' })}
    </div>
    <div class="two"><div class="col" style="gap:14px">
      <div class="card pad0"><div class="ch" style="padding:20px 20px 0"><h3>Payout history</h3></div>${w.payouts.length ? h`<div class="list" style="border:0;border-radius:0">${w.payouts.map(payoutRow)}</div>` : empty('receipt', 'No payouts yet', 'When you request a payout it shows up here with its status.')}</div>
      <div class="card pad0"><div class="ch" style="padding:20px 20px 0"><h3>Wallet activity</h3></div>${w.ledger.length ? h`<div class="list" style="border:0;border-radius:0">${w.ledger.map(ledgerRow)}</div>` : empty('list', 'No activity yet', 'Earnings and payouts are listed here.')}</div></div>
    <div class="col sticky" style="gap:14px"><div class="card"><div class="ch"><h3>Payout methods</h3><button type="button" class="btn s" data-act="wallet.addmethod">${icon('plus')}Add</button></div>
      ${w.methods.length ? h`<div class="col" style="gap:10px">${w.methods.map(m => h`<div class="row nw" style="gap:12px;border:1px solid var(--line);border-radius:12px;padding:12px 14px"><span style="color:var(--g)">${icon('card')}</span><div class="m trunc" style="flex:1"><div class="b trunc">${m.title}</div><div class="xs mu trunc">${m.sub}</div></div><button type="button" class="iconbtn sm" data-act="wallet.delmethod" data-id="${m.id}" title="Remove" aria-label="Remove ${m.title}">${icon('trash')}</button></div>`)}</div>`
        : h`<p class="sm mu">Add where you want to be paid: ${Object.keys(SQ.METHODS).filter(k => w.enabled[k]).map(k => SQ.METHODS[k]).join(', ')}.</p>`}</div>
      <div class="card"><div class="ch"><h3>Good to know</h3></div><ul class="sm" style="padding-left:18px;display:grid;gap:8px;color:#cfcfd5"><li>Minimum payout is <b>${usd(w.min_payout_cents, { whole: true })}</b>.</li><li>One payout request at a time.</li><li>Money from a clip arrives when its tracking window ends.</li><li>Need help with a payout? <a href="#support" style="color:var(--g)">Open a ticket</a>.</li></ul></div></div></div>`);
}, 'wallet');
