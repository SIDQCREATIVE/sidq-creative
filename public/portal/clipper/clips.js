/* My clips: the list with stage tabs, and one clip's page (progress, analytics upload, views chart, history). */
const SQ = window.SQ;
const { h, $, $$, html, icon, usd, num, ago, date, dtime, until, plat, chip, note, empty, stat, bgImg, get, post, del, act, ok, err, go, qs } = SQ;

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'Video'; } };
const TABS = [['', 'All'], ['review', 'In review'], ['analytics', 'Analytics needed'], ['checking', 'Checking'], ['tracking', 'Tracking'], ['verified', 'Verified'], ['completed', 'Paid'], ['rejected', 'Rejected']];

const clipRow = c => {
  const money = c.status === 'completed' ? usd(c.earned_cents) : c.est_cents != null ? usd(c.est_cents) : '-';
  return h`<div class="li hv" data-go="#clip/${c.id}" tabindex="0" role="link">
    <div class="th" style="${bgImg(c.thumb)}">${c.thumb ? '' : plat(c.platform, true)}</div>
    <div class="m"><div class="t">${plat(c.platform)}<span class="trunc" style="max-width:min(420px,60vw)">${c.title || hostOf(c.url)}</span></div>
      <div class="d"><span>${c.campaign}</span><span>Submitted ${ago(c.submitted_at)}</span>${c.tracking_ends && c.status !== 'completed' ? h`<span>Tracking ends ${until(c.tracking_ends)}</span>` : ''}</div></div>
    <div class="e">${SQ.stageChip(c.stage, c.stage_label)}
      ${c.stage === 'analytics' ? h`<a class="btn p s" href="#clip/${c.id}">Send analytics</a>` : ''}
      <div><div class="num b">${c.pay_views == null ? '-' : num(c.pay_views)}</div><div class="xs mu">views</div></div>
      <div style="min-width:64px"><div class="num b" style="color:${c.status === 'completed' ? 'var(--g)' : 'inherit'}">${money}</div><div class="xs mu">${c.status === 'completed' ? 'earned' : 'estimated'}</div></div></div></div>`;
};

SQ.route('clips', async ctx => {
  const stage = ctx.q.stage || '', camp = ctx.q.campaign || '', page = +ctx.q.page || 1;
  const r = await get('/api/clips' + qs({ stage, campaign: camp, page: page > 1 ? page : '' }));
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  const tabs = TABS.map(([k, t]) => [k, t, k === '' ? total : (r.counts[k] || 0), k === 'analytics' && r.counts.analytics > 0]);
  ctx.set(h`<div class="ph"><div class="t"><h1>My clips</h1><p>Every clip you submitted and where it is in the process.</p></div><a class="btn p" href="#campaigns">${icon('plus')}Submit a clip</a></div>
    ${camp ? h`<div class="row" style="margin-bottom:12px">${chip('Filtered by one campaign', 'info')}<button type="button" class="btn g s" data-act="clips.tab" data-v="${stage}" data-clear="1">Show all campaigns</button></div>` : ''}
    ${SQ.tabs(tabs, stage, 'clips.tab')}
    ${r.clips.length ? h`<div class="list">${r.clips.map(clipRow)}</div>${SQ.pager(r, 'clips.page')}`
      : total === 0 ? empty('film', 'No clips yet', 'Join a campaign, post your clip on your account, then paste its link in the campaign page.', h`<a class="btn p" href="#campaigns">Find a campaign</a>`)
        : empty('film', 'Nothing in this stage', 'Clips move here as our team reviews them.')}`);
}, 'clips');
act('clips.tab', el => { const p = { stage: el.dataset.v, page: '' }; if (el.dataset.clear) p.campaign = ''; SQ.nav(p); });
act('clips.page', el => SQ.nav({ page: +el.dataset.page > 1 ? el.dataset.page : '' }));

