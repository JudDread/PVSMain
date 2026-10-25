// zone.js - the combat zone screen (COMBAT MVP step 4b). A full-screen layer over the whole app, shown while the flown ship is inside a combat zone.
// It only DISPLAYS what the server says and REQUESTS orders (the server works the fight out). Between answers the page moves the dots along their
// speed (display only). While the screen is open it asks the server for a fresh picture every 5 seconds (and not at all while the page is hidden).
//   Enter popup:  fly.js shows a box at a zone place; its Enter button calls zoneEnter().
//   Top chips = the other ships, nearest first (tap = pick it, hold = details). Map in the middle. Bars. Burn switch. Orders. Module chips. Event lines.
// Server actions used: combat_zone, combat_enter, combat_order, combat_stance, combat_module.
import { S, call, whole, el, say } from 'core';

const POLL_MS = 5000;
let view = null, recv = 0, root = null, pollT = 0, animT = 0, busy = false;
let sel = null, ranges = true, zoom = 'zone', lastCheck = 0, away = false;
const R = {};                  // the elements we keep
const chips = new Map();       // ship id -> { b, ship }

const CSS = `
.zn{position:fixed;inset:0;z-index:40;background:#0b0f19;overflow-y:auto;box-sizing:border-box;padding:calc(8px + env(safe-area-inset-top,0px)) 10px calc(16px + env(safe-area-inset-bottom,0px))}
.znh{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.znh b{flex:1;font-size:15px;color:#e8b64a;min-width:0}
.znh button,.zrow button,.zmods button{margin:0}
.zchips{display:flex;gap:6px;overflow-x:auto;padding:4px 0 6px;min-height:48px;align-items:stretch}
.zchip{flex:none;margin:0;padding:6px 10px;font-size:13px;line-height:1.25;text-align:left;border:1px solid #444f70;background:#192033;color:#e3e9f7;white-space:pre;font-weight:500}
.zchip.hos{border-color:#ff7b6b}.zchip.fri{border-color:#6be08f}.zchip.sel{outline:2px solid #e8b64a}
canvas.zcv{width:100%;height:38vh;min-height:220px;display:block;background:#070a12;border:1px solid #222b40;border-radius:8px;touch-action:none}
.zcap{font-size:12px;color:#8d98b2;margin:3px 0 6px}
.zbar{position:relative;height:19px;background:#1c2438;border-radius:4px;overflow:hidden;margin:3px 0}
.zbar i{position:absolute;left:0;top:0;bottom:0;width:0}
.zbar span{position:relative;font-size:12px;padding:0 6px;line-height:19px;white-space:nowrap}
.zgrid{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
.zrow{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.zrow button{flex:1 1 auto;padding:9px 6px;font-size:13px}
.zhold{width:100%;margin:2px 0 4px}
.zmods{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.zmods button{flex:1 1 140px;padding:8px 6px;font-size:12px;line-height:1.25;white-space:pre}
.zev{font-size:12px;color:#aab4cc;line-height:1.55;margin-top:6px}
.zmsg{min-height:1.3em;font-size:13px;margin:4px 0}
.zwarn{color:#ff7b6b;font-weight:600;font-size:14px;margin:4px 0}
.ztgt{font-size:13px;line-height:1.45;background:#131a2a;border:1px solid #222b40;border-radius:8px;padding:8px;margin:6px 0}
.zmodal{position:fixed;inset:0;z-index:50;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
.zmodal>div{background:#131a2a;border:1px solid #3a5a78;border-radius:8px;padding:14px;max-width:340px;width:86%;font-size:14px;line-height:1.5}
`;

const FAM = { laser: '#ff5a4a', railgun: '#6bb8ff', plasma: '#c58bff', missile: '#6be08f', torpedo: '#6be08f', drone: '#e8b64a' };
const dg = () => (Date.now() - recv) / 1000 * ((view && view.scale) || 60);                 // game seconds since the picture was taken
const at = s => { const g = dg(); return { x: s.x + s.vx * g, y: s.y + s.vy * g }; };         // where a ship is NOW (display only)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const km = n => whole(n) + ' km';
const pct = f => Math.round(Math.max(0, f) * 100) + '%';
const errText = e => (e && e.data && e.data.message) || (e && e.message) || 'error';

