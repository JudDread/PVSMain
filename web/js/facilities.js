// facilities.js - the PORT screen (tab name "Port"): the things you can do at ONE place. Today: the shipyard (hulls, weapons and rigs).
// Later: casino, cantina, race track, black market ... each is one more block in drawFac().
// Display only: the server decides everything. Data: 'facilities' (all places / one place), 'shipyard'; actions rig_buy, rig_sell, hull_buy, hull_sell, rig_fit.
// You do NOT have to be at the place: what you buy goes into your storage THERE (Assets), what you sell is taken from it.
// The place list shows only places that have a facility. Every section starts closed; the open / closed state is remembered (this device).
// 2026-11-07 phone layout (same look as Market and Assets): white names, grey second lines, separator lines, prices abbreviated (1.2K),
// one-line pop-ups. ONE green section 'Assets' holds everything of yours that this place buys (parked hulls and stored rigs); then the buy lists.
// Selling a hull moves its rigs and cargo to your storage there by itself (SQL hull_sell_all, migration 095).
// Each facility has a big header box, the same size as the place box; its picture is web/img/facilities/<kind>.webp (3:1; none = plain box).
// Creates its own screen block (#scr-facilities) and the "Fit it now?" pop-up (#fprompt), so index.html needs only the import-map line.
// The Rigging screen opens this one with openFacilities(place, { shipId, label, shipLoc, back }): then a bought rig can be fitted at once.
import { S, $, say, call, locName, whole, el, LS, addScreen, setShipLine, dockedAt, defaultLoc, createPicker, openScreen, short } from 'core';
import { applyBackdrop } from 'backdrop';
import { rigError, KIND_PLURAL, hullPicUrl } from 'rigtext';

const TIERS = ['Light', 'Medium', 'Heavy', 'Super'];

let floc = null, fdock;               // the chosen place; the place the ship was docked at last time we looked
let fAt = 0, fLoading = false;
let places = null;                    // { place id: ['shipyard', ...] } - which places have facilities
let fac = null, yard = null;          // answers for floc: 'facilities' and 'shipyard'
let fsel = null;                      // the selected row { loc, kind: 'buy' | 'sell' | 'hbuy' | 'hsell', id }
let fbusy = false, fEdited = false, fRedraw = false;
let ctx = null, pendingCtx = null;    // set when we were opened from the Rigging screen
let secOpen = {};                     // section open (true) or closed: key 'place:section'; a missing key = closed
try { secOpen = JSON.parse(LS.get('pvs_fsec') || '{}') || {}; } catch (e) { secOpen = {}; }
const saveSec = () => LS.set('pvs_fsec', JSON.stringify(secOpen));

/* ---------- screen block + styles ---------- */
const scr = document.createElement('div'); scr.id = 'scr-facilities'; scr.hidden = true;
const ctxBar = el('div', 'fctx'); ctxBar.hidden = true;
const fpick = createPicker(v => { floc = v; fsel = null; fEdited = false; fac = yard = null; drawFac(); refreshFac(); }, 'Choose a place');
const fbody = el('div', 'muted', 'Loading...'); fbody.id = 'fbody';
scr.append(ctxBar, fpick.root, fbody);
$('scr-market').after(scr);

