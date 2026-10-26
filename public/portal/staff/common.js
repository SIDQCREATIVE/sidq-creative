/* Helpers shared by every page of the staff panel. */
const SQ = window.SQ;
const { h, $, html, icon, usd, num, compact, date, ago, chip, plat, avatar, bgImg, qs, get, post, ask } = SQ;

SQ.staff = null;
SQ.home = 'overview';
SQ.can = p => !!(SQ.staff && SQ.staff.perms.includes(p));

// The permission each page needs. Someone who opens a page by its address, but whose role does not include it, sees a short note instead of an empty page.
// (The server checks every request too. This only makes the screen clear.)
const NEEDS = { overview: 'overview', clips: 'review', accounts: 'review', payouts: 'payouts', campaigns: 'campaigns', news: 'campaigns', clippers: 'users', tickets: 'support', team: 'staff', leads: 'website', content: 'website', blog: 'website', seo: 'website', settings: 'settings', audit: 'audit' };
const addRoute = SQ.route;
SQ.route = (pattern, fn, nav) => addRoute(pattern, ctx => {
  const need = NEEDS[nav];
  if (need && !SQ.can(need)) {
    ctx.title('Not part of your role');
    return ctx.set(h`${SQ.head('This page is not part of your role', 'The owner decides which panels each team member can use.')}${SQ.note('info', 'shield', h`<b>You are logged in as ${SQ.staff.label}.</b> Use the pages in the menu. If you need this one, ask the owner to change your role under Team.`)}<p style="margin-top:18px"><a class="btn p" href="#${SQ.home}">Back to the overview</a></p>`);
  }
  return fn(ctx);
}, nav);

// What each permission means, in plain words (shown on the Team page).
SQ.PERMS = {
  overview: 'See the overview', review: 'Review clips and verify social accounts', payouts: 'Handle payouts, bonuses and wallet corrections',
  campaigns: 'Create and manage campaigns and announcements', users: 'Look up clippers', users_manage: 'Ban, message and write notes about clippers',
  staff: 'Add staff and change roles', support: 'Answer support tickets', website: 'Edit the website, blog and applications',
  settings: 'Change settings and run background jobs', audit: 'See the audit log'
};

// Clip stages in the order staff work through them.
SQ.STAGES = [['review', 'In review'], ['checking', 'Checking analytics'], ['analytics', 'Waiting for analytics'], ['tracking', 'Tracking'], ['verified', 'Verified'], ['completed', 'Paid'], ['rejected', 'Rejected']];
SQ.STAGE_HELP = {
  review: 'New clips. Check the rules, then approve or reject.',
  checking: 'The clipper sent analytics. Watch the recording and verify the views.',
  analytics: 'We asked these clippers for analytics. Waiting for them.',
  tracking: 'Approved clips that are counting views.',
  verified: 'Analytics were accepted. Paid when the tracking window ends.',
  completed: 'Paid to the clipper wallet.',
  rejected: 'Rejected clips.'
};

SQ.hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || ''); } };

// A clipper's name and picture; a link to their page when this role may open it.
SQ.who = (u, size) => {
  const inner = h`${avatar(u, size || 'xs')}<span class="trunc">${u.username || u.name || 'Unknown'}</span>`;
  return SQ.can('users') && u.id ? h`<a class="row nw" href="#clipper/${u.id}" style="gap:8px;color:inherit;text-decoration:none;min-width:0">${inner}</a>` : h`<span class="row nw" style="gap:8px;min-width:0">${inner}</span>`;
};

// How long something has been waiting. Warns after a day and turns red after two (staff are off on Sundays, so it adds up).
SQ.waiting = (at, label) => {
  if (!at) return '';
  const hrs = (Date.now() - new Date(at).getTime()) / 36e5;
  return chip((label || 'Waiting') + ' ' + ago(at).replace(/ ago$/, ''), hrs > 48 ? 'bad' : hrs > 24 ? 'warn' : 'mu', 'clock');
};

