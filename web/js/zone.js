// zone.js - the combat zone screen (COMBAT MVP step 4b, second version).
// One frame that fills the screen. The MAP fills all of it; everything else sits on top of the map:
//   top left   = settings button          left edge = your shield / armor / hull (+ heat, endurance) as thin vertical bars
//   top right  = the other ships as square chips (nearest at the right edge), 3 small bars under each
//   bottom     = your modules as square chips (first at the right edge): tap = on/off, hold = info, hold and slide = reorder
// Touch the map: one finger moves it, two fingers zoom it, a tap on a ship opens that ship's order menu.
// The page only DISPLAYS what the server says and REQUESTS orders. Between answers the dots move along their speed (display only).
// Server actions used: combat_zone, combat_enter, combat_order, combat_stance, combat_module.
import { S, call, whole, el, say } from 'core';

const POLL_MS = 5000;
const G_KMS2 = 0.00980665;                     // 1 g in km/s^2
let view = null, recv = 0, root = null, pollT = 0, animT = 0, busy = false, tick = 0;
let sel = null, menuFor = null, showRanges = true, lastCheck = 0, away = false, lastEv = null, lastMe = null;
let cam = null, cw = 0, ch = 0, modSig = '';
const R = {};                                  // the elements we keep
const chips = new Map();                       // ship id -> { w, b, dist, bars, ship }
const prevV = new Map(), acc = new Map(), head = new Map();   // per ship: last velocity, estimated acceleration, last heading
let pops = [];                                 // damage numbers { id, text, born }
const ptrs = new Map();                        // fingers on the map

const REL = { hos: '#ff5a4a', ally: '#4cd37a', neu: '#f2c744' };
const FAM = { laser: '#ff5a4a', railgun: '#6bb8ff', plasma: '#c58bff', missile: '#6be08f', torpedo: '#6be08f', drone: '#e8b64a' };

const CSS = `
.zn{position:fixed;inset:0;z-index:40;background:#070a12;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;--c:56px;font-family:system-ui,sans-serif;color:#e3e9f7}
.zn canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.zn button{margin:0}
.zset{position:absolute;left:6px;top:calc(6px + env(safe-area-inset-top,0px));width:44px;height:44px;padding:8px;background:#131a2a;border:1px solid #3a4a6a;border-radius:8px;color:#e3e9f7}
.zset svg,.zsq svg{width:100%;height:100%;display:block}
.ztop{position:absolute;left:56px;right:6px;top:calc(6px + env(safe-area-inset-top,0px));display:flex;flex-direction:row-reverse;gap:6px;align-items:flex-start;pointer-events:none}
.zbot{position:absolute;left:56px;right:6px;bottom:calc(6px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:row-reverse;gap:6px;align-items:flex-end;pointer-events:none}
.zc{display:flex;flex-direction:column;gap:2px;width:var(--c);pointer-events:auto}
.zsq{position:relative;width:var(--c);height:var(--c);padding:6px 6px 14px;border:2px solid #667;border-radius:8px;background:rgba(19,26,42,.88);color:#e3e9f7;pointer-events:auto;touch-action:none;box-sizing:border-box}
.zsq .zd{position:absolute;left:0;right:0;bottom:1px;font-size:10px;line-height:12px;text-align:center;color:#c8d2ea}
.zsq.sel{box-shadow:0 0 0 2px #fff}
.zsq.off{opacity:.38}
.zsq.drag{box-shadow:0 0 0 2px #e8b64a;z-index:5}
.zsb{position:relative;height:11px;background:#1c2438;border-radius:3px;overflow:hidden}
.zsb i{position:absolute;left:0;top:0;bottom:0;width:0}
.zsb span{position:relative;display:block;font-size:9px;line-height:11px;text-align:center;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000}
.zbars{position:absolute;left:6px;top:calc(56px + env(safe-area-inset-top,0px));bottom:calc(6px + env(safe-area-inset-bottom,0px));display:flex;gap:3px;pointer-events:none}
.zvb{position:relative;width:17px;background:rgba(28,36,56,.9);border-radius:4px;overflow:hidden}
.zvb i{position:absolute;left:0;right:0;bottom:0;height:0}
.zvb b{position:absolute;left:0;right:0;top:2px;font-size:10px;text-align:center;color:#fff;text-shadow:0 0 2px #000}
.zvb span{position:absolute;left:0;right:0;bottom:3px;top:16px;writing-mode:vertical-rl;transform:rotate(180deg);font-size:10px;text-align:center;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;white-space:nowrap}
.zmenu{position:absolute;z-index:6;background:#131a2a;border:1px solid #3a5a78;border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:5px;min-width:150px;max-width:260px}
.zmenu button{padding:10px 8px;font-size:14px;text-align:left}
.zmenu .zh{font-size:12px;color:#aab4cc;padding:0 2px 2px}
.zmenu .zr{display:flex;gap:5px}.zmenu .zr button{flex:1;padding:8px 4px;text-align:center;font-size:13px}
.zmenu input{width:100%;box-sizing:border-box}
.zinfo{position:absolute;z-index:7;right:6px;background:#131a2a;border:1px solid #3a5a78;border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.5;max-width:250px;pointer-events:none}
.zstat{position:absolute;left:56px;right:6px;font-size:11px;color:#aab4cc;text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;text-align:right}
.zwarn{position:absolute;left:60px;right:60px;text-align:center;color:#ff7b6b;font-weight:700;font-size:14px;text-shadow:0 0 4px #000,0 0 4px #000;pointer-events:none}
.ztoast{position:absolute;left:60px;right:10px;text-align:center;font-size:13px;color:#fff;background:rgba(19,26,42,.92);border:1px solid #3a5a78;border-radius:8px;padding:6px 8px;pointer-events:none;z-index:8}
.ztoast.err{border-color:#ff7b6b;color:#ffb0a6}
.zlog{position:absolute;z-index:6;left:56px;right:6px;font-size:12px;line-height:1.55;background:rgba(19,26,42,.94);border:1px solid #3a5a78;border-radius:8px;padding:8px}
`;

