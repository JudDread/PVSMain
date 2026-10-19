// facilities.js - the Facilities screen: the things you can do at ONE place. Today: the shipyard's rig store.
// Later: casino, cantina, race track, black market ... each is one more block in drawFac().
// Display only: the server decides everything. Data: 'facilities' (all places / one place), 'shipyard'; actions rig_buy, rig_sell, rig_fit.
// You do NOT have to be at the place: what you buy goes into your storage THERE (Assets), what you sell is taken from it.
// The place list shows only places that have a facility. Every section starts closed; the open / closed state is remembered (this device).
// Each facility has a big header box, the same size as the place box; its picture is web/img/facilities/<kind>.webp (3:1; none = plain box).
// Creates its own screen block (#scr-facilities) and the "Fit it now?" pop-up (#fprompt), so index.html needs only the import-map line.
// The Rigging screen opens this one with openFacilities(place, { shipId, label, shipLoc, back }): then a bought rig can be fitted at once.
import { S, $, say, call, locName, money, whole, el, LS, addScreen, setShipLine, dockedAt, defaultLoc, createPicker, openScreen } from 'core';
import { applyBackdrop } from 'backdrop';
import { rigError, KIND_PLURAL } from 'rigtext';

const TIERS = ['Light', 'Medium', 'Heavy', 'Super'];

let floc = null, fdock;               // the chosen place; the place the ship was docked at last time we looked
let fAt = 0, fLoading = false;
let places = null;                    // { place id: ['shipyard', ...] } - which places have facilities
let fac = null, yard = null;          // answers for floc: 'facilities' and 'shipyard'
let fsel = null;                      // the selected store row { loc, kind: 'buy' | 'sell', id }
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
    '#fbody .sub { line-height: 1.15 !important; }',
    '#fbody .sech { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 0 !important; line-height: 1.2 !important; background: rgba(120,160,210,0.16) !important; border-top: 2px solid rgba(120,160,210,0.55) !important; border-bottom: 1px solid rgba(120,160,210,0.25) !important; font-weight: 600 !important; letter-spacing: 0.02em; cursor: pointer; }',
    '#fbody .msec .msec { margin-top: 8px !important; }',
    '#fbody .fhead { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 0 0 8px; background-size: cover; background-position: center; }',
    '#fbody .fwrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }',
    '#fbody .ftab { border-collapse: collapse; font-size: 13px; width: 100%; }',
    '#fbody .ftab th { font-size: 11px; font-weight: 600; color: #8d98b2; text-align: right; white-space: nowrap; padding: 4px 8px; border-bottom: 1px solid #2a3350; }',
    '#fbody .ftab td { padding: 5px 8px; border-bottom: 1px solid #1c2438; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; cursor: pointer; vertical-align: top; }',
    '#fbody .ftab th:first-child, #fbody .ftab td:first-child { text-align: left; position: sticky; left: 0; background: #0b0f19; z-index: 1; }',
    '#fbody .ftab td.fx, #fbody .ftab th.fx { text-align: left; white-space: normal; min-width: 150px; }',
    '#fbody .ftab tr.sel td { background: #2a3350; }',
    '#fbody .ftab td.fpoptd { position: static; padding: 0; cursor: default; background: none; white-space: normal; }',
    '#fbody .ftab td.fpoptd .pop { position: sticky; left: 0; box-sizing: border-box; }',
    '.fctx { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }',
    '.fctx button { margin: 0; padding: 6px 12px; }',
    '#fprompt { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }',
    '#fprompt[hidden] { display: none; }',
    '#fprompt .abox { background: #131a2a; border: 2px solid #e8b64a; border-radius: 10px; padding: 12px; width: 100%; max-width: 420px; max-height: 92%; overflow-y: auto; box-sizing: border-box; }',
    '#fprompt .abox div { margin: 8px 0; }',
    '#fprompt .abtns { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }',
    '#fprompt .abtns button { margin: 0; padding: 8px 18px; }',
  ].join('\n');
  document.head.appendChild(st);
})();