/* ---------- one clip ---------- */
function stepper(c, needsAnalytics) {
  const S = needsAnalytics ? ['Submitted', 'Rules check', 'Analytics', 'Tracking views', 'Paid'] : ['Submitted', 'Rules check', 'Tracking views', 'Paid'];
  const ix = n => S.indexOf(n); let cur = 0, bad = -1;
  if (c.stage === 'review') cur = ix('Rules check');
  else if (c.stage === 'analytics' || c.stage === 'checking') cur = needsAnalytics ? ix('Analytics') : ix('Tracking views');
  else if (c.stage === 'tracking' || c.stage === 'verified') cur = ix('Tracking views');
  else if (c.stage === 'completed') cur = S.length;
  else if (c.stage === 'rejected') { cur = 1; bad = 1; }
  return h`<div class="steps" aria-label="Progress">${S.map((t, i) => h`<div class="s ${i === bad ? 'bad' : i < cur ? 'done' : i === cur ? 'cur' : ''}"><i>${i === bad ? icon('x') : i < cur ? icon('check') : ''}</i>${t}</div>`)}</div>`;
}
const evClass = t => /^(approved|verified|completed|earning|analytics_accepted)$/.test(t) ? 'k' : /(rejected|declined)/.test(t) ? 'x' : /analytics/.test(t) ? 'i' : '';