const IC = (d, extra) => '<svg viewBox="0 0 24 24" fill="currentColor"' + (extra || '') + '>' + d + '</svg>';
const ICON = {
  ship: IC('<path d="M12 2.5 20 21l-8-4.2L4 21z"/>'),
  drone: IC('<path d="M12 3 21 12 12 21 3 12z"/><circle cx="12" cy="12" r="3" fill="#0b0f19"/>'),
  railgun: IC('<rect x="2" y="9" width="15" height="2.4"/><rect x="2" y="13" width="15" height="2.4"/><path d="M17 7.5 23 12.2 17 17z"/>'),
  laser: IC('<path d="M2 12h13" stroke="currentColor" stroke-width="3"/><circle cx="18.5" cy="12" r="3.5"/><path d="M18.5 4v3M18.5 17v3M11 12" stroke="currentColor" stroke-width="2"/>'),
  plasma: IC('<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'),
  missile: IC('<path d="M3 8l5 3v2l-5 3 2-4z"/><rect x="7" y="9.5" width="10" height="5" rx="2.5"/><path d="M17 9.5 23 12 17 14.5z"/>'),
  weapon: IC('<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2"/>'),
  shield: IC('<path d="M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>'),
  armor: IC('<path d="M5 4h14l2 4v8l-2 4H5l-2-4V8z"/><path d="M8 9h8M8 12h8M8 15h8" stroke="#0b0f19" stroke-width="1.6"/>'),
  engine: IC('<path d="M12 22c-4-3-6-6-6-9 0-2.4 1.5-4.2 3-5.5.2 2 1 3 2 3.6C11 8 12 5 12 2c3.5 3 6 6.5 6 11 0 3-2 6-6 9z"/>'),
  power: IC('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  other: IC('<rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3"/>'),
};
const gear = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></svg>';
function modIcon(m) {
  if (m.family && ICON[m.family]) return ICON[m.family];
  if (m.kind === 'weapon') return ICON.weapon;
  const t = ((m.id || '') + ' ' + (m.name || '')).toLowerCase();
  if (t.includes('shield')) return ICON.shield;
  if (t.includes('armor') || t.includes('plat') || t.includes('repair')) return ICON.armor;
  if (t.includes('thrust') || t.includes('drive') || t.includes('engine') || t.includes('burn')) return ICON.engine;
  if (t.includes('power') || t.includes('reactor')) return ICON.power;
  return ICON.other;
}

/* ---------- small helpers ---------- */
const dg = () => (Date.now() - recv) / 1000 * ((view && view.scale) || 60);                  // game seconds since the picture was taken
const at = s => { const g = dg(); return { x: s.x + s.vx * g, y: s.y + s.vy * g }; };         // where a ship is NOW (display only)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const km = n => whole(n) + ' km';
const kshort = n => n >= 100000 ? Math.round(n / 1000) + 'k' : n >= 10000 ? (n / 1000).toFixed(0) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n) + '';
const pct = f => Math.round(Math.max(0, f) * 100);
const errText = e => (e && e.data && e.data.message) || (e && e.message) || 'error';
const rel = s => s.hostile ? 'hos' : (view && s.side === view.me.side ? 'ally' : 'neu');
const ORDER_NAME = { attack_max: 'Attack: long range', attack_opt: 'Attack: best range', follow: 'Follow', stop: 'Stop', flee: 'Flee' };