function mkBar(label, color) {
  const w = el('div', 'zbar'), f = document.createElement('i'), t = document.createElement('span');
  f.style.background = color; w.append(f, t);
  return { w, set(cur, max, txt) { f.style.width = (max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0) + '%'; t.textContent = label + ' ' + (txt != null ? txt : whole(cur) + ' / ' + whole(max)); } };
}

function ui() {
  if (root) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = el('div', 'zn'); root.hidden = true;
  const head = el('div', 'znh');
  R.back = el('button', 'alt', 'Back'); R.title = el('b', '', 'Combat zone'); R.rng = el('button', 'alt', 'Ranges'); R.zm = el('button', 'alt', 'Zone');
  head.append(R.back, R.title, R.rng, R.zm);
  R.chips = el('div', 'zchips');
  R.cv = el('canvas', 'zcv');
  R.cap = el('div', 'zcap', 'Dashed ring = the zone edge: fly past it to leave. Short line = where the ship will be in 10 game minutes.');
  R.warn = el('div', 'zwarn'); R.warn.hidden = true;
  R.bSh = mkBar('Shield', '#4aa3ff'); R.bAr = mkBar('Armor', '#c9a24a'); R.bHu = mkBar('Hull', '#6be08f');
  R.bHe = mkBar('Heat', '#ff8a3a'); R.bEn = mkBar('Endurance', '#9a7bff');
  const g1 = el('div', 'zgrid'); const c1 = el('div'), c2 = el('div');
  c1.append(R.bSh.w, R.bAr.w, R.bHu.w); c2.append(R.bHe.w, R.bEn.w); g1.append(c1, c2);
  R.info = el('div', 'zcap');
  R.tgt = el('div', 'ztgt');
  R.hold = document.createElement('input'); R.hold.type = 'number'; R.hold.inputMode = 'numeric'; R.hold.className = 'zhold';
  R.hold.placeholder = 'Distance to keep, in km (empty = automatic)';
  R.burn = el('div', 'zrow'); R.burnB = {};
  [['free', 'Free burn'], ['economy', 'Economy'], ['full', 'Full burn']].forEach(([k, label]) => {
    const b = el('button', 'alt', label); b.onclick = () => send('combat_stance', { stance: k }); R.burnB[k] = b; R.burn.appendChild(b);
  });
  R.burnCap = el('div', 'zcap', 'Free: no endurance used. Economy: keeps a reserve while closing in and slows when hot. Full: all thrust, spends endurance.');
  R.ord = el('div', 'zrow'); R.ordB = {};
  [['attack_max', 'Attack: far'], ['attack_opt', 'Attack: best range'], ['follow', 'Follow'], ['stop', 'Stop'], ['flee', 'Flee']].forEach(([k, label]) => {
    const b = el('button', 'alt', label); b.onclick = () => order(k); R.ordB[k] = b; R.ord.appendChild(b);
  });
  R.ordCap = el('div', 'zcap', 'Attack: far = keep the longest distance your weapons reach. Best range = where they hit hardest. Follow = stay about 50,000 km from the picked ship. Flee = fly straight out of the zone.');
  R.mods = el('div', 'zmods');
  R.ev = el('div', 'zev');
  R.msg = el('div', 'zmsg');
  root.append(head, R.chips, R.cv, R.cap, R.warn, g1, R.info, R.tgt, R.burn, R.burnCap, R.hold, R.ord, R.ordCap, R.mods, R.msg, R.ev);
  document.body.appendChild(root);
  R.back.onclick = () => { root.hidden = true; away = true; stopTimers(); };
  R.rng.onclick = () => { ranges = !ranges; R.rng.className = ranges ? '' : 'alt'; drawMap(); };
  R.zm.onclick = () => { zoom = zoom === 'zone' ? 'me' : 'zone'; R.zm.textContent = zoom === 'zone' ? 'Zone' : 'Me'; drawMap(); };
  R.rng.className = '';
  window.addEventListener('resize', () => { if (root && !root.hidden) drawMap(); });
}

function startTimers() {
  stopTimers();
  pollT = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  animT = setInterval(frame, 250);
}
function stopTimers() { clearInterval(pollT); clearInterval(animT); pollT = animT = 0; }

