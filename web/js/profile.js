// profile.js - the Profile screen, opened by the circle at the top right (no tab).
// Shows YOUR profile, or another pilot's: openProfile(name) (chat will use it later). The server decides what others may see.
// Own profile = public part + a Pilot block (credits, Cal, Skills) + the full Activity log. Numbers come from the server action 'profile'.
// 2026-11-07 phone layout: small portrait with the key lines beside it, section bars, two-across tiles (grey label over white value), money abbreviated.
import { S, $, addScreen, openScreen, el, short, whole, hullName, locName, call, nowMs } from 'core';
import { resetSkills } from './skills.js';   // the Skills screen makes its own div and registers itself

const box = $('scr-profile');
let viewName = null;     // null = my own profile, else the pilot's name
let data = null;         // the last 'profile' answer
let loadedAt = 0, loading = false, failed = null;

// ---- small styles for this screen only ----
const st = document.createElement('style');
st.textContent = [
  '#scr-profile > h2{font-size:18px;font-weight:500;color:#fff;margin:4px 4px 8px}',
  '#scr-profile .pftop{display:flex;gap:12px;align-items:center;padding:0 4px}',
  '#scr-profile .pfpic{flex:none;width:88px;height:88px;box-sizing:border-box;border:2px solid #444f70;border-radius:10px;background:#2a3350;color:#fff;font-size:44px;font-weight:700;display:flex;align-items:center;justify-content:center}',
  '#scr-profile .pfinfo{flex:1;min-width:0;display:grid;grid-template-columns:1fr 1fr;gap:8px}',
  '#scr-profile .pk{font-size:11px;color:#8d98b2;font-weight:400;line-height:1.2}',
  '#scr-profile .pv{font-size:13px;color:#fff;font-weight:500;line-height:1.2;overflow-wrap:anywhere}',
  '#scr-profile .sech{min-height:34px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 8px;margin-top:10px;background:rgba(120,160,210,.16);border-top:2px solid rgba(120,160,210,.55);border-bottom:1px solid rgba(120,160,210,.25);border-radius:0;color:#fff;font-weight:500;font-size:13px;letter-spacing:.02em}',
  '#scr-profile .sech button{height:30px;min-height:0;margin:0;padding:0 12px;font-size:13px}',
  '#scr-profile .pfgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;padding:8px}',
  '#scr-profile .pfgrid.g3{grid-template-columns:1fr 1fr 1fr}',
  '#scr-profile .pflist{max-height:260px;overflow-y:auto}',
  '#scr-profile .pfitem{padding:6px 8px;border-bottom:1px solid #2f3a58;font-size:12px;color:#fff}',
  '#scr-profile .pfsmall{font-size:11px}',
  '#scr-profile .pfsplit{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid #2f3a58;color:#fff;font-weight:500;font-size:13px}',
  '#scr-profile .pfsplit .muted{font-size:11px;font-weight:400}',
].join('');
document.head.appendChild(st);

const abbr = n => short(n, true);   // 54600000 -> 54.6M
// one tile: small grey label above, white value below
function tile(label, value) { const d = el('div', ''); d.append(el('div', 'pk', label), el('div', 'pv', value)); return d; }
// a section bar, with an optional small button on the right
function bar(title, right) { const h = el('div', 'sech'); h.appendChild(el('span', '', title)); if (right) h.appendChild(right); return h; }
function split(label, value, cls) { const r = el('div', 'pfsplit'); r.appendChild(el('span', '', label)); r.appendChild(el('span', cls || 'muted', value)); return r; }