function mkSBar(color) {                       // the 3 small bars under a ship chip
  const w = el('div', 'zsb'), f = document.createElement('i'), t = document.createElement('span');
  f.style.background = color; w.append(f, t);
  return { w, set(frac) { f.style.width = Math.max(0, Math.min(100, frac * 100)) + '%'; t.textContent = pct(frac); } };
}
function mkVBar(letter, color) {               // the vertical bars on the left edge
  const w = el('div', 'zvb'), f = document.createElement('i'), l = document.createElement('b'), t = document.createElement('span');
  f.style.background = color; l.textContent = letter; w.append(f, l, t);
  return { w, set(cur, max) { f.style.height = (max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0) + '%'; t.textContent = whole(cur); } };
}
function toast(text, bad) {
  if (!root) return;
  R.toast.textContent = text; R.toast.className = 'ztoast' + (bad ? ' err' : ''); R.toast.hidden = false;
  clearTimeout(R.toastT); R.toastT = setTimeout(() => { R.toast.hidden = true; }, bad ? 6000 : 3500);
}

/* ---------- building the frame (once) ---------- */
function ui() {
  if (root) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = el('div', 'zn'); root.hidden = true;
  R.cv = document.createElement('canvas');
  R.set = el('button', 'zset'); R.set.innerHTML = gear;
  R.top = el('div', 'ztop'); R.bot = el('div', 'zbot');
  R.bars = el('div', 'zbars');
  R.bSh = mkVBar('S', '#3f8cff'); R.bAr = mkVBar('A', '#c9a24a'); R.bHu = mkVBar('H', '#4cd37a'); R.bHe = mkVBar('T', '#ff8a3a'); R.bEn = mkVBar('E', '#9a7bff');
  R.bars.append(R.bSh.w, R.bAr.w, R.bHu.w, R.bHe.w, R.bEn.w);
  R.stat = el('div', 'zstat'); R.warn = el('div', 'zwarn'); R.warn.hidden = true;
  R.toast = el('div', 'ztoast'); R.toast.hidden = true;
  R.menu = el('div', 'zmenu'); R.menu.hidden = true;
  R.sets = el('div', 'zmenu'); R.sets.hidden = true;
  R.info = el('div', 'zinfo'); R.info.hidden = true;
  R.log = el('div', 'zlog'); R.log.hidden = true;
  root.append(R.cv, R.bars, R.top, R.bot, R.stat, R.warn, R.toast, R.set, R.sets, R.menu, R.info, R.log);
  document.body.appendChild(root);
  buildSettings();
  R.set.onclick = ev => { ev.stopPropagation(); const open = R.sets.hidden; closeMenus(); R.sets.hidden = !open; if (open) placeBelow(R.sets, R.set); };
  root.addEventListener('pointerdown', ev => { if (!R.menu.contains(ev.target) && !R.sets.contains(ev.target) && ev.target !== R.set && !R.set.contains(ev.target) && !(ev.target.closest && ev.target.closest('.zc'))) closeMenus(true); }, true);
  bindMap();
  window.addEventListener('resize', () => { if (root && !root.hidden) { sizeChips(); frame(true); } });
}
function closeMenus(keepSel) { R.menu.hidden = true; R.sets.hidden = true; R.log.hidden = true; menuFor = null; }
function placeBelow(menu, anchor) {
  const a = anchor.getBoundingClientRect(), W = root.clientWidth;
  menu.style.top = Math.round(a.bottom + 6) + 'px';
  const w = menu.offsetWidth || 160;
  menu.style.left = Math.max(6, Math.min(W - w - 6, Math.round(a.left))) + 'px';
}