/* ---------- talking to the server ---------- */
async function poll() {
  if (busy) return;
  busy = true;
  try { apply(await call('combat_zone')); }
  catch (e) { if (R.msg) { R.msg.className = 'zmsg err'; R.msg.textContent = 'No answer yet (' + errText(e) + '). Trying again.'; } }
  finally { busy = false; }
}
async function send(action, body) {
  if (busy) { R.msg.className = 'zmsg muted'; R.msg.textContent = 'One moment...'; return; }
  busy = true;
  try { R.msg.className = 'zmsg muted'; R.msg.textContent = ''; apply(await call(action, body)); }
  catch (e) { R.msg.className = 'zmsg err'; R.msg.textContent = errText(e); }
  finally { busy = false; }
}
function order(kind) {
  const body = { kind };
  const tgt = sel || (view && view.me.target_id);
  if (kind !== 'stop' && kind !== 'flee') {
    if (tgt) body.target = tgt;
    const h = R.hold.value.trim();
    if (h !== '') { const n = Number(h); if (!Number.isFinite(n) || n < 1) { R.msg.className = 'zmsg err'; R.msg.textContent = 'The distance must be a number of km, 1 or more.'; return; } body.hold_km = n; }
  }
  send('combat_order', body);
}

/* a picture from the server */
function apply(v) {
  if (!v || !v.ok) return;
  if (!v.in_zone) { closeZone(v); return; }
  ui();
  view = v; recv = Date.now();
  if (!root.hidden || !away) { root.hidden = false; if (!pollT) startTimers(); }
  render();
}
function closeZone(v) {
  const was = !!view;
  view = null; sel = null; away = false; stopTimers(); chips.clear();
  if (root) { root.hidden = true; R.chips.replaceChildren(); }
  if (was && v && v.left) {
    say(v.ship_state === 'drifting' ? 'You flew out of the zone. Your ship is drifting: pick a destination on the Fly screen.' : 'Your ship was destroyed. (Test version: it stays docked at the range.)', v.ship_state === 'drifting' ? 'ok' : 'err');
    if (S.refresh) S.refresh();
  }
}

/* ---------- what fly.js uses ---------- */
export const zoneIn = () => !!view;
export async function zoneEnter() {                       // the Enter button of the popup
  const v = await call('combat_enter');
  away = false; apply(v);
}
export async function zoneShow() {                        // 'Return to the zone'
  away = false; ui(); root.hidden = false; await poll(); if (!view) root.hidden = true; else startTimers();
}
export async function zoneCheck() {                       // fly.js asks now and then while docked at a zone place: are we already inside?
  if (view || busy || Date.now() - lastCheck < 20000) return;
  lastCheck = Date.now(); busy = true;
  try { const v = await call('combat_zone'); if (v && v.in_zone) { away = false; apply(v); } } catch (e) { /* the popup stays as it is */ }
  finally { busy = false; }
}
export function resetZone() { view = null; sel = null; away = false; lastCheck = 0; stopTimers(); chips.clear(); if (root) { root.hidden = true; R.chips.replaceChildren(); } }