(() => {
  const st = document.createElement('style');
  st.textContent = [
    '#fbody .sub { line-height: 1.15 !important; font-size: 11px !important; font-weight: 400 !important; color: #8d98b2; }',
    '#fbody .sech { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 34px !important; line-height: 1.2 !important; font-weight: 500 !important; letter-spacing: 0.02em; color: #fff !important; cursor: pointer; background: rgba(120,160,210,0.16) !important; border-top: 2px solid rgba(120,160,210,0.55) !important; border-bottom: 1px solid rgba(120,160,210,0.25) !important; border-radius: 0; display: flex; align-items: center; justify-content: space-between; }',
    '#fbody .sech.sellsec { background: rgba(95,208,160,0.14) !important; border-top: 2px solid rgba(95,208,160,0.6) !important; border-bottom: 1px solid rgba(95,208,160,0.3) !important; }',
    '#fbody .fsub { height: 30px; display: flex; align-items: center; padding: 0 8px 0 16px; border-bottom: 1px solid #2f3a58; font-size: 12px; color: #c7d0e6; cursor: pointer; }',
    '#fbody .msec + .msec { margin-top: 8px !important; }',
    '#fbody .msec .msec { margin-top: 0 !important; }',
    '#fbody .fhead { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 0 0 8px; background-size: cover; background-position: center; }',
    '#fbody .frow { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; color: #fff; font-weight: 500; font-size: 13px; line-height: 1.2; border-bottom: 1px solid #2f3a58; cursor: pointer; }',
    '#fbody .frow.sel { background: #2a3350; outline: 2px solid #e8b64a; outline-offset: -2px; }',
    '#fbody .fl { min-width: 0; flex: 1; }',
    '#fbody .fpr { flex: none; white-space: nowrap; }',
    '#fbody .fpr.pay { color: #e8b64a; }',
    '#fbody .fpr.get { color: #6be08f; }',
    '.fpop { box-sizing: border-box; background: rgba(120,160,210,0.10); border: 1px solid rgba(120,160,210,0.35); border-radius: 8px; padding: 6px 8px; margin: 4px 0 6px; color: #fff; font-size: 13px; }',
    '.fprow { display: flex; align-items: center; gap: 5px; }',
    '.fpe { flex: 1; min-width: 0; }',
    '.fpl { font-size: 11px; color: #8d98b2; line-height: 1.1; white-space: nowrap; font-weight: 400; }',
    '.fpv { font-size: 15px; font-weight: 500; line-height: 1.2; white-space: nowrap; }',
    '.fpv.pay { color: #e8b64a; }',
    '.fpv.get { color: #6be08f; }',
    '.fpop input.fin { width: 64px; height: 36px; flex: none; margin: 0; padding: 0 8px; text-align: right; font-size: 15px; box-sizing: border-box; }',
    '.fpop button { flex: none; height: 34px; min-height: 0; margin: 0; padding: 0 10px; font-size: 13px; }',
    '.fgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 8px; margin: 8px 0; }',
    '.fgrid .k { font-size: 11px; color: #8d98b2; font-weight: 400; }',
    '.fgrid .v { font-size: 13px; font-weight: 500; }',
    '.fpmsg { font-size: 11px; color: #8d98b2; font-weight: 400; }',
    '.fpmsg:not(:empty) { margin-top: 4px; }',
    '.fpmsg .err { color: #ff7b6b; }',
    '.fhullpic { display: block; width: 84px; height: 46px; object-fit: cover; border-radius: 6px; background: #0b0f19; flex: none; }',
    '.fctx { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }',
    '.fctx button { margin: 0; padding: 0 12px; height: 34px; min-height: 0; font-size: 13px; }',
    '#fprompt { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }',
    '#fprompt[hidden] { display: none; }',
    '#fprompt .abox { background: #131a2a; border: 2px solid #e8b64a; border-radius: 10px; padding: 12px; width: 100%; max-width: 420px; max-height: 92%; overflow-y: auto; box-sizing: border-box; }',
    '#fprompt .abox div { margin: 8px 0; }',
    '#fprompt .abtns { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }',
    '#fprompt .abtns button { margin: 0; padding: 0 18px; height: 34px; min-height: 0; font-size: 13px; }',
  ].join('\n');
  document.head.appendChild(st);
})();