/* the settings menu: everything that has no place of its own */
function buildSettings() {
  const m = R.sets; m.replaceChildren();
  const mk = (label, fn, cls) => { const b = el('button', cls || 'alt', label); b.onclick = ev => { ev.stopPropagation(); fn(b); }; return b; };
  R.setRange = mk('', () => { showRanges = !showRanges; syncSettings(); drawMap(); });
  const burn = el('div', 'zr'); R.burnB = {};
  [['free', 'Free'], ['economy', 'Economy'], ['full', 'Full']].forEach(([k, label]) => { const b = mk(label, () => send('combat_stance', { stance: k })); R.burnB[k] = b; burn.appendChild(b); });
  const ord = el('div', 'zr'); R.ordB = {};
  [['follow', 'Follow'], ['stop', 'Stop']].forEach(([k, label]) => { const b = mk(label, () => { order(k, null); closeMenus(); }); R.ordB[k] = b; ord.appendChild(b); });
  R.hold = document.createElement('input'); R.hold.type = 'number'; R.hold.inputMode = 'numeric'; R.hold.placeholder = 'Distance to keep, km (empty = automatic)';
  m.append(el('div', 'zh', 'Burn (engine power)'), burn,
    R.setRange,
    mk('Show the whole zone', () => { fitCam(); closeMenus(); drawMap(); }),
    mk('Center on my ship', () => { centerCam(); closeMenus(); drawMap(); }),
    el('div', 'zh', 'Orders without a menu'), ord,
    el('div', 'zh', 'Distance for the next attack / follow order'), R.hold,
    mk('Event log', () => { closeMenus(); showLog(); }),
    mk('Hide this screen', () => { closeMenus(); root.hidden = true; away = true; stopTimers(); }));
}
function syncSettings() {
  if (!view) return;
  R.setRange.textContent = 'Weapon ranges: ' + (showRanges ? 'ON' : 'OFF');
  Object.entries(R.burnB).forEach(([k, b]) => b.className = view.me.stance === k ? '' : 'alt');
  Object.entries(R.ordB).forEach(([k, b]) => b.className = view.me.order && view.me.order.kind === k ? '' : 'alt');
}
function showLog() {
  R.log.replaceChildren(...(view ? view.events.slice(-8).map(e => el('div', '', evText(e))) : []));
  if (!R.log.childNodes.length) R.log.textContent = 'Nothing has happened yet.';
  R.log.style.top = '64px'; R.log.hidden = false;
  clearTimeout(R.logT); R.logT = setTimeout(() => { R.log.hidden = true; }, 9000);
}

function startTimers() {
  stopTimers();
  pollT = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  animT = setInterval(() => { tick++; frame(tick % 4 === 0); }, 100);
}
function stopTimers() { clearInterval(pollT); clearInterval(animT); pollT = animT = 0; }

/* ---------- talking to the server ---------- */
async function poll() {
  if (busy) return;
  busy = true;
  try { apply(await call('combat_zone', { last: lastMe })); }
  catch (e) { toast('No answer yet (' + errText(e) + '). Trying again.', true); }
  finally { busy = false; }
}
async function send(action, body) {
  if (busy) { toast('One moment...'); return; }
  busy = true;
  try { apply(await call(action, body)); }
  catch (e) { toast(errText(e), true); }
  finally { busy = false; }
}
function order(kind, targetId) {
  const body = { kind };
  if (kind !== 'stop' && kind !== 'flee') {
    const tgt = targetId || sel || (view && view.me.target_id);
    if (tgt) body.target = tgt;
    const h = R.hold.value.trim();
    if (h !== '') { const n = Number(h); if (!Number.isFinite(n) || n < 1) { toast('The distance must be a number of km, 1 or more.', true); return; } body.hold_km = n; }
  }
  send('combat_order', body);
}

/* a picture from the server */
function apply(v) {
  if (!v || !v.ok) return;
  if (!v.in_zone) { closeZone(v); return; }
  ui();
  view = v; recv = Date.now(); lastMe = v.me.id;
  trackMotion(v);
  newEvents(v);
  if (!cam) fitCam();
  if (!root.hidden || !away) { root.hidden = false; if (!pollT) startTimers(); }
  render();
}
function closeZone(v) {
  const was = !!view;
  view = null; sel = null; away = false; cam = null; modSig = ''; lastEv = null; pops = [];
  prevV.clear(); acc.clear(); head.clear(); stopTimers(); chips.clear();
  if (root) { root.hidden = true; R.top.replaceChildren(); R.bot.replaceChildren(); closeMenus(); }
  if (was && v && v.left) {
    if (v.ship_state === 'drifting') say('You flew out of the zone. Your ship is drifting: pick a destination on the Fly screen.', 'ok');
    else if (v.ended === 'cleared') say('Zone cleared. Your ship is docked at the range.', 'ok');
    else if (v.ended === 'kill') say('Your ship was destroyed. (Test version: it stays docked at the range.)', 'err');
    else say('The fight is over. Your ship is docked at the range.', 'ok');
    if (S.refresh) S.refresh();
  }
}

