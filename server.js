const express = require('express'), path = require('path'), crypto = require('crypto');
const { Pool } = require('pg');
const app = express();

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
    fName: 'Ahtisham', fRole: 'Founder', f1: '100K', f1l: 'Subscribers', f2: '30M+', f2l: 'Gaming views', fImg: '',
    email: 'hello@sidqcreative.com'
  },
  stats: [
    { v: '100M+', l: 'Views generated' }, { v: '1K+', l: 'Public clippers' },
    { v: '20', l: 'Private clippers' }, { v: '5M–50M', l: 'Monthly views' }
  ],
  shorts: []
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
    [clip(b.type, 20), clip(b.name, 80), clip(b.email, 120), clip(b.phone, 40), clip(b.budget, 200), clip(b.msg, 1000)]);
  r.json({ ok: true });
}));

app.get('/api/leads', auth, wrap(async (q, r) => {
  const { rows } = await db.query('SELECT at, type, name, email, phone, budget, msg FROM leads ORDER BY id DESC LIMIT 1000');
  r.json(rows);
}));

app.get('/admin', (q, r) => r.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));

(async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS content (id INT PRIMARY KEY, data JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS leads (id SERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
      type TEXT, name TEXT, email TEXT, phone TEXT, budget TEXT, msg TEXT);`);
  app.listen(process.env.PORT || 3000, () => console.log('SIDQ Creative is running'));
})().catch(e => { console.error('Database error:', e.message); process.exit(1); });