/* ---------- small helpers ---------- */
const num = x => Number(x) || 0;
const abbr = n => short(n, true);   // 1200 -> 1.2K, 54600000 -> 54.6M
const isTyping = () => !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('fin'));
function qtyOf(inp) { const v = inp.value; if (v === '') return NaN; const q = Number(v); return Number.isInteger(q) && q >= 0 && q <= 100 ? q : NaN; }
const credits = () => (S.last && S.last.character ? num(S.last.character.credits) : 0);
const keyOf = x => x.rig_id || x.ship_id || x.hull_id;
const isSel = (kind, id) => !!fsel && fsel.loc === floc && fsel.kind === kind && fsel.id === id;
const fmtK = n => (n >= 1000 ? String(Math.round(n / 100) / 10) + 'k' : String(n));   // 300000 -> 300k
const pct = x => Math.round(num(x) * 100);
function curItem() {
  if (!fsel || !yard) return null;
  const list = fsel.kind === 'buy' ? yard.buy : fsel.kind === 'sell' ? yard.stock : fsel.kind === 'hbuy' ? yard.hulls : yard.my_hulls;
  return (list || []).find(x => keyOf(x) === fsel.id) || null;
}
// The place list only has places with a facility. If the chosen place is not one, take the docked place (if it has one), else the first.
function fixLoc() {
  if (!places) return;
  const ids = Object.keys(places).filter(id => (places[id] || []).length).sort((a, b) => locName(a).localeCompare(locName(b)));
  if (!ids.length || (floc && ids.includes(floc))) return;
  const dl = dockedAt();
  floc = dl && ids.includes(dl) ? dl : ids[0];
  fac = yard = null; fsel = null; fEdited = false;
}

/* ---------- loading ---------- */
async function refreshFac() {
  fAt = Date.now();
  if (fLoading || !S.sb || !floc) return;
  fLoading = true;
  let loc = floc;
  try {
    if (!places) {
      const p = await call('facilities');
      const m = {}; (p.places || []).forEach(x => { m[x.location_id] = x.kinds || []; }); places = m;
      fixLoc(); loc = floc;
    }
    const f = await call('facilities', { location: loc });
    const y = (f.facilities || []).some(x => x.kind === 'shipyard') ? await call('shipyard', { location: loc }) : null;
    if (loc === floc) { fac = f; yard = y; }
  } catch (e) { say(rigError(e), 'err'); }
  finally { fLoading = false; }
  if (loc !== floc) { refreshFac(); return; }   /* the place changed while we were asking: ask again for the new one */
  drawFac();
}

