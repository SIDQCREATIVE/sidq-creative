/* People: the clipper list, one clipper's page, and the staff team with roles. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, compact, date, dtime, ago, chip, plat, note, empty, get, post, put, del, act, ok, go, qs, avatar } = SQ;

const tierChip = t => chip(t, t === 'Elite' ? 'ok' : t === 'Pro' ? 'info' : 'mu');
const roleName = k => (SQ.staff && SQ.staff.roles[k] && SQ.staff.roles[k].label) || k;
const LEDGER = { earning: 'Clip earnings', referral: 'Referral bonus', bonus: 'Bonus', adjustment: 'Correction', payout: 'Payout request', payout_refund: 'Payout returned' };

/* ================================================================ clipper list */
const CU = { q: '', filter: 'all', page: 1 };
async function loadClippers() {
  const box = $('#culist'); if (!box) return;
  SQ.busy(box, true);
  let r; try { r = await get('/api/staff/users' + qs({ q: CU.q, filter: CU.filter === 'all' ? '' : CU.filter, page: CU.page > 1 ? CU.page : '' })); } catch (e) { SQ.busy(box, false); return SQ.err(e); }
  SQ.busy(box, false);
  html($('#cuseg'), SQ.seg([['all', 'Everyone'], ['new', 'New this week'], ['banned', 'Banned'], ['staff', 'Staff']], CU.filter, 'cu.filter'));
  html(box, r.users.length ? h`<div class="tw"><table class="tbl rt"><thead><tr><th>Clipper</th><th>Rank</th><th class="r">Accounts</th><th class="r">Clips</th><th class="r">Views</th><th class="r">Wallet</th><th>Joined</th><th>Last seen</th></tr></thead><tbody>${r.users.map(u => h`<tr class="hv" data-go="#clipper/${u.id}" tabindex="0" role="link">
      <td class="full-sm"><div class="row nw" style="gap:10px">${avatar(u, 'xs')}<span class="b trunc">${u.username}</span>${u.staff ? chip(roleName(u.role), 'info') : ''}${u.banned ? chip('Banned', 'bad', 'ban') : ''}</div></td><td>${tierChip(u.tier)}</td>
      <td class="r num hide-sm">${num(u.accounts)}</td><td class="r num hide-sm">${num(u.clips)}</td><td class="r num" data-l="Views">${compact(u.views)}</td><td class="r num" data-l="Wallet">${usd(u.balance_cents)}</td><td class="mu hide-sm">${date(u.created_at)}</td><td class="mu hide-sm">${u.last_seen ? ago(u.last_seen) : 'Never'}</td></tr>`)}</tbody></table></div>${SQ.pager(r, 'cu.page')}`
    : empty('users', CU.q ? 'Nobody matches that search' : 'No clippers here', CU.q ? 'Search by name or paste a Discord user ID.' : ''));
  history.replaceState(null, '', '#clippers' + qs({ q: CU.q, filter: CU.filter === 'all' ? '' : CU.filter }));
}
SQ.route('clippers', async ctx => {
  Object.assign(CU, { q: ctx.q.q || '', filter: ['new', 'banned', 'staff'].includes(ctx.q.filter) ? ctx.q.filter : 'all', page: 1 });
  ctx.set(h`${SQ.head('Clippers', 'Everyone who logged in with Discord. Click a clipper to see their clips, wallet and payouts.')}<div class="row" style="gap:12px;margin-bottom:16px"><div id="cuseg"></div>${SQ.searchBox('cu', CU.q, 'Search by name or Discord ID')}</div><div id="culist" style="transition:opacity .15s"></div>`);
  await loadClippers();
}, 'clippers');
act('cu.filter', el => { CU.filter = el.dataset.v; CU.page = 1; return loadClippers(); });
act('cu.page', el => { CU.page = +el.dataset.page; window.scrollTo(0, 0); return loadClippers(); });
SQ.onSearch('cu', v => { CU.q = v; CU.page = 1; return loadClippers().catch(SQ.err); });

/* ================================================================ one clipper */
const CUR = { r: null };
const PNAME = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
const clipLine = c => h`<a class="li" href="#clip/${c.id}">${SQ.clipThumb(c, 44)}<div class="m"><div class="t">${plat(c.platform)}<span class="trunc">${c.title || (PNAME[c.platform] || 'Video') + ' clip'}</span></div><div class="d"><span>${c.campaign}</span><span>${ago(c.submitted_at)}</span><span class="trunc mono" style="max-width:240px">${String(c.url || '').replace(/^https?:\/\/(www\.)?/, '')}</span></div></div>
  <div class="e">${c.earned_cents ? h`<b class="num" style="color:var(--g)">${usd(c.earned_cents)}</b>` : c.est_cents != null ? h`<span class="mu sm">${usd(c.est_cents)} est.</span>` : ''}${SQ.stageChip(c.stage, c.stage_label)}</div></a>`;

