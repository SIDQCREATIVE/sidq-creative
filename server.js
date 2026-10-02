const express = require('express'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const app = express();
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const F = path.join(DIR, 'content.json'), L = path.join(DIR, 'leads.json');
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

fs.mkdirSync(DIR, { recursive: true });
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1));
const mac = x => crypto.createHmac('sha256', SECRET).update(String(x)).digest('hex');
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
const valid = t => { const [a, b] = String(t || '').split('.'); return +a > Date.now() && b === mac(a); };
const auth = (q, r, n) => valid(q.get('x-token')) ? n() : r.status(401).json({ error: 'Log in again' });
const clip = (s, n) => String(s || '').slice(0, n);

let tries = 0; setInterval(() => tries = 0, 60000);
app.use(express.json({ limit: '1mb' }));

app.get('/api/content', (q, r) => r.json(read(F, DEFAULT)));

app.post('/api/login', (q, r) => {
  if (!PASS) return r.status(503).json({ error: 'Set ADMIN_PASSWORD in Railway Variables first' });
  if (++tries > 10) return r.status(429).json({ error: 'Too many tries. Wait a minute.' });
  if (!crypto.timingSafeEqual(hash(q.body.password), hash(PASS))) return r.status(401).json({ error: 'Wrong password' });
  const exp = Date.now() + 864e5;
  r.json({ token: exp + '.' + mac(exp) });
});

app.put('/api/content', auth, (q, r) => {
  const b = q.body;
  if (!b || typeof b.t !== 'object' || !Array.isArray(b.stats) || !Array.isArray(b.shorts)) return r.status(400).json({ error: 'Bad data' });
  write(F, b); r.json({ ok: true });
});

app.post('/api/lead', (q, r) => {
  const b = q.body || {}, all = read(L, []);
  all.unshift({ at: new Date().toISOString(), type: clip(b.type, 20), name: clip(b.name, 80), email: clip(b.email, 120),
    phone: clip(b.phone, 40), budget: clip(b.budget, 200), msg: clip(b.msg, 1000) });
  write(L, all.slice(0, 1000)); r.json({ ok: true });
});

app.get('/api/leads', auth, (q, r) => r.json(read(L, [])));
app.get('/admin', (q, r) => r.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('SIDQ Creative is running'));
