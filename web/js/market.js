// market.js - the Market screen (goods in markets, in storage and in the hold). Display only: the server decides every trade.
import { S, $, say, call, fmt, locName, money, whole, r2, el, cell, sgn, tone, LS, addScreen, setShipLine } from 'core';

const ARROW_OPEN = '\u25BE ', ARROW_SHUT = '\u25B8 ';

let mloc = null;            // chosen place: a location id, or 'ALL'
let mdock;                  // the place the ship was docked at last time we looked (to notice a new dock)
let mAt = 0;                // when the screen was last refreshed
const mc = {};              // cache per location: mc[id] = { d: market_at answer, at, bestSt, bestCg }
const mLoading = {};
let stAll = null, stAllBusy = false;   // answer of 'storage': everything I keep, at every place
let hold = null;            // { used, size } of the ship's hold, from the latest answer
const openLocs = {};        // All view: which places are expanded
const secOpen = {};         // which sections are collapsed: key 'place:section' -> false
let msel = null;            // selected row { loc, kind: 'cargo' | 'storage' | 'goods', good }
let dd = null, ddBusy = false;   // open destinations list { loc, kind, good, data }
let mbusy = false, mEdited = false, mRedraw = false, longFired = false, lastTap = { id: null, t: 0 };
let buyTo = LS.get('pvs_buyto') === 'hold' ? 'hold' : 'storage';   // where bought goods go (remembered)

const dockedAt = () => { const s = S.last && (S.last.ships || [])[0]; return s && s.state === 'docked' ? s.location_id : null; };
// Default place: where the ship is docked; else the last place it docked (remembered); else the start of the current trip.
function defaultLoc() {
  const dl = dockedAt(); if (dl) return dl;
  const mem = LS.get('pvs_lastdock'); if (mem) return mem;
  const a = ((S.last && S.last.actions) || []).find(x => x.status === 'pending');
  return (a && a.payload && a.payload.from) || 'luna';
}
function placeIds() {
  const s = new Set();
  Object.values(mc).forEach(x => ((x.d && x.d.market_ids) || []).forEach(i => s.add(i)));
  ((stAll && stAll.items) || []).forEach(i => s.add(i.location_id));
  if (dockedAt()) s.add(dockedAt());
  if (mloc && mloc !== 'ALL') s.add(mloc);
  return [...s].sort((a, b) => locName(a).localeCompare(locName(b)));
}
const curData = () => { const c = msel && mc[msel.loc]; return c ? c.d : null; };
function curItem() {
  const d = curData(); if (!d) return null;
  const list = msel.kind === 'goods' ? d.goods : msel.kind === 'cargo' ? d.cargo : d.storage;
  return (list || []).find(x => x.good_id === msel.good) || null;
}
const isSel = (loc, kind, good) => !!msel && msel.loc === loc && msel.kind === kind && msel.good === good;
const isDD = (loc, kind, good) => !!dd && dd.loc === loc && dd.kind === kind && dd.good === good;
const buyDest = d => (buyTo === 'hold' && d.here) ? 'hold' : 'storage';
function maxBuy(d, g) {
  let m = Math.min(g.stock, d.credits / g.buy_price);
  if (buyDest(d) === 'hold') m = Math.min(m, (d.hold_size - d.hold_used + 1e-9) / g.hold_per_unit);
  return Math.max(0, Math.floor(m));
}
function buyBlockReason(d, g) {
  if (!g || g.stock < 1) return 'Sold out';
  if (d.credits / g.buy_price < 1) return 'Low funds';
  if (buyDest(d) === 'hold' && (d.hold_size - d.hold_used + 1e-9) / g.hold_per_unit < 1) return 'Hold full';
  return 'Sold out';
}
const maxLoad = (d, x) => Math.max(0, Math.min(x.quantity, Math.floor((d.hold_size - d.hold_used + 1e-9) / x.hold_per_unit)));