SQ.route('clipper/:id', async ctx => {
  const r = await get('/api/staff/users/' + encodeURIComponent(ctx.params.id)), u = r.user; CUR.r = r;
  ctx.title(u.username);
  const manage = SQ.can('users_manage'), money = SQ.can('payouts');
  const pct = u.next ? (u.xp - u.floor) / Math.max(1, u.next - u.floor) * 100 : 100;
  ctx.set(h`<a class="back" href="#clippers">${icon('chevl')}Clippers</a>
    <div class="card" style="margin-bottom:16px"><div class="row nw" style="gap:18px;align-items:flex-start;flex-wrap:wrap">${avatar(u, 'lg')}
      <div style="flex:1;min-width:230px"><h1 style="font-size:26px">${u.username}</h1><div class="row" style="gap:8px;margin:8px 0">${tierChip(u.rank)}${u.role !== 'clipper' ? chip(roleName(u.role), 'info', 'shield') : ''}${u.banned ? chip('Banned', 'bad', 'ban') : ''}</div>
        <div class="row" style="gap:6px 18px;color:var(--mu);font-size:13px"><span>Joined ${date(u.created_at)}</span><span>${u.last_seen ? 'Last seen ' + ago(u.last_seen) : 'Never seen'}</span>${u.agreed_at ? '' : h`<span style="color:var(--warn)">Has not accepted the rules yet</span>`}</div>
        <div style="margin-top:10px;max-width:360px">${SQ.copyLine('Discord ID', u.discord_id)}</div>${u.email ? h`<div class="sm" style="margin-top:8px">${u.email}</div>` : ''}</div>
      <div class="row" style="gap:8px">${manage ? h`<button type="button" class="btn" data-act="cl.msg">${icon('send')}Message</button><button type="button" class="btn" data-act="cl.note">${icon('pencil')}Note</button>${u.banned ? h`<button type="button" class="btn p" data-act="cl.unban">Unban</button>` : h`<button type="button" class="btn d" data-act="cl.ban">${icon('ban')}Ban</button>`}` : ''}${money ? h`<button type="button" class="btn" data-act="cl.adjust">${icon('dollar')}Bonus or correction</button>` : ''}</div></div>
      ${u.banned ? h`<div style="margin-top:14px">${note('bad', 'ban', h`<b>Banned.</b> ${u.ban_reason || ''}`)}</div>` : ''}</div>
    <div class="g4" style="margin-bottom:16px">${SQ.stat('Wallet balance', usd(r.balance_cents), 'Available to withdraw', { icon: 'wallet', hero: true, g: true })}${SQ.stat('Earned in total', usd(r.earned_cents), 'Clips, referrals and bonuses', { icon: 'trend' })}${SQ.stat('Views counted', compact(u.xp), u.next ? num(u.next - u.xp) + ' to ' + u.nextRank : 'Top rank reached', { icon: 'eye' })}${SQ.stat('Open tickets', num(r.open_tickets), r.open_tickets ? 'Waiting in Support' : 'No open tickets', { icon: 'lifebuoy' })}</div>
    <div class="two"><div class="col" style="gap:14px">
      <div class="card pad0"><div class="ch" style="padding:18px 20px 0"><h3>Clips</h3>${r.clips.length ? h`<a class="btn s" href="#clips?user=${u.id}">All their clips</a>` : ''}</div>${r.clips.length ? h`<div class="list">${r.clips.map(clipLine)}</div>` : empty('film', 'No clips yet', '')}</div>
      <div class="card pad0"><div class="ch" style="padding:18px 20px 0"><h3>Wallet activity</h3></div>${r.ledger.length ? h`<div class="tw"><table class="tbl"><tbody>${r.ledger.map(l => h`<tr><td><div class="b">${LEDGER[l.type] || l.type}</div><div class="xs mu">${l.note || ''}</div></td><td class="mu xs nowrap">${dtime(l.created_at)}</td><td class="r num b" style="color:${l.amount_cents < 0 ? 'var(--tx)' : 'var(--g)'}">${usd(l.amount_cents, { sign: true })}</td></tr>`)}</tbody></table></div>` : empty('receipt', 'No wallet activity', '')}</div>
      ${r.payouts.length ? h`<div class="card pad0"><div class="ch" style="padding:18px 20px 0"><h3>Payouts</h3>${SQ.can('payouts') ? h`<a class="btn s" href="#payouts?q=${encodeURIComponent(u.username)}&status=paid">Open payouts</a>` : ''}</div><div class="tw"><table class="tbl"><tbody>${r.payouts.map(p => h`<tr><td><div class="b">${SQ.METHODS[p.method_type] || p.method_type}</div><div class="xs mu">Asked ${dtime(p.created_at)}</div></td><td>${SQ.status('payout', p.status)}</td><td class="r num b">${usd(p.amount_cents)}</td></tr>`)}</tbody></table></div></div>` : ''}</div>
    <div class="col" style="gap:14px">
      <div class="card"><div class="ch"><h3>Staff note</h3>${manage ? h`<button type="button" class="btn s g" data-act="cl.note">Edit</button>` : ''}</div>${u.staff_note ? h`<p class="pre sm">${u.staff_note}</p>` : h`<p class="sm mu">No note. Staff see notes on this page and on this clipper's clips.</p>`}</div>
      <div class="card"><div class="ch"><h3>Accounts</h3></div>${r.accounts.length ? h`<div class="col" style="gap:10px">${r.accounts.map(a => h`<div class="row nw" style="gap:10px">${plat(a.platform, true)}<div class="trunc" style="flex:1"><div class="b trunc">@${a.handle}</div><div class="xs mu">${a.followers ? compact(a.followers) + ' followers' : 'No follower count'}</div></div>${SQ.status('acct', a.status)}</div>`)}</div>` : h`<p class="sm mu">No accounts connected.</p>`}</div>
      ${money ? h`<div class="card"><div class="ch"><h3>Payout methods</h3></div>${r.methods.length ? h`<div class="col" style="gap:14px">${r.methods.map(m => h`<div><div class="b" style="margin-bottom:6px">${m.name}</div>${m.error ? note('warn', 'alert', m.error) : h`<div class="col" style="gap:6px">${m.fields.map(([k, v]) => SQ.copyLine(k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), v, { stack: true }))}</div>`}</div>`)}</div>` : h`<p class="sm mu">No payout method saved.</p>`}</div>` : ''}
      ${r.campaigns.length ? h`<div class="card"><div class="ch"><h3>Campaigns joined</h3></div><div class="row" style="gap:8px">${r.campaigns.map(c => SQ.can('campaigns') ? h`<a class="chip" href="#campaign/${c.id}" style="text-decoration:none">${c.title}</a>` : chip(c.title, 'mu'))}</div></div>` : ''}</div></div>`);
}, 'clippers');

const uid = () => CUR.r.user.id;
act('cl.msg', () => {
  SQ.dialog({
    title: 'Message ' + CUR.r.user.username,
    body: h`<p class="mu" style="margin-bottom:14px">They get a notification in the portal.</p><label class="f"><span class="h">Title</span><input class="in" name="title" maxlength="100" autocomplete="off"></label><label class="f" style="margin:0"><span class="h">Message</span><textarea class="in" name="body" rows="4" maxlength="400"></textarea></label>`,
    buttons: [{ text: 'Cancel', kind: 'g', value: false }, { text: 'Send message', kind: 'p', run: async dm => { await post(`/api/staff/users/${uid()}/message`, SQ.fields(dm.box)); ok('Message sent.'); } }]
  });
});
act('cl.note', async () => {
  const done = await SQ.ask({ title: 'Staff note', label: 'Note', text: 'Only staff see this. Use it for anything the next person should know.', value: CUR.r.user.staff_note || '', rows: 5, max: 1000, ok: 'Save note', submit: v => post(`/api/staff/users/${uid()}/note`, { note: v }) });
  if (done !== null) { ok('Note saved.'); SQ.reload(); }
});
act('cl.ban', async () => {
  const done = await SQ.reason({ title: 'Ban ' + CUR.r.user.username, label: 'Reason', text: 'The clipper sees this when they try to log in. Their wallet stays as it is.', presets: SQ.REASONS.ban, ok: 'Ban clipper', kind: 'd' }, v => post(`/api/staff/users/${uid()}/ban`, { reason: v }));
  if (done) { ok('Clipper banned.'); SQ.reload(); }
});
act('cl.unban', async () => {
  if (!await SQ.confirm({ title: 'Unban ' + CUR.r.user.username + '?', text: 'They can log in and submit clips again.', ok: 'Unban' })) return;
  await post(`/api/staff/users/${uid()}/unban`, {}); ok('Clipper unbanned.'); SQ.reload();
});
act('cl.adjust', () => {
  SQ.dialog({
    title: 'Bonus or correction for ' + CUR.r.user.username,
    body: h`<p class="mu" style="margin-bottom:14px">This changes their wallet right away. It is written to the wallet history and the audit log, and the clipper sees the reason.</p>
      <label class="f"><span class="h">Type</span><select class="in" name="kind"><option value="bonus">Bonus (adds money)</option><option value="adjustment">Correction (adds or removes money)</option></select></label>
      <label class="f"><span class="h">Amount in USD</span><input class="in" name="amount" inputmode="decimal" autocomplete="off" placeholder="5 or -5.50"><div class="hint">Use a minus sign to take money away. Only corrections can remove money.</div></label>
      <label class="f" style="margin:0"><span class="h">Reason</span><input class="in" name="note" maxlength="150" autocomplete="off" placeholder="For example Bonus for the best clip of the week"></label>`,
    buttons: [{ text: 'Cancel', kind: 'g', value: false }, { text: 'Update wallet', kind: 'p', run: async dm => {
      const f = SQ.fields(dm.box);
      if (f.kind === 'bonus' && String(f.amount).trim().startsWith('-')) throw new Error('A bonus adds money. Pick Correction to take money away.');
      await post(`/api/staff/users/${uid()}/adjust`, f); ok('Wallet updated. The clipper was told.'); SQ.reload();
    } }]
  });
});

/* ================================================================ team and roles */
const ORDER = ['owner', 'admin', 'manager', 'moderator', 'finance', 'support'];
SQ.route('team', async ctx => {
  const r = await get('/api/staff/team'), roles = r.roles, keys = ORDER.filter(k => roles[k]);
  const pick = k => keys.filter(x => x !== 'owner').map(x => [x, roles[x].label]);
  ctx.set(h`${SQ.head('Team', 'Give people a role and they only see the panels that role needs. You, the owner, can use everything.')}
    <div class="two"><div class="col" style="gap:14px">
      <div class="card pad0"><div class="ch" style="padding:18px 20px 0"><h3>Staff</h3></div><div class="list">${r.team.map(t => h`<div class="li"><div>${avatar(t, 'md')}</div><div class="m"><div class="t">${t.username}${t.role === 'owner' ? chip('Owner', 'ok', 'crown') : ''}</div><div class="d"><span>Discord ID ${t.discord_id}</span><span>${t.last_seen ? 'Last seen ' + ago(t.last_seen) : 'Never seen'}</span></div></div>
        <div class="e">${t.role === 'owner' ? '' : h`<select class="in" data-role="${t.id}" aria-label="Role of ${t.username}" style="width:auto;min-width:170px">${SQ.opts(pick(), t.role)}</select><button type="button" class="iconbtn sm" data-act="tm.remove" data-id="${t.id}" data-name="${t.username}" aria-label="Remove ${t.username} from the team" title="Remove from the team">${icon('x')}</button>`}</div></div>`)}</div></div>
      <div class="card"><div class="ch"><h3>What each role can do</h3></div><div class="tw"><table class="tbl"><thead><tr><th>Can</th>${keys.map(k => h`<th style="text-align:center">${roles[k].label}</th>`)}</tr></thead><tbody>${Object.keys(SQ.PERMS).map(p => h`<tr><td>${SQ.PERMS[p]}</td>${keys.map(k => h`<td style="text-align:center">${roles[k].perms.includes(p) ? h`<span style="color:var(--g)" aria-label="Yes">${icon('check')}</span>` : h`<span class="mu2" aria-label="No">-</span>`}</td>`)}</tr>`)}</tbody></table></div>
        <div class="col" style="gap:6px;margin-top:14px">${keys.map(k => h`<div class="sm"><b>${roles[k].label}.</b> <span class="mu">${roles[k].about}</span></div>`)}</div></div></div>
      <div class="card sticky"><div class="ch"><h3>Add a staff member</h3></div>
        <p class="sm mu" style="margin-bottom:14px">They must log in to the clipper portal with Discord once, so we know who they are. Then add them here.</p>
        <form id="tmform" onsubmit="return false"><label class="f"><span class="h">Discord user ID or username</span><input class="in" name="who" autocomplete="off" maxlength="60" placeholder="For example 123456789012345678"><div class="hint">In Discord, turn on Developer Mode, then right-click the person and choose Copy User ID.</div></label>
          <label class="f"><span class="h">Role</span><select class="in" name="role">${SQ.opts(pick(), 'moderator')}</select></label><button type="button" class="btn p blk" data-act="tm.add">Add to the team</button></form></div></div>`);
}, 'team');
document.addEventListener('change', async e => {
  const id = e.target.dataset && e.target.dataset.role; if (!id) return;
  try { await put('/api/staff/team/' + id, { role: e.target.value }); ok('Role changed.'); SQ.reload(); } catch (x) { SQ.err(x); SQ.reload(); }
});
act('tm.add', async () => { await post('/api/staff/team', SQ.fields($('#tmform'))); ok('Added to the team.'); SQ.reload(); });
act('tm.remove', async el => {
  if (!await SQ.confirm({ title: 'Remove ' + el.dataset.name + '?', text: 'They become a normal clipper and can no longer open the staff panel.', ok: 'Remove', kind: 'd' })) return;
  await del('/api/staff/team/' + el.dataset.id); ok('Removed from the team.'); SQ.reload();
});