/* ---------- the box under a selected rig row (buy or sell): built ONCE, moved on every redraw, so a number you type survives ---------- */
// Largest quantity that makes sense for the selected row: buy = what you can pay for, sell = what you have stored (never more than 100 per action).
function popMax() {
  const it = curItem(); if (!it || !fsel) return 0;
  return fsel.kind === 'buy' ? Math.max(0, Math.min(100, Math.floor(credits() / Math.max(1, num(it.price))))) : Math.min(100, num(it.quantity));
}
const WEAPON_STATS = [
  ['Power', x => whole(x.power_use)],
  ['Damage', x => whole(x.damage)],
  ['Cooldown', x => String(num(x.reuse_sec))],
  ['Best km', x => fmtK(num(x.optimal_range_km))],
  ['Max km', x => fmtK(num(x.max_range_km))],
  ['Acc % best/max', x => pct(x.optimal_accuracy) + '/' + pct(x.max_accuracy)],
  ['Ammo', x => (x.ammo != null ? whole(x.ammo) : '-')],
];
const HULL_STATS = [
  ['Hold', x => whole(x.hold_size)],
  ['Max g', x => String(num(x.max_g))],
  ['Power', x => whole(x.power)],
  ['Slots W/E/U', x => x.weapon_bays + '/' + x.engineering_slots + '/' + x.utility_slots],
  ['Shield', x => whole(x.shields)],
  ['Armor', x => whole(x.armor)],
  ['Hull', x => whole(x.hull_points)],
];
function fillGrid(grid, stats, x) {
  grid.replaceChildren();
  stats.forEach(([k, f]) => { const c = el('div', ''); c.append(el('div', 'k', k), el('div', 'v', f(x))); grid.appendChild(c); });
}
const mkBtn = (txt, alt) => { const b = el('button', alt ? 'alt' : '', txt); b.type = 'button'; return b; };
const pop = (() => {
  const root = el('div', 'fpop'), grid = el('div', 'fgrid'), fx = el('div', 'sub'), row = el('div', 'fprow'), msg = el('div', 'fpmsg');
  const e = el('div', 'fpe'), lab = el('div', 'fpl'), val = el('div', 'fpv'); e.append(lab, val);
  const inp = document.createElement('input');
  inp.type = 'number'; inp.inputMode = 'numeric'; inp.step = '1'; inp.min = '0'; inp.max = '100'; inp.className = 'fin'; inp.setAttribute('aria-label', 'Quantity'); inp.value = 1;
  const bAll = mkBtn('All', true), b1 = mkBtn('', false);
  row.append(e, inp, bAll, b1); root.append(grid, fx, row, msg);
  const selectAll = () => { try { inp.select(); } catch (x) {} };
  inp.addEventListener('focus', () => setTimeout(selectAll, 0));   // touching the box selects the whole number
  inp.addEventListener('click', selectAll);
  inp.addEventListener('input', () => { fEdited = true; refreshPop(); });
  inp.addEventListener('blur', () => setTimeout(() => { if (fRedraw && !isTyping()) { fRedraw = false; drawFac(); } }, 350));
  bAll.onclick = () => { inp.value = popMax(); fEdited = true; refreshPop(); };
  b1.onclick = () => doTrade();
  return { root, grid, fx, lab, val, msg, inp, bAll, b1 };
})();

function placePop(it) {
  const buy = fsel.kind === 'buy';
  if (buy) {
    if (it.kind === 'weapon') { fillGrid(pop.grid, WEAPON_STATS, it); pop.fx.textContent = ''; }
    else { fillGrid(pop.grid, [['Power', x => whole(x.power_use)]], it); pop.fx.textContent = it.effect_text ? it.effect_text + (it.works_now ? '' : ' (inactive)') : ''; }
  } else { pop.grid.replaceChildren(); pop.fx.textContent = ''; }
  pop.grid.hidden = !pop.grid.childNodes.length; pop.fx.hidden = !pop.fx.textContent;
  if (!fEdited) pop.inp.value = buy ? 1 : popMax();
  refreshPop();
  return pop.root;
}
function refreshPop() {
  const it = curItem(); if (!it || !fsel) return;
  const buy = fsel.kind === 'buy', q = qtyOf(pop.inp), bad = isNaN(q), none = !bad && q === 0;
  pop.msg.replaceChildren();
  const line = (cls, t) => pop.msg.appendChild(el('div', cls, t));
  if (bad) line('', 'Enter a whole number from 1 to 100.');
  pop.val.className = 'fpv ' + (buy ? 'pay' : 'get');
  if (buy) {
    const total = bad ? 0 : q * num(it.price), poor = !bad && total > credits();
    pop.lab.textContent = 'Total'; pop.val.textContent = abbr(total);
    if (poor) line('err', 'You have ' + abbr(credits()) + ' credits.');
    pop.b1.textContent = 'Buy'; pop.b1.disabled = bad || none || poor || fbusy;
  } else {
    const over = !bad && q > it.quantity;
    pop.lab.textContent = 'You get'; pop.val.textContent = abbr(bad ? 0 : q * num(it.sell_price));
    if (over) line('err', 'You only have ' + whole(it.quantity) + ' here.');
    pop.b1.textContent = 'Sell'; pop.b1.disabled = bad || none || over || fbusy;
  }
}

