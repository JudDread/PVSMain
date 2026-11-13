// zone.js - the combat zone screen (COMBAT MVP step 4b, third version).
// One frame that fills the screen. The MAP fills all of it; everything else sits on top of the map:
//   top left     = settings (gear)            left edge, low = your shield / armor / hull as thin vertical bars
//   top right    = the other ships as square chips (nearest at the right edge), 3 small bars under each
//   bottom       = a row of heat (lying down), endurance and zoom chips, against the right edge, and under it your modules as square chips (48 px, the row scrolls;
//                  identical modules are ONE chip with a count: tap = all on / all off, hold = a menu of its modules)
// Touch the map: one finger moves it, two fingers zoom it, a tap on a ship opens its menu, a DOUBLE tap on empty map thrusts that way.
// The page only DISPLAYS what the server says and REQUESTS orders. Between answers every ship is moved along its speed AND its estimated
// acceleration, and each new answer is blended in over a moment, so the motion stays smooth at the screen's full speed.
// Server actions used: combat_zone, combat_enter, combat_order, combat_stance, combat_module.
import { S, call, whole, el, say } from 'core';
import { modal, closeModal, pointAt, clearPointer } from './coach.js';

const POLL_MS = 5000;
const KEEPALIVE_MS = 20000;        // a HIDDEN zone screen still polls this slowly: the server takes a pilot out of the zone after 60 s of silence (084)
const G_KMS2 = 0.00980665;                     // 1 g in km/s^2
let view = null, recv = 0, root = null, pollT = 0, raf = 0, busy = false, tick = 0;
let sel = null, menuFor = null, pending = null, showRanges = true, lastCheck = 0, away = false, lastEv = null, lastMe = null, failShown = false;
let outInfo = null, lastDrone = null, lastInstanced = false, lastSuccess = null, endWant = null, endAt = 0, endBusy = false, endSt = null, heatSt = null, lastAmmo = null, cam = null, cw = 0, ch = 0, modSig = '', zoomMode = 0, logOpen = false, heatOpen = false, lastTap = null, bgc = null, bgW = 0, bgH = 0, bgZone = '';
const R = {};                                  // the elements we keep
let comboFor = null, rtt = null;               // comboFor = the module id whose menu is open; rtt = how long the last answer took (ms)
let intent = null, orderPic = false, maxGSeen = 0;   // intent = my last movement order, shown AT ONCE on my own ship until the server's pictures take over; maxGSeen = the hardest thrust measured so far
const optMod = new Map();                      // module index -> { on, t }: what the pilot just asked for, shown AT ONCE until the server says the same
const chips = new Map();                       // ship id -> { w, b, dist, bars, ship }
const prevV = new Map(), acc = new Map(), head = new Map(), pst = new Map();   // per ship: last speed, estimated acceleration, last heading, drawing state
let pops = [];                                 // floating numbers { id, text, color, born }: red damage, blue shield regeneration
let popNext = 0;                               // the time (ms) the next number may appear: the numbers are queued one after the other
const POP_GAP = 450, POP_GAP_MIN = 250, POP_SPAN = 5000;   // ms between numbers (2026-11-06: longer, they ran together); the whole queue is kept to ~5 s so it does not fall behind the 5-second pictures
const ptrs = new Map(); const rangeOn = new Set();      // ships whose weapon ranges are shown on the map                        // fingers on the map

const REL = { hos: '#ff5a4a', ally: '#4cd37a', neu: '#f2c744' };
const FAM = { laser: '#ff5a4a', railgun: '#6bb8ff', plasma: '#c58bff', missile: '#6be08f', torpedo: '#6be08f', drone: '#e8b64a' };
const ZOOM_NAME = ['Zone', 'Me', 'Target', 'Free'];

const CSS = `
.zn{position:fixed;inset:0;z-index:40;background:#070a12;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;--c:48px;font-family:system-ui,sans-serif;color:#e3e9f7}
.zn canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.zn button{margin:0}
.zset{position:absolute;left:6px;top:calc(6px + env(safe-area-inset-top,0px));width:44px;height:44px;padding:7px;background:#131a2a;border:1px solid #3a4a6a;border-radius:8px;color:#e3e9f7}
.zset svg,.zsq svg{width:100%;height:100%;display:block}
.ztop{position:absolute;left:56px;right:6px;top:calc(6px + env(safe-area-inset-top,0px));display:flex;flex-direction:row;gap:6px;align-items:flex-start;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;pointer-events:none}
.ztop::-webkit-scrollbar{display:none}
.ztop>.zc:first-child{margin-left:auto}   /* few ships: the row sits against the right edge; a full row starts at the gear and the rest slides in from the right */
.ztop .zsq{touch-action:pan-x}
.zbot{position:absolute;left:72px;right:6px;bottom:calc(3px + env(safe-area-inset-bottom,0px));padding:3px;display:flex;flex-direction:row;gap:6px;align-items:flex-end;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;pointer-events:none}
.zbot::-webkit-scrollbar{display:none}
.zbot>.zsq,.zbot>div{flex:0 0 auto}
.zbot>.zsq:first-child{margin-left:auto}   /* few chips: the row sits against the right edge; more than fit: it starts at the left and scrolls (a slide on a chip scrolls it) */
.zside{position:absolute;right:6px;bottom:calc(var(--c) + 12px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:row;gap:6px;align-items:flex-end;pointer-events:none}   /* heat, endurance, zoom: one row above the module chips, against the right edge */
.zc{display:flex;flex-direction:column;gap:2px;width:var(--c);flex:0 0 auto;pointer-events:auto}
.zsq{position:relative;width:var(--c);height:var(--c);padding:6px 6px 14px;border:2px solid #667;border-radius:8px;background:rgba(19,26,42,.88);color:#e3e9f7;pointer-events:auto;touch-action:none;box-sizing:border-box;overflow:hidden}
.zsq .zd{position:absolute;left:0;right:0;bottom:1px;font-size:11px;line-height:12px;text-align:center;color:#c8d2ea;text-shadow:0 0 3px #000;white-space:nowrap;overflow:hidden}
.zsq .zcnt{position:absolute;top:0;right:3px;font-size:11px;line-height:13px;font-weight:700;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000}   /* x4 = four identical modules in this chip; 2/4 = two of them on */
.zsq.part{border-style:dashed}
.zsq.sel{box-shadow:0 0 0 2px #fff}
.zsq.off{opacity:.45}
.zsq.drag{box-shadow:0 0 0 2px #e8b64a;z-index:5}
.zsq.bar{padding:0}
.zsq.wide{width:calc(var(--c) * 2 + 6px)}
.zsq.wide .zf{top:0;bottom:0;left:0;right:auto;height:auto;width:0}   /* the heat chip lies on its side: it fills from the left */
.zsq .zf{position:absolute;left:0;right:0;bottom:0;height:0;opacity:.8}
.zsq .zt{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;font-weight:700;font-size:14px;color:#fff;text-shadow:0 0 3px #000,0 0 3px #000}

@keyframes zflash{0%,100%{background:rgba(255,40,30,.9)}50%{background:rgba(19,26,42,.9)}}
.zsq.flash{animation:zflash .6s infinite}
.zsq.wait{opacity:.55;border-style:dashed}
.zsq:active{transform:scale(.93)}
.zsq.bar.on{box-shadow:inset 0 0 0 2px #9a7bff,0 0 9px rgba(154,123,255,.65)}
.zsb{position:relative;height:13px;background:#1c2438;border-radius:3px;overflow:hidden}
.zsb i{position:absolute;left:0;top:0;bottom:0;width:0}
.zsb span{position:relative;display:block;font-size:11px;line-height:13px;text-align:center;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000}
.zbars{position:absolute;left:6px;bottom:calc(6px + env(safe-area-inset-bottom,0px));height:calc((100% - 62px) / 2);display:flex;gap:3px;pointer-events:none}
.zvb{position:relative;width:18px;background:rgba(28,36,56,.9);border-radius:4px;overflow:hidden}
.zvb i{position:absolute;left:0;right:0;bottom:0;height:0}
.zvb b{position:absolute;left:0;right:0;top:2px;font-size:11px;text-align:center;color:#fff;text-shadow:0 0 2px #000}
.zvb span{position:absolute;left:0;right:0;bottom:3px;top:16px;writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;text-align:center;color:#fff;text-shadow:0 0 2px #000,0 0 2px #000;white-space:nowrap}
.zmenu{position:absolute;z-index:6;background:#131a2a;border:1px solid #3a5a78;border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:5px;min-width:150px;max-width:270px}
.zmenu button{padding:3px 8px;min-height:0;line-height:1.25;font-size:13px;text-align:left}
.zmenu button.pend{opacity:.55;background:#2a3350;color:#9aa6c4;pointer-events:none}
.zmenu .zh{font-size:12px;color:#aab4cc;padding:0 2px 2px}
.zmenu .zl{font-size:12px;line-height:1.5;color:#d7e0f2;padding:0 2px}
.zmenu input{width:100%;box-sizing:border-box}
.zinfo{position:absolute;z-index:7;right:6px;background:#131a2a;border:1px solid #3a5a78;border-radius:8px;padding:8px 10px;font-size:13px;line-height:1.5;max-width:250px;pointer-events:none}
.zstat{position:absolute;left:70px;right:6px;font-size:11px;color:#aab4cc;text-shadow:0 0 3px #000,0 0 3px #000;pointer-events:none;text-align:right}
.zwarn{position:absolute;left:60px;right:60px;text-align:center;color:#ff7b6b;font-weight:700;font-size:14px;text-shadow:0 0 4px #000,0 0 4px #000;pointer-events:none}
.ztoast{position:absolute;left:70px;right:10px;bottom:calc(var(--c) * 2 + 40px);text-align:center;font-size:13px;color:#fff;background:rgba(19,26,42,.92);border:1px solid #3a5a78;border-radius:8px;padding:6px 8px;pointer-events:none;z-index:8}
.ztoast.err{border-color:#ff7b6b;color:#ffb0a6}
.zlog{position:absolute;z-index:6;left:56px;right:6px;top:64px;font-size:12px;line-height:1.55;background:rgba(19,26,42,.94);border:1px solid #3a5a78;border-radius:8px;padding:8px}
`;

