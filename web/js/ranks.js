// ranks.js - the Ranks screen: leaderboards for level / XP, total damage, jobs, sales, net worth and distance. No tab: opened from the Home page.
// Loaded by home.js. It makes its own div (id scr-ranks) and its own styles, so web/index.html needs no change.
// ONE call ('ranks') when the screen opens loads ALL six boards, also the ones that are folded (the bar of a folded board shows your rank).
// Each board shows the top ten and, when you are lower, a gap and your own row. Nothing is polled; leave and open again to refresh.
// Names come from the server and are shown as text only (never as HTML).
import { $, el, addScreen, openScreen, call } from 'core';

const BOARDS = [
  { id: 'level', title: 'Level and XP', hint: 'Ranked by XP.' },
  { id: 'damage', title: 'Total damage', hint: 'All damage your ship has dealt in combat. Counted from 11 Nov 2026.' },
  { id: 'jobs', title: 'Jobs done', hint: 'Missions completed (repeats count).' },
  { id: 'sales', title: 'Sales', hint: 'Credits earned selling goods to NPC markets.' },
  { id: 'net_worth', title: 'Net worth', hint: 'Everything you own, counted in credits.' },
  { id: 'distance', title: 'Distance flown', hint: 'AU flown on finished trips (the Profile career number).' },
];

const st = document.createElement('style');
st.textContent = [
  '#scr-ranks .rhead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 4px 6px}',
  '#scr-ranks .rhead h2{margin:0;font-size:18px;font-weight:500;color:#fff}',
  '#scr-ranks .rx{width:34px;height:34px;padding:0;margin:0;flex:none;min-height:0;font-size:13px}',
  '#scr-ranks .rintro{margin:2px 8px 8px;color:#8d98b2;font-size:12px}',
  '#scr-ranks .rbar{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-height:44px;margin:8px 0 0;padding:0 10px;text-align:left;border:0;border-radius:0;border-top:2px solid rgba(120,160,210,.55);border-bottom:1px solid rgba(120,160,210,.3);background:rgba(120,160,210,.16);color:#fff;font-size:14px;font-weight:500}',
  '#scr-ranks .rbar .rt{flex:1;min-width:0}',
  '#scr-ranks .rbar .ry{font-size:12px;font-weight:400;color:#8d98b2;flex:none}',
  '#scr-ranks .rbar .rc{font-size:12px;color:#8d98b2;flex:none;width:12px;text-align:center}',
  '#scr-ranks .rhint{padding:6px 10px;font-size:11px;color:#8d98b2}',
  '#scr-ranks .rrow{display:flex;gap:8px;align-items:baseline;padding:8px 10px;border-bottom:1px solid #2f3a58;font-size:13px}',
  '#scr-ranks .rrow .rk{flex:none;width:26px;color:#8d98b2}',
  '#scr-ranks .rrow .rn{flex:1;min-width:0;font-weight:500;color:#fff;overflow-wrap:anywhere}',
  '#scr-ranks .rrow .rv{flex:none;color:#fff}',
  '#scr-ranks .rrow.me{background:rgba(91,140,255,.18);box-shadow:inset 3px 0 0 #5b8cff}',
  '#scr-ranks .rgap{text-align:center;color:#8d98b2;padding:2px 0;border-bottom:1px solid #2f3a58}',
  '#scr-ranks .rnote{padding:8px 10px;font-size:12px;color:#8d98b2;border-bottom:1px solid #2f3a58}',
  '#scr-ranks .rback{display:inline-flex;align-items:center;width:auto;height:34px;min-height:0;margin:10px 8px 14px;padding:0 14px;font-size:13px}',
].join('');
document.head.appendChild(st);

const box = el('div', '');
box.id = 'scr-ranks'; box.hidden = true;
$('scr-home').parentNode.appendChild(box);

let data = null;          // the last answer from the server
let failed = null;        // the text of the last error (null = none)
let loading = false;
const opened = new Set(); // boards that are unfolded; all start folded

/* 48200000 -> 48.2M, 12300 -> 12.3K, below 10000 the whole number with a thousands comma (dec: one decimal, for distance) */
function trim1(x) { return String(Math.round(x * 10) / 10); }
function num(n, dec) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return trim1(n / 1e9) + 'B';
  if (a >= 1e6) return trim1(n / 1e6) + 'M';
  if (a >= 1e4) return trim1(n / 1e3) + 'K';
  return (dec ? Math.round(n * 10) / 10 : Math.round(n)).toLocaleString('en-US');
}
function valueText(id, r) {
  if (id === 'level') return (r.level ? 'L' + r.level + ' \u00b7 ' : '') + num(r.value) + ' XP';
  if (id === 'distance') return num(r.value, true) + ' AU';
  return num(r.value);
}
function row(id, r, isMe) {
  const d = el('div', 'rrow' + (isMe ? ' me' : ''));
  d.append(el('div', 'rk', String(r.rank)), el('div', 'rn', String(r.name || '') + (isMe ? ' (you)' : '')), el('div', 'rv', valueText(id, r)));
  return d;
}

function board(b) {
  const d = (data.boards && data.boards[b.id]) || { ranked: 0, top: [], me: null };
  const top = d.top || [], me = d.me || null;
  const isOpen = opened.has(b.id);
  const w = el('div', '');
  const bar = el('button', 'rbar'); bar.type = 'button';
  bar.append(el('span', 'rt', b.title), el('span', 'ry', me && me.rank ? 'You #' + me.rank : 'Not ranked'), el('span', 'rc', isOpen ? '\u25be' : '\u25b8'));
  bar.onclick = () => { if (opened.has(b.id)) opened.delete(b.id); else opened.add(b.id); draw(); };
  w.appendChild(bar);
  if (!isOpen) return w;
  w.appendChild(el('div', 'rhint', b.hint));
  if (!top.length) { w.appendChild(el('div', 'rnote', 'Nobody has a score here yet.')); return w; }
  top.forEach(r => w.appendChild(row(b.id, r, !!r.me)));
  if (me && me.rank && !top.some(r => r.me)) {          // you are below the top ten: a gap, then your own row
    w.appendChild(el('div', 'rgap', '\u00b7 \u00b7 \u00b7'));
    w.appendChild(row(b.id, me, true));
  } else if (!(me && me.rank)) {
    w.appendChild(el('div', 'rnote', 'You are not ranked on this board yet.'));
  }
  return w;
}

function draw() {
  box.replaceChildren();
  const head = el('div', 'rhead');
  head.appendChild(el('h2', '', 'Ranks'));
  const x = el('button', 'alt rx', 'X');
  x.title = 'Back to Home'; x.setAttribute('aria-label', x.title);
  x.onclick = () => openScreen('home');
  head.appendChild(x);
  box.appendChild(head);
  if (loading && !data) { box.appendChild(el('div', 'rintro', 'Loading the ranks...')); return; }
  if (failed) {
    box.appendChild(el('div', 'rintro', 'Could not load the ranks: ' + failed));
    const again = el('button', 'alt rback', 'Try again'); again.onclick = load;
    box.appendChild(again);
    return;
  }
  if (!data) return;
  box.appendChild(el('div', 'rintro', (data.pilots || 0) + ' pilots \u00b7 updated when you open this screen'));
  BOARDS.forEach(b => box.appendChild(board(b)));
}

async function load() {
  loading = true; failed = null; draw();
  try { data = await call('ranks'); }
  catch (e) { failed = (e && e.message) || 'unknown error'; data = null; }
  loading = false; draw();
}

addScreen('ranks', 'Ranks', box, { noTab: true, onShow() { data = null; load(); } });   // data is cleared so another account never sees old rows
