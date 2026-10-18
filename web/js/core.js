// core.js - shared state and helpers used by every other file. Imports only the pure physics file (for the pulse bar).
import { pulseState } from 'physics';
// S holds the few values that more than one file needs to READ AND CHANGE
// (an imported variable cannot be reassigned by the file that imports it, so they live in this one object).
export const S = {
  sb: null,        // the Supabase client (set in main.js)
  last: null,      // latest answer of the server action 'me'
  current: null,   // name of the open screen
  refresh: null,   // main.js puts its refresh() function here so other files can ask for a reload
  skew: 0,         // server clock minus this device's clock, in ms (measured by main.js; a device clock can be minutes off)
  enTimer: false,  // the endurance bar shows 'mm:ss until full' while true (tap the bar to switch)
};
// Server time now, as far as we can tell. Use this instead of Date.now() whenever comparing with a server time.
export const nowMs = () => Date.now() + (S.skew || 0);
export const $ = id => document.getElementById(id);

export function locName(id) {
  const l = ((S.last && S.last.locations) || []).find(x => x.id === id);
  return l ? l.name : (id || '?');
}
export function curGd() { return S.last ? S.last.game_days + (nowMs() - S.last.real_ms) * S.last.scale / 864e5 : null; }

/* ---------- screen registry: add a screen = a div + addScreen(...) ---------- */
export const screens = {};
export function addScreen(name, title, el, hooks) { screens[name] = { title, el, ...(hooks || {}) }; }
/* functions that want to know when a screen opens (missions.js adds one); each gets the screen name */
export const screenWatchers = [];
/* tab dot: a screen may have a hook dot() that returns true when something new is waiting; its tab then shows a red dot */
const dotStyle = document.createElement('style');
dotStyle.textContent = '#nav button{position:relative}.tabdot{position:absolute;top:5px;right:12px;width:11px;height:11px;border-radius:50%;background:#ff5a4a;border:2px solid #0b0f19}';
document.head.appendChild(dotStyle);
export function updateDots() {
  document.querySelectorAll('#nav button[data-screen]').forEach(b => {
    const s = screens[b.dataset.screen], d = b.querySelector('.tabdot');
    if (d) d.hidden = !(s && s.dot && s.dot());
  });
}
/* tab icons: small line drawings (no picture files needed), keyed by screen name; they take the colour of the button text */
const ICONS = {
  travel: '<svg viewBox="0 0 24 24"><path d="M12 2c3 3 4 7 4 11l3 4-4 .5L12 21l-3-3.5-4-.5 3-4c0-4 1-8 4-11z"/><circle cx="12" cy="9.5" r="1.6"/></svg>',
  market: '<svg viewBox="0 0 24 24"><path d="M3 21h18M6 21v-7M11 21V8M16 21v-9M21 21V5"/><path d="M3 11l5-4 4 2 8-6"/></svg>',
  missions: '<svg viewBox="0 0 24 24"><path d="M5 21V3"/><path d="M5 4h13l-3 4.5 3 4.5H5"/></svg>',
  assets: '<svg viewBox="0 0 24 24"><path d="M3 7.5l9-5 9 5v9l-9 5-9-5z"/><path d="M3 7.5l9 5 9-5M12 12.5v9"/></svg>',
};
export function openScreen(name) {
  S.current = name;
  Object.entries(screens).forEach(([n, s]) => s.el.hidden = n !== name);
  const nav = $('nav'); nav.replaceChildren();
  const tabs = Object.entries(screens).filter(([n, s]) => !s.noTab);   /* noTab: a screen reached another way (the profile circle) */
  nav.hidden = tabs.length < 2;
  tabs.forEach(([n, s]) => {
    const b = document.createElement('button');
    if (ICONS[n]) { b.innerHTML = ICONS[n]; b.appendChild(el('span', '', s.title)); } else b.textContent = s.title;
    b.title = s.title; b.setAttribute('aria-label', s.title); b.dataset.screen = n;
    if (s.dot) { const d = document.createElement('i'); d.className = 'tabdot'; d.hidden = true; b.appendChild(d); }
    b.className = n === name ? 'on' : 'alt'; b.onclick = () => openScreen(n); nav.appendChild(b);
  });
  if (screens[name].onShow) screens[name].onShow();
  updateDots();
  screenWatchers.forEach(f => { try { f(name); } catch (e) {} });
}

/* ---------- small display helpers ---------- */
export const money = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });   // credits are shown WITHOUT cents, everywhere (decided)
export const whole = n => Math.round(Number(n)).toLocaleString();
export const r2 = n => Math.round(Number(n) * 100) / 100;
export function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
export function cell(cls, main, sub) { const c = el('span', cls, main); if (sub) c.appendChild(el('span', 'sub', sub)); return c; }
export const sgn = n => (Number(n) > 0 ? '+' : '') + money(n);
export const tone = n => Number(n) > 0 ? 'win' : Number(n) < 0 ? 'lose' : 'muted';
export const LS = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};

