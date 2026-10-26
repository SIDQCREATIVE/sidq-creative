'use strict';
// Serves the clipper portal and the staff panel as one script and one stylesheet each (few requests, fast on phones).
// The file address carries a hash of its content (?v=...), so a new deploy shows up for everyone at once and
// the files can still be cached for a year. The small page shells are filled in with the current addresses.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const LISTS = {
  'clipper.js': ['ui.js', 'clipper/dashboard.js', 'clipper/campaigns.js', 'clipper/clips.js', 'clipper/accounts.js', 'clipper/wallet.js', 'clipper/community.js', 'clipper/support.js', 'clipper/main.js'],
  'staff.js': ['ui.js', 'staff/common.js', 'staff/overview.js', 'staff/review.js', 'staff/payouts.js', 'staff/campaigns.js', 'staff/people.js', 'staff/support.js', 'staff/website.js', 'staff/settings.js', 'staff/main.js'],
  'portal.css': ['portal.css']
};
const TYPES = { js: 'application/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

module.exports = function mountAssets(app, root) {
  const dir = path.join(root, 'public', 'portal');
  const dev = !!process.env.DEV_ASSETS; // tests: rebuild on every request so edits show without a restart
  let built = null;

  const build = () => {
    const out = {};
    for (const [name, files] of Object.entries(LISTS)) {
      const parts = [];
      for (const f of files) {
        let code; try { code = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { console.warn('[assets] missing', f); continue; }
        // every file gets its own scope; files talk to each other through window.SQ
        parts.push(name.endsWith('.js') ? `;(function(){"use strict";\n${code}\n})();\n` : code);
      }
      const code = parts.join('\n');
      out[name] = { code, hash: crypto.createHash('sha1').update(code).digest('hex').slice(0, 10) };
    }
    return out;
  };
  const get = () => (dev || !built) ? (built = build()) : built;

  const shell = file => {
    const b = get();
    let html = fs.readFileSync(path.join(root, 'public', file), 'utf8');
    for (const name of Object.keys(b)) html = html.split('%' + name + '%').join(`/portal/${name}?v=${b[name].hash}`);
    return html;
  };
  let shells = {};
  const page = file => (q, r) => {
    if (dev || !shells[file]) shells[file] = shell(file);
    r.set({ 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex' });
    r.type('html').send(shells[file]);
  };

  for (const name of Object.keys(LISTS)) {
    app.get('/portal/' + name, (q, r) => {
      const b = get()[name];
      r.set('Cache-Control', q.query.v === b.hash ? 'public, max-age=31536000, immutable' : 'no-cache');
      r.type(TYPES[name.split('.').pop()]).send(b.code);
    });
  }
  build(); // fail loudly at startup if a file cannot be read
  return { page };
};
module.exports.LISTS = LISTS;
