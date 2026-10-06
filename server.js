const express = require('express'), compression = require('compression'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Pool } = require('pg');
const app = express();
app.set('trust proxy', 1);
if (process.env.SITE_URL) {  // send www to the main address
  const main = new URL(process.env.SITE_URL);
  app.use((q, r, n) => q.get('host') === 'www.' + main.host ? r.redirect(301, main.origin + q.originalUrl) : n());
}
app.use(compression());
app.use((q, r, n) => { r.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' }); n(); });

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. In Railway, add a PostgreSQL database and link DATABASE_URL to this service.');
  process.exit(1);
}
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const PASS = process.env.ADMIN_PASSWORD || '', SECRET = process.env.SECRET || PASS;

const DEFAULT = {
  t: {
    heroA: 'BE EVERYWHERE.', heroB: 'ALL AT ONCE.',
    sub: 'One video. Hundreds of clips. Millions of views. SIDQ Creative turns your long-form content into shorts that reach new people every day.',
    whyH: 'Why short content',
    why: 'Attention is the new currency. Short videos win on every platform and grow your audience faster than any other format.',
    fName: 'Ahtisham', fRole: 'Founder', f1: '100K', f1l: 'Subscribers', f2: '30M+', f2l: 'Gaming views', fImg: '/founder-bw.jpg', fImg2: '/founder-color.jpg',
    email: 'hello@sidqcreative.com',
    wa: '447362449938', ig: 'sidqcreative', whop: 'https://whop.com/sidq-creative/', discord: ''
  },
  stats: [
    { v: '100M+', l: 'Views generated' }, { v: '1K+', l: 'Public clippers' },
    { v: '20', l: 'Private clippers' }, { v: '5M–50M', l: 'Monthly views' }
  ],
  shorts: [
    '/videos/diary-1.mp4 | Diary of a CEO', '/videos/diary-2.mp4 | Diary of a CEO',
    '/videos/lacy-1.mp4 | Lacy', '/videos/lacy-2.mp4 | Lacy', '/videos/rubio-1.mp4 | Marco Rubio'
  ]
};

const mac = x => crypto.createHmac('sha256', SECRET).update(String(x)).digest('hex');
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const valid = t => { const [a, b] = String(t || '').split('.'); return +a > Date.now() && b === mac(a); };
const auth = (q, r, n) => valid(q.get('x-token')) ? n() : r.status(401).json({ error: 'Log in again' });
const clip = (s, n) => String(s || '').slice(0, n);
const wrap = f => (q, r, n) => Promise.resolve(f(q, r, n)).catch(e => { console.error(e); r.status(500).json({ error: 'Server error' }); });

let tries = 0, leadHits = 0;
setInterval(() => { tries = 0; leadHits = 0; }, 60000);
app.use(express.json({ limit: '1mb' }));

app.get('/api/content', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT data FROM content WHERE id = 1');
  r.json(rows[0] ? rows[0].data : DEFAULT);
}));

app.post('/api/login', (q, r) => {
  if (!PASS) return r.status(503).json({ error: 'Set ADMIN_PASSWORD in Railway Variables first' });
  if (++tries > 10) return r.status(429).json({ error: 'Too many tries. Wait a minute.' });
  if (!crypto.timingSafeEqual(hash(q.body.password), hash(PASS))) return r.status(401).json({ error: 'Wrong password' });
  const exp = Date.now() + 864e5;
  r.json({ token: exp + '.' + mac(exp) });
});

app.put('/api/content', auth, wrap(async (q, r) => {
  const b = q.body;
  if (!b || typeof b.t !== 'object' || !Array.isArray(b.stats) || !Array.isArray(b.shorts)) return r.status(400).json({ error: 'Bad data' });
  await db.query('INSERT INTO content (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = $1::jsonb', [JSON.stringify(b)]);
  r.json({ ok: true });
}));