/* ---------- the box under a selected hull row (buy or sell; no quantity) ---------- */
const hpop = (() => {
  const root = el('div', 'fpop'), top = el('div', 'fprow'), pic = document.createElement('img'), tx = el('div', 'fpe sub'), grid = el('div', 'fgrid');
  const row = el('div', 'fprow'), e = el('div', 'fpe'), lab = el('div', 'fpl'), val = el('div', 'fpv'), note = el('div', 'fpmsg'), msg = el('div', 'fpmsg');
  pic.className = 'fhullpic'; pic.alt = ''; pic.onerror = () => { pic.hidden = true; }; pic.onload = () => { pic.hidden = false; };
  top.style.alignItems = 'flex-start'; top.append(pic, tx);
  const b1 = mkBtn('', false);
  e.append(lab, val); row.append(e, b1);
  root.append(top, grid, row, note, msg);
  b1.onclick = () => doHull();
  return { root, top, pic, tx, grid, lab, val, note, msg, b1 };
})();
function placeHullPop(x) {
  const buy = fsel.kind === 'hbuy';
  hpop.msg.replaceChildren();
  const line = (cls, t) => hpop.msg.appendChild(el('div', cls, t));
  hpop.top.hidden = !buy; hpop.grid.hidden = !buy;
  if (buy) {
    hpop.pic.src = hullPicUrl(x.hull_id);
    hpop.tx.textContent = [x.class ? x.class + ' hull' : '', x.flavor || ''].filter(Boolean).join('. ');
    fillGrid(hpop.grid, [...HULL_STATS, ['Ships', () => whole(yard.ships_owned) + ' / ' + whole(yard.max_ships)]], x);
    hpop.lab.textContent = 'Price'; hpop.val.textContent = abbr(x.cost); hpop.val.className = 'fpv pay';
    hpop.note.textContent = '';
    if (x.level_ok === false) line('err', 'You need level ' + x.min_level + '.');
    else if (num(x.cost) > credits()) line('err', 'You have ' + abbr(credits()) + ' credits.');
    else if (num(yard.ships_owned) >= num(yard.max_ships)) line('err', 'You already own ' + whole(yard.ships_owned) + ' ships, the most allowed.');
    hpop.b1.textContent = 'Buy';
    hpop.b1.disabled = fbusy || x.level_ok === false || num(x.cost) > credits() || num(yard.ships_owned) >= num(yard.max_ships);
  } else {
    // rigs and cargo on the hull are no reason to refuse any more: the server moves them to your storage here (095). Only the flown ship (and a pod) cannot be sold.
    const block = !!x.why && x.why !== 'has_rigs' && x.why !== 'has_cargo';
    hpop.lab.textContent = 'You get'; hpop.val.textContent = abbr(x.sell_price); hpop.val.className = 'fpv get';
    hpop.note.textContent = 'Rigs and cargo go to your storage here.';
    if (block) line('err', rigError({ message: x.why, data: { count: x.rigs } }));
    hpop.b1.textContent = 'Sell'; hpop.b1.disabled = fbusy || block;
  }
  return hpop.root;
}