export function say(t, cls) { const m = $('msg'); m.textContent = t || ''; m.className = cls || ''; }
export const li = t => { const e = document.createElement('li'); e.textContent = t; return e; };

/* functions told the name of every server action that succeeded (missions.js uses this to finish steps named like an action) */
export const actionWatchers = [];
export async function call(action, extra) {
  const { data, error } = await S.sb.functions.invoke('game', { body: { action, ...(extra || {}) } });
  if (error) {
    let d = null;
    try { d = await error.context.json(); } catch (e) {}
    const err = new Error(d && d.error ? d.error : error.message);
    err.data = d;
    throw err;
  }
  actionWatchers.forEach(f => { try { f(action); } catch (e) {} });
  return data;
}
export function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + 'h ' : '') + m + 'm ' + s + 's';
}
// 'life_pod' -> 'Life Pod', 'elite_hauler' -> 'Elite Hauler'
export const hullName = id => String(id || 'ship').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
// The pulse numbers of the flight in progress (from the pending trip), shaped for pulseState; null if the flight does not pulse.
function pulseOf(a) {
  const q = a && a.payload && a.payload.pulse; if (!q) return null;
  return { g: q.g, bar: q.bar0, regen0: q.regen0, mx: q.mx, freeG: q.freeG, refill: q.refill, perG: q.perG, share: q.share, t0: q.t0 };
}
// The thrust the ship is flying at RIGHT NOW: the chosen thrust while a burn lasts, the free thrust while the bar refills.
// Worked out from the pending trip. null when not flying.
export function flightG() {
  const ship = S.last && (S.last.ships || [])[0];
  if (!ship || ship.state === 'docked' || ship.state === 'drifting') return null;   /* drifting: no thrust, no destination */
  const a = ((S.last.actions) || []).find(x => x.status === 'pending');
  const free = S.last.pilot && S.last.pilot.free_g != null ? Number(S.last.pilot.free_g) : 3;
  const pn = pulseOf(a);
  if (pn) return pulseState(pn, curGd() - pn.t0).burning ? Number(pn.g) : Number(pn.freeG);
  const p = a && a.payload;
  if (!p || p.g == null) return Number(ship.thrust_g);
  return Number(p.g) > free && p.burn_days != null && curGd() < Number(p.departT) + Number(p.burn_days) ? Number(p.g) : Math.min(Number(p.g), free);
}
// The endurance bar now: {v (value), mx (size), burning (above the free thrust right now), rate (gain per game hour while refilling)}.
// Pulsed flight: the page works the saw-tooth out itself with the same rule as the server.
// Otherwise: the value from the last 'me' answer, moved on at its rate since then (display only).
function enduranceInfo() {
  const p = S.last && S.last.pilot; if (!p || p.endurance == null) return null;
  const mx = Number(p.endurance_max);
  if (p.flight && p.cfg) {
    const f = p.flight, k = p.cfg, gd = Math.min(curGd(), Number(f.until));
    const st = pulseState({ g: f.g, bar: f.bar0, regen0: f.regen0, mx: k.mx, freeG: k.free_g, refill: k.refill, perG: k.per_g, share: k.share }, gd - Number(f.t0));
    return { v: st.v, mx, burning: !!st.burning, rate: Number(k.refill) };
  }
  const hours = (nowMs() - S.last.real_ms) * S.last.scale / 3.6e6;
  const rate = Number(p.endurance_rate_hour || 0);
  return { v: Math.max(0, Math.min(mx, Number(p.endurance) + rate * hours)), mx, burning: false, rate };
}
export function enduranceNow() { const i = enduranceInfo(); return i ? i.v : null; }
const clock = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60, p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : p(m)) + ':' + p(s); };
// Text for the endurance bar after a tap: time until full in REAL time (game hours x 3600 / speed).
function untilFull(i) {
  if (i.v >= i.mx - 0.05) return 'Full';
  if (i.burning) return 'Burning';
  if (i.rate > 0) return clock((i.mx - i.v) / i.rate * 3600 / S.last.scale) + ' until full';
  return '--:-- until full';
}
const CR = 'Cr ';   // the credits sign shown in front of the credits number
// The top bars: credits, XP (with level), endurance, and the profile circle. Display only; called from setShipLine every second.
function setBars() {
  const ch = S.last && S.last.character, p = S.last && S.last.pilot;
  $('money').textContent = ch ? CR + whole(ch.credits) : '';
  $('pic').textContent = ch && ch.name ? String(ch.name).trim().charAt(0).toUpperCase() : '?';
  if (!p) return;
  const xp = Number(p.xp), start = Number(p.xp_level_start), next = p.xp_next == null ? null : Number(p.xp_next);
  $('lvl').textContent = String(p.level);
  $('xpnum').textContent = next == null ? 'XP ' + whole(xp) + ' (top)' : 'XP ' + whole(xp) + ' / ' + whole(next);
  $('xpfill').style.width = (next == null ? 100 : Math.max(0, Math.min(100, (xp - start) / (next - start) * 100))) + '%';
  const i = enduranceInfo(); if (!i) return;
  $('ennum').textContent = S.enTimer ? untilFull(i) : 'END ' + Math.round(i.v) + ' / ' + Math.round(i.mx);   /* tap the endurance bar: the time until full replaces the numbers */
  $('enfill').style.width = Math.max(0, Math.min(100, i.v / i.mx * 100)) + '%';
}
// The ship line (hull, place or thrust). Credits and endurance now live in the bars.
export function setShipLine() {
  const ship = S.last && (S.last.ships || [])[0];
  const g = flightG();
  $('ship').textContent = !ship ? 'No ship' :
    ship.state === 'docked' ? hullName(ship.hull_id) + ' docked at ' + locName(ship.location_id) :
    ship.state === 'drifting' ? hullName(ship.hull_id) + ' drifting (no destination)' :
    hullName(ship.hull_id) + ' traveling at ' + (Math.round(g * 10) / 10) + ' g';
  setBars();
  updateDots();
}

