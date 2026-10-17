// profile.js - the Profile screen, opened by the circle at the top right (no tab).
// Shows YOUR profile, or another pilot's: openProfile(name) (chat will use it later). The server decides what others may see.
// Own profile = public part + a Pilot block (credits, Cal, Skills) + the full Activity log. Numbers come from the server action 'profile'.
import { S, $, addScreen, openScreen, el, money, whole, hullName, locName, call, nowMs } from 'core';
import { resetSkills } from './skills.js';   // the Skills screen makes its own div and registers itself

const box = $('scr-profile');
let viewName = null;     // null = my own profile, else the pilot's name
let data = null;         // the last 'profile' answer
let loadedAt = 0, loading = false, failed = null;

// ---- small styles for this screen only ----
const st = document.createElement('style');
st.textContent = '.pftop{display:flex;gap:12px;align-items:flex-start;margin-bottom:10px}'
  + '.pfpic{flex:0 0 calc(66.6% - 6px);aspect-ratio:1/1;box-sizing:border-box;border:2px solid #444f70;border-radius:10px;background:#2a3350;color:#e3e9f7;font-size:clamp(60px,24vw,200px);font-weight:700;display:flex;align-items:center;justify-content:center}'
  + '.pfinfo{flex:1;min-width:0}.pfinfo>div{padding:4px 0 6px;overflow-wrap:anywhere;line-height:1.25}.pfinfo .lbl{display:block;font-size:12px;color:#8d98b2}.pfsmall{font-size:12px}'
  + '.pfgrid{display:grid;grid-template-columns:1fr 1fr;column-gap:8px}.pfgrid>div{min-width:0;overflow-wrap:anywhere}'
  + '.pflist{max-height:260px;overflow-y:auto;border-top:1px solid #1c2438}.pfitem{padding:6px 8px;border-bottom:1px solid #1c2438;font-size:14px}'
  + '.pfsplit{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid #1c2438}';
document.head.appendChild(st);

function row(label, value) { const r = el('div', 'pad'); r.appendChild(el('span', 'muted', label + ': ')); r.appendChild(el('span', '', value)); return r; }
// one line of the narrow info column: small label above, value below
function irow(label, value) { const r = el('div', ''); r.appendChild(el('span', 'lbl', label)); r.appendChild(el('span', '', value)); return r; }
function block(title) { const b = el('section', ''); b.appendChild(el('h2', '', title)); return b; }
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
  wrap.style.margin = '2px 8px 6px';
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

  // top: picture box (placeholder letter) + the key lines
  const top = el('div', 'pftop');
  top.appendChild(el('div', 'pfpic', String(data.name || '?').charAt(0).toUpperCase()));
  const info = el('div', 'pfinfo');
  info.appendChild(irow('Level', String(level)));
  const created = new Date(data.created_at).getTime(), now = nowMs();
  const pf = el('div', ''); pf.appendChild(el('span', 'lbl', 'Pilot for')); pf.appendChild(el('span', '', Math.floor((now - created) / 864e5) + ' days'));
  pf.appendChild(el('span', 'lbl', ymd(created, now)));
  info.appendChild(pf);
  info.appendChild(irow('Last active', ago(data.last_action_at)));
  info.appendChild(irow('Net worth', 'Cr ' + money(data.net_worth)));
  top.appendChild(info);
  box.appendChild(top);

  // pilot-only block: XP, Cal, Skills, credits (never shown on another pilot's profile)
  if (data.self && me) {
    const pb = block('Pilot');
    if (p) {
      pb.appendChild(row('XP', p.xp_next == null ? whole(p.xp) + ' (top level)' : whole(p.xp) + ' / ' + whole(p.xp_next)));
      pb.appendChild(xpBar(p));
      pb.appendChild(row('Calibrations (Cal)', p.skill_points == null ? '0' : whole(p.skill_points)));
    }
    const sk = el('button', 'alt', 'Skills'); sk.onclick = () => openScreen('skills');
    pb.appendChild(sk);
    pb.appendChild(row('Credits', money(me.credits)));
    box.appendChild(pb);
  }

  // career numbers, two across (the second one starts at the middle)
  const c = data.career || {}, cr = block('Career'), cg = el('div', 'pfgrid');
  cg.appendChild(row('Distance flown', (Math.round(Number(c.distance_au || 0) * 100) / 100) + ' AU'));
  cg.appendChild(row('Trips made', whole(c.trips || 0)));
  cg.appendChild(row('Trades made', whole(c.trades || 0)));
  cg.appendChild(row('Freight deliveries', whole(c.freight_deliveries || 0)));
  cr.appendChild(cg); box.appendChild(cr);

  // ship (public: hull, place, destination), two across
  const sh = block('Ship'), s = data.ship || {};
  if (!s.hull_id) sh.appendChild(el('div', 'muted pad', 'No ship.'));
  else {
    const sg = el('div', 'pfgrid');
    sg.appendChild(row('Hull', hullName(s.hull_id)));
    if (s.state === 'docked') sg.appendChild(row('Status', 'Docked at ' + locName(s.location_id)));
    else sg.appendChild(row('Status', 'Flying' + (s.destination ? ' to ' + locName(s.destination) : '')));
    const ship = data.self && S.last && (S.last.ships || [])[0];
    if (ship && ship.hold_size != null) sg.appendChild(row('Hold size', whole(ship.hold_size)));
    if (data.self && data.max_g != null) sg.appendChild(row('Max thrust', (Math.round(Number(data.max_g) * 100) / 100) + ' g'));
    sh.appendChild(sg);
  }
  box.appendChild(sh);

  // reputations (none active yet)
  const rp = block('Reputation');
  (data.reputations || []).forEach(r => rp.appendChild(split(r.name, r.active ? whole(r.value) : 'Not active yet')));
  box.appendChild(rp);

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