/* ---------- drawing the picture ---------- */
function nameOf(id) {
  if (!view) return 'a ship';
  if (id === view.me.id) return 'You';
  const s = view.ships.find(x => x.id === id);
  return s ? s.name : 'a ship';
}
function evText(e) {
  const a = nameOf(e.actor_id), t = nameOf(e.target_id);
  switch (e.kind) {
    case 'damage': return a + ' hit ' + t + ' for ' + whole(e.amount || 0);
    case 'kill': return a + ' destroyed ' + t;
    case 'shutdown': return (e.actor_id ? a : t) + ' shut down (overheated)';
    case 'resume': return (e.actor_id ? a : t) + ' is back online';
    case 'exit': return a + ' left the zone';
    case 'enter': return a + ' entered the zone';
    default: return e.kind;
  }
}
function render() {
  const v = view, m = v.me;
  R.title.textContent = 'Combat zone: ' + whole(v.zone.exit_km) + ' km across to the edge';
  R.bSh.set(m.shield, m.shield_max); R.bAr.set(m.armor, m.armor_max); R.bHu.set(m.hull, m.hull_max);
  R.bHe.set(m.heat, m.heat_cap, m.heat + ' / ' + m.heat_cap); R.bEn.set(m.endurance, m.endurance_max, Math.round(m.endurance) + ' / ' + Math.round(m.endurance_max));
  R.warn.hidden = !(m.tripped || m.drained);
  R.warn.textContent = m.tripped ? 'OVERHEATED: systems off for ' + Math.ceil(m.shutdown_left) + ' s' : m.drained ? 'Endurance spent: thrust limited to the free level' : '';
  Object.entries(R.burnB).forEach(([k, b]) => b.className = m.stance === k ? '' : 'alt');
  Object.entries(R.ordB).forEach(([k, b]) => b.className = m.order && m.order.kind === k ? '' : 'alt');
  // modules
  R.mods.replaceChildren();
  (m.modules || []).forEach(mod => {
    const b = el('button', mod.on ? '' : 'alt', mod.name + '\n' + (mod.heat ? mod.heat + ' heat/s  ' : '') + (mod.on ? 'ON' : 'OFF'));
    b.onclick = () => send('combat_module', { index: mod.i, on: !mod.on });
    R.mods.appendChild(b);
  });
  if (!(m.modules || []).length) R.mods.appendChild(el('div', 'zcap', 'No weapons or rigs fitted.'));
  // ship chips
  const ids = new Set(v.ships.map(s => s.id));
  for (const [id, c] of chips) if (!ids.has(id)) { c.b.remove(); chips.delete(id); }
  v.ships.forEach(s => {
    let c = chips.get(s.id);
    if (!c) { c = { b: makeChip(s.id), ship: s }; chips.set(s.id, c); }
    c.ship = s; c.b.classList.toggle('hos', s.hostile); c.b.classList.toggle('fri', !s.hostile);
  });
  if (sel && !ids.has(sel)) sel = null;
  [...chips.values()].sort((a, b) => dist(at(m), at(a.ship)) - dist(at(m), at(b.ship))).forEach(c => R.chips.appendChild(c.b));
  if (!chips.size) { if (!R.none) R.none = el('div', 'zcap', 'No other ships in the zone.'); R.chips.appendChild(R.none); } else if (R.none) R.none.remove();
  // events, newest last
  R.ev.replaceChildren(...(v.events || []).slice(-6).map(e => el('div', '', evText(e))));
  frame();
}
function makeChip(id) {
  const b = el('button', 'zchip'); let timer = 0, held = false;
  b.onpointerdown = () => { held = false; clearTimeout(timer); timer = setTimeout(() => { held = true; details(id); }, 500); };
  const cancel = () => clearTimeout(timer);
  b.onpointerup = cancel; b.onpointerleave = cancel; b.onpointercancel = cancel;
  b.oncontextmenu = ev => ev.preventDefault();
  b.onclick = () => { if (held) { held = false; return; } sel = sel === id ? null : id; frame(); };
  return b;
}
function details(id) {
  const s = view && view.ships.find(x => x.id === id); if (!s) return;
  const me = at(view.me), p = at(s);
  const w = el('div', 'zmodal'), box = el('div');
  box.append(
    el('div', '', s.name + (s.hostile ? '  (hostile)' : '  (friendly)')),
    el('div', 'muted', s.hull_id.replace(/_/g, ' ') + '  |  class ' + s.class),
    el('div', '', 'Distance: ' + km(dist(me, p))),
    el('div', '', 'Speed: ' + (Math.hypot(s.vx, s.vy)).toFixed(1) + ' km/s'),
    el('div', '', 'Shield ' + pct(s.shield) + '   Armor ' + pct(s.armor) + '   Hull ' + pct(s.hull)),
    el('div', s.tripped ? 'err' : 'muted', s.tripped ? 'Overheated: systems off' : 'Systems running'));
  const ok = el('button', '', 'Close'); ok.style.marginTop = '10px'; ok.onclick = () => w.remove();
  box.appendChild(ok); w.appendChild(box); w.onclick = ev => { if (ev.target === w) w.remove(); };
  document.body.appendChild(w);
}