SQ.flagChips = flags => (flags || []).map(f => chip(f.text, f.level === 'high' ? 'bad' : 'warn', 'flag'));

SQ.clipThumb = (c, size) => h`<div class="th" style="width:${size || 56}px;height:${size || 56}px;${bgImg(c.thumb)}">${c.thumb ? '' : plat(c.platform, true)}</div>`;

// "Needs you" summary used on the overview and in the sidebar badges.
SQ.badges = {};
SQ.setBadges = b => {
  SQ.badges = b;
  SQ.$$('[data-badge]').forEach(el => { const n = b[el.dataset.badge] || 0; el.hidden = !n; el.textContent = n > 99 ? '99+' : n; });
};

// After a decision, open the next clip waiting in the same stage.
SQ.nextClip = async (stage, exceptId) => {
  try { const r = await get('/api/staff/clips' + qs({ stage })); const n = r.clips.find(c => c.id !== exceptId); return n ? n.id : null; }
  catch (e) { return null; }
};

// Reasons staff reuse often. Clippers read them, so they are short and polite.
SQ.REASONS = {
  clip: ['The clip was not posted on your connected account.', 'The video is not from the campaign source.', 'It was submitted after the time limit.', 'The clip has a watermark from another app.', 'This clip was already submitted.', 'The clip breaks the campaign rules.'],
  account: ['We could not find the code in your bio.', 'The account is private. Make it public and send it again.', 'The username does not match.', 'The account is too small for our campaigns.'],
  analytics: ['The recording does not show the views.', 'The recording is cut or blurry. Record the full screen without editing.', 'The audience countries, age or gender are missing.', 'We could not see your username or the page address.', 'The numbers do not match the video.'],
  payout: ['The payout details are not valid. Update them and ask again.', 'We could not send money to this account. Use another method.'],
  ban: ['Fake or bought views.', 'Posting other creators\' content as their own.', 'Using more than one account of the same person.']
};

// "Why?" dialog with preset reasons. `send(reason)` does the server call so errors show inside the dialog.
SQ.reason = (o, send) => ask({ ...o, long: true, min: 3, minMsg: 'Write a short reason first.', submit: send });

// Money in a form field: "12.50" in, cents out (and the other way).
SQ.toCents = v => { const s = String(v == null ? '' : v).trim().replace(/^\$/, ''); return /^\d{1,9}(\.\d{1,2})?$/.test(s) ? Math.round(parseFloat(s) * 100) : null; };
SQ.dollars = c => (Math.round(Number(c) || 0) / 100).toFixed(2);

// A small "label: value [copy]" line, used for payout details and verification codes.
SQ.copyLine = (label, value, o) => h`<div class="cl ${o && o.stack ? 'st' : ''}"><span class="xs mu">${label}</span><span class="v ${o && o.mono === false ? '' : 'mono'}">${value}</span>${SQ.copyBtn(value, 'Copy ' + String(label).toLowerCase())}</div>`;

// Table heading that stays put: a page title, a short line under it and the main actions.
SQ.head = (title, sub, actions) => h`<div class="ph"><div class="t"><h1>${title}</h1>${sub ? h`<p>${sub}</p>` : ''}</div>${actions || ''}</div>`;

// Which page lists to show while the first load runs, and the shared "search + filters" strip.
SQ.bar2 = (inner) => h`<div class="row" style="gap:10px;margin-bottom:16px">${inner}</div>`;
SQ.searchBox = (name, value, ph) => h`<div class="search">${icon('search')}<input class="in" type="search" placeholder="${ph}" value="${value || ''}" aria-label="${ph}" data-search="${name}"></div>`;

// Keep repainting only the list part of a page while the person types or changes a filter.
SQ.busy = (el, on) => { if (el) el.style.opacity = on ? '.5' : ''; };