/* ---------- shared by the Market and Assets screens ---------- */
// The place the ship is docked at, or null while it travels.
export const dockedAt = () => { const s = S.last && (S.last.ships || [])[0]; return s && s.state === 'docked' ? s.location_id : null; };
// Default place for a location box: where the ship is docked; else the last place it docked (remembered); else the start of the current trip; else Luna.
export function defaultLoc() {
  const dl = dockedAt(); if (dl) return dl;
  const mem = LS.get('pvs_lastdock'); if (mem) return mem;
  const a = ((S.last && S.last.actions) || []).find(x => x.status === 'pending');
  return (a && a.payload && a.payload.from) || 'luna';
}

/* ---------- place picker: replaces the plain drop-down on Market and Assets ----------
   The big box (btn, class 'locsel') keeps its title and label picture: the caller draws the picture on btn with applyBackdrop(btn, place).
   Tapping it opens a list of plain button rows (no pictures).
   createPicker(onPick, label) -> { root, btn, set(options, current) }
   options = [[value, text, tag], ...] (tag is optional, e.g. 'ship here'); onPick(value) runs when a row is tapped.
   The list opens under the big button and closes again when a row is tapped or you tap anywhere else.
   Redraws while the list is open do not close it. Display only. */
export function createPicker(onPick, label) {
  const root = el('div', 'lp'), btn = el('button', 'locsel'), name = el('span', 'lpname'), side = el('span', 'lpside'), list = el('div', 'lplist');
  btn.type = 'button'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', label || 'Choose a place');
  list.hidden = true; list.setAttribute('role', 'listbox');
  btn.append(name, side); root.append(btn, list);
  let opts = [], value = null, sig = null;
  const paint = () => {
    const cur = opts.find(o => o[0] === value);
    name.textContent = cur ? cur[1] : 'Choose a place';
    side.replaceChildren();
    if (cur && cur[2]) side.appendChild(el('span', 'lptag', cur[2]));
    side.appendChild(el('span', 'lpcaret', list.hidden ? '\u25BE' : '\u25B4'));
    [...list.children].forEach(b => { const on = b.dataset.v === value; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  };
  const shut = () => { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); paint(); };
  btn.onclick = () => { list.hidden = !list.hidden; btn.setAttribute('aria-expanded', list.hidden ? 'false' : 'true'); paint(); };
  document.addEventListener('pointerdown', e => { if (!list.hidden && !root.contains(e.target)) shut(); });
  return {
    root, btn,
    set(newOpts, cur) {
      const s = newOpts.map(o => o.join('|')).join(';');
      if (s !== sig) {   /* rebuild the rows only when the places (or their tags) changed */
        sig = s; opts = newOpts;
        list.replaceChildren(...opts.map(o => {
          const b = el('button', 'lprow'); b.type = 'button'; b.dataset.v = o[0]; b.setAttribute('role', 'option');
          b.appendChild(el('span', '', o[1])); if (o[2]) b.appendChild(el('span', 'lptag', o[2]));
          b.onclick = () => { value = o[0]; shut(); onPick(o[0]); };
          return b;
        }));
      }
      value = cur; paint();
    },
  };
}