/* ---- loading ---- */
async function loadLoc(loc) {
  if (!S.sb || mLoading[loc]) return;
  mLoading[loc] = true;
  try {
    const d = await call('market_at', { location: loc });
    const c = mc[loc] || (mc[loc] = {}); c.d = d; c.at = Date.now();
    hold = { used: d.hold_used, size: d.hold_size };
    if (S.last && S.last.character) S.last.character.credits = d.credits;
    setShipLine(); drawMarket();
    loadBest(loc);
    if (dd && dd.loc === loc) loadDD();
  } catch (e) { say('Error: ' + e.message, 'err'); }
  finally { mLoading[loc] = false; }
}
// "Best:" lines: where to sell each stack for the most profit per minute (hold: from the ship; storage: from that place)
async function loadBest(loc) {
  const c = mc[loc]; if (!c || !c.d) return;
  const idx = r => { const o = {}; (r.items || []).forEach(x => { o[x.good_id] = x; }); return o; };
  const jobs = [];
  if ((c.d.storage || []).length) jobs.push(call('cargo_routes', { source: 'storage', location: loc }).then(r => { c.bestSt = idx(r); })); else c.bestSt = null;
  if (c.d.here && (c.d.cargo || []).length) jobs.push(call('cargo_routes').then(r => { c.bestCg = idx(r); })); else c.bestCg = null;
  try { await Promise.all(jobs); } catch (e) { c.bestSt = c.bestCg = null; }
  drawMarket();
}
async function loadStorageAll() {
  if (stAllBusy || !S.sb) return;
  stAllBusy = true;
  try { stAll = await call('storage'); hold = { used: stAll.hold_used, size: stAll.hold_size }; drawMarket(); }
  catch (e) { say('Error: ' + e.message, 'err'); }
  finally { stAllBusy = false; }
}
function refreshMarket() {
  mAt = Date.now();
  loadStorageAll();
  if (mloc === 'ALL') Object.keys(openLocs).filter(k => openLocs[k]).forEach(loadLoc);
  else if (mloc) loadLoc(mloc);
}