app.post('/api/lead', wrap(async (q, r) => {
  if (++leadHits > 20) return r.status(429).json({ error: 'Too many requests' });
  const b = q.body || {};
  await db.query('INSERT INTO leads (type, name, email, phone, budget, msg, src) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [b.type === 'clipper' ? 'clipper' : 'customer', clip(b.name, 80), clip(b.email, 120), clip(b.phone, 40), clip(b.budget, 200), clip(b.msg, 1000), clip(b.src, 120)]);
  r.json({ ok: true });
}));

app.get('/api/leads', auth, wrap(async (q, r) => {
  const { rows } = await db.query('SELECT id, at, type, name, email, phone, budget, msg, seen, src FROM leads ORDER BY id DESC LIMIT 1000');
  r.json(rows);
}));

// ---------- SEO: home page, robots, sitemap, blog ----------
const home = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const site = q => (process.env.SITE_URL || q.protocol + '://' + q.get('host')).replace(/\/$/, '');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const md = t => String(t).split(/\n{2,}/).map(b => /^## /.test(b) ? `<h2>${esc(b.slice(3))}</h2>` : `<p>${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
const CSS = 'body{background:#000;color:#fff;font:18px/1.7 system-ui,sans-serif;max-width:720px;margin:auto;padding:32px 20px}a{color:#b7e222}h1{font-size:clamp(32px,6vw,52px);line-height:1.05;letter-spacing:-.03em}h2{margin-top:1.8em;line-height:1.2}small{color:#8f8f8f}article{border-top:1px solid #242424;padding:22px 0}';
const page = (q, o) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title><meta name="description" content="${esc(o.desc)}"><link rel="canonical" href="${site(q)}${o.path}"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.desc)}"><meta property="og:url" content="${site(q)}${o.path}"><meta property="og:type" content="${o.type || (o.ld ? 'article' : 'website')}">${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, '\\u003c')}</script>` : ''}<link rel="icon" href="/favicon.png"><link rel="alternate" type="application/rss+xml" href="/rss.xml">${o.crumbs ? '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: o.crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: site(q) + c[1] })) }).replace(/</g, '\\u003c') + '</script>' : ''}<style>${CSS}</style></head><body><p><a href="/">SIDQ Creative</a> | <a href="/blog">Blog</a></p>${o.body}<p style="margin-top:3em"><a href="/#apply"><b>Work with SIDQ Creative</b></a> | <a href="/blog">More articles</a> | <a href="/privacy">Privacy</a> | <a href="/terms">Terms</a></p></body></html>`;

app.get('/', (q, r) => r.type('html').send(home.split('%SITE%').join(site(q))));
app.get('/robots.txt', (q, r) => r.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${site(q)}/sitemap.xml\n`));
app.get('/sitemap.xml', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT slug, at FROM posts ORDER BY at DESC');
  const u = (p, d) => `<url><loc>${site(q)}${p}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  r.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u('/')}${u('/blog')}${LAND.map(x => u(x[0])).join('')}${u('/privacy')}${u('/terms')}${rows.map(p => u('/blog/' + p.slug, p.at)).join('')}</urlset>`);
}));

app.get('/blog', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT slug, title, descr, at FROM posts ORDER BY at DESC LIMIT 100');
  r.type('html').send(page(q, { title: 'Blog | SIDQ Creative', desc: 'Tips on short-form clipping, viral shorts and growing your channel.', path: '/blog',
    body: '<h1>Blog</h1>' + (rows.map(p => `<article><h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2><p>${esc(p.descr)}</p><small>${new Date(p.at).toDateString()}</small></article>`).join('') || '<p>First posts are coming soon.</p>') }));
}));

app.get('/blog/:slug', wrap(async (q, r) => {
  const p = (await db.query('SELECT * FROM posts WHERE slug = $1', [q.params.slug])).rows[0];
  if (!p) return r.status(404).send(page(q, { title: 'Not found | SIDQ Creative', desc: 'Post not found', path: '/blog', body: '<h1>Post not found</h1>' }));
  const rel = (await db.query('SELECT slug, title FROM posts WHERE slug <> $1 ORDER BY at DESC LIMIT 3', [p.slug])).rows;
  r.type('html').send(page(q, { title: p.title + ' | SIDQ Creative', desc: p.descr, path: '/blog/' + p.slug, crumbs: [['Home', '/'], ['Blog', '/blog'], [p.title, '/blog/' + p.slug]],
    body: `<h1>${esc(p.title)}</h1><small>${new Date(p.at).toDateString()} | ${Math.max(1, Math.round(p.body.split(/\s+/).length / 200))} min read</small>${md(p.body)}<hr><p><b>Written by Ahtisham</b>, founder of SIDQ Creative and a gaming creator with 100K subscribers and 30M+ views.</p><h2>More to read</h2>${rel.map(x => `<p><a href="/blog/${x.slug}">${esc(x.title)}</a></p>`).join('')}`,
    ld: { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.descr, datePublished: p.at,
      author: { '@type': 'Person', name: 'Ahtisham' }, publisher: { '@type': 'Organization', name: 'SIDQ Creative' } } }));
}));

app.post('/api/leads/seen', auth, wrap(async (q, r) => { await db.query('UPDATE leads SET seen = true WHERE type = $1', [clip(q.body.type, 20)]); r.json({ ok: true }); }));
app.delete('/api/leads/:id', auth, wrap(async (q, r) => { await db.query('DELETE FROM leads WHERE id = $1', [+q.params.id || 0]); r.json({ ok: true }); }));
app.get('/api/posts', auth, wrap(async (q, r) => r.json((await db.query('SELECT id, slug, title FROM posts ORDER BY at DESC')).rows)));
app.post('/api/posts', auth, wrap(async (q, r) => {
  const b = q.body || {}, slug = clip(b.title, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug || !b.body) return r.status(400).json({ error: 'Title and text are needed' });
  await db.query('INSERT INTO posts (slug, title, descr, body) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO UPDATE SET title=$2, descr=$3, body=$4',
    [slug, clip(b.title, 150), clip(b.descr, 300), clip(b.body, 50000)]);
  r.json({ ok: true, slug });
}));
app.delete('/api/posts/:id', auth, wrap(async (q, r) => { await db.query('DELETE FROM posts WHERE id = $1', [+q.params.id || 0]); r.json({ ok: true }); }));

// ---------- landing pages, legal pages, RSS, 404 ----------
const LAND = [
['/services/private-clipping', 'Private Clipping Service', 'A dedicated team of vetted clippers works only on your content, with consistent quality and full control.', `Private clipping gives you a small, trusted team that works only on your content.