// years / months / days between two moments (calendar arithmetic, UTC)
function ymd(fromMs, toMs) {
  const a = new Date(fromMs), b = new Date(Math.max(fromMs, toMs));
  let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth(), d = b.getUTCDate() - a.getUTCDate();
  if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  return y + 'y ' + m + 'm ' + d + 'd';
}
function ago(ts) {
  const s = Math.max(0, (nowMs() - new Date(ts).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fold(title, items, emptyText) {
  const wrap = el('section', ''), head = el('div', 'sech'), caret = el('span', '', '+'), list = el('div', 'pflist');
  head.append(el('span', '', title), caret); list.hidden = true;
  if (!items.length) list.appendChild(el('div', 'muted pad', emptyText));
  items.forEach(it => list.appendChild(it));
  head.onclick = () => { list.hidden = !list.hidden; caret.textContent = list.hidden ? '+' : '-'; };
  wrap.append(head, list);
  return wrap;
}
function xpBar(p) {
  const wrap = el('div', 'bar xp'), fill = el('div', 'fill');
  const pct = p.xp_next ? Math.max(0, Math.min(100, 100 * p.xp / p.xp_next)) : 100;
  fill.style.width = pct + '%';
  wrap.style.margin = '0 8px 8px';
  wrap.appendChild(fill);
  return wrap;
}
const eventItem = (e, tag) => {
  const d = el('div', 'pfitem', new Date(e.created_at).toLocaleString() + ' - ' + e.message);
  if (tag) d.appendChild(el('span', 'muted pfsmall', '  (public)'));
  return d;
};

async function load() {
  if (loading || !S.sb) return;
  loading = true;
  try {
    const d = await call('profile', viewName ? { name: viewName } : {});
    data = d; failed = null; loadedAt = Date.now();
  } catch (e) { failed = e.message === 'not_found' ? 'No pilot with that name.' : 'Could not load the profile (' + e.message + ').'; }
  loading = false;
  if (S.current === 'profile') draw();
}

function draw() {
  box.replaceChildren();
  const mine = !viewName;
  if (!mine) {
    const back = el('button', 'alt', 'Back to my profile'); back.onclick = () => { viewName = null; data = null; draw(); load(); };
    box.appendChild(back);
  }
  const me = S.last && S.last.character;
  const title = data ? data.name : (mine && me ? me.name : viewName) || 'Profile';
  box.appendChild(el('h2', '', title));
  if (failed) box.appendChild(el('div', 'err pad', failed));
  if (!data) { if (!failed) box.appendChild(el('div', 'muted pad', 'Loading...')); return; }

  const p = S.last && S.last.pilot;
  const level = data.self && p ? p.level : data.level;

  // top: small portrait (placeholder letter) + the key lines beside it
  const top = el('div', 'pftop');
  top.appendChild(el('div', 'pfpic', String(data.name || '?').charAt(0).toUpperCase()));
  const info = el('div', 'pfinfo');
  const created = new Date(data.created_at).getTime(), now = nowMs();
  const pf = tile('Pilot for', Math.floor((now - created) / 864e5) + ' days'); pf.appendChild(el('div', 'pk', ymd(created, now)));
  info.append(tile('Level', String(level)), tile('Net worth', 'Cr ' + abbr(data.net_worth)), pf, tile('Last active', ago(data.last_action_at)));
  top.appendChild(info);
  box.appendChild(top);

  // pilot-only block: XP, Cal, credits, Skills (never shown on another pilot's profile)
  if (data.self && me) {
    const sk = el('button', 'alt', 'Skills'); sk.onclick = () => openScreen('skills');
    box.appendChild(bar('Pilot', sk));
    const g = el('div', 'pfgrid g3');
    if (p) {
      g.appendChild(tile('XP', p.xp_next == null ? whole(p.xp) + ' (top level)' : abbr(p.xp) + ' / ' + abbr(p.xp_next)));
      g.appendChild(tile('Calibrations', p.skill_points == null ? '0' : whole(p.skill_points)));
    }
    g.appendChild(tile('Credits', abbr(me.credits)));
    box.appendChild(g);
    if (p) box.appendChild(xpBar(p));
  }

  // career numbers, two across
  const c = data.career || {}, cg = el('div', 'pfgrid');
  cg.append(tile('Distance flown', (Math.round(Number(c.distance_au || 0) * 100) / 100) + ' AU'), tile('Trips made', whole(c.trips || 0)),
    tile('Trades made', whole(c.trades || 0)), tile('Freight deliveries', whole(c.freight_deliveries || 0)));
  box.append(bar('Career'), cg);

  // ship (public: hull, place, destination), two across
  const s = data.ship || {};
  box.appendChild(bar('Ship'));
  if (!s.hull_id) box.appendChild(el('div', 'muted pad', 'No ship.'));
  else {
    const sg = el('div', 'pfgrid');
    sg.appendChild(tile('Hull', hullName(s.hull_id)));
    if (s.state === 'docked') sg.appendChild(tile('Status', 'Docked at ' + locName(s.location_id)));
    else sg.appendChild(tile('Status', 'Flying' + (s.destination ? ' to ' + locName(s.destination) : '')));
    const ship = data.self && S.last && (S.last.ships || [])[0];
    if (ship && ship.hold_size != null) sg.appendChild(tile('Hold size', whole(ship.hold_size)));
    if (data.self && data.max_g != null) sg.appendChild(tile('Max thrust', (Math.round(Number(data.max_g) * 100) / 100) + ' g'));
    box.appendChild(sg);
  }

  // reputations (none active yet)
  box.appendChild(bar('Reputation'));
  (data.reputations || []).forEach(r => box.appendChild(split(r.name, r.active ? whole(r.value) : 'Not active yet')));

  // events (public) and, for me only, the full activity log
  box.appendChild(fold('Events', (data.events || []).map(e => eventItem(e, false)), 'Nothing yet.'));
  if (data.self) box.appendChild(fold('Activity log (only you see this)', (data.activity || []).map(e => eventItem(e, e.public)), 'Nothing yet.'));
}

addScreen('profile', 'Profile', box, {
  noTab: true,
  onShow: () => { draw(); load(); },
  update: () => { if (S.current === 'profile' && Date.now() - loadedAt > 30000) load(); else if (S.current === 'profile' && data && data.self) draw(); },
});
// Open another pilot's profile by name (for chat and leaderboards later).
export function openProfile(name) { viewName = name || null; data = null; failed = null; openScreen('profile'); }
export function resetProfile() { viewName = null; data = null; failed = null; loadedAt = 0; box.replaceChildren(); resetSkills(); }