/* what the page remembers between pictures: speed changes (for the thrust lines) and new damage (for the numbers) */
function trackMotion(v) {
  const all = [v.me, ...v.ships];
  all.forEach(s => {
    const p = prevV.get(s.id);
    if (p) { const dtG = (recv - p.t) / 1000 * (v.scale || 60); if (dtG > 1) acc.set(s.id, { ax: (s.vx - p.vx) / dtG, ay: (s.vy - p.vy) / dtG }); }
    prevV.set(s.id, { vx: s.vx, vy: s.vy, t: recv });
    if (Math.hypot(s.vx, s.vy) > 0.2) head.set(s.id, Math.atan2(s.vy, s.vx));
  });
  const ids = new Set(all.map(s => s.id));
  for (const k of [...prevV.keys()]) if (!ids.has(k)) { prevV.delete(k); acc.delete(k); head.delete(k); }
}
function newEvents(v) {
  const evs = v.events || [];
  const top = evs.reduce((m, e) => Math.max(m, e.id || 0), 0);
  if (lastEv === null) { lastEv = top; return; }          // the first picture: do not replay old hits
  evs.filter(e => e.id > lastEv && e.kind === 'damage' && e.target_id).forEach((e, i) => {
    pops.push({ id: e.target_id, text: '-' + whole(e.amount || 0), born: Date.now() + i * 180 });
  });
  lastEv = Math.max(lastEv, top);
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
  try { const v = await call('combat_zone', {}); if (v && v.in_zone) { away = false; apply(v); } } catch (e) { /* the popup stays as it is */ }
  finally { busy = false; }
}
export function resetZone() {
  view = null; sel = null; away = false; lastCheck = 0; cam = null; modSig = ''; lastEv = null; lastMe = null; pops = [];
  prevV.clear(); acc.clear(); head.clear(); stopTimers(); chips.clear();
  if (root) { root.hidden = true; R.top.replaceChildren(); R.bot.replaceChildren(); closeMenus(); }
}

/* ---------- text for events ---------- */
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
    case 'cleared': return 'Zone cleared';
    default: return e.kind;
  }
}

/* ---------- rendering the chips and bars (after each picture) ---------- */
function sizeChips() {
  const n = Math.max(4, chips.size, view ? (view.me.modules || []).length : 0);
  const c = Math.max(38, Math.min(58, Math.floor((root.clientWidth - 70) / n) - 6));
  root.style.setProperty('--c', c + 'px');
}
function render() {
  const v = view, m = v.me;
  R.bSh.set(m.shield, m.shield_max); R.bAr.set(m.armor, m.armor_max); R.bHu.set(m.hull, m.hull_max);
  R.bHe.set(m.heat, m.heat_cap); R.bEn.set(m.endurance, m.endurance_max);
  R.warn.hidden = !(m.tripped || m.drained);
  R.warn.textContent = m.tripped ? 'OVERHEATED: systems off for ' + Math.ceil(m.shutdown_left) + ' s' : m.drained ? 'Endurance spent: thrust limited' : '';
  R.warn.style.top = 'calc(70px + env(safe-area-inset-top,0px))';
  syncSettings();
  renderShipChips();
  renderModChips();
  sizeChips();
  frame(true);
}
function renderShipChips() {
  const v = view, ids = new Set(v.ships.map(s => s.id));
  for (const [id, c] of chips) if (!ids.has(id)) { c.w.remove(); chips.delete(id); }
  v.ships.forEach(s => {
    let c = chips.get(s.id);
    if (!c) c = makeShipChip(s);
    c.ship = s;
    c.b.style.borderColor = REL[rel(s)];
    c.b.style.color = REL[rel(s)];
    c.bars[0].set(s.shield); c.bars[1].set(s.armor); c.bars[2].set(s.hull);
    c.b.title = s.name;
  });
  if (sel && !ids.has(sel)) sel = null;
  const mp = at(v.me);
  const sorted = [...chips.values()].sort((a, b) => dist(mp, at(a.ship)) - dist(mp, at(b.ship)));
  sorted.forEach(c => R.top.appendChild(c.w));                 // nearest first = right-most (the bar is right-to-left)
}
function makeShipChip(s) {
  const w = el('div', 'zc'), b = el('button', 'zsq'), d = el('div', 'zd');
  b.innerHTML = s.side === 'drones' ? ICON.drone : ICON.ship; b.appendChild(d);
  const bars = [mkSBar('#3f8cff'), mkSBar('#c9a24a'), mkSBar('#4cd37a')];
  w.append(b, ...bars.map(x => x.w));
  b.onclick = ev => { ev.stopPropagation(); pickShip(chips.get(s.id).ship.id); };
  const c = { w, b, dist: d, bars, ship: s };
  chips.set(s.id, c);
  return c;
}
function pickShip(id) {                                         // tap on a chip or on a ship on the map
  const c = chips.get(id); if (!c) return;
  if (menuFor === id) { closeMenus(); return; }
  closeMenus(); sel = id; menuFor = id;
  R.menu.replaceChildren(el('div', 'zh', c.ship.name + (c.ship.hostile ? ' (hostile)' : '')));
  [['attack_max', 'Attack: long range'], ['attack_opt', 'Attack: best range'], ['flee', 'Flee']].forEach(([k, label]) => {
    const b = el('button', view.me.order && view.me.order.kind === k && view.me.target_id === id ? '' : 'alt', label);
    b.onclick = ev => { ev.stopPropagation(); closeMenus(); order(k, id); };
    R.menu.appendChild(b);
  });
  R.menu.hidden = false; placeBelow(R.menu, c.w);
  frame(true);
}