/* ---- destinations list (long press / double tap) ---- */
async function openDD(loc, kind, good) {
  if (!isSel(loc, kind, good)) mEdited = false;
  msel = { loc, kind, good }; dd = { loc, kind, good, data: null };
  drawMarket(); await loadDD();
}
function closeDD() { dd = null; drawMarket(); }
async function loadDD() {
  if (!dd || !S.sb || ddBusy) return;
  ddBusy = true;
  const me = dd;
  try {
    let d;
    if (me.kind === 'goods') d = await call('routes', { good: me.good, location: me.loc });
    else if (me.kind === 'storage') d = await call('cargo_dest', { good: me.good, source: 'storage', location: me.loc });
    else d = await call('cargo_dest', { good: me.good });
    if (dd === me) me.data = d;
  } catch (e) { if (dd === me) me.data = { error: e.message }; }
  finally { ddBusy = false; drawMarket(); if (dd && dd !== me) loadDD(); }
}
function ddBox() {
  const box = el('div', 'routes'), d = dd.data, md = mc[dd.loc] && mc[dd.loc].d;
  const close = () => { const b = el('button', 'alt', 'Close'); b.onclick = closeDD; box.appendChild(b); return box; };
  if (!d) { box.appendChild(el('div', 'muted', 'Loading destinations...')); return close(); }
  if (d.error) { box.appendChild(el('div', 'err', d.error === 'no_market' ? 'This place does not trade that.' : 'Could not load: ' + d.error)); return close(); }
  if (d.docked === false && dd.kind === 'cargo') { box.appendChild(el('div', 'muted', 'Dock somewhere to compare destinations.')); return close(); }
  const hd = el('div', 'rhead');
  if (dd.kind === 'goods') {
    box.appendChild(el('div', '', 'Buy ' + d.name + ' at ' + locName(d.origin_id) + ' for ' + money(d.buy_here) + (d.remote ? ' (includes the remote fee)' : '') + '. Max load: ' + whole(d.max_load) + ' ' + d.unit + '.'));
    const g = md && (md.goods || []).find(x => x.good_id === dd.good);
    const why = d.hypothetical && md ? buyBlockReason(md, g) : null;
    if (d.hypothetical) box.appendChild(el('div', 'muted', (why === 'Hold full' ? 'Your hold is full' : why === 'Low funds' ? 'You cannot afford any' : 'None in stock here') + ', so the load columns show N/A.'));
    if (!d.rows.length) { box.appendChild(el('div', 'muted', 'No other place trades this good.')); return close(); }
    hd.append(el('span', '', 'Destination'), el('span', 'num', 'Sells'), el('span', 'num', 'Each'),
      el('span', 'num', d.hypothetical ? why : (md && md.hold_used > 0 ? 'For ' + whole(d.max_load) : 'Max load')), el('span', 'num', 'Per min'));
    box.appendChild(hd);
    d.rows.forEach(x => {
      const r = el('div', 'rrow');
      r.append(
        cell('', x.name, 'ETA ' + fmt(x.eta_real_minutes * 60) + (x.sun_danger ? ' (near the Sun!)' : '')),
        cell('num', money(x.sell_price), 'stock ' + whole(x.stock)),
        cell('num ' + tone(x.profit_each), sgn(x.profit_each)),
        d.hypothetical ? cell('num muted', 'N/A') : cell('num ' + tone(x.profit_load), sgn(x.profit_load)),
        d.hypothetical ? cell('num muted', 'N/A') : cell('num ' + tone(x.ppm), sgn(x.ppm)));
      box.appendChild(r);
    });
    box.appendChild(el('div', 'muted hint', 'Trips start at ' + locName(d.origin_id) + ', where the goods are. Sorted by profit per minute. Snapshot: prices change while you fly.'));
    return close();
  }
  const where = dd.kind === 'storage' ? ' stored at ' + locName(d.location_id) : '';
  box.appendChild(el('div', '', 'Selling your ' + whole(d.quantity) + ' ' + d.name + where + (d.cost_known ? ' (paid ' + money(d.avg_cost) + ' each).' : '. Cost unknown, so the figures show income, not profit.')));
  if (!d.rows.length) { box.appendChild(el('div', 'muted', 'No place trades this good.')); return close(); }
  hd.append(el('span', '', 'Destination'), el('span', 'num', 'Sells'), el('span', 'num', 'Each'), el('span', 'num', 'For ' + whole(d.quantity)), el('span', 'num', 'Per min'));
  box.appendChild(hd);
  d.rows.forEach(x => {
    const r = el('div', 'rrow');
    r.append(
      cell('', x.is_here ? x.name + ' (here)' : x.name, x.is_here ? 'no travel' : 'ETA ' + fmt(x.eta_real_minutes * 60) + (x.sun_danger ? ' (near the Sun!)' : '')),
      cell('num', money(x.sell_price), 'stock ' + whole(x.stock)),
      cell('num ' + tone(x.profit_each), sgn(x.profit_each)),
      cell('num ' + tone(x.profit_total), sgn(x.profit_total)),
      x.is_here ? cell('num muted', 'now') : cell('num ' + tone(x.ppm), sgn(x.ppm)));
    box.appendChild(r);
  });
  box.appendChild(el('div', 'muted hint', 'Trips start at ' + locName(d.location_id) + ', where the goods are. ' + (d.remote ? 'Your ship is not there, so selling there right now adds the remote fee. ' : '') + 'Snapshot: prices change while you fly.'));
  return close();
}

// long press (half a second) or double-tap on a row opens its destinations list; a single tap selects it
function wireRow(r, key, o) {
  let tm = null, sx = 0, sy = 0;
  const stop = () => clearTimeout(tm);
  r.addEventListener('contextmenu', e => e.preventDefault());
  r.addEventListener('pointerdown', e => {
    longFired = false; sx = e.clientX; sy = e.clientY; stop();
    tm = setTimeout(() => { longFired = true; o.open(); }, 500);
  });
  r.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) stop(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => r.addEventListener(n, stop));
  r.onclick = () => {
    if (longFired) { longFired = false; return; }
    const now = Date.now();
    if (lastTap.id === key && now - lastTap.t < 450) {
      lastTap = { id: null, t: 0 };
      if (o.isOpen()) o.close(); else o.open();
      return;
    }
    lastTap = { id: key, t: now };
    o.tap();
  };
}
function toggleSel(loc, kind, good) { msel = isSel(loc, kind, good) ? null : { loc, kind, good }; mEdited = false; drawMarket(); }

/* ---- the quantity pop-up: built ONCE and moved under the selected row on every redraw, so a number you are typing survives.
   While the box has focus, redraws wait until you leave it. ---- */