const IC = d => '<svg viewBox="0 0 24 24" fill="currentColor">' + d + '</svg>';
const ICON = {
  ship: IC('<path d="M12 2.5 20 21l-8-4.2L4 21z"/>'),
  drone: IC('<path d="M12 3 21 12 12 21 3 12z"/><circle cx="12" cy="12" r="3" fill="#0b0f19"/>'),
  railgun: IC('<rect x="2" y="9" width="15" height="2.4"/><rect x="2" y="13" width="15" height="2.4"/><path d="M17 7.5 23 12.2 17 17z"/>'),
  laser: IC('<path d="M2 12h13" stroke="currentColor" stroke-width="3"/><circle cx="18.5" cy="12" r="3.5"/><path d="M18.5 4v3M18.5 17v3" stroke="currentColor" stroke-width="2"/>'),
  plasma: IC('<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>'),
  missile: IC('<path d="M3 8l5 3v2l-5 3 2-4z"/><rect x="7" y="9.5" width="10" height="5" rx="2.5"/><path d="M17 9.5 23 12 17 14.5z"/>'),
  weapon: IC('<circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2"/>'),
  shield: IC('<path d="M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>'),
  armor: IC('<path d="M5 4h14l2 4v8l-2 4H5l-2-4V8z"/><path d="M8 9h8M8 12h8M8 15h8" stroke="#0b0f19" stroke-width="1.6"/>'),
  engine: IC('<path d="M12 22c-4-3-6-6-6-9 0-2.4 1.5-4.2 3-5.5.2 2 1 3 2 3.6C11 8 12 5 12 2c3.5 3 6 6.5 6 11 0 3-2 6-6 9z"/>'),
  power: IC('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  other: IC('<rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3"/>'),
  zone: IC('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="1.8"/>'),
  me: IC('<path d="M12 6.5 16.5 17 12 14.8 7.5 17z"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
  target: IC('<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.2"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" stroke="currentColor" stroke-width="2"/>'),
  free: IC('<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" fill="none" stroke="currentColor" stroke-width="1.8"/>'),
};
function gearSvg() {                            // a real gear: 8 teeth round a hub with a hole
  const n = 8, ro = 11, ri = 8.4, cx = 12, cy = 12; let d = '';
  for (let i = 0; i < n; i++) {
    const a = i * 2 * Math.PI / n, w1 = 0.2, w2 = 0.34;
    [[ri, a - w2], [ro, a - w1], [ro, a + w1], [ri, a + w2]].forEach(([r, t], j) => { d += (i === 0 && j === 0 ? 'M' : 'L') + (cx + r * Math.cos(t)).toFixed(2) + ' ' + (cy + r * Math.sin(t)).toFixed(2); });
  }
  d += 'Z M12 8.6a3.4 3.4 0 1 0 0.01 0Z';
  return '<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="' + d + '"/></svg>';
}
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
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const km = n => whole(n) + ' km';
const kshort = n => n >= 100000 ? Math.round(n / 1000) + 'k' : n >= 10000 ? (n / 1000).toFixed(0) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n) + '';
const n0 = n => n >= 10000 ? Math.round(n / 1000) + 'k' : String(Math.round(n));
const pct = f => Math.round(Math.max(0, f) * 100);
const errText = e => (e && e.data && e.data.message) || (e && e.message) || 'error';
const rel = s => s.hostile ? 'hos' : (view && s.side === view.me.side ? 'ally' : 'neu');
const CLS = { light: 'lgt', medium: 'med', heavy: 'hvy', super: 'spr', capital: 'spr' };
const FAB = { railgun: 'RAIL', laser: 'LAS', plasma: 'PLS', missile: 'MSL', torpedo: 'TPD', drone: 'DRN' };
function abbr(name) {                                   // short names for the small menu: 'Armor Plating' -> 'AP', 'Shield' -> 'SHIE'
  const w = String(name || '').split(/[\s_-]+/).filter(Boolean);
  return (w.length > 1 ? w.map(x => x[0]).join('') : (w[0] || '?').slice(0, 4)).toUpperCase().slice(0, 4);
}
function grouped(list) {                                // ['RAIL','RAIL','LAS'] -> 'RAILx2 LAS'
  const n = new Map(); list.forEach(x => n.set(x, (n.get(x) || 0) + 1));
  return [...n].map(([k, c]) => c > 1 ? k + 'x' + c : k).join(' ') || 'none';
}
const ammoLabel = a => a < 0.05 ? '0' : String(Math.round(a));      // just the number: the word did not fit in the chip
const ORDER_NAME = { attack_max: 'Attack: long range', attack_opt: 'Attack: best range', follow: 'Follow', stop: 'Stop', drift: 'Drift', flee: 'Flee', heading: 'Thrust on a heading' };

/* where a ship is drawn NOW: its last picture moved along speed and acceleration, plus the part of the last correction still fading out.
   p.lim (only after a movement order of mine) = how many game seconds the push lasts (a Stop ends at speed 0) */
function kin(p, g) {
  const t1 = p.lim == null ? g : Math.min(g, p.lim), t2 = g - t1;
  const vx = p.vx + p.ax * t1, vy = p.vy + p.ay * t1;
  return { x: p.x + p.vx * t1 + 0.5 * p.ax * t1 * t1 + vx * t2, y: p.y + p.vy * t1 + 0.5 * p.ay * t1 * t1 + vy * t2, vx, vy };
}
function posOf(id) {
  const p = pst.get(id); if (!p || !view) return null;
  const ts = Math.min(12, (Date.now() - p.t) / 1000), g = ts * (view.scale || 60), k = Math.exp(-ts / 0.7), q = kin(p, g);
  return { x: q.x + p.ox * k, y: q.y + p.oy * k };
}
/* the speed drawn NOW: the last speed plus the estimated acceleration, plus the part of the last correction still fading out */
function velOf(id) {
  const p = pst.get(id); if (!p || !view) return null;
  const ts = Math.min(12, (Date.now() - p.t) / 1000), g = ts * (view.scale || 60), k = Math.exp(-ts / 0.7), q = kin(p, g);
  return { x: q.vx + p.ovx * k, y: q.vy + p.ovy * k };
}
/* the acceleration drawn NOW (null once a Stop has finished braking) */
function accOf(id) {
  const a = acc.get(id), p = pst.get(id);
  if (a && p && p.lim != null && view && (Date.now() - p.t) / 1000 * (view.scale || 60) > p.lim) return null;
  return a || null;
}
const P = s => posOf(s.id) || { x: s.x, y: s.y };
function headOf(s) {
  const p = pst.get(s.id); if (!p || !view) return head.get(s.id) || 0;
  const q = kin(p, Math.min(12, (Date.now() - p.t) / 1000) * (view.scale || 60)), vx = q.vx, vy = q.vy;
  if (Math.hypot(vx, vy) > 0.2) { const h = Math.atan2(vy, vx); head.set(s.id, h); return h; }
  return head.get(s.id) || 0;
}

function mkSBar(color) {                       // the 3 small bars under a ship chip
  const w = el('div', 'zsb'), f = document.createElement('i'), t = document.createElement('span');
  f.style.background = color; w.append(f, t);
  return { w, set(frac, text) { f.style.width = Math.max(0, Math.min(100, frac * 100)) + '%'; t.textContent = text; } };
}
function mkVBar(letter, color) {               // the vertical bars on the left edge
  const w = el('div', 'zvb'), f = document.createElement('i'), l = document.createElement('b'), t = document.createElement('span');
  f.style.background = color; l.textContent = letter; w.append(f, l, t);
  return { w, set(cur, max) { f.style.height = (max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0) + '%'; t.textContent = whole(cur); } };
}
function mkBarChip(color, wide) {              // a chip that fills like a bar (wide = twice as wide: the heat chip, which fills from the left)
  const b = el('button', 'zsq bar' + (wide ? ' wide' : '')), f = el('div', 'zf'), t = el('div', 'zt'), d = el('div', 'zd');
  f.style.background = color; b.append(f, t, d);
  return { b, f, t, d };
}
function toast(text, bad) {
  if (!root) return;
  R.toast.textContent = text; R.toast.className = 'ztoast' + (bad ? ' err' : ''); R.toast.hidden = false;
  clearTimeout(R.toastT); R.toastT = setTimeout(() => { R.toast.hidden = true; }, bad ? 6000 : 3000);
}

/* ---------- building the frame (once) ---------- */
function ui() {
  if (root) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = el('div', 'zn'); root.hidden = true;
  R.cv = document.createElement('canvas');
  R.set = el('button', 'zset'); R.set.innerHTML = gearSvg();
  R.top = el('div', 'ztop'); R.bot = el('div', 'zbot');
  R.bars = el('div', 'zbars');
  R.bSh = mkVBar('S', '#3f8cff'); R.bAr = mkVBar('A', '#c9a24a'); R.bHu = mkVBar('H', '#4cd37a');
  R.bars.append(R.bSh.w, R.bAr.w, R.bHu.w);
  // right edge, middle: zoom, endurance, heat
  R.side = el('div', 'zside');
  R.zoomB = el('button', 'zsq'); R.zoomD = el('div', 'zd'); R.zoomB.append(R.zoomD);
  R.end = mkBarChip('#9a7bff', false); R.heat = mkBarChip('#4cd37a', true);
  R.side.append(R.heat.b, R.end.b, R.zoomB);                    // left to right: heat, endurance, zoom
  R.stat = el('div', 'zstat'); R.warn = el('div', 'zwarn'); R.warn.hidden = true;
  R.toast = el('div', 'ztoast'); R.toast.hidden = true;
  R.menu = el('div', 'zmenu'); R.menu.hidden = true;
  R.sets = el('div', 'zmenu'); R.sets.hidden = true;
  R.pop = el('div', 'zmenu'); R.pop.hidden = true;
  R.combo = el('div', 'zmenu'); R.combo.hidden = true;
  R.info = el('div', 'zinfo'); R.info.hidden = true;
  R.log = el('div', 'zlog'); R.log.hidden = true;
  root.append(R.cv, R.bars, R.top, R.bot, R.side, R.stat, R.warn, R.toast, R.set, R.sets, R.menu, R.pop, R.combo, R.info, R.log);
  document.body.appendChild(root);
  buildSettings();
  setZoomChip();
  R.set.onclick = ev => { ev.stopPropagation(); const open = R.sets.hidden; closeMenus(); R.sets.hidden = !open; if (open) placeBelow(R.sets, R.set); };
  R.zoomB.onclick = ev => { ev.stopPropagation(); cycleZoom(); };
  R.end.b.onclick = ev => {
    ev.stopPropagation();
    if (!view || endBusy) return;                                           // one change at a time
    if (view.me.stance === 'free' && view.me.drained) {                     // 2026-11-02: switching ON is not possible until the endurance has refilled
      toast("Can't activate until your endurance is above " + Math.round((view.me.end_recover || 0.25) * 100) + '%.', true);
      return;
    }
    endWant = view.me.stance === 'free'; endAt = Date.now(); endBusy = true; // true = we asked for ON: the chip shows it AT ONCE
    paintBars(true);
    queueStep({ op: 'stance', stance: endWant ? 'full' : 'free' })
      .then(ok => { if (!ok) endWant = null; })                             // the order failed: the chip goes back to what the server says
      .finally(() => { endBusy = false; if (view) paintBars(true); });
  };
  R.heat.b.onclick = ev => { ev.stopPropagation(); const open = R.pop.hidden; closeMenus(); if (open) { heatOpen = true; fillHeat(); R.pop.hidden = false; placeAbove(R.pop, R.heat.b); } };
  root.addEventListener('pointerdown', ev => {
    const t = ev.target, inside = x => x && x.contains(t);
    if (inside(R.menu) || inside(R.sets) || inside(R.pop) || inside(R.combo) || inside(R.set) || inside(R.heat.b) || (t.closest && (t.closest('.zc') || t.closest('.ztop')))) return;
    closeMenus();
  }, true);
  bindMap();
  window.addEventListener('resize', () => { if (root && !root.hidden) { sizeChips(); frame(true); } });
}
function closeMenus() { R.menu.hidden = true; R.sets.hidden = true; R.pop.hidden = true; R.combo.hidden = true; R.log.hidden = true; menuFor = null; pending = null; logOpen = false; heatOpen = false; comboFor = null; }
function placeBelow(menu, anchor) {
  const a = anchor.getBoundingClientRect(), W = root.clientWidth, w = menu.offsetWidth || 160;
  menu.style.right = 'auto'; menu.style.bottom = 'auto'; menu.style.top = Math.round(a.bottom + 6) + 'px';
  menu.style.left = Math.max(6, Math.min(W - w - 6, Math.round(a.left))) + 'px';
}
function placeAt(menu, px, py) {                // below a point on the map (the player's own ship)
  const W = root.clientWidth, w = menu.offsetWidth || 160;
  menu.style.right = 'auto'; menu.style.bottom = 'auto'; menu.style.top = Math.round(py + 22) + 'px';
  menu.style.left = Math.max(6, Math.min(W - w - 6, Math.round(px - w / 2))) + 'px';
}
function placeAbove(menu, anchor) {             // above a chip near the bottom (the heat popup, the menu of a combined module chip)
  const a = anchor.getBoundingClientRect(), W = root.clientWidth, H = root.clientHeight, w = menu.offsetWidth || 160;
  menu.style.top = 'auto'; menu.style.right = 'auto';
  menu.style.bottom = Math.round(H - a.top + 8) + 'px';
  menu.style.left = Math.max(6, Math.min(W - w - 6, Math.round(a.left + a.width / 2 - w / 2))) + 'px';
}
function placeLeft(menu, anchor) {              // to the left of a chip on the right edge
  const a = anchor.getBoundingClientRect(), W = root.clientWidth;
  menu.style.left = 'auto'; menu.style.bottom = 'auto'; menu.style.right = Math.round(W - a.left + 8) + 'px';
  menu.style.top = Math.max(6, Math.round(a.top)) + 'px';
}

/* the settings menu: only what has no place of its own */
function buildSettings() {
  const m = R.sets; m.replaceChildren();
  R.rtt = el('div', 'zh', '');
  const mk = (label, fn, cls) => { const b = el('button', cls || 'alt', label); b.onclick = ev => { ev.stopPropagation(); fn(b); }; return b; };
  R.setRange = mk('', () => { showRanges = !showRanges; syncSettings(); drawMap(); });
  R.hold = document.createElement('input'); R.hold.type = 'number'; R.hold.inputMode = 'numeric'; R.hold.placeholder = 'Distance to keep, km (empty = automatic)';
  m.append(R.setRange,
    el('div', 'zh', 'Distance for the next attack order'), R.hold,
    mk('Event log', () => { closeMenus(); logOpen = true; fillLog(); R.log.hidden = false; }),
    mk('Hide this screen', () => { closeMenus(); root.hidden = true; away = true; stopTimers(); pollT = setInterval(() => { if (!document.hidden) poll(); }, KEEPALIVE_MS); }), R.rtt);
}
function syncSettings() { R.setRange.textContent = 'Weapon ranges: ' + (showRanges ? 'ON' : 'OFF'); R.rtt.textContent = 'Last answer: ' + (rtt == null ? '-' : (rtt / 1000).toFixed(1) + ' s'); }
function fillLog() {
  R.log.replaceChildren(...(view ? view.events.filter(e => e.kind !== 'regen').slice(-8).map(e => el('div', '', evText(e))) : []));
  if (!R.log.childNodes.length) R.log.textContent = 'Nothing has happened yet.';
}

function startTimers() {
  stopTimers();
  pollT = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
  const loop = () => { tick++; frame(tick % 15 === 0); raf = requestAnimationFrame(loop); };       // the screen's own speed; the text parts update ~4 times a second
  raf = requestAnimationFrame(loop);
}
function stopTimers() { clearInterval(pollT); cancelAnimationFrame(raf); pollT = 0; raf = 0; }

/* ---------- talking to the server ---------- */
function resetPoll() {                           // an order's answer is a full picture: the next 5-second update waits 5 s from NOW (no extra requests)
  if (!pollT) return;
  clearInterval(pollT);
  pollT = setInterval(() => { if (!document.hidden) poll(); }, away ? KEEPALIVE_MS : POLL_MS);
}
async function poll() {
  if (busy) return;
  busy = true; const t0 = performance.now();
  try { const v = await call('combat_zone', { last: lastMe }); rtt = Math.round(performance.now() - t0); apply(v); }
  catch (e) { toast('No answer yet (' + errText(e) + '). Trying again.', true); }
  finally { busy = false; }
}
/* ORDERS: every change (a module switch, END, a target, a movement order) is a STEP. Steps wait in a queue and leave together in ONE request (combat_batch):
   when the line is free they go at once; while an update or an earlier order is still on its way, whatever piles up meanwhile goes in one request afterwards.
   queueStep() answers true / false when its request is done. If the server does not know combat_batch yet (a new page with the old server), the steps go one by one. */
const stepQ = [];
let flushing = false, batchOk = true;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OLD_ACTION = { module: 'combat_module', order: 'combat_order', target: 'combat_target', stance: 'combat_stance' };
function queueStep(step) { return new Promise(resolve => { stepQ.push({ step, resolve }); flushSteps(); }); }
async function flushSteps() {
  if (flushing) return; flushing = true;
  try {
    await sleep(0);                                           // steps queued by the same tap leave together
    while (stepQ.length) {
      for (let i = 0; busy && i < 150; i++) await sleep(40);  // an update is in flight: wait for it (up to 6 s) instead of dropping the order
      if (busy) { stepQ.splice(0).forEach(q => q.resolve(false)); toast('The server is slow to answer. Please try again.', true); pending = null; if (!R.menu.hidden) buildMenu(); break; }
      await sendSteps(stepQ.splice(0, 12));
    }
  } finally { flushing = false; }
}
async function sendSteps(part) {
  busy = true; const t0 = performance.now(); const steps = part.map(q => q.step);
  try {
    let v = null;
    if (batchOk) {
      try { v = await call('combat_batch', { steps }); }
      catch (e) { if (e && e.message === 'unknown_action') batchOk = false; else throw e; }
    }
    if (!batchOk) { for (const s of steps) { const { op, ...rest } = s; v = await call(OLD_ACTION[op], rest); } }
    rtt = Math.round(performance.now() - t0);
    orderPic = steps.some(x => x.op === 'order');
    try { apply(v); } finally { orderPic = false; }
    resetPoll();
    if (v && v.notes && v.notes.length) {
      if (intent && steps.some(x => x.op === 'order')) { revertIntent(); setTimeout(poll, 300); }       // an order was refused: back to what the server says                     // some steps were refused: say so, and show what is really switched
      toast(v.notes[0], true); steps.filter(s => s.op === 'module').forEach(s => optMod.delete(s.index)); modSig = ''; if (view) renderModChips();
    }
    part.forEach(q => q.resolve(true));
  } catch (e) {
    toast(errText(e), true); pending = null; if (!R.menu.hidden) buildMenu();
    if (steps.some(x => x.op === 'order')) revertIntent();
    steps.filter(s => s.op === 'module').forEach(s => optMod.delete(s.index)); modSig = ''; if (view) renderModChips();
    part.forEach(q => q.resolve(false)); setTimeout(poll, 300);   // a refused order: look at the real state again
  } finally { busy = false; }
}
/* what the pilot just asked for is SHOWN at once (the server's answer confirms or corrects it a moment later) */
function optOrder(body) {
  if (!view) return;
  const me = view.me, o = { kind: body.kind };
  if (body.target && (body.kind === 'attack_max' || body.kind === 'attack_opt')) me.target_id = body.target;   // the weapons' target changes only with an attack order
  if (body.kind === 'follow') o.follow_id = body.target;
  if (body.kind === 'heading') o.dir_deg = body.dir_deg;
  if (body.hold_km) o.hold_km = body.hold_km;
  me.order = o; frame(true);
}
/* MY SHIP AT ONCE: a movement order sets my ship's push right away (flame, speed, path); the server's answer and the next picture take over.
   Approximate on purpose (the push is the hardest thrust measured so far, 3 g at the start): it only has to cover the few seconds until the next picture. */
function rebase(id, ax, ay, lim) {
  const pos = posOf(id), vel = velOf(id); if (!pos || !vel) return;
  pst.set(id, { x: pos.x, y: pos.y, vx: vel.x, vy: vel.y, ax, ay, t: Date.now(), ox: 0, oy: 0, ovx: 0, ovy: 0, lim: lim == null ? undefined : lim });
  acc.set(id, { ax, ay });
}
function intendMove(body) {
  if (!view || !pst.has(view.me.id)) return;
  const m = view.me, mp = P(m), vel = velOf(m.id) || { x: m.vx, y: m.vy }, sp = Math.hypot(vel.x, vel.y), gk = Math.max(maxGSeen, 3) * G_KMS2;
  let ux = 0, uy = 0, lim;
  if (body.kind === 'heading') { const r = body.dir_deg * Math.PI / 180; ux = Math.cos(r); uy = Math.sin(r); }
  else if (body.kind === 'stop') { if (sp > 0.2) { ux = -vel.x / sp; uy = -vel.y / sp; lim = sp / gk; } }
  else if (body.kind !== 'drift') {                                       // attack / follow = toward the ship, flee = away from it
    const t = view.ships.find(x => x.id === body.target), tp = t && P(t), dd = tp ? Math.hypot(tp.x - mp.x, tp.y - mp.y) : 0;
    if (tp && dd > (body.hold_km || 1)) { const sg = body.kind === 'flee' ? -1 : 1; ux = sg * (tp.x - mp.x) / dd; uy = sg * (tp.y - mp.y) / dd; }
  }
  intent = { t: Date.now(), prevAcc: acc.get(m.id) || { ax: 0, ay: 0 }, lim, settled: false };
  rebase(m.id, ux * gk, uy * gk, lim);
}
function revertIntent() {                        // the order did not go through: my ship goes back to the last measured push
  if (!intent) return;
  const a = intent.prevAcc; intent = null;
  if (view) rebase(view.me.id, a.ax, a.ay);
}
function order(kind, targetId, deg) {
  const body = { kind };
  if (kind === 'heading') body.dir_deg = deg;
  else if (kind !== 'stop' && kind !== 'flee' && kind !== 'drift') {
    const tgt = targetId || sel || (view && view.me.target_id);
    if (tgt) body.target = tgt;
    const h = R.hold.value.trim();
    if (h !== '' && kind !== 'follow') { const n = Number(h); if (!Number.isFinite(n) || n < 1) { toast('The distance must be a number of km, 1 or more.', true); pending = null; if (!R.menu.hidden) buildMenu(); return; } body.hold_km = n; }
  }
  optOrder(body); intendMove(body); closeMenus();
  queueStep({ op: 'order', ...body });
}
function orderActive(kind, id) {
  if (kind === 'target') return !!view && view.me.target_id === id;            // 'Set as target': the weapons' target only
  const o = view && view.me.order; if (!o || o.kind !== kind) return false;
  if (kind === 'follow') return o.follow_id === id;                            // follow has its own subject now
  return (kind === 'attack_max' || kind === 'attack_opt') ? view.me.target_id === id : true;
}

/* a picture from the server */
function apply(v) {
  if (!v || !v.ok) return;
  if (!v.in_zone) { closeZone(v); return; }
  ui();
  view = v; recv = Date.now(); lastMe = v.me.id;
  (v.me.modules || []).forEach(m => { const o = optMod.get(m.i); if (o && (m.on === o.on || Date.now() - o.t > 8000)) optMod.delete(m.i); });
  if (v.run_failed && !failShown) {                              // 085: the escort target was lost: the run no longer counts (the fight goes on)
    failShown = true;
    modal({ kicker: 'VACUUM STATE', title: 'Mission failed', paras: [v.fail_text || 'The mission has failed.'], buttons: [{ label: 'OK', onClick: closeModal }] });
  }
  const dr = (v.ships || []).find(s => s.drone && s.hostile);          // which drone we are fighting (for the choices after the kill)
  if (dr) lastDrone = dr.drone;
  lastInstanced = !!(v.zone && v.zone.instanced);
  lastSuccess = v.success_text || null;
  tourMaybe();
  trackMotion(v);
  trackBars(v);
  newEvents(v);
  if (lastAmmo !== null && lastAmmo >= 0.05 && v.me.ammo < 0.05 && (v.me.modules || []).some(x => x.family === 'missile')) toast('Out of missiles. The launchers are switched off.', true);
  lastAmmo = v.me.ammo;
  if (zoomMode === 2 && !targetShip()) setZoom(1);
  if (bgZone !== v.zone.id) {                                   // a picture for this zone, if the files exist (a missing file simply shows nothing)
    bgZone = v.zone.id;
    root.style.backgroundImage = "url('img/zone_" + v.zone.id + ".webp'), url('img/zone_bg.webp')";
    root.style.backgroundSize = 'cover'; root.style.backgroundPosition = 'center';
  }
  if (!cam) fitCam();
  if (pending && orderActive(pending.kind, pending.id)) { R.menu.hidden = true; menuFor = null; pending = null; }     // the order is active: the menu goes
  if (!root.hidden || !away) { root.hidden = false; if (!pollT) startTimers(); }
  render();
}
function closeZone(v) {
  const was = !!view, killedDrone = lastDrone, wasInstanced = lastInstanced, okText = lastSuccess, failedRun = failShown;
  lastSuccess = null;
  lastDrone = null; lastCheck = 0; tourAbort(); tourChecked = false;
  failShown = false;
  intent = null; maxGSeen = 0; view = null; sel = null; away = false; cam = null; modSig = ''; lastEv = null; pops = []; popNext = 0; zoomMode = 0; bgZone = ''; lastAmmo = null; endWant = null; endBusy = false; endSt = null; heatSt = null;
  prevV.clear(); acc.clear(); head.clear(); pst.clear(); rangeOn.clear(); optMod.clear(); stopTimers(); chips.clear();
  if (root) { root.hidden = true; R.top.replaceChildren(); R.bot.replaceChildren(); closeMenus(); setZoomChip(); }
  if (was && v && v.left) {
    const drifting = v.ship_state === 'drifting';
    if (v.ended === 'cleared') {                                // (checked FIRST: a one-time mission zone sets the ship drifting when the run ends, and that used to hide this popup)
      if (okText && !failedRun) {                               // a scripted zone with a success text (and the run was not failed)
        modal({ kicker: 'VACUUM STATE', title: 'Mission complete', paras: [okText], buttons: [{ label: 'OK', onClick: closeModal }] });
        if (drifting) say('Your ship is drifting: pick a destination on the Fly screen.', 'ok');
      } else say(drifting ? 'Zone cleared. Your ship is drifting: pick a destination on the Fly screen.' : 'Zone cleared. Your ship is docked at the range.', 'ok');
      if (wasInstanced && killedDrone) afterKill(killedDrone);
    }
    else if (v.ended === 'retreat') modal({ kicker: 'ESC RANGE CONTROL', title: 'Exercise ended', paras: [v.message || "Exercise ended: hull under 25%. There's a lesson here somewhere. Your ship can be repaired at any location with a market."], buttons: [{ label: 'OK', onClick: closeModal }] });
    else if (v.ended === 'timeout') modal({ kicker: 'VACUUM STATE', title: 'Signal lost', paras: [v.message || 'You blacked out.'], buttons: [{ label: 'OK', onClick: closeModal }] });
    else if (v.ended === 'kill') { /* the insurance popup (insurance.js) tells the pilot; it opens with the next refresh below */ }
    else if (drifting) say('You flew out of the zone. Your ship is drifting: pick a destination on the Fly screen.', 'ok');
    else say('The fight is over. Your ship is docked at the range.', 'ok');
    if (S.refresh) S.refresh();
  } else if (was && S.refresh) S.refresh();   // the fight ended while another pilot's poll worked the zone: still look at the pilot's ships again (a lost ship asks for its delivery place)
}

/* what the page remembers between pictures: acceleration (thrust lines and smooth motion) and new damage (the numbers) */
function trackMotion(v) {
  const all = [v.me, ...v.ships];
  all.forEach(s => {
    const p = prevV.get(s.id);
    let hold = false;                                          // my ship keeps the push of my last order until a picture measured AFTER the order's answer arrives
    if (s.id === v.me.id && intent) {
      if (orderPic) { intent.settled = true; hold = true; }
      else if (intent.settled || recv - intent.t > 15000) intent = null;
      else hold = true;
    }
    if (p && !hold) { const dtG = (recv - p.t) / 1000 * (v.scale || 60); if (dtG > 1) acc.set(s.id, { ax: (s.vx - p.vx) / dtG, ay: (s.vy - p.vy) / dtG }); }
    if (s.id === v.me.id && p && !hold) { const a0 = acc.get(s.id); if (a0) maxGSeen = Math.max(maxGSeen, Math.hypot(a0.ax, a0.ay) / G_KMS2); }
    prevV.set(s.id, { vx: s.vx, vy: s.vy, t: recv });
    const old = pst.has(s.id) ? posOf(s.id) : null;            // where it was drawn a moment ago: the new picture is blended in from there
    const oldVel = pst.has(s.id) ? velOf(s.id) : null;         // ... and how fast
    const a = acc.get(s.id) || { ax: 0, ay: 0 };
    const lim = hold && intent && intent.lim != null ? Math.max(0, intent.lim - (recv - intent.t) / 1000 * (v.scale || 60)) : undefined;   // a Stop in progress: braking time left
    pst.set(s.id, { x: s.x, y: s.y, vx: s.vx, vy: s.vy, ax: a.ax, ay: a.ay, t: recv, ox: old ? old.x - s.x : 0, oy: old ? old.y - s.y : 0, ovx: oldVel ? oldVel.x - s.vx : 0, ovy: oldVel ? oldVel.y - s.vy : 0, lim });
  });
  const ids = new Set(all.map(s => s.id));
  for (const k of [...pst.keys()]) if (!ids.has(k)) { pst.delete(k); prevV.delete(k); acc.delete(k); head.delete(k); }
}
/* endurance and heat between pictures: each bar is moved along its own rate, and every new picture is blended in over a moment.
   endurance: the rate is MEASURED between the last two pictures (the page does not know the pilot's burn numbers);
   heat: the rate is the model the heat menu already shows (heat made per second minus cooling) */
function trackBars(v) {
  const m = v.me;
  const oldE = endSt ? endNow() : null, oldH = heatSt ? heatNow() : null;
  let er = 0;
  if (endSt && recv - endSt.t > 500) { const raw = (m.endurance - endSt.v) / ((recv - endSt.t) / 1000); er = 0.4 * endSt.r + 0.6 * raw; }
  endSt = { v: m.endurance, t: recv, r: er, o: oldE === null ? 0 : oldE - m.endurance };
  const hr = m.tripped ? -(m.heat_cool || 0) : heatInfo().net;
  heatSt = { v: m.heat, t: recv, r: hr, o: oldH === null ? 0 : oldH - m.heat };
}
function endNow() {
  const m = view.me; if (!endSt) return m.endurance;
  const ts = Math.min(12, (Date.now() - endSt.t) / 1000);
  return Math.max(0, Math.min(m.endurance_max, endSt.v + endSt.r * ts + endSt.o * Math.exp(-ts / 0.7)));
}
function heatNow() {
  const m = view.me; if (!heatSt) return m.heat;
  const ts = Math.min(12, (Date.now() - heatSt.t) / 1000);
  return Math.max(0, Math.min(m.heat_cap, heatSt.v + heatSt.r * ts + heatSt.o * Math.exp(-ts / 0.7)));
}
function newEvents(v) {
  const evs = v.events || [];
  const top = evs.reduce((m, e) => Math.max(m, e.id || 0), 0);
  if (lastEv === null) { lastEv = top; return; }          // the first picture: do not replay old hits
  // a picture brings all of its hits and regenerations at once: they are queued and shown ONE AFTER THE OTHER, POP_GAP apart
  // (tighter only when a lot happened, so the queue is empty again before the next picture)
  const fresh = evs.filter(e => e.id > lastEv && (e.kind === 'damage' || e.kind === 'regen') && e.target_id);
  if (fresh.length) {
    const now = Date.now(), start = Math.max(now, popNext);
    const gap = Math.max(POP_GAP_MIN, Math.min(POP_GAP, (POP_SPAN - (start - now)) / fresh.length));
    fresh.forEach((e, i) => pops.push({ id: e.target_id, text: (e.kind === 'regen' ? '+' : '-') + whole(e.amount || 0), color: e.kind === 'regen' ? '#4aa8ff' : '#ff4a3a', born: start + i * gap }));
    popNext = start + fresh.length * gap;
  }
  lastEv = Math.max(lastEv, top);
}

/* ---------- what fly.js uses ---------- */
export const zoneIn = () => !!view;
let infoCb = null, infoKnown = false;                    // fly.js redraws its zone box when the answer of the range check arrives (a reload showed the first message until then)
export const zoneOnInfo = cb => { infoCb = cb; };
export const zoneInfoKnown = () => infoKnown;
function infoChanged() { infoKnown = true; if (infoCb) { try { infoCb(); } catch (e) { /* the box redraws at the next update */ } } }
export const zoneDrones = () => (outInfo && outInfo.here && Array.isArray(outInfo.drones)) ? outInfo.drones.filter(d => d.unlocked || d.startable) : [];   // the drones this pilot may ask for here (a startable one starts its mission)


/* ---------- the combat tour: the first time a pilot with the ESC mission esc_1 open enters the training range ----------
   "Skip the tour" is only offered in the opening message; after "Show me" every beat has Next and nothing else.
   The SERVER keeps the progress: finishing (or skipping) reports the mission step 'zone_tour' of esc_1. A fight that ends mid-tour just stops it (it starts again next time). */
let tourOn = false, tourChecked = false, tourI = 0, tourT = 0;
const DOT = '\u2022 ';
function tourBeats() {
  const attackSet = () => { const o = view && view.me && view.me.order; return !!o && (o.kind === 'attack_opt' || o.kind === 'attack_max'); };
  const menuOpen = () => !!view && !R.menu.hidden && !!menuFor && menuFor !== view.me.id;
  return [
    { hole: [], next: true, text: 'The Vacuum. This is where combat happens. Every zone has an escape edge, and any ship that crosses it leaves the zone and returns to the Main Map.' },
    { target: '.zbars', hole: [], next: true, text: 'Shield, armor, hull: the order in which damage is taken. Yours are at the side of the screen.' },
    { target: '.ztop .zc', hole: [], next: true, text: "Everyone else's sit under their chip. Once all three are gone, so is the ship." },
    { modal: true, title: 'Weapons', paras: [
      'Four kinds of weapon, each with its own opinion of how a fight should go.',
      DOT + 'RG (railgun): the standard weapon of space combat. Low heat, low power, good damage. Get into optimal range quickly, because accuracy drops off steeply.',
      DOT + "Laser: better damage than a railgun at long range, for high heat and high power. Not a beginner's choice.",
      DOT + 'Missile: better damage than railgun or laser at every range, unless the target has a point defense rig. It uses ammo, and ammo is finite.',
      DOT + 'Plasma: huge damage at short range. Meant for large, slow targets: freighters, bases, capital ships. Do not bring it to a dogfight.'] },
    { target: '.ztop .zc > .zsq', hole: ['.ztop .zc > .zsq'], until: menuOpen,
      text: 'The chips along the top are the other ships on the range. Touch a chip, or the ship itself on the map, to make it your target and open the targeting options. Try it now: touch the drone, then choose Attack: best range.' },
    { target: { sel: '.zmenu button', text: 'best range' }, hole: ['.zmenu button'], until: attackSet, back: () => R.menu.hidden && !attackSet(), text: 'Choose Attack: best range.' },
    { target: '.zbot', hole: [], next: true, text: 'The chips along the bottom are your own weapons and rigs. Touching one switches it on or off, which is how you manage your heat. A weapon that is off cannot overheat. It cannot hit anything either.' },
    { modal: true, title: 'Controls', paras: [
      DOT + 'Double-tap empty space to thrust toward that point. To brake, touch your own ship and choose Stop. There is no friction out here. Start braking before you need to.',
      DOT + 'Gear icon: settings and options for this screen. The fight goes on if you hide it.',
      DOT + 'END button: your endurance. ON lets the G-Drive burn as hard as your orders ask, at the cost of your endurance. OFF holds you to free thrust and lets you recover your endurance. Touch to switch.'] },
    { modal: true, last: true, title: 'Range Control', label: 'Begin', paras: ['That covers most of the basics. You can review all of it, and find more detailed descriptions, by tapping the Vacuum State button and opening the Library. Good hunting, Pilot. Range Control out.'] },
  ];
}
let tourList = null;
function tourShow() {
  clearPointer(); closeModal();
  const b = tourList && tourList[tourI];
  if (!b) return tourFinish();
  if (b.modal) {
    modal({ kicker: 'ESC RANGE CONTROL', title: b.title, paras: b.paras, buttons: [{ label: b.label || 'Next', onClick: b.last ? tourFinish : tourNext }] });
  } else {
    pointAt({ target: b.target || null, text: b.text, next: b.next ? 'Next' : null, onNext: b.next ? tourNext : null, lock: true, hole: b.hole, dock: b.dock });
  }
}
function tourNext() { tourI++; tourShow(); }
function tourAbort() { const was = tourOn; tourOn = false; clearInterval(tourT); tourT = 0; tourList = null; if (was) { clearPointer(); closeModal(); } }   // only touches the screen when a tour was running
async function tourReport() {
  try { const m = await import('./missions.js'); await m.reportStep('esc_1', 'zone_tour'); }
  catch (e) { say('Could not save the briefing: ' + errMsg(e), 'err'); }
}
function tourFinish() { tourAbort(); tourReport(); }
function tourStart() {
  tourOn = true; tourList = tourBeats(); tourI = 0;
  clearInterval(tourT);
  tourT = setInterval(() => {                                   // the beats that wait for the pilot to do something
    const b = tourList && tourList[tourI];
    if (!b || !view) return;
    if (b.until && b.until()) { tourNext(); return; }
    if (b.back && b.back()) { b.n = (b.n || 0) + 1; if (b.n >= 8) { b.n = 0; tourI--; tourShow(); } }   // 8 checks (2 s) in a row: the pilot really closed the menu without choosing
    else if (b.back) b.n = 0;
  }, 250);
  const pct = (view.zone && view.zone.retreat_pct) || 25;
  modal({ kicker: 'ESC RANGE CONTROL', title: 'Combat screen', paras: [
      'You are cleared for live exercise. This screen holds everything a gunfight needs, and nothing here can cost you your ship: if your ship falls below ' + pct + '% hull, we end the exercise and send you home.',
      'Let us show you around.'],
    buttons: [{ label: 'Show me', onClick: tourShow }, { label: 'Skip the tour', alt: true, onClick: tourFinish }] });
}
async function tourMaybe() {
  if (tourOn || tourChecked || !view || !(view.zone && view.zone.instanced)) return;
  try {
    const m = await import('./missions.js');
    const q = (m.missionList() || []).find(x => x.id === 'esc_1');
    if (!q) return;                                              // the mission list is not loaded yet: try again at the next picture
    tourChecked = true;
    if (q.status === 'active' && (q.steps || []).some(x => x.id === 'zone_tour' && !x.done) && view && !tourOn) tourStart();
  } catch (e) { /* no tour this time */ }
}

/* after a drone dies on an INSTANCED range: what next? Fight again, fight another drone (the next one starts its mission: the one just done is claimed, the next accepted), or leave. */
const errMsg = e => (e && e.data && (e.data.message || e.data.error)) || (e && e.message) || 'error';
const KILL_TEXT = {
  drone_1: "Target destroyed. Don't go getting a big head, it didn't have any weapons. If you're not comfortable with the layout yet, take a pass at another one.",
  drone_2: "Nice shooting. We were only a little worried. Keep fighting these until you're ready for two at once.",
  drone_pair: 'Two down. If your ship needs repairs, head to any location with a market.',
};
async function afterKill(killedId) {
  let list = [];
  try { const o = await call('combat_zone', {}); outInfo = o; infoChanged(); list = (o && o.here && o.drones) || []; } catch (e) { return; }
  const killed = list.find(d => d.id === killedId);
  if (!killed) return;
  const go = async d => {
    closeModal();
    try { await enterDrone(d); } catch (e) { say(errMsg(e), 'err'); }
    if (S.refresh) S.refresh();
  };
  const buttons = [{ label: 'Fight again', onClick: () => go(killed) }];
  list.filter(d => d.id !== killedId && (d.unlocked || d.startable)).forEach(d => buttons.push({ label: 'Fight the ' + d.name + (d.unlocked ? '' : ' (starts its mission)'), onClick: () => go(d) }));
  buttons.push({ label: 'Leave', alt: true, onClick: () => { closeModal(); if (S.refresh) S.refresh(); } });
  modal({ kicker: 'RANGE CONTROL', title: 'Exercise complete', paras: [(KILL_TEXT[killedId] || 'Target destroyed.') + (killed.xp ? ' (+' + killed.xp + ' XP' + (killed.count > 1 ? ' each' : '') + ')' : ''), 'Mission rewards are paid when you claim them on the Missions screen.'], buttons });
}
export async function zoneEnter(d) {                       // the Enter button of the popup. d = a drone choice from zoneDrones(), or nothing (the zone's own drone)
  if (d && typeof d === 'object') return enterDrone(d);
  const v = await call('combat_enter');
  away = false; apply(v);
}
const rewardText = r => [r.credits ? '+' + whole(r.credits) + ' credits' : '', r.xp ? '+' + whole(r.xp) + ' XP' : ''].filter(Boolean).join(', ') || 'no reward';
/* enter with a chosen drone. A drone whose mission is not open yet STARTS it: the mission before it is claimed (its reward is paid), the list synced, its own mission accepted. */
async function enterDrone(d) {
  if (!d.unlocked) {
    if (d.prev_quest) { try { const r = await call('mission_claim', { quest: d.prev_quest }); if (r && r.reward) say('Mission complete: ' + rewardText(r.reward) + '.', 'ok'); } catch (e) { /* already claimed or not ready: fine */ } }
    try { await call('missions'); } catch (e) { /* only syncs the mission list */ }
    if (d.quest) await call('mission_accept', { quest: d.quest });
  }
  const v = await call('combat_enter', { drone: d.id });
  away = false; apply(v);
}
export async function zoneShow() {                        // 'Return to the zone'
  away = false; ui(); root.hidden = false; await poll(); if (!view) root.hidden = true; else startTimers();
}
export async function zoneCheck() {                       // fly.js asks now and then while docked at a zone place: are we already inside?
  if (view || busy || Date.now() - lastCheck < 20000) return;
  lastCheck = Date.now(); busy = true;
  try { const v = await call('combat_zone', {}); if (v && v.in_zone) { away = false; apply(v); } else { outInfo = v; if (v && v.released && S.refresh) S.refresh(); } } catch (e) { /* the popup stays as it is */ }
  finally { busy = false; infoChanged(); }
}
export function resetZone() {
  failShown = false; lastSuccess = null; intent = null; maxGSeen = 0;
  view = null; sel = null; away = false; lastCheck = 0; cam = null; modSig = ''; lastEv = null; lastMe = null; pops = []; popNext = 0; zoomMode = 0;
  prevV.clear(); acc.clear(); head.clear(); pst.clear(); rangeOn.clear(); optMod.clear(); stopTimers(); chips.clear();
  if (root) { root.hidden = true; R.top.replaceChildren(); R.bot.replaceChildren(); closeMenus(); setZoomChip(); }
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

/* ---------- heat ---------- */
function heatInfo() {
  const m = view.me, list = [];
  let gen = 0;
  (m.modules || []).forEach(mod => {
    if (!mod.on || !mod.heat) return;
    const isW = mod.kind === 'weapon', firing = isW ? (m.dps_list || []).some(d => d.id === mod.id && d.dps > 0) && !(mod.family === 'missile' && m.ammo < 0.05) : true;
    list.push({ name: mod.name, heat: mod.heat, note: isW ? (firing ? 'firing now' : 'only while firing') : 'while on', active: firing });
    if (firing) gen += mod.heat;
  });
  const a = accOf(m.id), g = a ? Math.hypot(a.ax, a.ay) / G_KMS2 : 0, eng = (m.eng_k || 0) * Math.max(0, g - (m.eng_thr || 3));
  gen += eng;
  return { list, gen, eng, g, cool: m.heat_cool || 0, net: gen - (m.heat_cool || 0) };
}
function fillHeat() {
  const m = view.me, h = heatInfo(), f = m.heat_cap > 0 ? m.heat / m.heat_cap : 0;
  const rows = [el('div', 'zh', 'Heat ' + m.heat + ' of ' + m.heat_cap + ' (' + pct(f) + '%)')];
  h.list.forEach(x => rows.push(el('div', 'zl', x.name + ': +' + x.heat + '/s  (' + x.note + ')')));
  rows.push(el('div', 'zl', 'Engine: +' + h.eng.toFixed(1) + '/s' + (h.eng > 0 ? '' : '  (heat starts above ' + (m.eng_thr || 3) + ' g)')));
  rows.push(el('div', 'zl', 'Cooling: -' + h.cool + '/s'));
  rows.push(el('div', 'zl', 'Now: ' + (h.net >= 0 ? '+' : '') + h.net.toFixed(1) + '/s'));
  rows.push(el('div', 'zh', 'Weapons weaken above ' + pct(m.heat_warn || 0.8) + '%, and the ship shuts down at 100% until it cools below ' + pct(m.heat_resume || 0.6) + '%.'));
  R.pop.replaceChildren(...rows);
}

/* ---------- rendering the chips and bars (after each picture) ---------- */
function sizeChips() { /* the chips are 48 px everywhere (--c in the CSS); the bottom row scrolls instead of shrinking them */ }
/* the endurance chip (tap = all or none: ON = full burn, OFF = free burn only) and the heat chip. Called on every screen frame: the fill moves smoothly,
   the texts (text = true) only ~4 times a second. A tap on the endurance chip shows the wanted state AT ONCE and keeps it until the server says the same. */
function paintBars(text) {
  if (!view) return;
  const m = view.me;
  if (endWant !== null && ((m.stance !== 'free') === endWant || (!endBusy && Date.now() - endAt > 8000))) endWant = null;
  const ef = m.endurance_max > 0 ? endNow() / m.endurance_max : 0, eon = endWant !== null ? endWant : m.stance !== 'free';
  R.end.f.style.height = pct(ef) + '%'; R.end.f.style.background = eon ? '#9a7bff' : '#667';
  // heat chip: green to 40%, yellow to the first penalty, red above, flashing while shut down
  const hf = m.heat_cap > 0 ? heatNow() / m.heat_cap : 0, hw = m.heat_warn || 0.8, hcol = hf <= 0.4 ? '#4cd37a' : hf <= hw ? '#f2c744' : '#ff5a4a';
  R.heat.f.style.width = pct(hf) + '%'; R.heat.f.style.background = hcol;
  if (!text) return;
  R.end.t.textContent = pct(ef) + '%'; R.end.d.textContent = eon ? 'END ON' : 'END OFF';
  R.end.b.style.borderColor = m.drained ? '#ff5a4a' : (eon ? '#9a7bff' : '#667');
  R.end.b.classList.toggle('on', eon);
  const hi = heatInfo();
  R.heat.t.textContent = m.tripped ? 'HOT' : pct(hf) + '%';
  R.heat.d.textContent = (hi.gen >= 0 ? '+' : '') + hi.gen.toFixed(1) + '/s';
  R.heat.b.style.borderColor = hcol; R.heat.b.classList.toggle('flash', !!m.tripped);
}
function render() {
  const v = view, m = v.me;
  R.bSh.set(m.shield, m.shield_max); R.bAr.set(m.armor, m.armor_max); R.bHu.set(m.hull, m.hull_max);
  if (heatOpen) fillHeat();
  if (logOpen) fillLog();
  R.warn.hidden = !(m.tripped || m.drained);
  R.warn.textContent = m.tripped ? 'OVERHEATED: systems off for ' + Math.ceil(m.shutdown_left) + ' s' : m.drained ? 'Endurance spent: thrust limited' : '';
  R.warn.style.top = 'calc(70px + env(safe-area-inset-top,0px))';
  syncSettings();
  renderShipChips();
  renderModChips();
  sizeChips();
  if (!R.menu.hidden && menuFor) buildMenu();
  frame(true);
}
function renderShipChips() {
  const v = view, ids = new Set(v.ships.map(s => s.id));
  for (const [id, c] of chips) if (!ids.has(id)) { c.w.remove(); chips.delete(id); }
  v.ships.forEach(s => {
    let c = chips.get(s.id);
    if (!c) c = makeShipChip(s);
    c.ship = s;
    c.b.style.borderColor = REL[rel(s)]; c.b.style.color = REL[rel(s)];
    c.bars[0].set(s.shield, n0(s.sh)); c.bars[1].set(s.armor, n0(s.ar)); c.bars[2].set(s.hull, n0(s.hu));
    c.b.title = s.name;
  });
  if (sel && !ids.has(sel)) sel = null;
  const mp = P(v.me);
  const sorted = [...chips.values()].sort((a, b) => dist(mp, P(a.ship)) - dist(mp, P(b.ship)));
  sorted.forEach(c => R.top.appendChild(c.w));                 // nearest first = left-most; the row grows from the right edge, stops at the gear when full, and the rest slides in by touch
}
function makeShipChip(s) {
  const w = el('div', 'zc'), b = el('button', 'zsq'), d = el('div', 'zd');
  b.innerHTML = s.side === 'drones' ? ICON.drone : ICON.ship; b.appendChild(d);
  const bars = [mkSBar('#3f8cff'), mkSBar('#c9a24a'), mkSBar('#4cd37a')];
  w.append(b, ...bars.map(x => x.w));
  b.onclick = ev => { ev.stopPropagation(); pickShip(s.id); };
  const c = { w, b, dist: d, bars, ship: s };
  chips.set(s.id, c);
  return c;
}

/* the order menu of a ship: enemies = attack / flee, friends = follow, your own ship = stop */
function menuItems(id) {
  if (id === view.me.id) return { title: 'Your ship', items: [['stop', 'Stop'], ['drift', 'Drift']] };
  const s = view.ships.find(x => x.id === id); if (!s) return null;
  return s.hostile ? { ship: s, title: s.name + ' (hostile)', items: [['target', 'Set as target'], ['attack_max', 'Attack: long range'], ['attack_opt', 'Attack: best range'], ['flee', 'Flee']] }
                   : { ship: s, title: s.name + ' (friendly)', items: [['follow', 'Follow']] };
}
function buildMenu() {
  const d = view && menuFor && menuItems(menuFor);
  if (!d) { R.menu.hidden = true; menuFor = null; return false; }
  const rows = [el('div', 'zh', d.title)];
  if (!d.ship && menuFor === view.me.id) rows.push(el('div', 'zl', 'Targeting: ' + (view.me.target_id ? nameOf(view.me.target_id) : 'nobody')));
  if (d.ship) {                                          // class, weapons and mods in short form, and the range toggle
    const s = d.ship, cl = String(s.class || '?').toLowerCase();
    rows.push(el('div', 'zl', (CLS[cl] || cl.slice(0, 3)) + '  |  weapons: ' + grouped((s.weapons || []).map(w => FAB[w.fam] || abbr(w.fam)))));
    rows.push(el('div', 'zl', 'mods: ' + grouped((s.mods || []).filter(x => x.k !== 'weapon').map(x => abbr(x.n)))));
    rows.push(el('div', 'zl', 'Targeting: ' + (s.tid ? nameOf(s.tid) : 'nobody')));        // who this ship is shooting at (the map shows it too)
    const on = rangeOn.has(s.id), rb = el('button', on ? '' : 'alt', 'Range: ' + (on ? 'ON' : 'OFF'));
    rb.onclick = ev => { ev.stopPropagation(); if (rangeOn.has(s.id)) rangeOn.delete(s.id); else rangeOn.add(s.id); buildMenu(); drawMap(); };
    rows.push(rb);
  }
  d.items.forEach(([k, label]) => {
    const wait = pending && pending.kind === k && pending.id === menuFor;
    const b = el('button', wait ? 'pend' : (orderActive(k, menuFor) ? '' : 'alt'), wait ? label + ' ...' : label);
    b.onclick = ev => {
      ev.stopPropagation();
      if (k === 'target') { const tid = menuFor; view.me.target_id = tid; closeMenus(); frame(true); queueStep({ op: 'target', target: tid }); }   // shown at once
      else order(k, menuFor === view.me.id ? null : menuFor);
    };
    rows.push(b);
  });
  R.menu.replaceChildren(...rows);
  return true;
}
function pickShip(id, px, py) {                                 // a tap on a chip or on a ship on the map
  if (!view) return;
  const isMe = id === view.me.id;
  if (menuFor === id && !R.menu.hidden) { closeMenus(); if (!isMe) { sel = null; frame(true); } return; }     // the same chip again: close its menu AND deselect it (the red ring goes back to MY target)
  closeMenus();
  sel = isMe ? null : id;                                        // my own ship: the menu shows MY target and no chip stays selected
  menuFor = id; if (!buildMenu()) return;
  R.menu.hidden = false;
  if (isMe) placeAt(R.menu, px, py); else placeBelow(R.menu, chips.get(id).w);
  frame(true);
}

/* modules at the bottom: tap = on/off, hold = info, hold and slide = new place */
function loadOrder() { try { return JSON.parse(localStorage.getItem('zone_mods') || '[]'); } catch (e) { return []; } }
function saveOrder(a) { try { localStorage.setItem('zone_mods', JSON.stringify(a)); } catch (e) { /* private mode: the order is not kept */ } }
const passive = m => !(Number(m.heat) > 0);                 // no heat = nothing to switch: armor plating, power amplifier, cargo expander... are ALWAYS on (the server holds the same rule)
const modOn = m => { if (passive(m)) return true; const o = optMod.get(m.i); return o ? o.on : m.on; };      // what is shown: the pilot's own tap first, then the server
function groupMods(mods) {                                  // identical modules (same id) = ONE chip; the order is the pilot's saved order
  const by = new Map();
  mods.forEach(m => { if (!by.has(m.id)) by.set(m.id, []); by.get(m.id).push(m); });
  const saved = loadOrder();
  return [...by.entries()].map(([id, list]) => ({ id, list }))
    .sort((a, b) => { const A = saved.indexOf(a.id), B = saved.indexOf(b.id); return (A < 0 ? 999 : A) - (B < 0 ? 999 : B); });
}
function renderModChips() {
  const mods = view.me.modules || [], groups = groupMods(mods);
  R.bot.querySelectorAll('.zsq[data-fam="missile"] .zd').forEach(d => { d.textContent = ammoLabel(view.me.ammo); });      // the ammo number follows the fight
  const sig = groups.map(g => g.id + ':' + g.list.map(m => modOn(m) ? 1 : 0).join('')).join(',');
  if (sig === modSig) { if (comboFor) fillCombo(); return; }
  modSig = sig;
  const first = R.bot.children.length === 0, keep = R.bot.scrollLeft;     // a rebuild (a chip switched) must not throw the scrolled row back to the start
  R.bot.replaceChildren();
  if (!mods.length) { const n = el('div', '', 'No weapons or rigs fitted.'); n.style.cssText = 'font-size:12px;color:#aab4cc;padding:8px;pointer-events:none'; R.bot.appendChild(n); return; }
  groups.forEach(g => R.bot.appendChild(makeGroupChip(g)));
  R.bot.scrollLeft = first ? R.bot.scrollWidth : keep;          // right justified: a row too long to fit starts at its RIGHT end; later it stays where the pilot scrolled it
  if (comboFor) fillCombo();
}
/* a tap on a chip: one module switches; a combined chip switches ALL of its modules (all on -> all off, otherwise all on) */
function tapGroup(g) {
  if (g.list.every(passive)) { toast('Always on.'); return; }
  const want = !g.list.every(modOn);
  if (want && g.list[0].family === 'missile' && view.me.ammo < 0.05) { toast('No ammo.', true); return; }
  setMods(g.list.filter(m => modOn(m) !== want), want);
}
function setMods(list, on) {
  list = list.filter(m => !passive(m));
  if (!list.length) return;
  list.forEach(m => optMod.set(m.i, { on, t: Date.now() }));
  modSig = ''; renderModChips();                            // shown at once
  list.forEach(m => queueStep({ op: 'module', index: m.i, on }));   // all of them leave in ONE request
}
function makeGroupChip(g) {
  const m0 = g.list[0], n = g.list.length, on = g.list.filter(modOn).length, b = el('button', 'zsq' + (on === 0 ? ' off' : '') + (on > 0 && on < n ? ' part' : ''));
  b.innerHTML = modIcon(m0); b.dataset.key = g.id; b.dataset.fam = m0.family || '';
  b.style.color = FAM[m0.family] || '#cfd8ea'; b.style.borderColor = on > 0 ? '#e8b64a' : '#445';
  const heat = g.list.reduce((s, m) => s + (m.heat || 0), 0);
  b.appendChild(el('div', 'zd', m0.family === 'missile' ? ammoLabel(view.me.ammo) : (heat ? String(+heat.toFixed(1)) + '/s' : (on ? 'ON' : 'OFF'))));
  if (n > 1) b.appendChild(el('div', 'zcnt', on > 0 && on < n ? on + '/' + n : 'x' + n));
  let timer = 0, long = false, dragging = false, scrolling = false, x0 = 0, lx = 0;
  b.onpointerdown = ev => {
    ev.stopPropagation(); b.setPointerCapture(ev.pointerId); x0 = lx = ev.clientX; long = dragging = scrolling = false;
    timer = setTimeout(() => { long = true; b.classList.add('drag'); if (n > 1) openCombo(g); else showInfo(m0, b); if (navigator.vibrate) navigator.vibrate(15); }, 450);
  };
  b.onpointermove = ev => {
    const dx = ev.clientX - x0;
    if (!long) {                                            // a quick slide scrolls the row (the page scrolls it by hand: the chips take the touch)
      if (Math.abs(dx) > 10) { clearTimeout(timer); scrolling = true; }
      if (scrolling) R.bot.scrollLeft -= ev.clientX - lx;
      lx = ev.clientX; return;
    }
    if (Math.abs(dx) > 14) { dragging = true; R.info.hidden = true; if (n > 1) { R.combo.hidden = true; comboFor = null; } b.style.transform = 'translateX(' + dx + 'px)'; }
  };
  const done = ev => {
    clearTimeout(timer); b.classList.remove('drag'); R.info.hidden = true;
    if (dragging) {                                         // hold and slide = a new place in the row
      const sibs = [...R.bot.querySelectorAll('.zsq')].filter(x => x !== b);
      const place = sibs.filter(x => { const r = x.getBoundingClientRect(); return r.left + r.width / 2 < ev.clientX; }).length;   // how many chips are further left
      const keys = sibs.map(x => x.dataset.key); keys.splice(place, 0, g.id);
      saveOrder(keys); b.style.transform = ''; modSig = ''; renderModChips();
    } else if (!long && !scrolling && ev.type === 'pointerup') tapGroup(g);
    long = dragging = scrolling = false;
  };
  b.onpointerup = done; b.onpointercancel = done;
  b.oncontextmenu = ev => ev.preventDefault();
  return b;
}
/* hold a combined chip: a menu with each of its modules (tap one to switch just that one) */
function openCombo(g) { closeMenus(); comboFor = g.id; fillCombo(); R.combo.hidden = false; placeCombo(); }
function placeCombo() {
  const a = R.bot.querySelector('.zsq[data-key="' + (window.CSS && CSS.escape ? CSS.escape(comboFor) : comboFor) + '"]');
  if (a) placeAbove(R.combo, a);
}
function fillCombo() {
  const g = view && groupMods(view.me.modules || []).find(x => x.id === comboFor);
  if (!g) { R.combo.hidden = true; comboFor = null; return; }
  const m0 = g.list[0], rows = [el('div', 'zh', m0.name + ' x' + g.list.length)];
  infoLines(m0).slice(2).forEach(t => rows.push(el('div', 'zl', t)));
  g.list.forEach((m, i) => {
    const on = modOn(m), b = el('button', on ? '' : 'alt', (i + 1) + '. ' + m.name + ': ' + (on ? 'ON' : 'OFF'));
    b.onclick = ev => { ev.stopPropagation(); if (!on && m.family === 'missile' && view.me.ammo < 0.05) { toast('No ammo.', true); return; } setMods([m], !on); };
    if (passive(m)) b.disabled = true;                      // always on
    rows.push(b);
  });
  R.combo.replaceChildren(...rows);
  if (!R.combo.hidden) placeCombo();
}
function infoLines(m) {
  const me = view.me, w = (me.weapons || []).find(x => x.id === m.id), d = (me.dps_list || []).find(x => x.id === m.id);
  const lines = [m.name, (m.family || m.kind) + (modOn(m) ? '' : '  (OFF)')];
  lines.push('Heat: ' + (m.heat || 0) + ' per second');
  if (m.family === 'missile') lines.push('Ammo left: ' + Math.round(me.ammo));
  if (w) { lines.push('Best range: ' + km(w.opt_km), 'Longest range: ' + km(w.max_km)); lines.push(d ? 'Damage now: ' + d.dps + '/s  (' + pct(d.acc) + '% hit)' : 'Damage: needs a target in range'); }
  return lines;
}
function showInfo(m, anchor) {
  R.info.replaceChildren(...infoLines(m).map((t, i) => el('div', i ? '' : 'zh', t)));
  R.info.hidden = false;
  R.info.style.bottom = Math.round(root.clientHeight - anchor.getBoundingClientRect().top + 8) + 'px';
}

/* ---------- the map: camera, zoom chip, touch, drawing ---------- */
const targetShip = () => { const id = sel || (view && view.me.target_id); return id && view ? view.ships.find(s => s.id === id) : null; };
function setZoomChip() {
  if (!R.zoomB) return;
  const k = ['zone', 'me', 'target', 'free'][zoomMode];
  R.zoomB.innerHTML = ICON[k]; R.zoomD.textContent = ZOOM_NAME[zoomMode]; R.zoomB.appendChild(R.zoomD);
  R.zoomB.style.borderColor = zoomMode === 3 ? '#667' : '#e8b64a'; R.zoomB.style.color = '#e3e9f7';
}
function setZoom(mode) {
  zoomMode = mode;
  if (view && cw) {
    if (mode === 0) fitCam();
    else if (mode === 1) { const p = P(view.me), far = Math.max(60000, ...(view.me.weapons || []).map(w => w.max_km)); cam = { cx: p.x, cy: p.y, k: Math.min(cw, ch) / 2 / (far * 1.25) }; }
    else if (mode === 2) { const t = targetShip(); if (t) { const p = P(t), rad = Math.max(40000, dist(P(view.me), p) * 1.6); cam = { cx: p.x, cy: p.y, k: Math.min(cw, ch) / 2 / rad }; } else { zoomMode = 0; fitCam(); } }
  }
  setZoomChip();
}
function cycleZoom() { let next = zoomMode === 3 ? 0 : (zoomMode + 1) % 3; if (next === 2 && !targetShip()) next = 0; setZoom(next); }
function fitCam() { if (!view || !cw) { cam = cam || { cx: 0, cy: 0, k: 0 }; cam.fit = true; return; } cam = { cx: 0, cy: 0, k: Math.min(cw, ch) / 2 / (view.zone.exit_km * 1.08) }; }
const toScr = (x, y) => ({ x: (x - cam.cx) * cam.k + cw / 2, y: (y - cam.cy) * cam.k + ch / 2 });
const toWorld = (px, py) => ({ x: (px - cw / 2) / cam.k + cam.cx, y: (py - ch / 2) / cam.k + cam.cy });
function clampCam() {
  if (!view) return;
  const base = Math.min(cw, ch) / 2 / (view.zone.exit_km * 1.08);
  cam.k = Math.max(base / 3, Math.min(base * 400, cam.k));
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
      if (moved > 10) { if (zoomMode !== 3) { zoomMode = 3; setZoomChip(); } cam.cx -= dx / cam.k; cam.cy -= dy / cam.k; }   // moving the map by hand ends 'follow'
      last = { x: ev.clientX, y: ev.clientY };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0 && d > 0) {
        const r = cv.getBoundingClientRect(), mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top, w0 = toWorld(mx, my);
        cam.k *= d / pinch; clampCam();
        if (zoomMode === 3 || zoomMode === 0) { cam.cx = w0.x - (mx - cw / 2) / cam.k; cam.cy = w0.y - (my - ch / 2) / cam.k; if (zoomMode === 0) { zoomMode = 3; setZoomChip(); } }   // the point under the fingers stays; follow modes keep following
      }
      pinch = d;
    }
  };
  const up = ev => {
    const was = ptrs.size; ptrs.delete(ev.pointerId); if (ptrs.size < 2) pinch = 0;
    if (was === 1 && moved < 10 && Date.now() - tapT < 400 && ev.type === 'pointerup') tapMap(ev.clientX, ev.clientY);
    if (ptrs.size === 1) { const p = [...ptrs.values()][0]; last = { x: p.x, y: p.y }; moved = 99; }
  };
  cv.onpointerup = up; cv.onpointercancel = up;
}
function tapMap(cx, cy) {
  if (!view || !cam) return;
  const r = R.cv.getBoundingClientRect(), px = cx - r.left, py = cy - r.top;
  let best = null, bd = 30;
  [view.me, ...view.ships].forEach(s => { const p = P(s), q = toScr(p.x, p.y), d = Math.hypot(q.x - px, q.y - py); if (d < bd) { bd = d; best = s; } });
  if (best) { lastTap = null; pickShip(best.id, px, py); return; }       // a tap on a ship: its order menu
  const now = Date.now();
  if (lastTap && now - lastTap.t < 350 && Math.hypot(px - lastTap.x, py - lastTap.y) < 40) { lastTap = null; headingTo(px, py); return; }    // double tap: thrust that way
  lastTap = { t: now, x: px, y: py }; closeMenus();
}
function headingTo(px, py) {
  const q = toScr(P(view.me).x, P(view.me).y);
  let deg = Math.atan2(py - q.y, px - q.x) * 180 / Math.PI; if (deg < 0) deg += 360;
  toast('Thrust on heading ' + Math.round(deg) + ' degrees. Use Stop (touch your ship) to brake.');
  order('heading', null, deg);
}