/* modules at the bottom: tap = on/off, hold = info, hold and slide = new place */
function loadOrder() { try { return JSON.parse(localStorage.getItem('zone_mods') || '[]'); } catch (e) { return []; } }
function saveOrder(a) { try { localStorage.setItem('zone_mods', JSON.stringify(a)); } catch (e) { /* private mode: order is not kept */ } }
function modKeys(mods) { const seen = {}; return mods.map(m => { seen[m.id] = (seen[m.id] || 0) + 1; return m.id + '#' + seen[m.id]; }); }
function renderModChips() {
  const mods = view.me.modules || [], keys = modKeys(mods), saved = loadOrder();
  const idx = mods.map((m, i) => i).sort((a, b) => { const A = saved.indexOf(keys[a]), B = saved.indexOf(keys[b]); return (A < 0 ? 999 + a : A) - (B < 0 ? 999 + b : B); });
  const sig = idx.map(i => keys[i] + (mods[i].on ? '1' : '0')).join(',');
  if (sig === modSig) return;
  modSig = sig; R.bot.replaceChildren();
  if (!mods.length) { const n = el('div', '', 'No weapons or rigs fitted.'); n.style.cssText = 'font-size:12px;color:#aab4cc;padding:8px;pointer-events:none'; R.bot.appendChild(n); return; }
  idx.forEach(i => { const m = mods[i]; R.bot.appendChild(makeModChip(m, keys[i])); });
}
function makeModChip(m, key) {
  const b = el('button', 'zsq' + (m.on ? '' : ' off')); b.innerHTML = modIcon(m); b.dataset.key = key;
  b.style.color = FAM[m.family] || '#cfd8ea'; b.style.borderColor = m.on ? '#e8b64a' : '#445';
  const d = el('div', 'zd', m.heat ? m.heat + '/s' : (m.on ? 'ON' : 'OFF')); b.appendChild(d);
  let timer = 0, long = false, dragging = false, x0 = 0;
  b.onpointerdown = ev => {
    ev.stopPropagation(); b.setPointerCapture(ev.pointerId); x0 = ev.clientX; long = false; dragging = false;
    timer = setTimeout(() => { long = true; b.classList.add('drag'); showInfo(m, b); if (navigator.vibrate) navigator.vibrate(15); }, 450);
  };
  b.onpointermove = ev => {
    const dx = ev.clientX - x0;
    if (!long) { if (Math.abs(dx) > 10) clearTimeout(timer); return; }
    if (Math.abs(dx) > 14) { dragging = true; R.info.hidden = true; b.style.transform = 'translateX(' + dx + 'px)'; }
  };
  const done = ev => {
    clearTimeout(timer); b.classList.remove('drag'); R.info.hidden = true;
    if (dragging) {
      const sibs = [...R.bot.querySelectorAll('.zsq')].filter(x => x !== b);
      const place = sibs.filter(x => { const r = x.getBoundingClientRect(); return r.left + r.width / 2 > ev.clientX; }).length;   // how many chips are further right
      const keys = sibs.map(x => x.dataset.key); keys.splice(place, 0, key);
      saveOrder(keys); b.style.transform = ''; modSig = ''; renderModChips();
    } else if (!long && ev.type === 'pointerup') send('combat_module', { index: m.i, on: !m.on });
    long = dragging = false;
  };
  b.onpointerup = done; b.onpointercancel = done;
  b.oncontextmenu = ev => ev.preventDefault();
  return b;
}
function showInfo(m, anchor) {
  const me = view.me, w = (me.weapons || []).find(x => x.id === m.id), d = (me.dps_list || []).find(x => x.id === m.id);
  const lines = [m.name, (m.family || m.kind) + (m.on ? '' : '  (OFF)')];
  lines.push('Heat: ' + (m.heat || 0) + ' per second');
  if (w) { lines.push('Best range: ' + km(w.opt_km), 'Longest range: ' + km(w.max_km)); lines.push(d ? 'Damage now: ' + d.dps + '/s  (' + pct(d.acc) + '% hit)' : 'Damage: needs a target in range'); }
  R.info.replaceChildren(...lines.map((t, i) => el('div', i ? '' : 'zh', t)));
  R.info.hidden = false;
  R.info.style.bottom = Math.round(root.clientHeight - anchor.getBoundingClientRect().top + 8) + 'px';
}

