// facilities.js - the Facilities screen: the things you can do at ONE place. Today: the shipyard's rig store.
// Later: casino, cantina, race track, black market ... each is one more block in drawFac().
// Display only: the server decides everything. Data: 'facilities' (all places / one place), 'shipyard'; actions rig_buy, rig_sell, rig_fit.
// You do NOT have to be at the place: what you buy goes into your storage THERE (Assets), what you sell is taken from it.
// Creates its own screen block (#scr-facilities) and the "Fit it now?" pop-up (#fprompt), so index.html needs only the import-map line.
// The Rigging screen opens this one with openFacilities(place, { shipId, label, shipLoc, back }): then a bought rig can be fitted at once.
import { S, $, say, call, locName, money, whole, el, cell, addScreen, setShipLine, dockedAt, defaultLoc, createPicker, openScreen } from 'core';
import { applyBackdrop } from 'backdrop';
import { rigError, KIND_PLURAL } from 'rigtext';

const ARROW_OPEN = '\u25BE ', ARROW_SHUT = '\u25B8 ';

let floc = null, fdock;               // the chosen place; the place the ship was docked at last time we looked
let fAt = 0, fLoading = false;
let places = null;                    // { place id: ['shipyard', ...] } - which places have facilities
let fac = null, yard = null;          // answers for floc: 'facilities' and 'shipyard'
let fsel = null;                      // the selected store row { loc, kind: 'buy' | 'sell', id }
let fbusy = false, fEdited = false, fRedraw = false;
let ctx = null, pendingCtx = null;    // set when we were opened from the Rigging screen
const secOpen = {};                   // collapsed sections: key 'place:section' -> false

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
    '#fbody .row { padding-top: 3px !important; padding-bottom: 3px !important; min-height: 0 !important; line-height: 1.2 !important; }',
    '#fbody .sub { line-height: 1.15 !important; }',
    '#fbody .sech { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 0 !important; line-height: 1.2 !important; background: rgba(120,160,210,0.16) !important; border-top: 2px solid rgba(120,160,210,0.55) !important; border-bottom: 1px solid rgba(120,160,210,0.25) !important; font-weight: 600 !important; letter-spacing: 0.02em; cursor: pointer; }',
    '#fbody .msec + .msec { margin-top: 14px !important; }',
    '#fbody .msec .msec { margin-top: 8px !important; }',
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
function curItem() {
  if (!fsel || !yard) return null;
  return (fsel.kind === 'buy' ? (yard.buy || []) : (yard.stock || [])).find(x => x.rig_id === fsel.id) || null;
}

/* ---------- loading ---------- */
async function refreshFac() {
  fAt = Date.now();
  if (fLoading || !S.sb || !floc) return;
  fLoading = true;
  const loc = floc;
  try {
    if (!places) {
      const p = await call('facilities');
      const m = {}; (p.places || []).forEach(x => { m[x.location_id] = x.kinds || []; }); places = m;
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
  const list = ((S.last && S.last.locations) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  fpick.set(list.map(l => [l.id, l.name, dl === l.id ? 'ship here' : (places && places[l.id] && places[l.id].length ? places[l.id].join(', ') : '')]), floc);
  applyBackdrop(fpick.btn, floc);        /* the picture behind the box follows the chosen place */
}
function section(parent, key, title, count, drawBody) {
  const k = floc + ':' + key, open = secOpen[k] !== false;
  const box = el('div', 'msec'), h = el('div', 'sech');
  h.appendChild(el('span', '', (open ? ARROW_OPEN : ARROW_SHUT) + title + (count != null ? ' (' + count + ')' : '')));
  h.onclick = () => { secOpen[k] = !open; drawFac(); };
  box.appendChild(h);
  if (open) drawBody(box);
  parent.appendChild(box);
}
function toggle(kind, id) { fsel = isSel(kind, id) ? null : { loc: floc, kind, id }; fEdited = false; drawFac(); }

function itemRow(box, kind, x) {
  const sel = isSel(kind, x.rig_id), r = el('div', 'row' + (sel ? ' sel' : ''));
  if (kind === 'buy') {
    const bits = [x.effect_text];
    if (!x.works_now) bits.push('not active yet');
    bits.push(num(x.power_use) > 0 ? 'uses ' + whole(x.power_use) + ' power' : 'no power use');
    bits.push(whole(x.cu) + ' CU');
    r.append(cell('', x.name, bits.join(' - ')), cell('num', money(x.price), num(x.in_storage) > 0 ? 'you have ' + whole(x.in_storage) + ' here' : ''));
  } else {
    r.append(cell('', whole(x.quantity) + ' x ' + x.name + (x.elite ? ' (elite)' : '')), cell('num', money(x.sell_price), 'each'));
  }
  r.onclick = () => toggle(kind, x.rig_id);
  box.appendChild(r);
  if (sel) box.appendChild(placePop(x));
}

function drawShipyard(body) {
  if (!yard) { body.appendChild(el('div', 'muted pad', 'Loading the shipyard...')); return; }
  if (fsel && (fsel.loc !== floc || !curItem())) { fsel = null; fEdited = false; }
  const buy = yard.buy || [], stock = yard.stock || [];
  section(body, 'yard', 'Shipyard', null, box => {
    box.appendChild(el('div', 'muted pad', 'Rigs and weapons. What you buy goes into your storage at ' + locName(floc) + ' (see Assets); you do not have to be here. The shipyard buys any rig back at ' + Math.round(num(yard.buyback_pct) * 100) + '% of its price.'));
    if (stock.length) section(box, 'sell', 'Sell: your rigs stored here', stock.length, b => stock.forEach(x => itemRow(b, 'sell', x)));
    ['weapon', 'engineering', 'utility'].forEach(k => {
      const items = buy.filter(x => x.kind === k);
      if (items.length) section(box, 'buy:' + k, 'Buy: ' + KIND_PLURAL[k].toLowerCase(), items.length, b => items.forEach(x => itemRow(b, 'buy', x)));
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
  if (!fl.length) { body.appendChild(el('div', 'muted pad', 'There is nothing to do at ' + locName(floc) + ' yet. Places with a facility are tagged in the list above.')); return; }
  fl.forEach(f => { if (f.kind === 'shipyard') drawShipyard(body); });
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
    say((kind === 'buy' ? 'Bought ' : 'Sold ') + whole(q) + ' x ' + it.name + (kind === 'buy' ? ' for ' : ' for ') + money(r.total) + ' credits.' + (kind === 'buy' ? ' In your storage at ' + locName(loc) + '.' : ''), 'ok');
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
    fsel = null; fEdited = false;
    refreshFac(); drawFac();
  },
  update: ship => {
    const dl = (ship && ship.state === 'docked') ? ship.location_id : null;
    if (dl !== fdock) { fdock = dl; if (dl && !ctx) { floc = dl; fac = yard = null; fsel = null; } refreshFac(); return; }
    if (Date.now() - fAt > 12000) refreshFac();
  },
});

/* called by main.js on log out */
export function resetFacilities() {
  floc = null; fdock = undefined; places = fac = yard = null; fsel = null; fEdited = false; ctx = pendingCtx = null;
  closeFit();
  fbody.replaceChildren();
}
