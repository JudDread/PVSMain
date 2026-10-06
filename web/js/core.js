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
export function setShipLine() {
  const ship = S.last && (S.last.ships || [])[0];
  const cr = S.last && S.last.character ? '  |  Credits ' + money(S.last.character.credits) : '';
  $('ship').textContent = (!ship ? 'No ship' :
    ship.state === 'docked' ? 'Docked at ' + locName(ship.location_id) + ' (thrust ' + ship.thrust_g + ' g)' :
    'Traveling (thrust ' + ship.thrust_g + ' g)') + cr;
}