/* ---------- the map: camera, touch, drawing ---------- */
function fitCam() { if (!view || !cw) { cam = cam || { cx: 0, cy: 0, k: 0 }; cam.fit = true; return; } cam = { cx: 0, cy: 0, k: Math.min(cw, ch) / 2 / (view.zone.exit_km * 1.08) }; }
function centerCam() {
  if (!view) return; const mp = at(view.me), far = Math.max(60000, ...(view.me.weapons || []).map(w => w.max_km));
  cam = { cx: mp.x, cy: mp.y, k: Math.min(cw, ch) / 2 / (far * 1.25) };
}
const toScr = (x, y) => ({ x: (x - cam.cx) * cam.k + cw / 2, y: (y - cam.cy) * cam.k + ch / 2 });
const toWorld = (px, py) => ({ x: (px - cw / 2) / cam.k + cam.cx, y: (py - ch / 2) / cam.k + cam.cy });
function clampCam() {
  if (!view) return;
  const base = Math.min(cw, ch) / 2 / (view.zone.exit_km * 1.08);
  cam.k = Math.max(base / 3, Math.min(base * 200, cam.k));
}
function bindMap() {
  const cv = R.cv; let tapT = 0, moved = 0, last = null, pinch = 0;
  cv.onpointerdown = ev => {
    cv.setPointerCapture(ev.pointerId); ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ptrs.size === 1) { tapT = Date.now(); moved = 0; last = { x: ev.clientX, y: ev.clientY }; } else { moved = 99; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  cv.onpointermove = ev => {
    if (!ptrs.has(ev.pointerId) || !cam) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (ptrs.size === 1 && last) {
      const dx = ev.clientX - last.x, dy = ev.clientY - last.y; moved += Math.abs(dx) + Math.abs(dy);
      cam.cx -= dx / cam.k; cam.cy -= dy / cam.k; last = { x: ev.clientX, y: ev.clientY }; drawMap();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) {
        const r = cv.getBoundingClientRect(), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top, w0 = toWorld(mx, my);
        cam.k *= d / pinch; clampCam();
        cam.cx = w0.x - (mx - cw / 2) / cam.k; cam.cy = w0.y - (my - ch / 2) / cam.k;   // the point under the fingers stays there
      }
      pinch = d; drawMap();
    }
  };
  const up = ev => {
    const was = ptrs.size; ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = 0;
    if (was === 1 && moved < 10 && Date.now() - tapT < 400 && ev.type === 'pointerup') tapMap(ev.clientX, ev.clientY);
    if (ptrs.size === 1) { const p = [...ptrs.values()][0]; last = { x: p.x, y: p.y }; moved = 99; }
  };
  cv.onpointerup = up; cv.onpointercancel = up;
}
function tapMap(cx, cy) {                                       // a tap on a ship opens its menu (from its chip)
  if (!view || !cam) return;
  const r = R.cv.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
  let best = null, bd = 28;
  view.ships.forEach(s => { const p = at(s), q = toScr(p.x, p.y), d = Math.hypot(q.x - px, q.y - py); if (d < bd) { bd = d; best = s; } });
  if (best) pickShip(best.id); else closeMenus();
}