## What you get

Clippers who learn your style, follow your rules and deliver clips with consistent quality. Your raw footage stays inside the team.

## Best for

Podcasters, streamers and brands that care about quality, privacy and control over how their content looks.

## How it works

You send the long video. Our team finds the best moments, edits them and delivers clips that are ready to post, or posts them for you.`],
['/services/public-clipping', 'Public Clipping Network', 'Our open network of clippers cuts and posts your content across many pages to give you wide reach.', `Public clipping uses a large open network of clippers who make and post clips of your content on their own pages.

## What you get

Wide reach across many audiences at once, because many clippers post in parallel on different pages.

## Best for

Creators and podcasts that want more reach and views and are happy to share their content with a network.

## How it works

You share your long video and the rules. Clippers cut and post clips, and views are counted so you can see what the network delivered.`],
['/services/short-form-editing', 'Short-Form Video Editing', 'Pro editors turn your footage into fast, captioned shorts with strong hooks, pacing and graphics.', `Our editors turn long footage into short videos built to hold attention.

## What is included

A strong hook in the first seconds, tight pacing, clear captions, sound design and clean vertical framing.

## Best for

Creators who post on their own channel and need polished videos without hiring an in-house editor.

## How it works

Send the raw video. We select the moments, edit them and send back finished clips, ready to upload to YouTube Shorts, Instagram Reels and TikTok.`],
['/services/editing-and-content-writing', 'Short-Form Editing and Content Writing', 'Edited shorts plus hooks, titles and captions written for you, so every clip is ready to post.', `This service adds writing to our editing. Every clip comes with the words that help it perform.

## What is included

Edited shorts, plus hooks, titles, captions and descriptions written for each platform.

## Best for

Busy creators and brands who want to post consistently without writing copy for every clip.

## How it works

You send the long video and a few notes about your audience. We deliver the clips and the text, ready to post.`],
['/podcast-clipping-agency', 'Podcast Clipping Agency', 'SIDQ Creative turns podcast episodes into short clips that bring new listeners and viewers.', `A podcast episode is full of moments that can reach new people. Our podcast clipping agency finds them and turns them into shorts.

## Why clip your podcast

Short clips are the easiest way for new listeners to find your show on YouTube Shorts, Instagram Reels and TikTok.

## What we do

We find the strongest moments, edit them with captions and hooks, and deliver clips or post them for you. We also offer a B2B pipeline for brands that use a podcast to win customers.

## Get started