const isTyping = () => !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('qin'));
function qtyOf(inp) { const v = inp.value; if (v === '') return NaN; const q = Number(v); return Number.isInteger(q) && q >= 0 ? q : NaN; }
const pop = (() => {
  const root = el('div', 'pop'), left = el('div', 'popl'), right = el('div', 'popr');
  const title = el('div', 'poptitle'), row = el('div', 'poprow'), brow = el('div', 'poprow');
  const inp = document.createElement('input');
  inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '0'; inp.step = '1'; inp.className = 'qin'; inp.setAttribute('aria-label', 'Quantity');
  const b1 = el('button', '', ''), b2 = el('button', 'alt', '');
  const chips = el('div', 'chips'), info = el('div', 'popinfo');
  row.append(inp, chips);            // top right: the number box and its quick buttons
  brow.append(b1, b2);               // under them: the Buy / Sell / Load buttons
  left.append(title, info);          // left: what you are doing + the explanation lines
  right.append(row, brow);
  root.append(left, right);
  inp.addEventListener('input', () => { mEdited = true; refreshPop(); });
  inp.addEventListener('blur', () => setTimeout(() => { if (mRedraw && !isTyping()) { mRedraw = false; drawMarket(); } }, 350));
  b1.onclick = () => doAct('main'); b2.onclick = () => doAct('second');
  return { root, title, inp, b1, b2, chips, info };
})();
function addChip(label, fn) { const b = el('button', 'alt', label); b.onclick = fn; pop.chips.appendChild(b); }
function refreshPop() {
  const it = curItem(), d = curData(); if (!it || !d) return;
  const q = qtyOf(pop.inp), bad = isNaN(q) || q < 1, p = pop;
  p.info.replaceChildren();
  if (isNaN(q)) p.info.appendChild(el('div', '', 'Enter a whole number (0 or more).'));
  if (msel.kind === 'goods') {
    const dest = buyDest(d), max = maxBuy(d, it);
    p.b1.textContent = 'Buy'; p.b1.disabled = bad || mbusy;
    p.b2.textContent = 'To: ' + (dest === 'hold' ? 'Hold' : 'Storage'); p.b2.disabled = mbusy || !d.here;
    if (!isNaN(q)) p.info.appendChild(el('div', '', 'Buy ' + whole(q) + ' ' + it.name + ': about ' + money(q * it.buy_price) + (dest === 'hold' ? ' (hold space free: ' + r2(Math.max(0, d.hold_size - d.hold_used)) + ')' : '')));
    p.info.appendChild(el('div', 'muted', 'Goes into ' + (dest === 'hold' ? 'your hold.' : 'your storage at ' + d.location_name + '.') + (d.here ? '' : ' Hold needs your ship docked here.')));
    if (max === 0) p.info.appendChild(el('div', 'muted', 'You cannot buy any right now: ' + buyBlockReason(d, it).toLowerCase() + '.'));
    return;
  }
  const sells = it.sell_here != null, cargo = msel.kind === 'cargo';
  p.b1.textContent = 'Sell'; p.b1.disabled = bad || !sells || q > it.quantity || mbusy;
  if (cargo) { p.b2.textContent = 'Unload'; p.b2.disabled = bad || q > it.quantity || mbusy; }
  else { p.b2.textContent = 'Load'; p.b2.disabled = bad || !d.here || q > it.quantity || q > maxLoad(d, it) || mbusy; }
  if (!sells) p.info.appendChild(el('div', 'muted', 'This place does not buy that.'));
  else if (!isNaN(q)) p.info.appendChild(el('div', '', 'Sell ' + whole(q) + ' ' + it.name + ': about ' + money(q * it.sell_here) + ' (you have ' + whole(it.quantity) + ')'));
  if (cargo) p.info.appendChild(el('div', 'muted', 'Unload moves it into your storage here.'));
  else p.info.appendChild(el('div', 'muted', d.here ? 'Load moves it into your hold (room for ' + whole(maxLoad(d, it)) + ').' : 'Load needs your ship docked here.'));
  if (!isNaN(q) && q > it.quantity) p.info.appendChild(el('div', 'err', 'You only have ' + whole(it.quantity) + '.'));
}
function placePop(d, kind, it) {
  const p = pop;
  p.title.textContent = (kind === 'goods' ? 'Buy ' : kind === 'cargo' ? 'Cargo: ' : 'Stored: ') + it.name;
  if (!mEdited) p.inp.value = kind === 'goods' ? maxBuy(d, it) : it.quantity;
  p.chips.replaceChildren();
  addChip('1', () => { p.inp.value = 1; mEdited = true; refreshPop(); });
  addChip('10', () => { p.inp.value = 10; mEdited = true; refreshPop(); });
  if (kind === 'storage') addChip('Full', () => { mEdited = true; p.inp.value = maxLoad(d, it); refreshPop(); });   // as much as fits the empty hold space
  addChip(kind === 'goods' ? 'Max' : 'All', () => { mEdited = false; p.inp.value = kind === 'goods' ? maxBuy(d, it) : it.quantity; refreshPop(); });
  refreshPop();
  return p.root;
}

