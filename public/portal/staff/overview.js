/* Staff overview: what needs a person right now, the numbers, and what happened recently. Shows only what the role may see. */
const SQ = window.SQ;
const { h, html, icon, usd, num, compact, ago, chip, get, dayLabel, barChart, usdAxis, span } = SQ;

const greeting = name => {
  const hr = new Date().getHours(), first = String(name || '').split(/[\s._-]/)[0] || 'there';
  return (hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + ', ' + first;
};
const todo = (href, ic, n, label, sub, hot) => h`<a class="card todo ${n ? 'on' : ''} ${hot ? 'hot' : ''}" href="${href}">${icon(ic)}<div class="n num">${num(n)}</div><div class="b">${label}</div><div class="xs mu">${sub || (n ? '' : 'Nothing waiting')}</div></a>`;
const old = hrs => hrs > 1 ? 'Oldest waiting ' + span(hrs * 3600) : '';
const series = rows => rows.map(x => ({ x: dayLabel(x.d), full: dayLabel(x.d, true), y: x.v }));

SQ.route('overview', async ctx => {
  const o = await get('/api/staff/overview'), r = o.review, p = o.payouts, s = o.support, u = o.users, lead = o.leads;
  SQ.refreshBadges();
  const tiles = [];
  if (r) tiles.push(todo('#clips?stage=review', 'film', r.review, 'Clips to review', old(r.oldest_hours), r.oldest_hours > 24 && r.review), todo('#clips?stage=checking', 'eye', r.checking, 'Analytics to check', r.analytics ? r.analytics + ' more waiting on clippers' : ''), todo('#accounts', 'usercheck', r.accounts, 'Accounts to verify', ''));
  if (p) tiles.push(todo('#payouts', 'wallet', p.open, 'Payouts to send', p.open ? usd(p.open_cents) + (p.oldest_hours > 1 ? ', ' + old(p.oldest_hours).toLowerCase() : '') : '', p.oldest_hours > 72 && p.open));
  if (s) tiles.push(todo('#tickets', 'lifebuoy', s.waiting, 'Tickets to answer', s.open > s.waiting ? s.open - s.waiting + ' answered, not closed' : ''));
  if (lead) tiles.push(todo('#leads', 'inbox', lead.customers + lead.clippers, 'New applications', lead.customers || lead.clippers ? lead.customers + ' customers, ' + lead.clippers + ' clippers' : ''));
  const open = tiles.length ? [r && r.review + r.checking + r.accounts, p && p.open, s && s.waiting, lead && lead.customers + lead.clippers].reduce((a, n) => a + (n || 0), 0) : 0;

  const stats = [];
  if (o.views != null) stats.push(SQ.stat('Views counted', compact(o.views), 'Across all approved clips', { icon: 'eye' }));
  if (o.campaigns) stats.push(SQ.stat('Live campaigns', num(o.campaigns.live), o.campaigns.draft ? num(o.campaigns.draft) + ' in draft' : 'No drafts', { icon: 'megaphone' }));
  if (u) stats.push(SQ.stat('Clippers', num(u.total), `${num(u.new7)} new this week, ${num(u.active24)} active today`, { icon: 'users' }));
  if (p) stats.push(SQ.stat('Paid out, last 30 days', usd(p.paid30_cents, { whole: true }), usd(p.paid_cents, { whole: true }) + ' paid in total', { icon: 'dollar', g: true }), SQ.stat('Owed in wallets', usd(p.wallets_cents, { whole: true }), 'Clipper balances waiting to be withdrawn', { icon: 'wallet' }));

  const charts = [], nch = [o.clips_series, o.signups_series, o.paid_series].filter(Boolean).length, cw = nch > 2 ? 340 : 560;
  if (o.clips_series) charts.push(h`<div class="card"><div class="ch"><h3>Clips submitted</h3><span class="xs mu">Last 14 days</span></div>${barChart(series(o.clips_series), { w: cw, label: 'Clips submitted', unit: 'clips', xlabel: 'Day', ylabel: 'Clips' })}</div>`);
  if (o.signups_series) charts.push(h`<div class="card"><div class="ch"><h3>New clippers</h3><span class="xs mu">Last 14 days</span></div>${barChart(series(o.signups_series), { w: cw, label: 'New clippers', unit: 'joined', xlabel: 'Day', ylabel: 'Clippers' })}</div>`);
  if (o.paid_series) charts.push(h`<div class="card"><div class="ch"><h3>Paid out</h3><span class="xs mu">Last 14 days</span></div>${barChart(series(o.paid_series), { w: cw, label: 'Paid out', fmt: usd, axis: usdAxis, xlabel: 'Day', ylabel: 'Paid out' })}</div>`);

  const act = o.activity || [];
  ctx.set(h`${SQ.head(greeting(SQ.staff.name), new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + (SQ.isSunday() ? '. Sunday is a staff day off, so campaigns cannot go live today.' : '.'))}
    ${tiles.length ? h`${open ? '' : SQ.note('ok', 'checkc', h`<b>You are all caught up.</b> Nothing is waiting for a person right now.`)}<div class="tiles" style="margin-bottom:18px">${tiles}</div>` : ''}
    ${stats.length ? h`<div class="gs" style="margin-bottom:18px">${stats}</div>` : ''}
    ${charts.length ? h`<div class="${charts.length > 2 ? 'g3' : 'g2'}" style="margin-bottom:18px">${charts}</div>` : ''}
    ${r ? h`<div class="card pad0"><div class="ch" style="padding:18px 20px 0"><h3>Recent clip activity</h3><a class="btn s" href="#clips">Open the clip queue</a></div>
      ${act.length ? h`<div class="list">${act.map(e => h`<a class="li" href="#clip/${e.submission_id}"><span style="color:var(--mu2)">${icon(e.type === 'rejected' ? 'xc' : e.type === 'completed' ? 'dollar' : e.type === 'submitted' ? 'upload' : e.type.startsWith('analytics') ? 'image' : 'check')}</span>
        <div class="m"><div class="t trunc">${e.username}: ${e.text}</div><div class="d"><span>${e.campaign}</span><span>${e.actor === 'system' ? 'System' : e.actor}</span></div></div><div class="e"><span class="xs mu">${ago(e.at)}</span></div></a>`)}</div>` : SQ.empty('film', 'No activity yet', 'Clips that are submitted, checked and paid show up here.')}</div>` : ''}`);
}, 'overview');