/* ---------- drawing ---------- */
function drawLocBox() {
  const dl = dockedAt();
  const ids = places ? Object.keys(places).filter(id => (places[id] || []).length) : (floc ? [floc] : []);
  const list = ids.sort((a, b) => locName(a).localeCompare(locName(b)));
  fpick.set(list.map(id => [id, locName(id), (dl === id ? '@ship ' : '') + ((places && places[id]) || []).join(', ')]), floc);
  applyBackdrop(fpick.btn, floc);        /* the picture behind the box follows the chosen place */
}
// A section bar (open / closed is remembered). kind: 'sell' = the green Assets bar, 'sub' = a small group inside a section (Light, Medium ...).
function section(parent, key, title, count, drawBody, kind) {
  const k = floc + ':' + key, open = secOpen[k] === true;
  const box = el('div', 'msec'), h = el('div', kind === 'sub' ? 'fsub' : 'sech' + (kind === 'sell' ? ' sellsec' : ''));
  h.appendChild(el('span', '', (open ? '\u25BE ' : '\u25B8 ') + title + (count != null ? ' (' + count + ')' : '')));
  h.onclick = () => { secOpen[k] = !open; saveSec(); drawFac(); };
  box.appendChild(h);
  if (open) drawBody(box);
  parent.appendChild(box);
}
// A facility's big header box (same size as the place box), then its body when open.
function facHeader(parent, key, title, picture, drawBody) {
  const k = floc + ':' + key, open = secOpen[k] === true;
  const box = el('div', 'msec'), h = el('button', 'locsel fhead');
  h.type = 'button'; h.setAttribute('aria-expanded', open ? 'true' : 'false');
  h.style.backgroundImage = 'linear-gradient(rgba(7,10,18,.3), rgba(7,10,18,.3)), url(img/facilities/' + picture + '.webp), linear-gradient(135deg, #1a2338, #0f1523)';
  h.append(el('span', 'lpname', title), el('span', 'lpcaret', open ? '\u25B4' : '\u25BE'));
  h.onclick = () => { secOpen[k] = !open; saveSec(); drawFac(); };
  box.appendChild(h);
  if (open) drawBody(box);
  parent.appendChild(box);
}
function toggle(kind, id) { fsel = isSel(kind, id) ? null : { loc: floc, kind, id }; fEdited = false; drawFac(); }

// One row: name over a grey line, the price on the right (amber = you pay, green = you get); the selected row gets its pop-up under it.
function frow(parent, kind, x, name, sub, price, cls) {
  const sel = isSel(kind, keyOf(x)), r = el('div', 'frow' + (sel ? ' sel' : '')), l = el('div', 'fl');
  l.appendChild(el('div', '', name));
  if (sub) l.appendChild(el('div', 'sub', sub));
  r.append(l, el('span', 'fpr ' + cls, price));
  r.onclick = () => toggle(kind, keyOf(x));
  parent.appendChild(r);
  if (sel) parent.appendChild(kind === 'hbuy' || kind === 'hsell' ? placeHullPop(x) : placePop(x));
}
const have = x => (num(x.in_storage) > 0 ? ', you have ' + whole(x.in_storage) + ' here' : '');
const rigRows = (box, items) => items.forEach(x => frow(box, 'buy', x, x.name,
  (x.kind === 'weapon' ? 'dmg ' + whole(x.damage) + ', power ' + whole(x.power_use) + ', best ' + fmtK(num(x.optimal_range_km)) + ' km' : (x.effect_text || '') + (x.works_now ? '' : ' (inactive)')) + have(x), abbr(x.price), 'pay'));