Send us an episode and tell us your goal.`],
['/streamer-clipping-agency', 'Streamer Clipping Agency', 'We turn streams and gaming content into short clips that grow your audience.', `Streams are long, but the best moments are short. Our streamer clipping agency finds funny, exciting and viral moments and turns them into shorts.

## Why it works

Short clips bring new viewers to your channel while you are offline.

## What we do

We watch your streams or VODs, pick the best moments and edit them for YouTube Shorts, Instagram Reels and TikTok. Our founder is a gaming creator with 100K subscribers and 30M+ views, so we know what gamers like to watch.

## Get started

Send us a stream link and tell us your goal.`]
];
LAND.forEach(([p, t, d, b]) => app.get(p, (q, r) => r.type('html').send(page(q, { title: t + ' | SIDQ Creative', desc: d, path: p, type: 'website',
  body: `<h1>${esc(t)}</h1>${md(b)}<p><a href="https://wa.me/447362449938?text=${encodeURIComponent('Hi SIDQ Creative, I am interested in: ' + t)}"><b>Get a custom quote on WhatsApp</b></a></p>`,
  crumbs: [['Home', '/'], [t, p]],
  ld: { '@context': 'https://schema.org', '@type': 'Service', name: t, description: d, provider: { '@type': 'Organization', name: 'SIDQ Creative', url: site(q) }, areaServed: 'Worldwide' } }))));

const LEGAL = {
'/privacy': ['Privacy Policy', `Last updated: October 2026.

SIDQ Creative runs this website. This policy explains what information we collect and how we use it.

## What we collect

When you fill in our form we collect your name, email, phone number, your budget or links and your message. We also record the website or link you came from. If you contact us on WhatsApp or Instagram, those services handle your messages under their own policies.

## How we use it

We use your information to reply to you, prepare quotes and run our service. We do not sell your information.

## Who sees it

Only our team. We use hosting and database providers to run the site, and they process data on our behalf.

## How long we keep it

We keep applications only as long as we need them to talk with you. You can ask us to delete your data at any time.

## Your rights

You can ask to see, correct or delete your information. Message us on WhatsApp at +44 7362 449938.

## Cookies

We do not use advertising cookies. If we add analytics later, we will update this page.`],
'/terms': ['Terms of Service', `Last updated: October 2026.

By using this website or working with SIDQ Creative you agree to these terms.

## Our services

We provide clipping, editing and distribution services for long-form video. The scope, price and timing of each project are agreed with you in writing before work starts.

## Your content

You keep ownership of your content. You confirm that you have the right to give us the videos you send, and you allow us to edit, post and distribute clips of them for you.

## Results

We work hard to grow your reach, but we cannot promise a specific number of views, followers or sales. Platform rules and algorithms change.

## Payments

Fees are agreed in advance. Unless we agree otherwise, work starts after payment is confirmed.

## Confidentiality

We keep your unreleased content private and share it only with the editors working on your project.

## Changes

We may update these terms. The latest version is always on this page.

## Contact

