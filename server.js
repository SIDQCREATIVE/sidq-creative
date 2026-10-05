const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Pool } = require('pg');
const app = express();
app.set('trust proxy', 1);

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
    email: 'hello@sidqcreative.com'
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
  await db.query('INSERT INTO leads (type, name, email, phone, budget, msg) VALUES ($1,$2,$3,$4,$5,$6)',
    [b.type === 'clipper' ? 'clipper' : 'customer', clip(b.name, 80), clip(b.email, 120), clip(b.phone, 40), clip(b.budget, 200), clip(b.msg, 1000)]);
  r.json({ ok: true });
}));

app.get('/api/leads', auth, wrap(async (q, r) => {
  const { rows } = await db.query('SELECT id, at, type, name, email, phone, budget, msg, seen FROM leads ORDER BY id DESC LIMIT 1000');
  r.json(rows);
}));

// ---------- SEO: home page, robots, sitemap, blog ----------
const home = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const site = q => (process.env.SITE_URL || q.protocol + '://' + q.get('host')).replace(/\/$/, '');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const md = t => String(t).split(/\n{2,}/).map(b => /^## /.test(b) ? `<h2>${esc(b.slice(3))}</h2>` : `<p>${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
const CSS = 'body{background:#000;color:#fff;font:18px/1.7 system-ui,sans-serif;max-width:720px;margin:auto;padding:32px 20px}a{color:#b7e222}h1{font-size:clamp(32px,6vw,52px);line-height:1.05;letter-spacing:-.03em}h2{margin-top:1.8em;line-height:1.2}small{color:#8f8f8f}article{border-top:1px solid #242424;padding:22px 0}';
const page = (q, o) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title><meta name="description" content="${esc(o.desc)}"><link rel="canonical" href="${site(q)}${o.path}"><meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.desc)}"><meta property="og:url" content="${site(q)}${o.path}"><meta property="og:type" content="${o.ld ? 'article' : 'website'}">${o.ld ? `<script type="application/ld+json">${JSON.stringify(o.ld).replace(/</g, '\\u003c')}</script>` : ''}<link rel="icon" href="/favicon.png"><style>${CSS}</style></head><body><p><a href="/">SIDQ Creative</a> | <a href="/blog">Blog</a></p>${o.body}</body></html>`;

app.get('/', (q, r) => r.type('html').send(home.split('%SITE%').join(site(q))));
app.get('/robots.txt', (q, r) => r.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${site(q)}/sitemap.xml\n`));
app.get('/sitemap.xml', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT slug, at FROM posts ORDER BY at DESC');
  const u = (p, d) => `<url><loc>${site(q)}${p}</loc>${d ? `<lastmod>${new Date(d).toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
  r.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u('/')}${u('/blog')}${rows.map(p => u('/blog/' + p.slug, p.at)).join('')}</urlset>`);
}));

app.get('/blog', wrap(async (q, r) => {
  const { rows } = await db.query('SELECT slug, title, descr, at FROM posts ORDER BY at DESC LIMIT 100');
  r.type('html').send(page(q, { title: 'Blog | SIDQ Creative', desc: 'Tips on short-form clipping, viral shorts and growing your channel.', path: '/blog',
    body: '<h1>Blog</h1>' + (rows.map(p => `<article><h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2><p>${esc(p.descr)}</p><small>${new Date(p.at).toDateString()}</small></article>`).join('') || '<p>First posts are coming soon.</p>') }));
}));

app.get('/blog/:slug', wrap(async (q, r) => {
  const p = (await db.query('SELECT * FROM posts WHERE slug = $1', [q.params.slug])).rows[0];
  if (!p) return r.status(404).send(page(q, { title: 'Not found | SIDQ Creative', desc: 'Post not found', path: '/blog', body: '<h1>Post not found</h1>' }));
  r.type('html').send(page(q, { title: p.title + ' | SIDQ Creative', desc: p.descr, path: '/blog/' + p.slug,
    body: `<h1>${esc(p.title)}</h1><small>${new Date(p.at).toDateString()}</small>${md(p.body)}`,
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

app.get('/admin', (q, r) => r.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));

(async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS content (id INT PRIMARY KEY, data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS leads (id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
      type TEXT, name TEXT, email TEXT, phone TEXT, budget TEXT, msg TEXT);
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS seen BOOLEAN NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS posts (id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
      descr TEXT, body TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now());`);
  app.listen(process.env.PORT || 3000, () => console.log('SIDQ Creative is running'));
})().catch(e => { console.error('Database error:', e.message); process.exit(1); });