function drawShipyard(body) {
  if (fsel && (fsel.loc !== floc || !curItem())) { fsel = null; fEdited = false; }
  facHeader(body, 'yard', 'Shipyard', 'shipyard', box => {
    if (!yard) { box.appendChild(el('div', 'muted pad', 'Loading the shipyard...')); return; }
    const buy = yard.buy || [], stock = yard.stock || [];
    const hulls = yard.hulls || [], mine = yard.my_hulls || [];
    // everything of yours that this place buys, in ONE section: parked hulls first, then stored rigs
    if (mine.length || stock.length) section(box, 'assets', 'Assets', mine.length + stock.length, b => {
      mine.forEach(x => frow(b, 'hsell', x, x.name,
        'hull' + (x.is_active ? ', you are flying it' : '') + (num(x.rigs) > 0 ? ', ' + whole(x.rigs) + (num(x.rigs) === 1 ? ' rig' : ' rigs') + ' fitted' : '') + (num(x.hold_used) > 0 ? ', ' + whole(x.hold_used) + ' CU cargo' : ''),
        abbr(x.sell_price), 'get'));
      stock.forEach(x => frow(b, 'sell', x, x.name, 'rig' + (x.elite ? ', elite' : '') + ', ' + whole(x.quantity) + ' in storage', abbr(x.sell_price), 'get'));
    }, 'sell');
    if (hulls.length) section(box, 'buyhull', 'Hulls', hulls.length, b => {
      TIERS.forEach(tier => {
        const items = hulls.filter(x => x.class === tier);
        if (items.length) section(b, 'buyhull:' + tier, tier, items.length, c => items.forEach(x => frow(c, 'hbuy', x, x.name,
          'hold ' + whole(x.hold_size) + ', ' + String(num(x.max_g)) + ' g, slots ' + x.weapon_bays + '/' + x.engineering_slots + '/' + x.utility_slots + (x.level_ok === false ? ', level ' + x.min_level : ''),
          abbr(x.cost), 'pay')), 'sub');
      });
    });
    const weapons = buy.filter(x => x.kind === 'weapon');
    if (weapons.length) section(box, 'buy:weapon', 'Weapons', weapons.length, b => {
      TIERS.forEach(tier => {
        const items = weapons.filter(x => x.tier === tier);
        if (items.length) section(b, 'buy:weapon:' + tier, tier, items.length, c => rigRows(c, items), 'sub');
      });
    });
    ['engineering', 'utility'].forEach(k => {
      const items = buy.filter(x => x.kind === k);
      if (items.length) section(box, 'buy:' + k, KIND_PLURAL[k], items.length, b => rigRows(b, items));
    });
  });
}