/* things that change every moment (distance numbers, the target card, the map) */
function frame() {
  if (!view || !root || root.hidden) return;
  const m = view.me, mp = at(m);
  chips.forEach(c => {
    const d = dist(mp, at(c.ship));
    c.b.textContent = c.ship.name + '\n' + km(d);
    c.b.classList.toggle('sel', c.ship.id === sel);
  });
  const sp = Math.hypot(m.vx, m.vy);
  R.info.textContent = 'Speed ' + sp.toFixed(1) + ' km/s  |  from the center ' + km(Math.hypot(mp.x, mp.y)) + '  |  your thrust up to ' + m.max_g + ' g  |  repair ' + m.hps + '/s  |  ammo ' + m.ammo;
  const tid = sel || m.target_id, t = tid && view.ships.find(s => s.id === tid);
  if (!t) { R.tgt.textContent = chips.size ? 'No ship picked. Tap a ship at the top, then give an order.' : 'Nothing to fight here. Fly past the dashed ring to leave.'; }
  else {
    const d = dist(mp, at(t));
    R.tgt.textContent = t.name + (t.hostile ? ' (hostile)' : '') + '  |  ' + km(d) + '\nShield ' + pct(t.shield) + '   Armor ' + pct(t.armor) + '   Hull ' + pct(t.hull) +
      (t.id === m.target_id ? '\nYou are shooting it: about ' + m.dps + ' damage/s at this range' : '\nNot your target yet: give an Attack order');
    R.tgt.style.whiteSpace = 'pre-line';
  }
  drawMap();
}

function drawMap() {
  if (!view || !R.cv) return;
  const cv = R.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const m = view.me, mp = at(m), exit = view.zone.exit_km;
  let cx = 0, cy = 0, rad = exit * 1.08;
  if (zoom === 'me') { cx = mp.x; cy = mp.y; const far = Math.max(60000, ...(m.weapons || []).map(w => w.max_km)); rad = far * 1.25; }
  const k = Math.min(W, H) / 2 / rad;
  const X = x => (x - cx) * k + W / 2, Y = y => (y - cy) * k + H / 2;
  // the zone edge and the arrival ring
  const r0 = Math.hypot(mp.x, mp.y), near = r0 > 0.9 * exit;
  c.lineWidth = 1.5; c.setLineDash([6, 6]); c.strokeStyle = near ? '#ff5a4a' : '#6b7794';
  c.beginPath(); c.arc(X(0), Y(0), exit * k, 0, 7); c.stroke();
  c.strokeStyle = '#2a3350'; c.beginPath(); c.arc(X(0), Y(0), view.zone.entry_km * k, 0, 7); c.stroke();
  c.setLineDash([]); c.fillStyle = '#2a3350'; c.fillRect(X(0) - 3, Y(0) - 0.5, 6, 1); c.fillRect(X(0) - 0.5, Y(0) - 3, 1, 6);
  // my weapon reach: shaded discs (long = faint, best = stronger)
  if (ranges) (m.weapons || []).forEach(w => {
    const col = FAM[w.fam] || '#e8b64a';
    c.globalAlpha = 0.07; c.fillStyle = col; c.beginPath(); c.arc(X(mp.x), Y(mp.y), w.max_km * k, 0, 7); c.fill();
    c.globalAlpha = 0.5; c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.arc(X(mp.x), Y(mp.y), w.opt_km * k, 0, 7); c.stroke();
    c.globalAlpha = 1;
  });
  const dot = (s, p, col, label, ring) => {
    const x = X(p.x), y = Y(p.y);
    c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); c.lineTo(X(p.x + s.vx * 600), Y(p.y + s.vy * 600)); c.stroke();   // 10 game minutes ahead
    c.fillStyle = col; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill();
    if (ring) { c.strokeStyle = '#e8b64a'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, 7); c.stroke(); }
    c.fillStyle = '#d7e4f0'; c.font = '11px system-ui,sans-serif'; c.fillText(label, x + 8, y - 8);
  };
  const tid = sel || m.target_id;
  view.ships.forEach(s => dot(s, at(s), s.hostile ? '#ff7b6b' : '#6be08f', s.name, s.id === tid));
  dot(m, mp, '#e8b64a', 'You', false);
  c.fillStyle = '#8d98b2'; c.font = '11px system-ui,sans-serif'; c.fillText(zoom === 'zone' ? 'whole zone' : 'around you', 6, H - 6);
}