// Files chosen for upload: screen recordings as they are, screenshots already shrunk in the browser. Kept here until they are sent.
const MAX_FILES = 6, MAX_VIDEOS = 2, MAX_VIDEO = 80 * 1048576;
let STAGED = [], BUSY = 0, REC = null, GEN = 0; // REC is the recording in progress. GEN changes on every page render so a late recording never lands on another clip.
const videoCount = () => STAGED.filter(s => s.kind === 'video').length;
const dropStaged = () => { STAGED.forEach(s => URL.revokeObjectURL(s.url)); STAGED = []; BUSY = 0; if (REC) { try { REC.stop(); } catch (e) { /* already stopped */ } REC = null; } GEN++; };
const capOf = s => [s.recorded ? 'Recorded here' : (s.name || 'Recording'), s.seconds ? SQ.clock(s.seconds) : '', SQ.mb(s.bytes)].filter(Boolean).join(' · ');
const paintStaged = () => {
  const box = $('#proofthumbs'); if (!box) return;
  html(box, STAGED.map((s, i) => s.kind === 'video'
    ? h`<div class="t v"><video src="${s.url}" controls preload="metadata" playsinline></video><div class="cap">${capOf(s)}</div><button type="button" data-act="clip.unstage" data-i="${i}" aria-label="Remove recording ${i + 1}">${icon('x')}</button></div>`
    : h`<div class="t"><img src="${s.url}" alt="Screenshot ${i + 1}" data-act="zoom"><button type="button" data-act="clip.unstage" data-i="${i}" aria-label="Remove screenshot ${i + 1}">${icon('x')}</button></div>`)
    .concat(BUSY ? [h`<div class="t" style="display:grid;place-items:center"><div class="sk" style="width:40px;height:40px;border-radius:50%"></div></div>`] : []));
  const b = $('#proofsend'); if (b) b.disabled = !STAGED.length || !!BUSY || !!REC;
  const r = $('#recbtn'); if (r) r.disabled = !!REC || !!BUSY;
  const z = $('#proofhint'); if (z) z.textContent = STAGED.length ? `${STAGED.length} of ${MAX_FILES} files ready` : 'MP4, MOV or WebM up to 80 MB, or PNG, JPG and WebP screenshots';
};
const paintRec = sec => {
  const el = $('#recbar'); if (!el) return;
  if (!REC) { el.innerHTML = ''; return; }
  const t = $('#rectime', el); if (t) { t.textContent = SQ.clock(sec || 0); return; }
  html(el, h`<div class="recbar"><i class="dot"></i><b class="num" id="rectime">${SQ.clock(sec || 0)}</b><span class="sm" style="flex:1;min-width:210px">Recording your screen. Open your analytics in another tab or window and show everything we asked for. Come back here and press Stop.</span><button type="button" class="btn d s" data-act="clip.recstop">Stop recording</button></div>`);
};
SQ.onDrop('proof', async (el, files) => {
  if (REC) return SQ.toast('Stop the recording first.', 'warn');
  if (!files.some(f => SQ.videoType(f) || f.type.startsWith('image/'))) return SQ.toast('Choose a screen recording (MP4, MOV or WebM) or screenshots (PNG, JPG or WebP).', 'warn');
  const gen = GEN;
  for (const f of files) {
    if (STAGED.length + BUSY >= MAX_FILES) { SQ.toast(`You can send up to ${MAX_FILES} files at once.`, 'warn'); break; }
    if (SQ.videoType(f)) {
      if (videoCount() >= MAX_VIDEOS) { SQ.toast(`You can send up to ${MAX_VIDEOS} recordings. Remove one first.`, 'warn'); continue; }
      if (f.size > MAX_VIDEO) { SQ.toast(`That recording is ${SQ.mb(f.size)}. The limit is 80 MB. Record a shorter video, about 3 minutes is enough.`, 'warn'); continue; }
      STAGED.push({ kind: 'video', blob: f, url: URL.createObjectURL(f), type: SQ.videoType(f), bytes: f.size, name: f.name }); paintStaged();
    } else if (f.type.startsWith('image/')) {
      BUSY++; paintStaged();
      try { const blob = await SQ.compressImage(f); if (gen !== GEN) break; STAGED.push({ kind: 'image', blob, url: URL.createObjectURL(blob), bytes: blob.size }); }
      catch (e) { err(e); }
      if (gen === GEN) { BUSY--; paintStaged(); }
    } else SQ.toast(`${f.name || 'That file'} was skipped. Only recordings and images can be sent.`, 'warn');
  }
});
act('clip.pick', () => { const f = $('#proofpick'); if (f) f.click(); });
act('clip.unstage', el => { const s = STAGED.splice(+el.dataset.i, 1)[0]; if (s) URL.revokeObjectURL(s.url); paintStaged(); });
async function startRec() {
  if (REC || BUSY) return;
  if (videoCount() >= MAX_VIDEOS) return SQ.toast(`You can send up to ${MAX_VIDEOS} recordings. Remove one first.`, 'warn');
  if (STAGED.length >= MAX_FILES) return SQ.toast(`You can send up to ${MAX_FILES} files at once. Remove one first.`, 'warn');
  const gen = GEN; let ctl;
  try { ctl = await SQ.record({ max: 300, onTick: s => { if (gen === GEN) paintRec(s); } }); }
  catch (e) {
    if (e && ['NotAllowedError', 'AbortError', 'SecurityError', 'NotFoundError'].includes(e.name)) return SQ.toast('Recording did not start. When your browser asks, choose the screen to share.', 'warn');
    return err(e);
  }
  if (gen !== GEN) { ctl.stop(); return; }
  REC = ctl; paintRec(0); paintStaged();
  SQ.toast('Recording started. Open your analytics in another tab or window, then come back and press Stop.');
  let r;
  try { r = await ctl.done; } catch (e) { if (gen === GEN) { REC = null; paintRec(); paintStaged(); err(e); } return; }
  if (gen !== GEN) return;
  REC = null; paintRec();
  if (r.blob.size > MAX_VIDEO) SQ.toast(`The recording is ${SQ.mb(r.blob.size)}, over the 80 MB limit. Record a shorter video.`, 'warn');
  else { STAGED.push({ kind: 'video', blob: r.blob, url: URL.createObjectURL(r.blob), type: SQ.videoType(r.blob) || 'video/webm', bytes: r.blob.size, seconds: r.seconds, recorded: true }); SQ.toast('Recording saved. Watch it once, then press Send.'); }
  paintStaged();
  const u = $('#upl'); if (u) u.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
act('clip.rec', () => { startRec(); }); // not awaited: the button must not show a spinner for the whole recording
act('clip.recstop', () => { if (REC) REC.stop(); });
act('clip.upload', async el => {
  if (!STAGED.length || REC) return;
  const id = el.dataset.id, noteText = $('#proofnote').value.trim().slice(0, 300), total = STAGED.length, box = $('#proofErr'), prog = $('#proofprog'), gen = GEN; box.innerHTML = '';
  let sent = 0; const idle = el.textContent;
  const label = p => { el.textContent = (total > 1 ? `Sending ${sent + 1} of ${total}` : 'Sending') + (p != null ? `, ${Math.round(p * 100)}%` : ''); if (prog) { prog.hidden = false; prog.firstElementChild.style.width = Math.round((p || 0) * 100) + '%'; } };
  try {
    while (STAGED.length) {
      const s = STAGED[0]; label(0);
      await SQ.upload(`/api/clips/${id}/proof${sent === 0 && noteText ? '?note=' + encodeURIComponent(noteText) : ''}`, s.blob, { type: s.kind === 'video' ? s.type : 'image/jpeg', onProgress: label });
      URL.revokeObjectURL(s.url); STAGED.shift(); sent++;
    }
  } catch (e) {
    if (gen !== GEN) return;
    el.textContent = idle; if (prog) prog.hidden = true; paintStaged();
    if (e.status !== 401) html(box, note('bad', 'alert', h`<b>${sent ? sent + ' of ' + total + ' files were sent.' : 'The upload failed.'}</b> ${e.message}`));
    return;
  }
  ok('Analytics sent. Our team will check them soon.');
  await SQ.refreshMe().catch(() => { }); SQ.reload();
});

SQ.route('clip/:id', async ctx => {
  const r = await get('/api/clips/' + encodeURIComponent(ctx.params.id)), c = r.clip, live = c.status === 'approved' || c.status === 'verified';
  dropStaged();
  ctx.title('Clip');
  const ends = c.tracking_ends ? date(c.tracking_ends) + ' (' + until(c.tracking_ends) + ')' : '';
  const stageNote = ({
    review: () => note('info', 'clock', h`<b>Our team is checking your clip against the campaign rules.</b> Reviews usually take less than a day. Staff are off on Sundays.`),
    checking: () => note('info', 'eye', h`<b>We received your analytics and are checking them.</b> You will get a notification as soon as they are verified.`),
    tracking: () => note('ok', 'trend', h`<b>Your clip is counting views.</b> Views are counted until ${ends}. The money goes to your wallet when that ends.`),
    verified: () => note('ok', 'check', h`<b>Your clip is verified.</b> The views are counted until ${ends}, then the money goes to your wallet.`),
    completed: () => note('ok', 'checkc', h`<b>${usd(c.earned_cents)} was added to your wallet.</b> <a href="#wallet" style="color:var(--g)">Open your wallet</a>`),
    rejected: () => note('bad', 'xc', h`<b>This clip was rejected.</b> ${c.reject_reason || ''}<div style="margin-top:10px"><a class="btn s" href="#support">Ask support about it</a></div>`)
  })[c.stage];
  // The standard request text repeats what the card already explains, so only a message somebody wrote for this clip or campaign is shown on top.
  const canRec = SQ.canRecord(), askedRaw = c.analytics_feedback || r.campaign_note, asked = askedRaw && !/^Record your screen while you open the analytics of this video/.test(askedRaw) ? askedRaw : '';
  const upload = c.stage === 'analytics' ? h`<div class="card" id="upl" style="border-color:#6b5316"><div class="ch"><h3>Send your audience analytics</h3>${chip('Action needed', 'warn', 'alert')}</div>
      ${asked ? h`<div class="note warn" style="margin-bottom:14px">${icon('info')}<div class="x"><b>What our team asked for</b><div style="margin-top:2px">${asked}</div></div></div>` : ''}
      <p style="margin-bottom:10px">Record your screen while you open the analytics of this video. We watch it to confirm the views are real.</p>
      <ol class="sm steps-l"><li>Start with your username on screen, then open this video's analytics.</li>
        <li>Show the views, then the audience tabs: top countries, age and gender.</li>
        <li>Do not cut or edit the video. One to three minutes is enough. Screenshots are also accepted.</li></ol>
      <div class="row" style="margin:16px 0 12px">${canRec ? h`<button type="button" class="btn p" id="recbtn" data-act="clip.rec">${icon('video')}Record my screen</button>` : ''}
        <button type="button" class="btn${canRec ? '' : ' p'}" data-act="clip.pick">${icon('upload')}${canRec ? 'Upload a file' : 'Upload recording or screenshots'}</button></div>
      ${canRec ? h`<div class="xs mu" style="margin:-4px 0 12px">When your browser asks what to share, choose <b>Entire screen</b>, so we can see the page address.</div>` : h`<div class="xs mu" style="margin:-4px 0 12px">On a phone, use its screen recorder (iPhone: Control Center, Screen Recording. Android: Quick settings, Screen record), then upload the video here.</div>`}
      <div id="recbar"></div>
      <div class="drop" data-drop="proof" data-act="clip.pick" role="button" tabindex="0">${icon('upload')}<div class="b" style="margin-top:6px">Drop a recording or screenshots here</div><div class="xs" id="proofhint" style="margin-top:4px">MP4, MOV or WebM up to 80 MB, or PNG, JPG and WebP screenshots</div></div>
      <input type="file" id="proofpick" data-files="proof" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm,image/png,image/jpeg,image/webp" multiple hidden>
      <div class="thumbs" id="proofthumbs"></div>
      <label class="f" style="margin-top:14px"><span class="h">Note for our team (optional)</span><textarea class="in" id="proofnote" rows="2" maxlength="300" placeholder="Anything we should know about this recording"></textarea></label>
      <div id="proofErr"></div><div class="bar" id="proofprog" hidden style="margin-bottom:12px"><i style="width:0%"></i></div><button type="button" class="btn p" id="proofsend" data-act="clip.upload" data-id="${c.id}" disabled>Send analytics</button></div>` : '';
  const proofs = r.proofs.length ? h`<div class="card"><div class="ch"><h3>What you sent</h3></div><div class="thumbs" style="margin-top:0">${r.proofs.map((p, i) => /^video\//.test(p.mime || '')
    ? h`<div class="t v"><video src="/api/proofs/${p.id}" controls preload="metadata" playsinline></video><div class="cap">Screen recording${p.bytes ? ' · ' + SQ.mb(p.bytes) : ''}</div></div>`
    : h`<div class="t"><img src="/api/proofs/${p.id}" alt="Screenshot ${i + 1}" data-act="zoom" loading="lazy"></div>`)}</div></div>` : '';
  const snaps = r.snapshots.length >= 2 ? h`<div class="card"><div class="ch"><h3>Views over time</h3></div>${SQ.areaChart(r.snapshots.map(s => ({ x: new Date(s.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), full: dtime(s.at), y: s.views })), { fmt: num, axis: SQ.compact, label: 'Views over time', xlabel: 'Checked', ylabel: 'Views' })}</div>` : '';
  ctx.set(h`<a class="back" href="#clips">${icon('chevl')}My clips</a>
    <div class="card" style="margin-bottom:14px"><div class="row nw" style="gap:14px;align-items:flex-start">${plat(c.platform, true)}<div style="min-width:0;flex:1"><h2 style="font-size:20px;word-break:break-word">${c.title || hostOf(c.url)}</h2>
      <div class="row sm mu" style="margin-top:6px;gap:6px 14px"><a href="#campaign/${c.campaign_id}" style="color:var(--g)">${c.campaign}</a><span>Submitted ${ago(c.submitted_at)}</span><a href="${c.url}" target="_blank" rel="noopener" class="nowrap">Open video ${icon('ext')}</a></div></div>${SQ.stageChip(c.stage, c.stage_label)}</div>
      <hr class="dv">${stepper(c, r.requires_analytics)}</div>
    ${c.track_error ? note('warn', 'alert', h`<b>We could not read the views of this video.</b> Make sure it is public. ${c.track_error}`) : ''}
    ${stageNote ? stageNote() : ''}
    <div class="g4" style="margin-bottom:14px">
      ${stat('Views counted', c.pay_views == null ? '-' : num(c.pay_views), c.views_source === 'api' ? 'Tracked automatically' : c.pay_views == null ? 'Counted from your analytics' : 'Verified from your analytics', { icon: 'eye' })}
      ${stat(c.status === 'completed' ? 'Earned' : 'Estimated earnings', c.status === 'completed' ? usd(c.earned_cents) : c.est_cents != null ? usd(c.est_cents) : '-', c.status === 'completed' ? 'Added to your wallet' : 'Final amount is set when tracking ends', { g: true, icon: 'dollar' })}
      ${stat('Tracking ends', live && c.tracking_ends ? until(c.tracking_ends).replace('in ', '') : c.status === 'completed' ? 'Finished' : '-', live && c.tracking_ends ? date(c.tracking_ends) : '', { icon: 'clock' })}
      ${stat('Posted', c.posted_at ? ago(c.posted_at) : '-', c.posted_at ? date(c.posted_at) : 'Time not available', { icon: 'calendar' })}
    </div>
    ${upload}${proofs}${snaps}
    <div class="card"><div class="ch"><h3>History</h3></div><div class="tl">${r.events.map(e => h`<div class="e ${evClass(e.type)}"><div>${e.text}</div><small>${e.actor ? e.actor + ', ' : ''}${dtime(e.at)}</small></div>`)}</div></div>
    ${c.status === 'pending' ? h`<div class="row" style="margin-top:14px"><button type="button" class="btn d" data-act="clip.remove" data-id="${c.id}">${icon('trash')}Remove this clip</button><span class="xs mu">You can only remove a clip before our team reviews it.</span></div>` : ''}`);
  paintStaged();
}, 'clips');
// Notifications link to #submission/<id>; it is the same page.
SQ.route('submission/:id', ctx => { SQ.go('clip/' + ctx.params.id, true); }, 'clips');
act('clip.remove', async el => {
  if (!await SQ.confirm({ title: 'Remove this clip?', text: 'It will be deleted. You can submit the link again later.', ok: 'Remove clip', kind: 'd' })) return;
  await del('/api/clips/' + el.dataset.id); ok('Clip removed.'); go('clips');
});
