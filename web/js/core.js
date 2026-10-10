// core.js - shared state and helpers used by every other file. Imports nothing.
// S holds the few values that more than one file needs to READ AND CHANGE
// (an imported variable cannot be reassigned by the file that imports it, so they live in this one object).
export const S = {
  sb: null,        // the Supabase client (set in main.js)
  last: null,      // latest answer of the server action 'me'
  current: null,   // name of the open screen
  refresh: null,   // main.js puts its refresh() function here so other files can ask for a reload
};
export const $ = id => document.getElementById(id);

export function locName(id) {
  const l = ((S.last && S.last.locations) || []).find(x => x.id === id);
  return l ? l.name : (id || '?');
}
export function curGd() { return S.last ? S.last.game_days + (Date.now() - S.last.real_ms) * S.last.scale / 864e5 : null; }

/* ---------- screen registry: add a screen = a div + addScreen(...) ---------- */
export const screens = {};
export function addScreen(name, title, el, hooks) { screens[name] = { title, el, ...(hooks || {}) }; }
export function openScreen(name) {
  S.current = name;
  Object.entries(screens).forEach(([n, s]) => s.el.hidden = n !== name);
  const nav = $('nav'); nav.replaceChildren();
  nav.hidden = Object.keys(screens).length < 2;
  Object.entries(screens).forEach(([n, s]) => {
    const b = document.createElement('button'); b.textContent = s.title;
    b.className = n === name ? 'on' : 'alt'; b.onclick = () => openScreen(n); nav.appendChild(b);
  });
  if (screens[name].onShow) screens[name].onShow();
}

/* ---------- small display helpers ---------- */
export const money = n => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export async function call(action, extra) {
  const { data, error } = await S.sb.functions.invoke('game', { body: { action, ...(extra || {}) } });
  if (error) {
    let d = null;
    try { d = await error.context.json(); } catch (e) {}
    const err = new Error(d && d.error ? d.error : error.message);
    err.data = d;
    throw err;
  }
  return data;
}
export function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + 'h ' : '') + m + 'm ' + s + 's';
}
// 'life_pod' -> 'Life Pod', 'elite_hauler' -> 'Elite Hauler'
export const hullName = id => String(id || 'ship').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
// The thrust the ship is flying at RIGHT NOW: the chosen thrust while the burn lasts, then the free thrust (3 g).
// Worked out from the pending trip (payload g, departT, burn_days). null when not flying.
export function flightG() {
  const ship = S.last && (S.last.ships || [])[0];
  if (!ship || ship.state === 'docked') return null;
  const a = ((S.last.actions) || []).find(x => x.status === 'pending');
  const p = a && a.payload;
  const free = S.last.pilot && S.last.pilot.free_g != null ? Number(S.last.pilot.free_g) : 3;
  if (!p || p.g == null) return Number(ship.thrust_g);
  const burn = Number(p.burn_days || 0);
  return burn > 0 && curGd() < Number(p.departT) + burn ? Number(p.g) : (Number(p.g) > free ? free : Number(p.g));
}
// The endurance bar now: the value from the last 'me' answer, moved on at its rate since then (display only).
export function enduranceNow() {
  const p = S.last && S.last.pilot; if (!p || p.endurance == null) return null;
  const hours = (Date.now() - S.last.real_ms) * S.last.scale / 3.6e6;
  const v = Number(p.endurance) + Number(p.endurance_rate_hour || 0) * hours;
  return Math.max(0, Math.min(Number(p.endurance_max), v));
}
export function setShipLine() {
  const ship = S.last && (S.last.ships || [])[0];
  const cr = S.last && S.last.character ? '  |  Credits ' + money(S.last.character.credits) : '';
  const en = enduranceNow();
  const bar = en == null ? '' : '  |  Endurance ' + Math.round(en) + ' / ' + Math.round(S.last.pilot.endurance_max);
  const g = flightG();
  $('ship').textContent = (!ship ? 'No ship' :
    ship.state === 'docked' ? hullName(ship.hull_id) + ' docked at ' + locName(ship.location_id) :
    hullName(ship.hull_id) + ' traveling at ' + (Math.round(g * 10) / 10) + ' g') + bar + cr;
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