/* things that change every moment */
function frame(full) {
  if (!view || !root || root.hidden) return;
  const m = view.me, mp = P(m);
  paintBars(full);
  if (full) {
    chips.forEach(c => { c.dist.textContent = kshort(dist(mp, P(c.ship))); c.b.classList.toggle('sel', c.ship.id === sel); });
    const ord = m.order || { kind: 'stop' }, tgt = m.target_id && view.ships.find(s => s.id === m.target_id), fol = ord.follow_id && view.ships.find(s => s.id === ord.follow_id), a = accOf(m.id), g = a ? Math.hypot(a.ax, a.ay) / G_KMS2 : 0;
    R.stat.textContent = (ORDER_NAME[ord.kind] || ord.kind) + (ord.kind === 'heading' && ord.dir_deg != null ? ' ' + Math.round(ord.dir_deg) + '°' : '') +
      (ord.kind === 'follow' ? (fol ? ': ' + fol.name : '') : (tgt && ['attack_max', 'attack_opt'].includes(ord.kind) ? ': ' + tgt.name : '')) + (ord.hold_km ? ' at ' + km(ord.hold_km) : '') +
      '  |  speed ' + (vv => Math.hypot(vv.x, vv.y))(velOf(m.id) || { x: m.vx, y: m.vy }).toFixed(1) + ' km/s  |  thrust ' + g.toFixed(1) + ' g';
    R.stat.style.bottom = 'calc(' + (2 * parseInt(getComputedStyle(root).getPropertyValue('--c')) + 18) + 'px + env(safe-area-inset-bottom,0px))';
  }
  drawMap();
}