function drawFac() {
  if (isTyping()) { fRedraw = true; return; }
  fRedraw = false;
  if (!floc) return;
  ctxBar.replaceChildren();
  ctxBar.hidden = !ctx;
  if (ctx) {
    const b = el('button', 'alt', '\u2039 Back to rigging'); b.onclick = () => { if (ctx && ctx.back) ctx.back(); };
    ctxBar.append(b, el('span', 'sub', ctx.label || ''));
  }
  drawLocBox();
  const body = fbody; body.replaceChildren();
  if (!fac) { body.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const fl = fac.facilities || [];
  if (!fl.length) { body.appendChild(el('div', 'muted pad', 'There is nothing to do at ' + locName(floc) + ' yet.')); return; }
  fl.forEach(f => { if (f.kind === 'shipyard') drawShipyard(body); });
}

/* ---------- buying and selling ---------- */
async function doTrade() {
  if (fbusy || !fsel || !yard) return;
  const it = curItem(); if (!it) return;
  const q = qtyOf(pop.inp); if (isNaN(q) || q < 1) return;
  const kind = fsel.kind, loc = floc;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  fbusy = true; drawFac();
  try {
    const r = await call(kind === 'buy' ? 'rig_buy' : 'rig_sell', { location: loc, rig: it.rig_id, qty: q });
    if (S.last && S.last.character && r.credits != null) { S.last.character.credits = r.credits; setShipLine(); }
    say((kind === 'buy' ? 'Bought ' : 'Sold ') + whole(q) + ' x ' + it.name + ' for ' + abbr(r.total) + ' credits.' + (kind === 'buy' ? ' In your storage at ' + locName(loc) + '.' : ''), 'ok');
    if (kind === 'buy' && ctx && ctx.shipId && ctx.shipLoc === loc) offerFit(it, q);
  } catch (e) { say(rigError(e), 'err'); }
  finally { fbusy = false; fEdited = false; fRedraw = false; if (S.refresh) S.refresh(); refreshFac(); }
}

async function doHull() {
  if (fbusy || !fsel || !yard) return;
  const x = curItem(); if (!x) return;
  const kind = fsel.kind, loc = floc;
  fbusy = true; drawFac();
  try {
    const r = kind === 'hbuy' ? await call('hull_buy', { location: loc, hull: x.hull_id }) : await call('hull_sell', { location: loc, ship: x.ship_id });
    if (S.last && S.last.character && r.credits != null) { S.last.character.credits = r.credits; setShipLine(); }
    say(kind === 'hbuy' ? 'Bought a ' + x.name + ' for ' + abbr(r.cost) + ' credits. It is parked at ' + locName(loc) + ' (Assets, Hulls here).'
                        : 'Sold the ' + x.name + ' for ' + abbr(r.total) + ' credits.' + (num(r.rigs_moved) > 0 || num(r.goods_moved) > 0 ? ' Rigs and cargo go to your storage here.' : ''), 'ok');
    fsel = null;
  } catch (e) { say(rigError(e), 'err'); }
  finally { fbusy = false; if (S.refresh) S.refresh(); refreshFac(); }
}

/* ---------- "Fit it now?" (only when we were opened from the Rigging screen for a ship docked HERE) ---------- */
const fp = (() => {
  const root = el('div'); root.id = 'fprompt'; root.hidden = true;
  const box = el('div', 'abox'), msg = el('div', ''), err = el('div', 'err'), btns = el('div', 'abtns');
  const bn = el('button', 'alt', 'Not now'), by = el('button', '', 'Fit now');
  btns.append(bn, by); box.append(msg, err, btns); root.appendChild(box); document.body.appendChild(root);
  return { root, msg, err, bn, by };
})();
let fitFor = null, fitBusy = false;
function offerFit(it, q) {
  fitFor = it;
  fp.msg.textContent = 'Bought ' + whole(q) + ' x ' + it.name + '. Fit one to your ' + (ctx.label || 'ship') + ' now?';
  fp.err.textContent = ''; fp.by.disabled = false; fp.bn.textContent = 'Not now';
  fp.root.hidden = false; document.body.style.overflow = 'hidden';
}
function closeFit() { fp.root.hidden = true; document.body.style.overflow = ''; fitFor = null; }
fp.bn.onclick = () => { if (!fitBusy) closeFit(); };
fp.by.onclick = async () => {
  if (fitBusy || !fitFor || !ctx) return;
  fitBusy = true; fp.by.disabled = true; fp.err.textContent = '';
  const c = ctx, nm = fitFor.name;
  try {
    await call('rig_fit', { rig: fitFor.rig_id, ship: c.shipId });
    closeFit();
    say('Fitted ' + nm + ' to your ' + (c.label || 'ship') + '.', 'ok');
    if (S.refresh) S.refresh();
    if (c.back) c.back();
  } catch (e) { fp.err.textContent = rigError(e); fp.by.disabled = false; fp.bn.textContent = 'Close'; }
  finally { fitBusy = false; }
};

/* ---------- wiring ---------- */
// Open the Port screen at a place. c (optional) = { shipId, label, shipLoc, back }: set by the Rigging screen.
export function openFacilities(loc, c) {
  pendingCtx = c || null;
  if (loc && loc !== floc) { floc = loc; fac = yard = null; fsel = null; }
  openScreen('facilities');
}
addScreen('facilities', 'Port', scr, {
  onShow: () => {
    ctx = pendingCtx; pendingCtx = null;      /* opened by its tab: no Rigging context */
    fdock = dockedAt(); if (!floc) floc = defaultLoc();
    fixLoc();
    fsel = null; fEdited = false;
    refreshFac(); drawFac();
  },
  update: ship => {
    const dl = (ship && ship.state === 'docked') ? ship.location_id : null;
    if (dl !== fdock) {
      fdock = dl;
      if (dl && !ctx && places && (places[dl] || []).length) { floc = dl; fac = yard = null; fsel = null; }
      refreshFac(); return;
    }
    if (Date.now() - fAt > 12000) refreshFac();
  },
});

/* called by main.js on log out */
export function resetFacilities() {
  floc = null; fdock = undefined; places = fac = yard = null; fsel = null; fEdited = false; ctx = pendingCtx = null;
  closeFit();
  fbody.replaceChildren();
}
