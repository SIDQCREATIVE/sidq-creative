/* Home: what needs attention, earnings, the clip pipeline, live campaigns, news and recent payouts. */
const SQ = window.SQ;
const { h, $, icon, usd, num, compact, ago, plat, chip, note, empty, bar, stat, avatar, get, dayLabel } = SQ;

const PIPE = [['review', 'In review'], ['analytics', 'Analytics needed'], ['checking', 'Checking analytics'], ['tracking', 'Tracking views'], ['verified', 'Verified'], ['completed', 'Paid to wallet'], ['rejected', 'Rejected']];

SQ.route('home', async ctx => {
  const [d, feed] = await Promise.all([get('/api/dashboard'), get('/api/payout-feed').catch(() => ({ on: false }))]);
  const me = SQ.me, u = me.user, counts = d.counts, total = Object.values(counts).reduce((a, b) => a + b, 0);
  me.balance_cents = d.balance_cents; const wb = $('#walbal'); if (wb) wb.textContent = usd(d.balance_cents);
  const joined = d.campaigns.some(c => c.joined), acc = d.accounts, hasAcct = (acc.approved || 0) > 0, canConnect = !!(me.connect && (me.connect.youtube || me.connect.tiktok || me.connect.instagram)), autoCheck = !!(me.auto && (me.auto.youtube || me.auto.tiktok || me.auto.instagram));

  const banners = [
    me.staffHoliday && note('info', 'clock', h`<b>Staff are off today (Sunday).</b> Clip reviews and payouts continue on Monday. You can still post and submit clips.`),
    !hasAcct && !(acc.pending || 0) && note('warn', 'link', h`<b>Connect your first account.</b> You need a verified YouTube, TikTok or Instagram account before you can join a campaign.${canConnect ? ' Sign in with the platform and it is verified at once.' : ''}<div style="margin-top:10px"><a class="btn p s" href="#accounts">Connect an account</a></div>`),
    !hasAcct && (acc.pending || 0) > 0 && note('info', 'clock', h`<b>Your account is waiting to be verified.</b> ${autoCheck ? 'We look for the code in your bio by ourselves, usually within minutes. Open Accounts and press Check now to try again right away.' : 'We check the code in your bio. Most accounts are verified within a day.'}${canConnect ? ' To skip the wait, open Accounts and press Verify instantly.' : ''}`),
    (acc.rejected || 0) > 0 && note('bad', 'xc', h`<b>An account was rejected.</b> Open <a href="#accounts" style="color:var(--g)">Accounts</a> to see why and send it for review again.`),
    d.analytics_clips.length > 0 && note('warn', 'upload', h`<b>${SQ.plural(counts.analytics || d.analytics_clips.length, 'clip needs', 'clips need')} your audience analytics.</b> Send a screen recording of your analytics so we can verify the views and pay you.
      <div class="row" style="margin-top:10px">${d.analytics_clips.slice(0, 3).map(c => h`<a class="btn s" href="#clip/${c.id}">${plat(c.platform)} ${(c.title || c.campaign).slice(0, 36)}</a>`)}</div>`),
    d.open_payout && note('info', 'wallet', h`<b>Your payout of ${usd(d.open_payout.amount_cents)} is ${d.open_payout.status === 'processing' ? 'being processed' : 'waiting for our team'}.</b> <a href="#wallet" style="color:var(--g)">See the details</a>`)
  ].filter(Boolean);

  const stages = PIPE.filter(([k]) => counts[k] > 0);
  const pipe = total ? h`<div class="list" style="border:0;background:none">${stages.map(([k, t]) => h`<a class="li" href="#clips?stage=${k}" style="padding:12px 4px;grid-template-columns:minmax(0,1fr) auto"><span class="row nw" style="gap:10px">${SQ.stageChip(k, t)}</span><b class="num">${num(counts[k])}</b></a>`)}</div><a class="btn blk s" style="margin-top:12px" href="#clips">View all clips</a>`
    : empty('film', 'No clips yet', 'Join a campaign, post a clip on your account and submit its link.', h`<a class="btn p s" href="#campaigns">Find a campaign</a>`);
  const earned = d.series.some(x => x.cents > 0);

  const camps = d.campaigns.length ? h`<div class="list">${d.campaigns.map(c => h`<a class="li" href="#campaign/${c.id}">${SQ.campThumb(c, 'th')}<div class="m"><div class="t">${c.title}${c.joined ? chip('Joined', 'info', 'check') : ''}</div><div class="d"><span>${SQ.campBadges(c)}</span><span>${usd(SQ.campLeft(c), { whole: true })} left</span><span>Min ${num(c.min_views)} views</span></div></div><div class="e"><div class="rate" style="font-size:22px">${usd(c.rate * 100)}<small> per 1K</small></div></div></a>`)}</div>`
    : empty('megaphone', 'No live campaigns right now', 'New campaigns appear here as soon as they go live.');

  const checklist = total === 0 ? h`<div class="card"><div class="ch"><h3>Get started</h3></div><div class="list" style="border:0">${[
    [hasAcct, canConnect ? 'Connect your account' : 'Connect and verify an account', canConnect ? 'Sign in with YouTube, TikTok or Instagram. Your account is verified at once and your views are counted automatically.' : 'Add your YouTube, TikTok or Instagram account and put the code in your bio.', '#accounts', 'Connect'],
    [joined, 'Join a campaign', 'Read the rate, budget and rules, then press Join.', '#campaigns', 'Browse'],
    [false, 'Submit your first clip', 'Post it on your account, then paste the link inside the campaign page.', '#campaigns', 'Submit']
  ].map(([done, t, s, href, b]) => h`<div class="li" style="grid-template-columns:auto minmax(0,1fr) auto"><span style="color:${done ? 'var(--g)' : 'var(--mu2)'}">${icon(done ? 'checkc' : 'target')}</span><div class="m"><div class="t">${t}</div><div class="d">${s}</div></div><div class="e">${done ? chip('Done', 'ok') : h`<a class="btn s" href="${href}">${b}</a>`}</div></div>`)}</div></div>` : '';

  const news = d.news.length ? h`<div class="card"><div class="ch"><h3>News</h3></div><div class="col" style="gap:16px">${d.news.map(n => h`<div><div class="b">${n.pinned ? icon('pin') : ''} ${n.title}</div><div class="sm mu pre" style="margin-top:4px">${n.body}</div><div class="xs mu" style="margin-top:4px">${ago(n.created_at)}</div></div>`)}</div></div>` : '';
  const pay = feed.on ? h`<div class="card"><div class="ch"><h3>Recent payouts</h3></div>
    <div class="sm mu" style="margin-bottom:12px"><b style="color:var(--g)">${usd(feed.total_cents, { whole: true })}</b> paid to clippers so far in ${SQ.plural(feed.count, 'payout')}.</div>
    ${feed.items.length ? h`<div class="col" style="gap:12px">${feed.items.slice(0, 6).map(p => h`<div class="row nw" style="gap:10px">${avatar({ username: p.who }, 'xs')}<div class="trunc sm"><b>${p.who}</b> was paid <b>${usd(p.amount_cents)}</b><span class="mu"> via ${SQ.METHODS[p.type] || p.type}</span></div><span class="xs mu right nowrap">${ago(p.at)}</span></div>`)}</div>` : '<div class="sm mu">The first payouts will show up here.</div>'}</div>` : '';

  ctx.set(h`<div class="ph"><div class="t"><h1>Welcome back, ${u.username}</h1><p>Here is where your clips and earnings stand today.</p></div><a class="btn p" href="#campaigns">${icon('megaphone')}Browse campaigns</a></div>
    ${banners}
    <div class="g4" style="margin-bottom:14px">
      ${stat('Wallet balance', usd(d.balance_cents), d.balance_cents >= d.min_payout_cents ? h`<a href="#wallet" style="color:var(--g)">Ready to withdraw</a>` : 'Minimum payout is ' + usd(d.min_payout_cents, { whole: true }), { hero: true, g: true, icon: 'wallet' })}
      ${stat('Pending earnings', usd(d.pending_cents), 'Estimated from clips still counting views', { icon: 'clock' })}
      ${stat('Paid out', usd(d.paid_cents), 'Earned in total: ' + usd(d.lifetime_cents), { icon: 'dollar' })}
      ${stat('Views counted', compact(d.views), 'Across all your approved clips', { icon: 'eye' })}
    </div>
    <div class="two" style="margin-bottom:14px"><div class="card"><div class="ch"><h3>Earnings, last 30 days</h3></div>
      ${earned ? SQ.areaChart(d.series.map(x => ({ x: dayLabel(x.d), full: dayLabel(x.d, true), y: x.cents })), { fmt: v => usd(v), axis: SQ.usdAxis, label: 'Earnings per day', ylabel: 'Earned' }) : empty('chart', 'No earnings yet', 'Money lands in your wallet when a clip finishes its tracking window.')}</div>
      <div class="card"><div class="ch"><h3>Your clips</h3></div>${pipe}</div></div>
    ${checklist}
    <div class="card pad0" style="margin-bottom:14px"><div class="ch" style="padding:20px 20px 0"><h3>Live campaigns</h3><a class="btn g s" href="#campaigns">See all${icon('chevr')}</a></div><div style="padding:0 0 4px">${camps}</div></div>
    <div class="g2" style="align-items:start">${news}${pay}</div>`);
}, 'home');