/* weapon reach circles: shaded disc = longest range, ring = best range, one pair per kind of weapon in its own color (identical weapons share one pair) */
function drawRanges(c, q, ws, k, dashed) {
  const seen = new Set();
  (ws || []).forEach(w => {
    const key = w.fam + '|' + w.opt_km + '|' + w.max_km; if (seen.has(key)) return; seen.add(key);
    const col = FAM[w.fam] || '#e8b64a';
    c.globalAlpha = 0.07; c.fillStyle = col; c.beginPath(); c.arc(q.x, q.y, w.max_km * k, 0, 7); c.fill();
    c.globalAlpha = 0.55; c.strokeStyle = col; c.lineWidth = 1; c.setLineDash(dashed ? [4, 4] : []);
    c.beginPath(); c.arc(q.x, q.y, w.opt_km * k, 0, 7); c.stroke(); c.setLineDash([]);
    c.globalAlpha = 1;
  });
}

/* a drawn background: soft colored clouds and stars, made once per screen size (25% larger than the screen so it can drift) */
function makeBg(W, H) {
  const w = Math.round(W * 1.25), h = Math.round(H * 1.25), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  let seed = 20261026; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  [['70,50,150', 0.20], ['30,90,150', 0.16], ['120,40,110', 0.12], ['40,120,120', 0.10], ['90,60,160', 0.12]].forEach(([rgb, a]) => {
    const x = rnd() * w, y = rnd() * h, r = (0.25 + rnd() * 0.3) * Math.max(w, h), gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const tints = ['255,255,255', '200,220,255', '255,240,210'];
  for (let i = 0; i < 260; i++) {
    g.fillStyle = 'rgba(' + tints[Math.floor(rnd() * 3)] + ',' + (0.25 + rnd() * 0.65).toFixed(2) + ')';
    g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.4 + rnd() * rnd() * 1.6, 0, 7); g.fill();
  }
  return c;
}

function drawMap() {
  if (!view || !R.cv) return;
  const cv = R.cv, dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const first = !cw; cw = W; ch = H;
  if (!cam || cam.fit || first) { const keep = zoomMode; fitCam(); cam.fit = false; if (keep !== 0 && keep !== 3) setZoom(keep); }
  if (zoomMode === 1) { const p = P(view.me); cam.cx = p.x; cam.cy = p.y; }               // 'Me' and 'Target' follow their ship
  else if (zoomMode === 2) { const t = targetShip(); if (t) { const p = P(t); cam.cx = p.x; cam.cy = p.y; } else setZoom(1); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  if (!bgc || bgW !== W || bgH !== H) { bgc = makeBg(W, H); bgW = W; bgH = H; }
  const lim = (v, a) => Math.max(-a, Math.min(a, v));
  c.drawImage(bgc, -W * 0.125 - lim(cam.cx * cam.k * 0.04, W * 0.12), -H * 0.125 - lim(cam.cy * cam.k * 0.04, H * 0.12));     // the star field drifts slowly when the map moves
  const m = view.me, mp = P(m), exit = view.zone.exit_km, k = cam.k;
  // the zone edge (red when close to it)
  const near = Math.hypot(mp.x, mp.y) > 0.9 * exit, o = toScr(0, 0);
  c.lineWidth = 1.5; c.setLineDash([6, 6]); c.strokeStyle = near ? '#ff5a4a' : '#6b7794';
  c.beginPath(); c.arc(o.x, o.y, exit * k, 0, 7); c.stroke(); c.setLineDash([]);
  // my weapon reach: shaded disc = longest range, ring = best range
  if (showRanges) drawRanges(c, toScr(mp.x, mp.y), m.weapons, k, false);
  view.ships.forEach(s => { if (rangeOn.has(s.id)) { const p = P(s); drawRanges(c, toScr(p.x, p.y), s.weapons, k, true); } });     // other ships: dashed rings
  const tid = sel || m.target_id;
  const ship = (s, p, col, isMe) => {
    const q = toScr(p.x, p.y), a = accOf(s.id), am = a ? Math.hypot(a.ax, a.ay) : 0, g = am / G_KMS2;
    if (a && g > 0.05) {                                          // thrust: a red line pointing AWAY from the push
      const len = Math.min(34, 10 + 22 * g), ux = -a.ax / am, uy = -a.ay / am;
      c.strokeStyle = '#ff3b30'; c.lineWidth = 3; c.lineCap = 'round';
      c.beginPath(); c.moveTo(q.x + ux * 6, q.y + uy * 6); c.lineTo(q.x + ux * (6 + len), q.y + uy * (6 + len)); c.stroke(); c.lineCap = 'butt';
    }
    c.save(); c.translate(q.x, q.y); c.rotate(headOf(s));          // the ship: a triangle pointing the way it travels
    c.fillStyle = col; c.beginPath(); c.moveTo(9, 0); c.lineTo(-6, 6); c.lineTo(-3, 0); c.lineTo(-6, -6); c.closePath(); c.fill();
    if (isMe) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); }
    c.restore();
    if (s.id === tid && !isMe) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(q.x, q.y, 13, 0, 7); c.stroke(); }
    return q;
  };
  const pos = new Map();
  view.ships.forEach(s => pos.set(s.id, ship(s, P(s), REL[rel(s)], false)));
  pos.set(m.id, ship(m, mp, REL.ally, true));
  // WHO IS TARGETING WHOM: a red pulsing ring around the TARGET of the selected ship (or around MY target when nothing is selected), and a thin dashed red line to it from that ship (from MY ship when nothing is selected)
  const selS = sel && view.ships.find(s => s.id === sel), from = selS ? selS.id : m.id, to = selS ? selS.tid : m.target_id;
  if (to && pos.get(to)) {
    const q = pos.get(to), f = pos.get(from), pulse = 0.5 + 0.5 * Math.sin(Date.now() / 175);
    if (f && from !== to) { c.save(); c.strokeStyle = 'rgba(255,59,48,.55)'; c.lineWidth = 1.5; c.setLineDash([5, 5]); c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(q.x, q.y); c.stroke(); c.restore(); }
    c.save(); c.strokeStyle = 'rgba(255,59,48,' + (0.4 + 0.6 * pulse).toFixed(2) + ')'; c.lineWidth = 2.5; c.beginPath(); c.arc(q.x, q.y, 17 + 3 * pulse, 0, 7); c.stroke(); c.restore();
  }
  // floating numbers: red damage and blue regeneration, rising and fading
  const now = Date.now(); pops = pops.filter(p => now - p.born < 1500);
  c.font = 'bold 14px system-ui,sans-serif'; c.textAlign = 'center';
  pops.forEach(p => {
    const age = (now - p.born) / 1500; if (age < 0) return; const q = pos.get(p.id); if (!q) return;
    c.globalAlpha = 1 - age; c.lineWidth = 3; c.strokeStyle = '#000'; c.fillStyle = p.color || '#ff4a3a';
    const px = q.x + (p.text[0] === '+' ? 14 : -14);        // damage a little left, regeneration a little right: they do not print over each other
    c.strokeText(p.text, px, q.y - 14 - age * 34); c.fillText(p.text, px, q.y - 14 - age * 34);
  });
  c.globalAlpha = 1; c.textAlign = 'left';
}