Message us on WhatsApp at +44 7362 449938.`]
};
Object.entries(LEGAL).forEach(([p, [t, b]]) => app.get(p, (q, r) => r.type('html').send(page(q, { title: t + ' | SIDQ Creative', desc: t + ' for SIDQ Creative.', path: p, type: 'website', body: `<h1>${esc(t)}</h1>${md(b)}` }))));

app.get('/rss.xml', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT slug, title, descr, at FROM posts ORDER BY at DESC LIMIT 50');
  r.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>SIDQ Creative Blog</title><link>${site(q)}/blog</link><description>Tips on clipping and short-form video</description>${rows.map(p => `<item><title>${esc(p.title)}</title><link>${site(q)}/blog/${p.slug}</link><description>${esc(p.descr)}</description><pubDate>${new Date(p.at).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`);
}));

app.get('/admin', (q, r) => r.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', index: false }));
app.use((q, r) => r.status(404).type('html').send(page(q, { title: 'Page not found | SIDQ Creative', desc: 'Page not found', path: '/', type: 'website', body: '<h1>Page not found</h1><p><a href="/">Back to the home page</a></p>' })));

const SEED = [
['OpusClip vs a Clipping Agency: Which One Fits Your Channel?', 'OpusClip is an AI clipping tool. A clipping agency uses people. Learn when each one is the better choice.', `OpusClip is an AI tool that cuts a long video into short clips automatically. A clipping agency does the same job with a team of people. Both can work, but they suit different creators.

## What an AI clipping tool does well

It is fast and low cost. You upload a video and get many clips in minutes. It suits creators who want a quick first draft and have time to review every clip.

## Where a clipping agency is stronger

A human editor understands your audience, your humor and your brand. An agency picks the moments that fit your channel, edits them with care, and can also post the clips and track results.

## Which should you choose?

Choose a tool if your budget is small and you are happy to do the checking yourself. Choose an agency if you want finished clips without the work and someone responsible for the result. SIDQ Creative gives you that team: send one long video and we turn it into short clips ready to upload.`],
['Submagic vs Human Editors: Where Each One Wins', 'Submagic is an AI tool for captions and effects. Human editors add judgment. See how they compare.', `Submagic is an AI tool that adds captions and effects to short videos. Human editors do more than captions. Here is where each one wins.

## What Submagic-style tools do well

Auto captions, quick effects and fast turnaround. They save time on the repetitive parts of editing.

## What human editors add

Editors decide which moment to cut, how to open with a strong hook, how fast the pacing should be and which graphics help the story. These choices keep people watching.

## The best of both

At SIDQ Creative we use AI for speed and people for polish. The tool handles the repeat work, and our editors make sure every clip fits your brand and holds attention.`],
['Clipping Agency vs Ads Marketing: Which Grows Your Brand Faster?', 'Ads buy attention. Clipping builds it. See how the two compare for creators and brands.', `Paid ads and clipping both bring attention, but in different ways.

## How ads work

You pay for each view or click. Results start fast and stop when the budget stops.

## How clipping works

Clippers turn your existing long videos into many short clips and post them on many pages. Each clip can keep getting views after it is posted, and you build a library of content instead of renting attention.

## Which is better for your brand?

Ads suit a product launch or a sale with a clear deadline. Clipping suits creators, podcasts and brands that want steady organic growth. Many brands use both: ads for quick pushes and clipping for long-term reach. If you already make long videos, clipping is often the better first step.`],
['What Is a Clipping Agency and How Does It Work?', 'A clipping agency turns long videos into short clips. Learn how the process works from upload to posting.', `A clipping agency turns long videos, such as podcasts, streams and YouTube videos, into short clips for platforms like YouTube Shorts, Instagram Reels and TikTok.

## What the work looks like

First, the team finds the strongest moments in your video. Then editors cut them, add captions and graphics, and prepare each clip for every platform. Finally the clips are posted by the agency or by a network of clippers.

## Who needs one?

Podcasters, streamers, coaches and brands that already record long content but do not have time to make shorts.

## How SIDQ Creative works

You send raw footage. We find the best parts, edit them and deliver clips that are ready to upload. One long video can become many shorts.`],
['Private Clipping vs Public Clipping: What Is the Difference?', 'Private clipping uses a dedicated team. Public clipping uses an open network. Learn which one fits you.', `Clipping agencies often offer two models: private clipping and public clipping.

## Private clipping

A small, trusted team works only on your content. They learn your style, follow your rules and edit with consistent quality. This is best when your brand needs control.

## Public clipping

An open network of clippers makes and posts clips of your content on their own pages. You reach many audiences at once, and the network can post at a large scale.

## Which one is right for you?

Choose private for quality and control. Choose public for reach. Many creators use both. SIDQ Creative runs both a private team and a public clipper network, so you can start with one and add the other.`],
['How to Choose a Clipping Agency: 4 Services to Compare', 'Not every clipping agency offers the same services. Here is what to compare before you hire one.', `Not every clipping agency offers the same services. Before you hire one, check what they actually do.

## Services to look for

Private clipping: a dedicated team for your content.

Public clipping: a large network that spreads your clips.

Short-form editing: pro editing with captions, pacing and graphics.

Short-form editing plus content writing: edited clips with hooks, titles and captions written for you.

## Questions to ask

How do they find the best moments? Who edits the clips? Can you see examples? How do they report results?

## Why choose SIDQ Creative

We offer all four services, so you do not need to hire separate teams. Tell us what you need and we build a plan around it.`]
];
const slugify = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
async function seed() {
  if ((await db.query('SELECT 1 FROM content WHERE id = 2')).rowCount) return;
  for (const [t, d, b] of SEED) await db.query('INSERT INTO posts (slug, title, descr, body) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [slugify(t), t, d, b]);
  await db.query(`INSERT INTO content (id, data) VALUES (2, '{"seeded":true}') ON CONFLICT (id) DO NOTHING`);
}

const SEED2 = [
['How Much Does a Clipping Agency Cost? What Affects the Price', 'The price of a clipping agency depends on volume, channels and distribution. See what changes the cost.', `There is no single price for a clipping agency. The cost depends on what you need. These are the main things that change it.

## How many clips you need

Ten clips a month and fifty clips a month are very different jobs. More clips mean more editing time.

## How many channels we run

Running one channel is simpler than running several. Each extra channel needs its own posting plan and tracking.

## The level of editing

Simple cuts with captions cost less than full edits with color grading, graphics and split-screen framing.

## Distribution

Some clients only want the files. Others also want a clipper network that posts across many pages, and pay by views.

## Extras

Written content such as hooks, titles and LinkedIn posts adds to the work, and so do reports.

## How to get a price

Tell us about your show, your goal and how many channels you want. We send a custom quote. Message us on WhatsApp or fill in the form.`],
['OpusClip and Submagic Alternatives: When to Hire People Instead', 'Looking for an OpusClip or Submagic alternative? Learn when a human clipping team is the better choice.', `AI tools like OpusClip and Submagic save time. But many creators look for alternatives when the results feel generic.

## Signs a tool is not enough

The clips pick moments that do not fit your style. Captions look the same as everyone else's. You still spend hours reviewing, fixing and posting.

## What a human team adds

Editors choose moments that fit your audience, add pacing and graphics that match your brand, and deliver finished clips. A clipping agency can also post the clips and track results.

## A simple way to decide

Try a tool first if your budget is small. Hire a team when your time is worth more than the tool saves, or when you want a steady stream of clips without managing it. Message us on WhatsApp for a custom quote.`],
['How to Turn a Podcast Into 30 Shorts', 'A simple 5-step process to cut one long podcast episode into dozens of short clips.', `One podcast episode has enough material for dozens of shorts. Follow this process.

## Step 1: Watch for strong moments

Look for a surprising fact, a strong opinion, a story with a clear ending or a funny reaction. Mark each one with a time.

## Step 2: Start with a hook

The first three seconds decide if people stay. Open with the most interesting sentence, even if it came later in the conversation.

## Step 3: Cut tight

Remove pauses and filler words. Keep each clip focused on one idea.

## Step 4: Add captions and framing

Use clear captions and a vertical layout so the speaker fills the screen.

## Step 5: Post on every platform

Share each clip on YouTube Shorts, Instagram Reels and TikTok.

If you would rather skip the work, send us the episode and our team does all five steps.`],
['What Is CPM Clipping and How Does It Work?', 'CPM clipping means you pay per 1,000 verified views. Learn how it works and when it makes sense.', `CPM stands for cost per thousand views. In CPM clipping you pay a set rate for every 1,000 verified views your clips earn, instead of a flat fee.

## How it works

You share your long video. A network of clippers cuts it into short clips and posts them across many fan channels. The views are counted, verified and billed at the agreed rate. You can set a monthly limit so your spending never goes over your budget.

## Why creators like it

You pay for delivered views, so the cost follows the results. It also puts your content on many channels at once.

## When it makes sense

It works best for podcasts and creators that already have long videos and want more reach. SIDQ Creative runs this as the Managed Distribution Network, with a rate agreed in advance.`]
];
async function seed2() {
  if ((await db.query('SELECT 1 FROM content WHERE id = 3')).rowCount) return;
  for (const [t, d, b] of SEED2) await db.query('INSERT INTO posts (slug, title, descr, body) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [slugify(t), t, d, b]);
  await db.query(`INSERT INTO content (id, data) VALUES (3, '{"seeded":2}') ON CONFLICT (id) DO NOTHING`);
}

(async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS content (id INT PRIMARY KEY, data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS leads (id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
      type TEXT, name TEXT, email TEXT, phone TEXT, budget TEXT, msg TEXT);
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS src TEXT;
    CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      descr TEXT, body TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  await seed();
  await seed2();
  app.listen(process.env.PORT || 3000, () => console.log('SIDQ Creative is running'));
})().catch(e => { console.error('Database error:', e.message); process.exit(1); });
