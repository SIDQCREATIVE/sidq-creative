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
    wa: '447362449938', ig: 'sidqcreative', whop: 'https://whop.com/sidq-creative/', discord: '',
    hServices: 'Our services', hShorts: 'Popular shorts', hProcess: 'How it works', hFounder: 'Meet the founder', hFaq: 'Frequently asked questions', hApply: 'Work with us', hCompare: 'Why SIDQ Creative', hStd: 'What we clip. What we skip.'
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

let SEO = {};  // custom titles, descriptions and headings saved in admin
const homePage = q => {
  const o = SEO['/'] || {}; let h = home.split('%SITE%').join(site(q));
  if (o.title) h = h.replace(/<title>.*?<\/title>/, `<title>${esc(o.title)}</title>`).replace(/(property="og:title" content=")[^"]*/, (m, a) => a + esc(o.title));
  if (o.desc) h = h.replace(/(name="description" content=")[^"]*/, (m, a) => a + esc(o.desc)).replace(/(property="og:description" content=")[^"]*/, (m, a) => a + esc(o.desc));
  return h;
};
app.get('/', (q, r) => r.type('html').send(homePage(q)));
app.get('/robots.txt', (q, r) => r.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${site(q)}/sitemap.xml\n`));
app.get('/sitemap.xml', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT slug, at FROM posts ORDER BY at DESC');
  const u = (p, d) => `<url><loc>${site(q)}${p}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  r.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u('/')}${u('/blog')}${LAND.map(x => u(x[0])).join('')}${u('/privacy')}${u('/terms')}${u('/resources')}${u('/tools/hook-generator')}${u('/content-standards')}${TOOLS.map(x => u(x[0])).join('')}${rows.map(p => u('/blog/' + p.slug, p.at)).join('')}</urlset>`);
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

Send us a stream link and tell us your goal.`],
['/compare/opusclip-alternative', 'SIDQ Creative vs OpusClip', 'OpusClip is an AI clipping tool. SIDQ Creative is a human clipping agency. See which one fits you.', `OpusClip is an AI tool that cuts long videos into short clips automatically. SIDQ Creative is a clipping agency with human editors and a clipper network. The right choice depends on how much work you want to do yourself.

## Choose a tool if

You have time to review every clip, your budget is small and you are fine with a generic style.

## Choose SIDQ Creative if

You want finished clips without the work, edits that match your brand, and a team that can also post and track results.

## Can you use both?

Yes. Some creators use a tool for quick drafts and an agency for the clips that matter most.`],
['/compare/submagic-alternative', 'SIDQ Creative vs Submagic', 'Submagic adds captions and effects with AI. SIDQ Creative adds human editors who choose the moments and polish every clip.', `Submagic is an AI tool that adds captions and effects to short videos. SIDQ Creative is an agency where human editors choose the moments, edit them and can post them for you.

## Choose a tool if

You already have the clips and only need fast captions and effects.

## Choose SIDQ Creative if

You start from long videos and want the whole job done: finding moments, editing, captions and posting.

## The best of both

We use AI for speed and people for polish, so every clip fits your brand.`],
['/compare/freelance-editors-alternative', 'SIDQ Creative vs Freelance Editors', 'Hiring a freelance editor or working with a clipping agency: how the two compare for steady short-form video.', `Freelance editors are a good fit for one-off jobs. A clipping agency is built for steady, repeatable work.

## With a freelancer

You find, brief and manage the person. Quality and speed depend on one individual.

## With SIDQ Creative

You work with a team. We find the moments, edit, and can post the clips, so you do not manage each step.

## Which is better?

For a single video, a freelancer may be enough. For a steady stream of clips every month, a team saves you time.`],
['/use-cases/youtube-video-clipping', 'YouTube Video Clipping', 'Turn long YouTube videos into Shorts, Reels and TikToks with our clipping team.', `Long YouTube videos hold dozens of moments that can work as shorts. We find them and turn them into clips.

## What we do

We pick the strongest moments, add hooks and captions, and prepare vertical clips for YouTube Shorts, Instagram Reels and TikTok.

## Why it helps

Shorts bring new viewers to your long videos and keep your channel active between uploads.

## Get started

Send us a video link and tell us your goal.`],
['/use-cases/twitch-kick-stream-clipping', 'Twitch and Kick Stream Clipping', 'We turn Twitch and Kick streams into short clips that bring new viewers to your channel.', `Streams are long, but the best moments are short. We turn them into clips that people share.

## What we do

We go through your streams or VODs, pick funny and exciting moments and edit them for short-form platforms.

## Why it helps

Clips keep working while you are offline and send new viewers to your next stream.

## Get started

Send us a stream link and tell us your goal.`],
['/use-cases/webinar-interview-clipping', 'Webinar and Interview Clipping', 'Turn webinars and interviews into short clips for LinkedIn, YouTube and Instagram.', `A one hour webinar or interview contains many short ideas worth sharing.

## What we do

We find the clear, useful moments and turn them into short clips with captions, ready for LinkedIn, YouTube Shorts and Instagram Reels.

## Who it is for

Brands, coaches, founders and hosts who want their expertise to reach more people.

## Get started

Send us the recording and tell us your goal.`],
["/youtube-clipping-agency", "YouTube Clipping Agency", "SIDQ Creative turns long videos into short clips for YouTube. Clean content, strong hooks and captions.", "We turn your long videos into clips made for YouTube: YouTube Shorts and long-form channels.\n\n## What we do\n\nWe find the strongest moments, edit them with captions and hooks, and prepare them for YouTube. We can also post them for you.\n\n## Why clip for YouTube\n\nShorts bring new viewers to your long videos and keep your channel active between uploads.\n\n## Our standards\n\nWe follow our content standards. We do not clip music promotion, gambling, alcohol, illegal, haram or adult content.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/tiktok-clipping-agency", "TikTok Clipping Agency", "SIDQ Creative turns long videos into short clips for TikTok. Clean content, strong hooks and captions.", "We turn your long videos into clips made for TikTok: vertical videos made to be watched quickly.\n\n## What we do\n\nWe find the strongest moments, edit them with captions and hooks, and prepare them for TikTok. We can also post them for you.\n\n## Why clip for TikTok\n\nTikTok is built around short vertical videos, so clips are a natural fit.\n\n## Our standards\n\nWe follow our content standards. We do not clip music promotion, gambling, alcohol, illegal, haram or adult content.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/instagram-clipping-agency", "Instagram Clipping Agency", "SIDQ Creative turns long videos into short clips for Instagram. Clean content, strong hooks and captions.", "We turn your long videos into clips made for Instagram: Reels and the Instagram feed.\n\n## What we do\n\nWe find the strongest moments, edit them with captions and hooks, and prepare them for Instagram. We can also post them for you.\n\n## Why clip for Instagram\n\nReels can bring your content to people who do not follow you yet.\n\n## Our standards\n\nWe follow our content standards. We do not clip music promotion, gambling, alcohol, illegal, haram or adult content.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/x-clipping-agency", "X Clipping Agency", "SIDQ Creative turns long videos into short clips for X. Clean content, strong hooks and captions.", "We turn your long videos into clips made for X: short video clips that fit the X timeline.\n\n## What we do\n\nWe find the strongest moments, edit them with captions and hooks, and prepare them for X. We can also post them for you.\n\n## Why clip for X\n\nShort clips are easy to share and repost on X.\n\n## Our standards\n\nWe follow our content standards. We do not clip music promotion, gambling, alcohol, illegal, haram or adult content.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/facebook-clipping-agency", "Facebook Clipping Agency", "SIDQ Creative turns long videos into short clips for Facebook. Clean content, strong hooks and captions.", "We turn your long videos into clips made for Facebook: Reels and the Facebook feed.\n\n## What we do\n\nWe find the strongest moments, edit them with captions and hooks, and prepare them for Facebook. We can also post them for you.\n\n## Why clip for Facebook\n\nFacebook Reels can reach large and varied audiences.\n\n## Our standards\n\nWe follow our content standards. We do not clip music promotion, gambling, alcohol, illegal, haram or adult content.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/halal-friendly-clipping-agency", "Halal-Friendly Clipping Agency", "Halal-Friendly Clipping Agency by SIDQ Creative: clean, well-edited short clips for your audience.", "If you want your clips to stay clean and respectful, you need a team that understands your boundaries.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe follow clear content standards: no music promotion, gambling, alcohol, illegal or haram content.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/islamic-lecture-clipping", "Islamic Lecture and Khutbah Clipping", "Islamic Lecture and Khutbah Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "Lectures and khutbahs contain short reminders that can reach many people.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe keep the full meaning of the speaker's words and add clear captions.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/muslim-podcast-clipping", "Muslim Podcast Clipping", "Muslim Podcast Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "Muslim podcasters can reach new listeners with short clips that respect their values.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe pick moments that explain your ideas well and keep the tone respectful.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/educational-content-clipping", "Educational Content Clipping", "Educational Content Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "Teachers and educators can turn lessons into short explainers that students can watch anywhere.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe turn each lesson into short clips with one clear takeaway.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/family-friendly-clipping-agency", "Family-Friendly Clipping Agency", "Family-Friendly Clipping Agency by SIDQ Creative: clean, well-edited short clips for your audience.", "Family-friendly channels need clips that stay clean from the first second to the last.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe check each clip against our content standards before it goes out.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/business-podcast-clipping", "Business and Entrepreneur Clipping", "Business and Entrepreneur Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "Business conversations are full of useful ideas that fit into 30 to 60 seconds.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe lead with the sharpest insight so busy viewers stop scrolling.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/self-improvement-clipping", "Self-Improvement Clipping", "Self-Improvement Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "Advice and motivation work well as short clips with clear hooks and captions.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe open with the strongest line and keep each clip focused on one idea.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/tech-review-clipping", "Tech News and Review Clipping", "Tech News and Review Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "Tech news and reviews can be cut into quick takes that viewers can watch in a minute.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe show the key verdict or feature in the first seconds.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/history-documentary-clipping", "History and Documentary Clipping", "History and Documentary Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "History and documentary channels have stories that can become short, gripping clips.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe choose the most surprising moments and keep the story easy to follow.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/fitness-coaching-clipping", "Fitness and Coaching Clipping", "Fitness and Coaching Clipping by SIDQ Creative: clean, well-edited short clips for your audience.", "Coaches can share tips and demonstrations as short clips that attract new clients.\n\n## What we do\n\nWe find the best moments, edit them with captions and hooks, and deliver clips for YouTube, TikTok, Instagram, X and Facebook.\n\n## How we work\n\nWe show the key tip clearly with captions so viewers can follow along.\n\n## Get started\n\nSend us a video and tell us your goal."],
["/clipper-guidelines", "Clipper Guidelines", "Guidelines for everyone who clips content with SIDQ Creative: clean content, honest edits and respect for creators.", "These guidelines apply to everyone who clips content with SIDQ Creative.\n\n## Follow the content standards\n\nDo not clip or promote music promotion, gambling, alcohol, illegal activities, haram content or adult content.\n\n## Keep the context\n\nDo not cut a clip in a way that changes what the speaker meant. Keep enough context so viewers understand.\n\n## Respect permission\n\nOnly clip content you have permission to clip. Do not claim that a page is official unless it is.\n\n## Be honest\n\nDo not buy fake views or use bots. Do not mislead people with titles that do not match the clip.\n\n## Quality\n\nUse clear captions, a strong first few seconds and clean audio.\n\n## Questions\n\nMessage us on WhatsApp at +44 7362 449938."]
];
LAND.forEach(([p, t, d, b]) => app.get(p, (q, r) => { const o = SEO[p] || {}; r.type('html').send(page(q, { title: o.title || t + ' | SIDQ Creative', desc: o.desc || d, path: p, type: 'website',
  body: `<h1>${esc(o.h1 || t)}</h1>${md(b)}<p><a href="https://wa.me/447362449938?text=${encodeURIComponent('Hi SIDQ Creative, I am interested in: ' + t)}"><b>Get a custom quote on WhatsApp</b></a></p>`,
  crumbs: [['Home', '/'], [t, p]],
  ld: { '@context': 'https://schema.org', '@type': 'Service', name: t, description: d, provider: { '@type': 'Organization', name: 'SIDQ Creative', url: site(q) }, areaServed: 'Worldwide' } })); }));

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
'/content-standards': ['Content Standards', `Last updated: October 2026.

SIDQ Creative clips content for everyone, on YouTube, TikTok, Instagram, X and Facebook. We keep our work clean. These standards apply to every project, whether our team makes the clips or our clippers post them.

## What we do not clip or promote

Music promotion. Gambling and betting. Alcohol. Illegal activities. Content that is haram. Adult or sexualized content.

## Why

We want our clients and clippers to be proud of every clip that carries our name.

## What this means for you

If your content includes any of the topics above, we may decline the project or ask you to remove those parts before we start. We may also stop a project if the content changes later.

## Our clippers

Clippers in our network must follow these standards. Clips that break them are not accepted.

## Questions

Message us on WhatsApp at +44 7362 449938.`],
'/terms': ['Terms of Service', `Last updated: October 2026.

By using this website or working with SIDQ Creative you agree to these terms.

## Our services

We provide clipping, editing and distribution services for long-form video. The scope, price and timing of each project are agreed with you in writing before work starts.

## Your content

You keep ownership of your content. You confirm that you have the right to give us the videos you send, and you allow us to edit, post and distribute clips of them for you.

## Content we do not accept

We do not work on content that promotes music, gambling, alcohol, illegal activities, haram content or adult content. See our Content Standards page. We may decline or stop a project that does not follow these standards.

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

app.get('/health', (q, r) => r.send('ok'));
app.get('/resources', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT slug, title FROM posts ORDER BY at DESC');
  r.type('html').send(page(q, { title: 'Resources | SIDQ Creative', desc: 'Guides, comparisons and free tools for creators who want more reach from short-form video.', path: '/resources', type: 'website',
    body: '<h1>Resources</h1><h2>Services and guides</h2>' + LAND.map(x => `<p><a href="${x[0]}">${esc(x[1])}</a></p>`).join('') + '<h2>Free tools</h2><p><a href="/tools/hook-generator">Short-form hook and title generator</a></p>' + TOOLS.map(x => `<p><a href="${x[0]}">${esc(x[1])}</a></p>`).join('') + '<h2>Blog</h2>' + rows.map(p => `<p><a href="/blog/${p.slug}">${esc(p.title)}</a></p>`).join('') }));
}));
app.get('/tools/hook-generator', (q, r) => r.type('html').send(page(q, { title: 'Free Short-Form Hook and Title Generator | SIDQ Creative', desc: 'Free tool: type your topic and get hook lines and titles for YouTube Shorts, Instagram Reels and TikTok.', path: '/tools/hook-generator', type: 'website', crumbs: [['Home', '/'], ['Hook generator', '/tools/hook-generator']],
  body: `<h1>Short-Form Hook and Title Generator</h1><p>Type your topic and get hook lines and titles for Shorts, Reels and TikTok.</p><input id="t" placeholder="Example: morning routine" style="width:100%;padding:12px;font-size:18px;background:#111;color:#fff;border:1px solid #333;border-radius:10px"><p><button id="g" style="padding:12px 24px;border:0;border-radius:99px;background:#b7e222;font-weight:700;cursor:pointer">Generate</button></p><div id="o"></div><script>const H=['Nobody tells you this about X','Stop doing X the hard way','I tried X for 30 days. Here is what happened','The biggest mistake people make with X','3 things I wish I knew about X before I started','Why X is harder than it looks','This is how X really works','If you do X, watch this first','What X experts will not tell you','Do this before you try X again'],T=['How to get better at X fast','X: the simple guide for beginners','X mistakes to avoid in 2026','What I learned about X','X explained in 60 seconds'];g.onclick=()=>{const x=t.value.replace(/[&<>"']/g,'').trim()||'your topic',f=a=>a.map(s=>'<li>'+s.replace(/X/g,x)+'</li>').join('');o.innerHTML='<h2>Hooks</h2><ul>'+f(H)+'</ul><h2>Titles</h2><ul>'+f(T)+'</ul><p><a href="/#apply"><b>Want us to edit your clips for you? Get a custom quote</b></a></p>'};</script>` })));

const TOOLS = [
["/tools/content-calendar", "30-Day Shorts Content Calendar Generator", "Free tool: type your topics and get a 30-day shorts posting plan.", "<h1>30-Day Shorts Content Calendar Generator</h1><p>Type your topics, one per line, and get a 30-day plan.</p><textarea id=\"t\" rows=\"6\" style=\"width:100%;padding:12px;font-size:17px;background:#111;color:#fff;border:1px solid #333;border-radius:10px\"></textarea><p><button id=\"g\" style=\"padding:12px 24px;border:0;border-radius:99px;background:#b7e222;font-weight:700;cursor:pointer\">Make my calendar</button></p><div id=\"o\"></div><script>const F=[\"Hook clip\",\"Quick tip\",\"Story\",\"Question for your audience\",\"Myth vs fact\",\"Behind the scenes\"];g.onclick=()=>{const L=t.value.split(\"\\n\").map(s=>s.replace(/[&<>\"']/g,\"\").trim()).filter(Boolean);if(!L.length)return;o.innerHTML=\"<ol>\"+Array.from({length:30},(_,i)=>\"<li>Day \"+(i+1)+\": \"+F[i%F.length]+\" about \"+L[i%L.length]+\"</li>\").join(\"\")+\"</ol><p><a href=\"/#apply\"><b>Want us to make these clips for you? Get a custom quote</b></a></p>\"}</script>"],
["/tools/caption-generator", "Caption Generator for Instagram, X and Facebook", "Free tool: type your topic, pick a platform and get caption ideas.", "<h1>Caption Generator for Instagram, X and Facebook</h1><p>Type your topic and pick a platform.</p><input id=\"t\" style=\"width:100%;padding:12px;font-size:17px;background:#111;color:#fff;border:1px solid #333;border-radius:10px\" placeholder=\"Example: podcast growth\"><p><select id=\"p\" style=\"width:100%;padding:12px;font-size:17px;background:#111;color:#fff;border:1px solid #333;border-radius:10px\"><option>Instagram</option><option>X</option><option>Facebook</option></select></p><p><button id=\"g\" style=\"padding:12px 24px;border:0;border-radius:99px;background:#b7e222;font-weight:700;cursor:pointer\">Generate</button></p><div id=\"o\"></div><script>const C=[\"Here is the one thing about # that changed everything.\",\"# in under a minute. Save this for later.\",\"Most people get # wrong. Watch to the end.\",\"If you care about #, this one is for you.\",\"What I wish I knew about # sooner.\"];g.onclick=()=>{const x=t.value.replace(/[&<>\"']/g,\"\").trim()||\"your topic\",lim=p.value===\"X\"?280:2200;o.innerHTML=\"<ul>\"+C.map(s=>s.replace(/#/g,x)).filter(s=>s.length<=lim).map(s=>\"<li>\"+s+\"</li>\").join(\"\")+\"</ul><p>Limit: \"+lim+\" characters.</p>\"}</script>"],
["/tools/caption-counter", "Caption and Title Length Checker", "Free tool: check your text against YouTube title, X post and Instagram caption limits.", "<h1>Caption and Title Length Checker</h1><p>Paste your text to see its length against common limits.</p><textarea id=\"t\" rows=\"6\" style=\"width:100%;padding:12px;font-size:17px;background:#111;color:#fff;border:1px solid #333;border-radius:10px\"></textarea><div id=\"o\"></div><script>t.oninput=()=>{const n=t.value.length,w=(t.value.match(/\\S+/g)||[]).length,r=(l,a)=>\"<p>\"+a+\": \"+(n<=l?\"OK\":\"<b>too long by \"+(n-l)+\"</b>\")+\" (limit \"+l+\")</p>\";o.innerHTML=\"<p><b>\"+n+\"</b> characters, <b>\"+w+\"</b> words</p>\"+r(100,\"YouTube title\")+r(280,\"X post\")+r(2200,\"Instagram caption\")}</script>"],
["/tools/timestamp-formatter", "Clip Timestamp Formatter", "Free tool: paste timestamps and notes, get a clean sorted list for your editors.", "<h1>Clip Timestamp Formatter</h1><p>Paste timestamps with a note, one per line. Example: 12:30 funny moment</p><textarea id=\"t\" rows=\"8\" style=\"width:100%;padding:12px;font-size:17px;background:#111;color:#fff;border:1px solid #333;border-radius:10px\"></textarea><p><button id=\"g\" style=\"padding:12px 24px;border:0;border-radius:99px;background:#b7e222;font-weight:700;cursor:pointer\">Format and sort</button></p><pre id=\"o\" style=\"white-space:pre-wrap\"></pre><script>g.onclick=()=>{const S=x=>x.split(\":\").reduce((a,b)=>a*60+(+b||0),0),P=n=>String(n).padStart(2,\"0\"),L=t.value.split(\"\\n\").map(l=>l.trim().match(/^(\\d{1,2}(?::\\d{2}){1,2})\\s*(.*)$/)).filter(Boolean).map(m=>[S(m[1]),m[2]]).sort((a,b)=>a[0]-b[0]);o.textContent=L.map(([s,n])=>P(Math.floor(s/3600))+\":\"+P(Math.floor(s%3600/60))+\":\"+P(s%60)+\" \"+n).join(\"\\n\")}</script>"],
["/content-checklist", "Is Your Content a Fit?", "A quick checklist: does your content follow our standards? Tick anything your content includes.", "<h1>Is Your Content a Fit?</h1><p>Tick anything your content includes.</p><form id=\"f\" style=\"line-height:2.2\"><label><input type=\"checkbox\"> Music promotion</label><br><label><input type=\"checkbox\"> Gambling or betting</label><br><label><input type=\"checkbox\"> Alcohol</label><br><label><input type=\"checkbox\"> Illegal activities</label><br><label><input type=\"checkbox\"> Haram content</label><br><label><input type=\"checkbox\"> Adult or sexualized content</label></form><div id=\"o\"></div><p><button onclick=\"print()\" style=\"padding:12px 24px;border:0;border-radius:99px;background:#b7e222;font-weight:700;cursor:pointer\">Print this page</button></p><script>f.onchange=()=>{o.innerHTML=f.querySelector(\"input:checked\")?\"<p><b>Some of this content is not a fit for us.</b> You can remove those parts before you send it.</p>\":\"<p><b>Your content looks like a fit.</b> <a href=\\\"/#apply\\\">Apply for a custom quote</a></p>\"};f.onchange()</script>"]
];
TOOLS.forEach(([p, t, d, h]) => app.get(p, (q, r) => r.type('html').send(page(q, { title: t + ' | SIDQ Creative', desc: d, path: p, type: 'website', crumbs: [['Home', '/'], [t, p]], body: h }))));
app.get('/.well-known/security.txt', (q, r) => r.type('text').send('Contact: https://wa.me/447362449938\nExpires: 2027-12-31T00:00:00.000Z\nPreferred-Languages: en\n'));
app.get('/api/seo', auth, (q, r) => r.json({ SEO, pages: [['/', 'Home page', (home.match(/<title>(.*?)<\/title>/) || [])[1] || '', (home.match(/name="description" content="([^"]*)/) || [])[1] || ''], ...LAND.map(x => [x[0], x[1], x[1] + ' | SIDQ Creative', x[2]])] }));
app.put('/api/seo', auth, wrap(async (q, r) => {
  const clean = {};
  for (const [p, o] of Object.entries(q.body || {})) if (o && typeof o === 'object') clean[clip(p, 100)] = { title: clip(o.title, 120), desc: clip(o.desc, 300), h1: clip(o.h1, 120) };
  SEO = clean;
  await db.query('INSERT INTO content (id, data) VALUES (4, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = $1::jsonb', [JSON.stringify(clean)]);
  r.json({ ok: true });
}));
app.get('/admin', (q, r) => r.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', index: false }));
app.use((q, r) => r.status(404).type('html').send(page(q, { title: 'Page not found | SIDQ Creative', desc: 'Page not found', path: '/', type: 'website', body: '<h1>Page not found</h1><p><a href="/">Back to the home page</a></p><p><a href="/blog">Blog</a> | <a href="/resources">Resources</a> | <a href="/#apply">Contact us</a></p>' })));

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

const SEED3 = [
['How to Clip a Podcast Without Music', 'You can make strong podcast clips without background music. Learn how to hold attention with voice, captions and sound effects.', `Many viewers prefer clean clips without background music. You can still make clips that hold attention.

## Start with the voice

Clear audio and a strong first sentence matter more than any track.

## Use captions

Big, easy captions keep people watching, even on mute.

## Add sound effects with care

Short sound effects at key moments can add emphasis. Keep them light so the speaker stays in focus.

## Keep the edit tight

Cut pauses and filler words. A fast, clean edit feels lively without music.

SIDQ Creative follows clean content standards in every project.`],
['Sound Effects vs Music in Shorts: What Keeps People Watching', 'Compare sound effects and music in short videos, and learn when each one helps.', `Both sound effects and music can change how a short feels. They do different jobs.

## What sound effects do

They mark a moment: a cut, a reveal or a punchline. They are short and do not compete with the voice.

## What music does

Music sets a mood, but it can cover the speaker, and some creators avoid it for personal or brand reasons.

## How to choose

If your content is speech-led, such as a podcast or a lecture, start with voice, captions and a few sound effects. Test different versions and watch which one people finish.`],
['Captions for Viewers Who Watch on Mute', 'Most people scroll fast and many watch with the sound off. Learn how to write and place captions that work.', `Most viewers scroll fast, and many watch with the sound off. Captions let them follow along.

## Keep them short

Show a few words at a time so the eye can keep up.

## Make them readable

Use a clear font, strong contrast and a size that fits a phone screen.

## Place them well

Keep captions away from the edges and from buttons that apps place on top of the video.

## Check the words

Auto captions make mistakes. Read them before you post.`],
['How to Clip a Debate Fairly: Keep the Context', 'Debates are easy to clip unfairly. Learn how to make clips that show what people really meant.', `Debates are easy to clip unfairly. A clip should show what the person meant.

## Keep the question

Include the question or claim the person is answering.

## Do not cut mid-thought

Let the speaker finish the point, even if it takes a few more seconds.

## Show what is being answered

If a clip is about a disagreement, make sure viewers can see what is being disagreed with.

## Write honest titles

The title should match what happens in the clip.

Fair clips keep trust, and trust keeps viewers.`],
['How to Get Permission to Clip Someone Else\'s Show', 'Clipping a show without permission can lead to takedowns. Learn who to ask and what to say.', `Clipping someone else's show without permission can lead to takedowns or worse. Ask first.

## Who to ask

The creator, the host or the team that manages the show.

## What to ask

Say which platforms you will post on, how you will credit the show and how you will edit the clips.

## Get it in writing

A short email or message is enough to keep a record.

## Follow the answer

If they say no, or ask you to remove a clip, do it.

This is general advice, not legal advice.`],
['Rules for Running a Fan Page the Right Way', 'A fan page can help a creator and grow your audience. Follow these simple rules to do it well.', `A fan page celebrates a creator's work. Done well, it helps the creator and the page.

## Say it is a fan page

Use the words fan page in the name or bio so nobody thinks it is official.

## Credit the source

Name the creator and link to the full video.

## Ask for permission

Tell the creator what you are doing and listen to the answer.

## Remove content on request

If the creator asks you to take something down, do it quickly.

## Keep it clean

Post only content that fits your own standards and the platform rules.

This is general advice, not legal advice.`]
];
async function seed3() {
  if ((await db.query('SELECT 1 FROM content WHERE id = 5')).rowCount) return;
  for (const [t, d, b] of SEED3) await db.query('INSERT INTO posts (slug, title, descr, body) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING', [slugify(t), t, d, b]);
  await db.query(`INSERT INTO content (id, data) VALUES (5, '{"seeded":3}') ON CONFLICT (id) DO NOTHING`);
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
  await seed3();
  const sr = (await db.query('SELECT data FROM content WHERE id = 4')).rows[0]; if (sr) SEO = sr.data;
  app.listen(process.env.PORT || 3000, () => console.log('SIDQ Creative is running'));
})().catch(e => { console.error('Database error:', e.message); process.exit(1); });