/* ---- drawing ---- */
function drawLocBox() {
  const s = $('mloc'), ids = placeIds(), dl = dockedAt();
  const opts = [['ALL', 'All locations'], ...ids.map(id => [id, locName(id) + (dl === id ? ' (ship here)' : '')])];
  const sig = opts.map(o => o.join('|')).join(';');
  if (s.dataset.sig !== sig) {
    s.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }));
    s.dataset.sig = sig;
  }
  if (s.value !== mloc && document.activeElement !== s) s.value = mloc;
}
function section(parent, loc, key, title, count, btn, drawBody) {
  const k = loc + ':' + key, open = secOpen[k] !== false;
  const box = el('div', 'msec'), h = el('div', 'sech');
  h.appendChild(el('span', '', (open ? ARROW_OPEN : ARROW_SHUT) + title + ' (' + count + ')'));
  if (btn) h.appendChild(btn);
  h.onclick = e => { if (e.target.tagName === 'BUTTON') return; secOpen[k] = !open; drawMarket(); };
  box.appendChild(h);
  if (open) drawBody(box);
  parent.appendChild(box);
}
function stackRow(box, d, loc, kind, x, cb) {
  const sel = isSel(loc, kind, x.good_id);
  const r = el('div', 'row' + (sel ? ' sel' : ''));
  const left = cell('', whole(x.quantity) + ' x ' + x.name, x.avg_cost != null ? 'paid ' + money(x.avg_cost) + ' each' : 'cost unknown');
  if (cb && cb.best) {
    const b = cb.best, inc = cb.cost_known ? '' : ' income';
    left.appendChild(el('span', 'sub ' + tone(b.is_here ? b.profit_total : b.ppm), b.is_here
      ? 'Best: sell here, ' + sgn(b.profit_total) + inc
      : 'Best: ' + b.name + ' (' + fmt(b.eta_real_minutes * 60) + '), ' + sgn(b.profit_total) + inc + ', ' + sgn(b.ppm) + '/min' + (b.sun_danger ? ' near the Sun!' : '')));
  } else if (cb) left.appendChild(el('span', 'sub muted', 'No place buys this.'));
  const right = el('span', 'num');
  if (x.sell_here == null) right.appendChild(el('span', 'muted', 'not sold here'));
  else {
    right.appendChild(el('span', 'get', 'sells here for ' + money(x.sell_here)));
    if (x.profit_each != null) right.appendChild(el('span', 'sub ' + tone(x.profit_each), sgn(x.profit_each) + ' each, ' + sgn(x.profit_total) + ' for ' + whole(x.quantity)));
  }
  r.append(left, right);
  wireRow(r, kind + ':' + loc + ':' + x.good_id, { open: () => openDD(loc, kind, x.good_id), close: closeDD, isOpen: () => isDD(loc, kind, x.good_id), tap: () => toggleSel(loc, kind, x.good_id) });
  box.appendChild(r);
  if (sel) box.appendChild(placePop(d, kind, x));
  if (isDD(loc, kind, x.good_id)) box.appendChild(ddBox());
}
function drawLoc(parent, loc) {
  const c = mc[loc];
  if (!c || !c.d) { parent.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const d = c.d, cargo = d.cargo || [], stored = d.storage || [], goods = d.goods || [];
  if (!d.here && d.remote_fee > 0) parent.appendChild(el('div', 'muted hint pad', 'Your ship is not docked here, so trades at this market carry an extra ' + Math.round(d.remote_fee * 100) + '% fee. Prices below include it.'));
  if (d.here) {
    const ub = el('button', 'alt', 'Unload all'); ub.disabled = mbusy || !cargo.length; ub.onclick = doUnloadAll;
    section(parent, loc, 'cargo', 'Cargo, hold ' + r2(d.hold_used) + ' / ' + r2(d.hold_size), cargo.length, ub, box => {
      if (!cargo.length) box.appendChild(el('div', 'muted pad', 'Empty'));
      cargo.forEach(x => stackRow(box, d, loc, 'cargo', x, c.bestCg && c.bestCg[x.good_id]));
    });
  }
  section(parent, loc, 'storage', 'Stored here', stored.length, null, box => {
    if (!stored.length) box.appendChild(el('div', 'muted pad', 'Nothing of yours is stored here.'));
    stored.forEach(x => stackRow(box, d, loc, 'storage', x, c.bestSt && c.bestSt[x.good_id]));
  });
  section(parent, loc, 'goods', 'For sale', goods.length, null, box => {
    if (!goods.length) { box.appendChild(el('div', 'muted pad', 'Nothing is traded here.')); return; }
    const hd = el('div', 'mhead'); hd.append(el('span', '', 'Good'), el('span', 'num', 'Buy for'), el('span', 'num', 'Sell at'), el('span', 'num', 'Stock'));
    box.appendChild(hd);
    goods.forEach(g => {
      const sel = isSel(loc, 'goods', g.good_id);
      const r = el('div', 'mrow' + (sel ? ' sel' : ''));
      r.append(cell('', g.name, 'per ' + g.unit), cell('num pay', money(g.buy_price)), cell('num get', money(g.sell_price)), cell('num', whole(g.stock), 'target ' + whole(g.target_stock)));
      wireRow(r, 'goods:' + loc + ':' + g.good_id, { open: () => openDD(loc, 'goods', g.good_id), close: closeDD, isOpen: () => isDD(loc, 'goods', g.good_id), tap: () => toggleSel(loc, 'goods', g.good_id) });
      box.appendChild(r);
      if (sel) box.appendChild(placePop(d, 'goods', g));
      if (isDD(loc, 'goods', g.good_id)) box.appendChild(ddBox());
    });
  });
}
function drawMarket() {
  if (isTyping()) { mRedraw = true; return; }
  mRedraw = false;
  if (!mloc) return;
  const body = $('mbody'); body.replaceChildren();
  drawLocBox();
  $('minfo').textContent = 'Credits ' + money((S.last && S.last.character) ? S.last.character.credits : 0) + (hold ? '   |   Hold ' + r2(hold.used) + ' / ' + r2(hold.size) : '');
  if (msel && curData() && !curItem()) { msel = null; mEdited = false; }
  if (dd && mc[dd.loc] && mc[dd.loc].d) {
    const d = mc[dd.loc].d, list = dd.kind === 'goods' ? d.goods : dd.kind === 'cargo' ? d.cargo : d.storage;
    if (!(list || []).some(x => x.good_id === dd.good)) dd = null;
  }
  if (mloc === 'ALL') {
    const ids = placeIds();
    if (!ids.length) body.appendChild(el('div', 'muted pad', 'Nothing yet.'));
    ids.forEach(id => {
      const open = !!openLocs[id], n = ((stAll && stAll.items) || []).filter(i => i.location_id === id).length;
      const g = el('div', 'locg');
      g.append(el('span', '', (open ? ARROW_OPEN : ARROW_SHUT) + locName(id) + (dockedAt() === id ? ' (ship here)' : '')), el('span', 'muted', n ? n + ' stored' : ''));
      g.onclick = () => { openLocs[id] = !open; if (!open) loadLoc(id); drawMarket(); };
      body.appendChild(g);
      if (open) { const inner = el('div', 'locbody'); drawLoc(inner, id); body.appendChild(inner); }
    });
  } else drawLoc(body, mloc);
}

/* ---- actions ---- */
function marketError(e) {
  const d = e.data || {}, m = e.message;
  if (m === 'not_enough_hold') return 'Not enough room in the hold (free ' + r2(d.hold_free || 0) + ', needed ' + r2(d.hold_needed || 0) + ').';
  if (m === 'not_enough_credits') return 'Not enough credits (cost ' + money(d.cost || 0) + ', you have ' + money(d.credits || 0) + ').';
  if (m === 'not_enough_stock') return 'The market only has ' + whole(d.available || 0) + ' available.';
  if (m === 'not_enough_cargo') return 'You only have ' + (d.have || 0) + ' in the hold.';
  if (m === 'not_enough_stored') return 'You only have ' + (d.have || 0) + ' stored there.';
  if (m === 'not_docked' || m === 'not_docked_here') return 'Your ship must be docked at this place for that.';
  if (m === 'no_market') return 'This place does not trade that.';
  if (m === 'bad_quantity') return 'Enter a whole number of 1 or more.';
  if (m === 'server_error') return 'Server error. Has migration 011 been run in the SQL editor?';
  return 'Error: ' + m;
}
async function doAct(which) {
  if (mbusy || !msel) return;
  const it = curItem(), d = curData(); if (!it || !d) return;
  if (msel.kind === 'goods' && which === 'second') { buyTo = buyTo === 'hold' ? 'storage' : 'hold'; LS.set('pvs_buyto', buyTo); mEdited = false; drawMarket(); return; }
  const q = qtyOf(pop.inp); if (!(q >= 1)) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const s = { ...msel }, nm = it.name;
  let action, args, okText;
  if (s.kind === 'goods') {
    const dest = buyDest(d);
    action = 'trade_at'; args = { location: s.loc, kind: 'buy', good: s.good, quantity: q, stack: dest === 'hold' ? 'cargo' : 'storage' };   // the server calls the hold 'cargo'
    okText = r => 'Bought ' + q + ' ' + nm + ' for ' + money(r.total) + ' (' + money(r.unit_price) + ' each) into ' + (dest === 'hold' ? 'the hold.' : 'storage at ' + d.location_name + '.');
  } else if (which === 'main') {
    action = 'trade_at'; args = { location: s.loc, kind: 'sell', good: s.good, quantity: q, stack: s.kind === 'cargo' ? 'cargo' : 'storage' };
    okText = r => 'Sold ' + q + ' ' + nm + ' for ' + money(r.total) + ' (' + money(r.unit_price) + ' each).';
  } else if (s.kind === 'cargo') {
    action = 'unload'; args = { good: s.good, quantity: q }; okText = () => 'Unloaded ' + q + ' ' + nm + ' into storage.';
  } else {
    action = 'load'; args = { good: s.good, quantity: q }; okText = () => 'Loaded ' + q + ' ' + nm + ' into the hold.';
  }
  mbusy = true; refreshPop(); drawMarket();
  try { const r = await call(action, args); say(okText(r), 'ok'); }
  catch (e) { say(marketError(e), 'err'); }
  finally { mbusy = false; mEdited = false; mRedraw = false; refreshMarket(); }
}
async function doUnloadAll() {
  if (mbusy) return;
  mbusy = true; drawMarket();
  try { const r = await call('unload_all'); say(r.units_moved ? 'Unloaded ' + r.goods_moved + ' kinds of goods (' + whole(r.units_moved) + ' units) into storage.' : 'The hold is already empty.', 'ok'); }
  catch (e) { say(marketError(e), 'err'); }
  finally { mbusy = false; refreshMarket(); }
}

$('mloc').onchange = () => {
  mloc = $('mloc').value; msel = null; dd = null; mEdited = false;
  if (mloc === 'ALL') refreshMarket(); else { mAt = Date.now(); loadLoc(mloc); }
  drawMarket();
};
addScreen('market', 'Market', $('scr-market'), {
  onShow: () => { mdock = dockedAt(); if (!mloc) mloc = defaultLoc(); refreshMarket(); drawMarket(); },
  update: ship => {
    const dl = (ship && ship.state === 'docked') ? ship.location_id : null;
    if (dl) LS.set('pvs_lastdock', dl);
    let changed = false;
    if (dl !== mdock) { mdock = dl; changed = true; if (dl && mloc !== 'ALL') mloc = dl; }
    if (!mloc) { mloc = defaultLoc(); changed = true; }
    if (changed || Date.now() - mAt > 20000) refreshMarket();
  },
});

/* called by main.js on log out */
export function resetMarket() {
  mloc = null; mdock = undefined; msel = null; dd = null; stAll = null; hold = null;
  Object.keys(mc).forEach(k => delete mc[k]);
}
