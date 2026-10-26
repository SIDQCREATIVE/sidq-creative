/* Website: applications from the landing page, the page texts, the blog and search settings. Owner and admin only. */
const SQ = window.SQ;
const { h, $, $$, html, icon, dtime, ago, chip, note, empty, get, post, put, del, act, ok, go, qs } = SQ;

/* ================================================================ applications */
const LD = { tab: 'customer', rows: [], timer: null };
const waLink = p => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 8 ? 'https://wa.me/' + d : ''; };
const leadCard = l => h`<div class="card"><div class="row" style="gap:10px;align-items:flex-start"><div style="flex:1;min-width:220px"><div class="row" style="gap:8px"><h3>${l.name}</h3>${l.seen ? '' : chip('New', 'ok')}</div>
    <div class="row" style="gap:6px 16px;margin-top:8px;font-size:13.5px">${l.email ? h`<a href="mailto:${l.email}" style="color:var(--g)">${icon('mail')} ${l.email}</a>` : ''}${l.phone ? h`<span>${l.phone}</span>${waLink(l.phone) ? h`<a href="${waLink(l.phone)}" target="_blank" rel="noopener" style="color:var(--g)">WhatsApp ${icon('ext')}</a>` : ''}` : ''}</div></div>
    <div class="xs mu" style="text-align:right">${dtime(l.at)}<br>${ago(l.at)}</div></div>
  ${l.budget ? h`<div class="dv"></div><div class="xs mu">${l.type === 'clipper' ? 'Link to their edits' : 'Their video or channel'}</div><div class="sm" style="word-break:break-all;margin-top:2px">${/^https?:\/\//i.test(l.budget) ? h`<a href="${l.budget}" target="_blank" rel="noopener" style="color:var(--g)">${l.budget}</a>` : l.budget}</div>` : ''}
  ${l.msg ? h`<div class="xs mu" style="margin-top:12px">Message</div><p class="pre sm" style="margin-top:2px">${l.msg}</p>` : ''}
  <div class="row" style="margin-top:14px;justify-content:space-between"><span class="xs mu">${l.src ? 'Came from ' + l.src : ''}</span><button type="button" class="btn s d" data-act="ld.del" data-id="${l.id}">${icon('trash')}Delete</button></div></div>`;
function paintLeads() {
  const un = t => LD.rows.filter(l => l.type === t && !l.seen).length, rows = LD.rows.filter(l => l.type === LD.tab);
  html($('#ldtabs'), SQ.tabs([['customer', 'Customers', un('customer'), un('customer') > 0], ['clipper', 'Clippers', un('clipper'), un('clipper') > 0]], LD.tab, 'ld.tab'));
  html($('#ldlist'), rows.length ? h`<div class="col" style="gap:12px">${rows.map(leadCard)}</div>` : empty('inbox', 'No applications yet', LD.tab === 'clipper' ? 'People who apply as clippers on the website show up here.' : 'People who ask for clipping services on the website show up here.'));
  clearTimeout(LD.timer);
  if (rows.some(l => !l.seen)) LD.timer = setTimeout(async () => { const t = LD.tab; try { await post('/api/leads/seen', { type: t }); LD.rows.forEach(l => { if (l.type === t) l.seen = true; }); if ($('#ldlist')) { /* keep the New chips for this visit */ } SQ.pingBadges(); } catch (e) { /* later */ } }, 4000);
}
SQ.route('leads', async ctx => {
  LD.rows = await get('/api/leads');
  LD.tab = LD.rows.some(l => l.type === 'customer' && !l.seen) || !LD.rows.some(l => l.type === 'clipper' && !l.seen) ? 'customer' : 'clipper';
  ctx.set(h`${SQ.head('Applications', 'People who filled in a form on your website.')}<div id="ldtabs"></div><div id="ldlist"></div>`);
  paintLeads();
}, 'leads');
act('ld.tab', el => { LD.tab = el.dataset.v; paintLeads(); });
act('ld.del', async el => {
  if (!await SQ.confirm({ title: 'Delete this application?', text: 'It is removed for good.', ok: 'Delete', kind: 'd' })) return;
  await del('/api/leads/' + el.dataset.id); LD.rows = LD.rows.filter(l => l.id !== +el.dataset.id); paintLeads(); SQ.pingBadges(); ok('Deleted.');
});

/* ================================================================ page texts */
const L = { heroA: 'Hero line 1 (white)', heroB: 'Hero line 2 (grey)', sub: 'Hero paragraph', whyH: 'Why section title', why: 'Why section text', fName: 'Founder name', fRole: 'Founder title', f1: 'Founder number 1', f1l: 'Number 1 label', f2: 'Founder number 2', f2l: 'Number 2 label', fImg: 'Founder photo, black and white', fImg2: 'Founder photo, colour (shows on hover)', wa: 'WhatsApp number (digits only, with country code)', ig: 'Instagram username', whop: 'Whop link', discord: 'Discord invite link (full link)', hServices: 'Heading: services', hShorts: 'Heading: popular shorts', hProcess: 'Heading: how it works', hFounder: 'Heading: founder', hFaq: 'Heading: FAQ', hApply: 'Heading: apply form', hCompare: 'Heading: comparison table', hStd: 'Heading: what we clip and skip', email: 'Contact email' };
const DH = { hServices: 'Our services', hShorts: 'Popular shorts', hProcess: 'How it works', hFounder: 'Meet the founder', hFaq: 'Frequently asked questions', hApply: 'Work with us', hCompare: 'Why SIDQ Creative', hStd: 'What we clip. What we skip.' };
const GROUPS = [
  ['Top of the page', 'The first thing visitors read.', ['heroA', 'heroB', 'sub']],
  ['Why choose you', 'The section that explains your offer.', ['whyH', 'why']],
  ['Founder', 'Name, title, two numbers and two photos.', ['fName', 'fRole', 'f1', 'f1l', 'f2', 'f2l', 'fImg', 'fImg2']],
  ['Contact and links', 'Also used by the clipper portal for the Discord button.', ['email', 'wa', 'ig', 'whop', 'discord']],
  ['Section headings', 'The titles above each part of the home page.', ['hServices', 'hShorts', 'hProcess', 'hFounder', 'hFaq', 'hApply', 'hCompare', 'hStd']]
];
const LONG = ['sub', 'why'];
const RETIRED = ['p1', 'p2', 'p3']; // old price fields: the home page no longer shows them
const CT = { D: null };
SQ.route('content', async ctx => {
  const D = CT.D = await get('/api/content'), known = new Set([...GROUPS.flatMap(g => g[2]), ...RETIRED]), extra = Object.keys(D.t || {}).filter(k => !known.has(k));
  const input = k => { const v = (D.t && D.t[k]) || DH[k] || ''; return LONG.includes(k) ? h`<label class="f"><span class="h">${L[k] || k}</span><textarea class="in" data-k="${k}" rows="3">${v}</textarea></label>` : h`<label class="f"><span class="h">${L[k] || k}</span><input class="in" data-k="${k}" value="${v}" autocomplete="off"></label>`; };
  ctx.set(h`${SQ.head('Page texts', 'Change the words and numbers on your home page. Press Save, then refresh the website to see them.', h`<a class="btn" href="/" target="_blank" rel="noopener">${icon('ext')}Open the website</a>`)}
    <div class="col" style="gap:14px">${GROUPS.map(([t, sub, keys]) => h`<div class="card"><div class="ch" style="margin-bottom:4px"><h3>${t}</h3></div><p class="sm mu" style="margin-bottom:14px">${sub}</p><div class="${keys.length > 3 ? 'g2' : ''}">${keys.map(input)}</div></div>`)}
      <div class="card"><div class="ch" style="margin-bottom:4px"><h3>Numbers</h3></div><p class="sm mu" style="margin-bottom:14px">The big numbers shown under the hero.</p>${(D.stats || []).map((s, i) => h`<div class="g2"><label class="f"><span class="h">Number ${i + 1}</span><input class="in" data-sv="${i}" value="${s.v}" autocomplete="off"></label><label class="f"><span class="h">Label</span><input class="in" data-sl="${i}" value="${s.l}" autocomplete="off"></label></div>`)}</div>
      <div class="card"><div class="ch" style="margin-bottom:4px"><h3>Popular shorts carousel</h3></div><p class="sm mu" style="margin-bottom:14px">One per line: a YouTube Shorts link, or <span class="mono">/videos/file.mp4 | Client name</span>. Up to 100.</p><textarea class="in" id="ctshorts" rows="10" style="font-family:ui-monospace,Menlo,monospace;font-size:13px">${(D.shorts || []).join('\n')}</textarea></div>
      ${extra.length ? h`<div class="card"><div class="ch" style="margin-bottom:14px"><h3>Other texts</h3></div><div class="g2">${extra.map(input)}</div></div>` : ''}</div>
    <div class="savebar"><span class="sm mu">Changes are live on the website as soon as you save.</span><button type="button" class="btn p" data-act="ct.save">Save changes</button></div>`);
}, 'content');
act('ct.save', async () => {
  const D = CT.D; D.t = D.t || {};
  $$('[data-k]').forEach(i => { D.t[i.dataset.k] = i.value; });
  $$('[data-sv]').forEach(i => { D.stats[i.dataset.sv].v = i.value; }); $$('[data-sl]').forEach(i => { D.stats[i.dataset.sl].l = i.value; });
  D.shorts = $('#ctshorts').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100);
  await put('/api/content', D); ok('Saved. Refresh the website to see it.');
});

/* ================================================================ blog */
SQ.route('blog', async ctx => {
  const posts = await get('/api/posts');
  ctx.set(h`${SQ.head('Blog', 'Posts help people find you on Google. Each post gets its own page.')}
    <div class="two"><div>${posts.length ? h`<div class="list">${posts.map(p => h`<div class="li" style="grid-template-columns:minmax(0,1fr) auto"><div class="m"><div class="t trunc"><a href="/blog/${p.slug}" target="_blank" rel="noopener" style="color:inherit">${p.title}</a></div><div class="d"><span class="mono">/blog/${p.slug}</span></div></div><div class="e"><a class="btn s" href="/blog/${p.slug}" target="_blank" rel="noopener">${icon('ext')}View</a><button type="button" class="btn s d" data-act="bl.del" data-id="${p.id}">${icon('trash')}</button></div></div>`)}</div>` : empty('book', 'No posts yet', 'Write your first post on the right.')}</div>
      <div class="card sticky"><div class="ch"><h3>New post</h3></div><form id="blform" onsubmit="return false">
        <label class="f"><span class="h">Title</span><input class="in" name="title" maxlength="150" autocomplete="off"><div class="hint">Publishing with the same title replaces the old post.</div></label>
        <label class="f"><span class="h">Short description for Google</span><input class="in" name="descr" maxlength="300" autocomplete="off"></label>
        <label class="f"><span class="h">Text</span><textarea class="in" name="body" rows="12" placeholder="Leave an empty line between paragraphs. Start a line with ## for a heading."></textarea></label>
        <button type="button" class="btn p blk" data-act="bl.post">Publish post</button></form></div></div>`);
}, 'blog');
act('bl.post', async () => { const r = await post('/api/posts', SQ.fields($('#blform'))); ok('Published at /blog/' + r.slug); SQ.reload(); });
act('bl.del', async el => {
  if (!await SQ.confirm({ title: 'Delete this post?', text: 'The page disappears from the website.', ok: 'Delete', kind: 'd' })) return;
  await del('/api/posts/' + el.dataset.id); ok('Deleted.'); SQ.reload();
});

/* ================================================================ search settings */
const SE = { pages: [] };
const seoCount = el => {
  const hint = el.closest('label') && el.closest('label').querySelector('.hint'); if (!hint) return;
  const max = el.dataset.f === 'title' ? 60 : 160, n = (el.value || el.placeholder || '').length;
  hint.textContent = `Keep it under ${max} characters. ${n} now${el.value ? '' : ', automatic text'}.`;
  hint.style.color = n > max ? 'var(--warn)' : '';
};
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('[data-sp][data-f="title"],[data-sp][data-f="desc"]')) seoCount(e.target); });
SQ.onSearch('seo', v => {
  const q = v.trim().toLowerCase();
  SQ.$$('[data-find]').forEach(c => { c.style.display = q && !c.dataset.find.includes(q) ? 'none' : ''; });
});
SQ.route('seo', async ctx => {
  const j = await get('/api/seo'); SE.pages = j.pages;
  ctx.set(h`${SQ.head('Search settings', 'What Google shows for each page. Leave a field empty to keep the automatic text.')}
    ${SQ.bar2(SQ.searchBox('seo', '', 'Find a page, for example blog or private'))}
    <div class="col" style="gap:14px">${j.pages.map(([p, n, t, d], i) => { const o = j.SEO[p] || {}; return h`<div class="card" data-find="${(n + ' ' + p).toLowerCase()}"><div class="ch" style="margin-bottom:12px"><h3>${n}</h3><span class="mono xs mu">${p}</span></div>
      <label class="f"><span class="h">Title in search results</span><input class="in" data-sp="${i}" data-f="title" placeholder="${t}" value="${o.title || ''}" maxlength="120" autocomplete="off"><div class="hint">Keep it under 60 characters.</div></label>
      <label class="f"><span class="h">Description in search results</span><textarea class="in" rows="2" data-sp="${i}" data-f="desc" placeholder="${d}" maxlength="300">${o.desc || ''}</textarea><div class="hint">Keep it under 160 characters.</div></label>
      ${p === '/' ? '' : h`<label class="f" style="margin:0"><span class="h">Main heading on the page (H1)</span><input class="in" data-sp="${i}" data-f="h1" placeholder="${n}" value="${o.h1 || ''}" maxlength="120" autocomplete="off"></label>`}</div>`; })}</div>
    <div class="savebar"><span class="sm mu">Google can take a few days to show new texts.</span><button type="button" class="btn p" data-act="seo.save">Save changes</button></div>`);
  SQ.$$('[data-sp][data-f="title"],[data-sp][data-f="desc"]').forEach(seoCount);
}, 'seo');
act('seo.save', async () => {
  const o = {};
  $$('[data-sp]').forEach(i => { const p = SE.pages[i.dataset.sp][0]; (o[p] = o[p] || {})[i.dataset.f] = i.value; });
  await put('/api/seo', o); ok('Saved.');
});