/* ---------- small helpers ---------- */
const num = x => Number(x) || 0;
const isTyping = () => !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('fin'));
function qtyOf(inp) { const v = inp.value; if (v === '') return NaN; const q = Number(v); return Number.isInteger(q) && q >= 1 && q <= 100 ? q : NaN; }
const credits = () => (S.last && S.last.character ? num(S.last.character.credits) : 0);
const isSel = (kind, id) => !!fsel && fsel.loc === floc && fsel.kind === kind && fsel.id === id;
const fmtK = n => (n >= 1000 ? String(Math.round(n / 100) / 10) + 'k' : String(n));   // 300000 -> 300k
const pct = x => Math.round(num(x) * 100);
function curItem() {
  if (!fsel || !yard) return null;
  return (fsel.kind === 'buy' ? (yard.buy || []) : (yard.stock || [])).find(x => x.rig_id === fsel.id) || null;
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

/* ---------- the dropdown under a selected row: built ONCE, moved on every redraw, so a number you type survives ---------- */
const pop = (() => {
  const root = el('div', 'pop'), left = el('div', 'popl'), right = el('div', 'popr');
  const title = el('div', 'poptitle'), info = el('div', 'popinfo'), row = el('div', 'poprow'), brow = el('div', 'poprow');
  const inp = document.createElement('input');
  inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '1'; inp.max = '100'; inp.step = '1'; inp.className = 'fin'; inp.setAttribute('aria-label', 'Quantity');
  const chips = el('div', 'chips'), b1 = el('button', '', '');
  row.append(inp, chips); brow.append(b1); left.append(title, info); right.append(row, brow); root.append(left, right);
  inp.addEventListener('input', () => { fEdited = true; refreshPop(); });
  inp.addEventListener('blur', () => setTimeout(() => { if (fRedraw && !isTyping()) { fRedraw = false; drawFac(); } }, 350));
  b1.onclick = () => doTrade();
  return { root, title, info, inp, chips, b1 };
})();
function addChip(label, fn) { const b = el('button', 'alt', label); b.onclick = fn; pop.chips.appendChild(b); }
function setQty(q) { pop.inp.value = q; fEdited = true; refreshPop(); }

function placePop(it) {
  const buy = fsel.kind === 'buy';
  pop.root.className = 'pop' + (buy ? '' : ' sell');
  pop.title.textContent = it.name;
  pop.chips.replaceChildren();
  if (!fEdited) pop.inp.value = 1;
  addChip('1', () => setQty(1));
  if (buy) { addChip('5', () => setQty(5)); addChip('10', () => setQty(10)); }
  else addChip('All', () => setQty(Math.min(100, it.quantity)));
  refreshPop();
  return pop.root;
}
function refreshPop() {
  const it = curItem(); if (!it || !fsel) return;
  const buy = fsel.kind === 'buy', q = qtyOf(pop.inp), bad = isNaN(q);
  pop.info.replaceChildren();
  const line = (cls, t) => pop.info.appendChild(el('div', cls, t));
  if (bad) line('', 'Enter a whole number from 1 to 100.');
  if (buy) {
    const total = bad ? 0 : q * num(it.price), poor = !bad && total > credits();
    if (!bad) line('', 'Total ' + money(total) + ' credits.');
    if (poor) line('err', 'You have ' + money(credits()) + ' credits.');
    line('muted', 'Goes into your storage at ' + locName(floc) + '.');
    pop.b1.textContent = 'Buy'; pop.b1.disabled = bad || poor || fbusy;
  } else {
    const over = !bad && q > it.quantity;
    if (!bad) line('', 'You get ' + money(q * num(it.sell_price)) + ' credits.');
    if (over) line('err', 'You only have ' + whole(it.quantity) + ' here.');
    line('muted', 'Taken from your storage at ' + locName(floc) + '.');
    pop.b1.textContent = 'Sell'; pop.b1.disabled = bad || over || fbusy;
  }
}

/* ---------- drawing ---------- */
function drawLocBox() {
  const dl = dockedAt();
  const ids = places ? Object.keys(places).filter(id => (places[id] || []).length) : (floc ? [floc] : []);
  const list = ids.sort((a, b) => locName(a).localeCompare(locName(b)));
  fpick.set(list.map(id => [id, locName(id), (dl === id ? '@ship ' : '') + ((places && places[id]) || []).join(', ')]), floc);
  applyBackdrop(fpick.btn, floc);        /* the picture behind the box follows the chosen place */
}
// A small section bar (open / closed is remembered).
function section(parent, key, title, count, drawBody) {
  const k = floc + ':' + key, open = secOpen[k] === true;
  const box = el('div', 'msec'), h = el('div', 'sech');
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

// A table (like a spreadsheet): first column = the name (stays put while the rest scrolls sideways), then the number columns, then the price.
// cols = [{ h: heading, f: item -> text, cls: optional class ('fx' = wide text column) }]; the selected row gets the buy / sell box under it.
function drawTable(parent, kind, items, cols, lastHead, lastFn) {
  const wrap = el('div', 'fwrap'), t = document.createElement('table'); t.className = 'ftab';
  const hr = t.createTHead().insertRow();
  [{ h: 'Name' }, ...cols, { h: lastHead }].forEach(c => { const th = document.createElement('th'); th.textContent = c.h; if (c.cls) th.className = c.cls; hr.appendChild(th); });
  const tb = t.createTBody(), n = cols.length + 2;
  items.forEach(x => {
    const sel = isSel(kind, x.rig_id), tr = tb.insertRow();
    tr.className = sel ? 'sel' : '';
    const nm = tr.insertCell();
    nm.appendChild(document.createTextNode(x.name));
    const sub = kind === 'buy' ? (num(x.in_storage) > 0 ? 'you have ' + whole(x.in_storage) + ' here' : '') : (x.elite ? 'elite' : '');
    if (sub) nm.appendChild(el('span', 'sub', sub));
    cols.forEach(c => { const td = tr.insertCell(); td.textContent = c.f(x); if (c.cls) td.className = c.cls; });
    tr.insertCell().textContent = lastFn(x);
    tr.onclick = () => toggle(kind, x.rig_id);
    if (sel) { const pr = tb.insertRow(), pc = pr.insertCell(); pc.colSpan = n; pc.className = 'fpoptd'; pc.appendChild(placePop(x)); }
  });
  wrap.appendChild(t); parent.appendChild(wrap);
}

const WEAPON_COLS = [
  { h: 'Power', f: x => whole(x.power_use) },
  { h: 'Damage', f: x => whole(x.damage) },
  { h: 'Reuse s', f: x => String(num(x.reuse_sec)) },
  { h: 'Best km', f: x => fmtK(num(x.optimal_range_km)) },
  { h: 'Max km', f: x => fmtK(num(x.max_range_km)) },
  { h: 'Acc % best/max', f: x => pct(x.optimal_accuracy) + '/' + pct(x.max_accuracy) },
  { h: 'Ammo', f: x => (x.ammo != null ? whole(x.ammo) : '-') },
];
const RIG_COLS = [
  { h: 'Power', f: x => whole(x.power_use) },
  { h: 'Effect', cls: 'fx', f: x => x.effect_text + (x.works_now ? '' : ' (inactive)') },
];
const SELL_COLS = [{ h: 'Qty', f: x => whole(x.quantity) }];

function drawShipyard(body) {
  if (fsel && (fsel.loc !== floc || !curItem())) { fsel = null; fEdited = false; }
  facHeader(body, 'yard', 'Shipyard', 'shipyard', box => {
    if (!yard) { box.appendChild(el('div', 'muted pad', 'Loading the shipyard...')); return; }
    const buy = yard.buy || [], stock = yard.stock || [];
    if (stock.length) section(box, 'sell', 'Sell: your rigs stored here', stock.length, b => drawTable(b, 'sell', stock, SELL_COLS, 'Each', x => money(x.sell_price)));
    const weapons = buy.filter(x => x.kind === 'weapon');
    if (weapons.length) section(box, 'buy:weapon', 'Buy: weapons', weapons.length, b => {
      TIERS.forEach(tier => {
        const items = weapons.filter(x => x.tier === tier);
        if (items.length) section(b, 'buy:weapon:' + tier, tier, items.length, c => drawTable(c, 'buy', items, WEAPON_COLS, 'Price', x => money(x.price)));
      });
    });
    ['engineering', 'utility'].forEach(k => {
      const items = buy.filter(x => x.kind === k);
      if (items.length) section(box, 'buy:' + k, 'Buy: ' + KIND_PLURAL[k].toLowerCase(), items.length, b => drawTable(b, 'buy', items, RIG_COLS, 'Price', x => money(x.price)));
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
    ctxBar.append(b, el('span', 'muted', ctx.label || ''));
  }
  drawLocBox();
  const body = fbody; body.replaceChildren();
  if (!fac) { body.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const fl = fac.facilities || [];
  if (!fl.length) { body.appendChild(el('div', 'muted pad', 'There is nothing to do at ' + locName(floc) + ' yet.')); return; }
  fl.forEach(f => { if (f.kind === 'shipyard') drawShipyard(body); });
  /* the buy / sell box is as wide as the table's visible part, so it stays in view when a wide table is scrolled sideways */
  const w = pop.root.closest('.fwrap');
  pop.root.style.width = w ? Math.max(200, w.clientWidth - 4) + 'px' : '';
}

/* ---------- buying and selling ---------- */
async function doTrade() {
  if (fbusy || !fsel || !yard) return;
  const it = curItem(); if (!it) return;
  const q = qtyOf(pop.inp); if (isNaN(q)) return;
  const kind = fsel.kind, loc = floc;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  fbusy = true; drawFac();
  try {
    const r = await call(kind === 'buy' ? 'rig_buy' : 'rig_sell', { location: loc, rig: it.rig_id, qty: q });
    if (S.last && S.last.character && r.credits != null) { S.last.character.credits = r.credits; setShipLine(); }
    say((kind === 'buy' ? 'Bought ' : 'Sold ') + whole(q) + ' x ' + it.name + ' for ' + money(r.total) + ' credits.' + (kind === 'buy' ? ' In your storage at ' + locName(loc) + '.' : ''), 'ok');
    if (kind === 'buy' && ctx && ctx.shipId && ctx.shipLoc === loc) offerFit(it, q);
  } catch (e) { say(rigError(e), 'err'); }
  finally { fbusy = false; fEdited = false; fRedraw = false; if (S.refresh) S.refresh(); refreshFac(); }
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
// Open the Facilities screen at a place. c (optional) = { shipId, label, shipLoc, back }: set by the Rigging screen.
export function openFacilities(loc, c) {
  pendingCtx = c || null;
  if (loc && loc !== floc) { floc = loc; fac = yard = null; fsel = null; }
  openScreen('facilities');
}
addScreen('facilities', 'Facilities', scr, {
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