/* things that change every moment */
function frame(full) {
  if (!view || !root || root.hidden) return;
  const m = view.me, mp = at(m);
  if (full) {
    chips.forEach(c => { c.dist.textContent = kshort(dist(mp, at(c.ship))); c.b.classList.toggle('sel', c.ship.id === sel); });
    const ord = m.order || { kind: 'stop' }, tgt = m.target_id && view.ships.find(s => s.id === m.target_id);
    R.stat.textContent = (ORDER_NAME[ord.kind] || ord.kind) + (tgt && ord.kind !== 'stop' && ord.kind !== 'flee' ? ': ' + tgt.name : '') + (ord.hold_km ? ' at ' + km(ord.hold_km) : '') +
      '  |  burn ' + m.stance + '  |  speed ' + Math.hypot(m.vx, m.vy).toFixed(1) + ' km/s  |  ' + kshort(Math.hypot(mp.x, mp.y)) + ' km from center';
    R.stat.style.bottom = 'calc(' + (parseInt(getComputedStyle(root).getPropertyValue('--c')) + 14) + 'px + env(safe-area-inset-bottom,0px))';
  }
  drawMap();
}

function drawMap() {
  if (!view || !R.cv) return;
  const cv = R.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const first = !cw; cw = W; ch = H;
  if (!cam || cam.fit || first) { fitCam(); cam.fit = false; }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const m = view.me, mp = at(m), exit = view.zone.exit_km, k = cam.k;
  // the zone edge (red when close to it)
  const near = Math.hypot(mp.x, mp.y) > 0.9 * exit, o = toScr(0, 0);
  c.lineWidth = 1.5; c.setLineDash([6, 6]); c.strokeStyle = near ? '#ff5a4a' : '#6b7794';
  c.beginPath(); c.arc(o.x, o.y, exit * k, 0, 7); c.stroke(); c.setLineDash([]);
  // my weapon reach: shaded disc = longest range, ring = best range
  if (showRanges) {
    const q = toScr(mp.x, mp.y);
    (m.weapons || []).forEach(w => {
      const col = FAM[w.fam] || '#e8b64a';
      c.globalAlpha = 0.07; c.fillStyle = col; c.beginPath(); c.arc(q.x, q.y, w.max_km * k, 0, 7); c.fill();
      c.globalAlpha = 0.5; c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.arc(q.x, q.y, w.opt_km * k, 0, 7); c.stroke();
      c.globalAlpha = 1;
    });
  }
  const tid = sel || m.target_id;
  const ship = (s, p, col, isMe) => {
    const q = toScr(p.x, p.y);
    const a = acc.get(s.id), g = a ? Math.hypot(a.ax, a.ay) / G_KMS2 : 0;
    const h = head.get(s.id) || 0;
    if (a && g > 0.05) {                                          // thrust: a red line pointing AWAY from the push
      const len = Math.min(34, 10 + 22 * g), ux = -a.ax / Math.hypot(a.ax, a.ay), uy = -a.ay / Math.hypot(a.ax, a.ay);
      c.strokeStyle = '#ff3b30'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.moveTo(q.x + ux * 6, q.y + uy * 6); c.lineTo(q.x + ux * (6 + len), q.y + uy * (6 + len)); c.stroke(); c.lineCap = 'butt';
    }
    c.save(); c.translate(q.x, q.y); c.rotate(h);                 // the ship: a triangle pointing the way it travels
    c.fillStyle = col; c.beginPath(); c.moveTo(9, 0); c.lineTo(-6, 6); c.lineTo(-3, 0); c.lineTo(-6, -6); c.closePath(); c.fill();
    if (isMe) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); }
    c.restore();
    if (s.id === tid && !isMe) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(q.x, q.y, 13, 0, 7); c.stroke(); }
    return q;
  };
  const pos = new Map();
  view.ships.forEach(s => { const p = at(s); pos.set(s.id, ship(s, p, REL[rel(s)], false)); });
  pos.set(m.id, ship(m, mp, REL.ally, true));
  // damage numbers: red, rising and fading
  const now = Date.now(); pops = pops.filter(p => now - p.born < 1500);
  c.font = 'bold 14px system-ui,sans-serif'; c.textAlign = 'center';
  pops.forEach(p => {
    const age = (now - p.born) / 1500; if (age < 0) return; const q = pos.get(p.id); if (!q) return;
    c.globalAlpha = 1 - age; c.lineWidth = 3; c.strokeStyle = '#000'; c.fillStyle = '#ff4a3a';
    c.strokeText(p.text, q.x, q.y - 14 - age * 34); c.fillText(p.text, q.x, q.y - 14 - age * 34);
  });
  c.globalAlpha = 1; c.textAlign = 'left';
}
