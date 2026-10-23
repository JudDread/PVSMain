// market.js - the Market screen (goods in markets, in storage and in the hold). Display only: the server decides every trade.
import { S, $, say, call, fmt, curGd, locName, money, whole, r2, el, cell, sgn, tone, LS, addScreen, setShipLine, createPicker, qtyControl, SHIP_SVG } from 'core';
import { applyBackdrop } from 'backdrop';

const ARROW_OPEN = '\u25BE ', ARROW_SHUT = '\u25B8 ';

let mloc = null;            // chosen place: a location id, or 'ALL'
let mDockSeen;              // the place the ship was docked at when we last reset the page for a dock (null = in flight)
const selLoc = {};          // Produced / Consumed place selectors: 'place:section' -> chosen place id (missing = All)
const isRig = id => String(id || '').startsWith('rig_');   // rigs never show on the Market page
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
const frQty = {};            // freight board: contract id -> what is typed in its units box (survives redraws)
let haul = [];            // my active freight loads (freight_hauling), shown in the Cargo section when the ship is docked here
let frSel = null, frBusy = false;   // the selected freight row; an Accept is in progress
let frChain = Promise.resolve();    // freight calls go one after the other (the server settles freight on each call)
let buyTo = LS.get('pvs_buyto') === 'hold' ? 'hold' : 'storage';   // where bought goods go (remembered)

/* ---- For sale list: sorting (header buttons) and tight rows ---- */
const gSort = { col: 'name', dir: 1 };   // dir 1 = low to high / a to z, -1 = high to low / z to a
function pressSort(col) {
  if (gSort.col === col) gSort.dir = -gSort.dir;
  else { gSort.col = col; gSort.dir = col === 'name' ? 1 : -1; }   // Good starts a-z; numbers start high-to-low
  drawMarket();
}
function sortGoods(list) {
  const k = gSort.col, f = gSort.dir;
  return [...list].sort((a, b) => {
    if (k === 'name') return f * a.name.localeCompare(b.name);
    const d = (a[k] || 0) - (b[k] || 0);
    return d ? f * d : a.name.localeCompare(b.name);
  });
}
// compact spacing for the Market lists (written here because the page's own styles were not changed; !important so it wins)
(() => {
  const st = document.createElement('style');
  st.textContent = [
    '#mbody .mrow, #mbody .row { padding-top: 3px !important; padding-bottom: 3px !important; min-height: 0 !important; line-height: 1.2 !important; }',
    '#mbody .sub { line-height: 1.15 !important; }',
    '#mbody .sech { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 0 !important; line-height: 1.2 !important; }',
    '#mbody .sech button { padding: 2px 10px !important; min-height: 0 !important; }',
    '#mbody .mhead { padding-top: 2px !important; padding-bottom: 2px !important; min-height: 0 !important; }',
    '#mbody .mhead button { background: none !important; border: 0 !important; box-shadow: none !important; color: inherit; font: inherit; width: 100%; padding: 4px 0 !important; min-height: 0 !important; margin: 0 !important; text-align: left; white-space: nowrap; cursor: pointer; }',
    '#mbody .mhead .num button { text-align: right; }',
    '#mbody .msec + .msec { margin-top: 14px !important; }',
    '#mbody .sech button.ub { background: #e8b64a !important; color: #14100a !important; border: 0 !important; border-radius: 6px !important; font-weight: 700 !important; padding: 5px 14px !important; }',
    '#mbody .sech button.ub:disabled { opacity: .45; }',
    '#mbody .sech select { background: #192033 !important; color: #e3e9f7 !important; border: 1px solid #333d57 !important; border-radius: 6px !important; font: inherit; font-size: 13px !important; padding: 2px 6px !important; margin: 0 !important; width: auto !important; max-width: 48% !important; min-height: 0 !important; }',
    '.mpop { background: rgba(120,160,210,0.10); border: 1px solid rgba(120,160,210,0.35); border-radius: 8px; padding: 10px; margin: 4px 0 8px; }',
    '.mpop .mpinfo { margin-bottom: 8px; }',
    '.mpop .mi { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }',
    '.mpop .mi b { font-weight: 700; }',
    '.mpbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; }',
    '.mpbar > button { margin: 0; padding: 8px 14px; }',
    '.mcf { position: fixed; inset: 0; z-index: 9000; background: rgba(0,0,0,.65); display: flex; align-items: center; justify-content: center; padding: 16px; }',
    '.mcfbox { background: #131a2a; border: 1px solid #3a4666; border-radius: 10px; padding: 16px; max-width: 360px; width: 100%; box-sizing: border-box; }',
    '.mcft { font-weight: 700; font-size: 16px; margin-bottom: 10px; text-align: center; }',
    '.mcfb > div { margin-bottom: 8px; }',
    '.mcfr { display: flex; gap: 10px; justify-content: center; margin-top: 12px; }',
    '.mcfr button { margin: 0; padding: 8px 18px; min-width: 100px; }',
    '#mbody .sech { background: rgba(120,160,210,0.16) !important; border-top: 2px solid rgba(120,160,210,0.55) !important; border-bottom: 1px solid rgba(120,160,210,0.25) !important; font-weight: 600 !important; letter-spacing: 0.02em; }'
  ].join('\n');
  document.head.appendChild(st);
})();

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
  ((stAll && stAll.items) || []).filter(i => !isRig(i.good_id)).forEach(i => s.add(i.location_id));
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
    loadFreight(loc);
    if (d.here) loadHaul();
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
// the freight board for one place: contracts that start there (no good, no owner name: the server hides them from haulers)
function loadFreight(loc) {
  frChain = frChain.then(async () => {
    if (!S.sb) return;
    try { const r = await call('freight_board', { location: loc }); const c = mc[loc]; if (c) { c.fr = (r && r.items) || []; c.frErr = null; } }
    catch (e) { const c = mc[loc]; if (c) c.frErr = e.message; }
    drawMarket();
  });
  return frChain;
}
// my active freight loads: they take hold space, so the Cargo section lists them (one line per load)
function loadHaul() {
  frChain = frChain.then(async () => {
    if (!S.sb) return;
    try { const r = await call('freight_hauling'); haul = ((r && r.items) || []).filter(i => i.status === 'active'); }
    catch (e) { haul = []; }
    drawMarket();
  });
  return frChain;
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
// stock number, then stock as a percent of the node's TARGET stock (100% = base price; the price uses this) in brackets, with P: (this place produces) or C: (this place consumes) in front
function stockTag(x) {
  if (!(x.target_stock > 0)) return whole(x.stock);
  return whole(x.stock) + ' (' + (x.role === 'producer' ? 'P:' : x.role === 'consumer' ? 'C:' : '') + Math.round(100 * x.stock / x.target_stock) + '%)';
}
function ddBox() {
  const box = el('div', 'routes'), d = dd.data, md = mc[dd.loc] && mc[dd.loc].d;
  const close = () => box;   // no Close button: tap the row again to close (same as the buy/sell window)
  const GRID = 'display:grid;grid-template-columns:minmax(0,1.3fr) repeat(3,minmax(0,1fr));column-gap:10px;align-items:start';
  if (!d) { box.appendChild(el('div', 'muted', 'Loading destinations...')); return close(); }
  if (d.error) { box.appendChild(el('div', 'err', d.error === 'no_market' ? 'This place does not trade that.' : 'Could not load: ' + d.error)); return close(); }
  if (d.docked === false && dd.kind === 'cargo') { box.appendChild(el('div', 'muted', 'Dock somewhere to compare destinations.')); return close(); }
  const hd = el('div', 'rhead'); hd.style.cssText = GRID;
  if (dd.kind === 'goods') {
    const g = md && (md.goods || []).find(x => x.good_id === dd.good);
    const why = d.hypothetical && md ? buyBlockReason(md, g) : null;
    if (d.hypothetical) box.appendChild(el('div', 'muted', (why === 'Hold full' ? 'Your hold is full' : why === 'Low funds' ? 'You cannot afford any' : 'None in stock here') + ', so the per-minute column shows N/A.'));
    if (!d.rows.length) { box.appendChild(el('div', 'muted', 'No other place trades this good.')); return close(); }
    hd.append(el('span', '', 'Destination'), el('span', 'num', g && g.role === 'consumer' ? 'Buy from' : 'Sells to'), el('span', 'num', 'Each'), el('span', 'num', 'Per min'));
    box.appendChild(hd);
    d.rows.forEach(x => {
      const r = el('div', 'rrow'); r.style.cssText = GRID;
      r.append(
        cell('', x.name, 'ETA ' + fmt(x.eta_real_minutes * 60) + (x.sun_danger ? ' (near the Sun!)' : '')),
        cell('num', money(x.sell_price), stockTag(x)),
        cell('num ' + tone(x.profit_each), sgn(x.profit_each)),
        d.hypothetical ? cell('num muted', 'N/A') : cell('num ' + tone(x.ppm), sgn(x.ppm)));
      box.appendChild(r);
    });
    box.appendChild(el('div', 'muted hint', 'Trips start at ' + locName(d.origin_id) + ', where the goods are. Sorted by profit per minute. Snapshot: prices change while you fly.'));
    return close();
  }
  if (!d.rows.length) { box.appendChild(el('div', 'muted', 'No place trades this good.')); return close(); }
  hd.append(el('span', '', 'Destination'), el('span', 'num', 'Sells to'), el('span', 'num', 'Each'), el('span', 'num', 'Per min'));
  box.appendChild(hd);
  d.rows.forEach(x => {
    const r = el('div', 'rrow'); r.style.cssText = GRID;
    r.append(
      cell('', x.is_here ? x.name + ' (here)' : x.name, x.is_here ? 'no travel' : 'ETA ' + fmt(x.eta_real_minutes * 60) + (x.sun_danger ? ' (near the Sun!)' : '')),
      cell('num', money(x.sell_price), stockTag(x)),
      cell('num ' + tone(x.profit_each), sgn(x.profit_each)),
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
function toggleSel(loc, kind, good) { if (isDD(loc, kind, good)) { dd = null; msel = null; mEdited = false; drawMarket(); return; } msel = isSel(loc, kind, good) ? null : { loc, kind, good }; mEdited = false; drawMarket(); }

/* ---- the quantity pop-up: built ONCE and moved under the selected row on every redraw, so a number you are typing survives.
   While the box has focus, redraws wait until you leave it. ---- */
const isTyping = () => { const a = document.activeElement; return !!(a && ((a.classList && a.classList.contains('qin')) || a.tagName === 'SELECT')); };
function qtyOf(inp) { const v = inp.value; if (v === '') return NaN; const q = Number(v); return Number.isInteger(q) && q >= 0 ? q : NaN; }
// the biggest number the box may hold: buying = the server's maximum; selling / loading = what you have
function popMax() {
  const it = curItem(); if (!it || !msel) return 0;
  if (msel.kind === 'goods') { const mq = quotes[qKey(0)]; return mq && mq.d && mq.d.ok ? mq.d.max_quantity : 0; }
  return it.quantity;
}
const pop = (() => {
  const root = el('div', 'mpop'), info = el('div', 'mpinfo'), bar = el('div', 'mpbar');
  const q = qtyControl({
    steps: [1, 10], getMax: popMax, inputClass: 'qin',
    onChange: () => { mEdited = true; refreshPop(); },
    extras: [['full', () => { const it = curItem(), d = curData(); return it && d ? maxLoad(d, it) : 0; }]],   // storage only: as much as fits the free hold space
  });
  const inp = q.input, b1 = el('button', '', ''), b2 = el('button', 'alt', '');
  b1.type = 'button'; b2.type = 'button';
  bar.append(q.root, b1, b2);        // one row: the number box with its buttons, then Buy / Sell, then the other button
  root.append(info, bar);
  inp.addEventListener('blur', () => setTimeout(() => { if (mRedraw && !isTyping()) { mRedraw = false; drawMarket(); } }, 350));
  b1.onclick = () => doAct('main'); b2.onclick = () => doAct('second');
  return { root, inp, q, b1, b2, info };
})();
/* ---- server quotes: the exact price of an order and the real maximum come from the server ('quote'), never from the page.
   A quote with quantity 0 = "just tell me the most I can do". Answers are kept 15 s; typing waits 300 ms before asking. ---- */
const quotes = {};                      // key -> { d: answer | null, err, at }
const qBusy = {};
let qTimer = null, qTimerKey = null;
const qKind = () => msel.kind === 'goods' ? 'buy' : 'sell';
const qStack = d => msel.kind === 'goods' ? (buyDest(d) === 'hold' ? 'cargo' : 'storage') : (msel.kind === 'cargo' ? 'cargo' : 'storage');
const qKey = q => { const d = curData(); return d && msel ? [msel.loc, qKind(), msel.good, qStack(d), q].join('|') : ''; };
function wantQuote(q) {
  const d = curData(); if (!msel || !d) return null;
  const key = qKey(q), have = quotes[key];
  if (have && Date.now() - have.at <= 15000) return have;
  if (qBusy[key] || qTimerKey === key) return have || null;
  const args = { location: msel.loc, kind: qKind(), good: msel.good, quantity: q, stack: qStack(d) };
  if (q === 0) { qBusy[key] = true; fetchQuote(key, args); }
  else { clearTimeout(qTimer); qTimerKey = key; qTimer = setTimeout(() => { qTimerKey = null; qBusy[key] = true; fetchQuote(key, args); }, have ? 0 : 300); }
  return have || null;
}
async function fetchQuote(key, args) {
  let rec;
  try { rec = { d: await call('quote', args), at: Date.now() }; }
  catch (e) { rec = { d: null, err: e, at: Date.now() }; }
  qBusy[key] = false; quotes[key] = rec;
  refreshConfirm();
  if (!msel || !curData()) return;
  // the maximum has arrived and you have not typed your own number: fill it in
  if (msel.kind === 'goods' && !mEdited && !isTyping() && key === qKey(0) && rec.d && rec.d.ok) pop.inp.value = rec.d.max_quantity;
  refreshPop();
}
const clearQuotes = () => { Object.keys(quotes).forEach(k => delete quotes[k]); };
function problemText(qd) {
  const r = qd.d, p = r.problem;
  if (p === 'not_enough_stock') return 'The market only has ' + whole(Math.floor(r.stock)) + '.';
  if (p === 'not_enough_hold') return 'Not enough free hold space.';
  if (p === 'not_enough_credits') return 'Not enough credits: this costs ' + money(r.total) + '.';
  if (p === 'not_enough_cargo' || p === 'not_enough_stored') return 'You do not have that many.';
  return 'This cannot be done right now.';
}
// two labelled numbers from the server's quote: the whole order and the average price of one item
function infoRow(label, value) { const r = el('div', 'mi'); r.append(el('span', '', label), el('b', '', value)); return r; }
function priceRows(info, qd) {
  if (qd && qd.d && qd.d.ok) { info.appendChild(infoRow('Total price', money(qd.d.total))); info.appendChild(infoRow('Price each (average)', money(qd.d.unit_price))); }
  else if (qd && qd.err) info.appendChild(el('div', 'muted', 'Could not get the exact price: ' + marketError(qd.err)));
  else info.appendChild(el('div', 'muted', 'Checking the price...'));
}
function refreshPop() {
  const it = curItem(), d = curData(); if (!it || !d) return;
  const q = qtyOf(pop.inp), bad = isNaN(q) || q < 1, p = pop;
  p.info.replaceChildren();
  if (msel.kind === 'goods') {
    const dest = buyDest(d), mq = wantQuote(0);
    p.b1.textContent = 'Buy'; p.b1.disabled = bad || mbusy;
    p.b2.textContent = 'To: ' + (dest === 'hold' ? 'Hold' : 'Storage'); p.b2.disabled = mbusy || !d.here;
    if (isNaN(q)) p.info.appendChild(el('div', 'muted', !mEdited ? 'Checking the most you can buy...' : 'Enter a whole number.'));
    else if (q >= 1) {
      const qd = wantQuote(q); priceRows(p.info, qd);
      if (qd && qd.d && qd.d.ok && qd.d.problem) p.info.appendChild(el('div', 'err', problemText(qd)));
      if (qd && qd.d && qd.d.can_do === false) p.b1.disabled = true;
    }
    if (mq && mq.d && mq.d.ok && mq.d.max_quantity === 0) p.info.appendChild(el('div', 'err', 'You cannot buy any right now: ' + ({ stock: 'sold out', credits: 'low funds', hold: 'hold full' }[mq.d.limit] || 'not available') + '.'));
    return;
  }
  const sells = it.sell_here != null, cargo = msel.kind === 'cargo';
  p.b1.textContent = 'Sell'; p.b1.disabled = bad || !sells || q > it.quantity || mbusy;
  if (cargo) { p.b2.textContent = 'Unload'; p.b2.disabled = bad || q > it.quantity || mbusy; }
  else { p.b2.textContent = 'Load'; p.b2.disabled = bad || !d.here || q > it.quantity || q > maxLoad(d, it) || mbusy; }
  if (isNaN(q)) p.info.appendChild(el('div', 'muted', 'Enter a whole number.'));
  if (!sells) p.info.appendChild(el('div', 'muted', 'This place does not buy that.'));
  else if (!isNaN(q) && q >= 1 && q <= it.quantity) {
    const qd = wantQuote(q); priceRows(p.info, qd);
    if (qd && qd.d && qd.d.ok && qd.d.problem) p.info.appendChild(el('div', 'err', problemText(qd)));
  }
  if (!isNaN(q) && q > it.quantity) p.info.appendChild(el('div', 'err', 'You only have ' + whole(it.quantity) + '.'));
}
function placePop(d, kind, it) {
  const p = pop;
  if (!mEdited) { if (kind === 'goods') { const mq = quotes[qKey(0)]; p.inp.value = mq && mq.d && mq.d.ok ? mq.d.max_quantity : ''; } else p.inp.value = it.quantity; }
  p.q.extras[0].hidden = kind !== 'storage';
  refreshPop();
  return p.root;
}

/* ---- the confirmation box for a buy or a sell: shows the numbers the server quoted, then Cancel / Confirm ---- */
let cfSnap = null, cfEls = null;
function cfBuild() {
  if (cfEls) return cfEls;
  const ov = el('div', 'mcf'), box = el('div', 'mcfbox'), title = el('div', 'mcft'), body = el('div', 'mcfb'), row = el('div', 'mcfr');
  const no = el('button', 'alt', 'Cancel'), yes = el('button', '', 'Confirm');
  no.type = 'button'; yes.type = 'button';
  row.append(no, yes); box.append(title, body, row); ov.appendChild(box); ov.hidden = true; document.body.appendChild(ov);
  no.onclick = closeConfirm;
  ov.addEventListener('pointerdown', e => { if (e.target === ov) closeConfirm(); });
  yes.onclick = () => { if (!cfSnap || mbusy) return; const qq = quotes[cfSnap.key], s = { ...cfSnap, expect: qq && qq.d ? Number(qq.d.total) : null }; closeConfirm(); runTrade(s); };
  cfEls = { ov, title, body, yes };
  return cfEls;
}
function closeConfirm() { cfSnap = null; if (cfEls) cfEls.ov.hidden = true; }
function openConfirm() {
  const it = curItem(), d = curData(); if (!it || !d || mbusy || !msel) return;
  const q = qtyOf(pop.inp); if (!(q >= 1)) return;
  const buy = msel.kind === 'goods', dest = buy ? buyDest(d) : null;
  cfSnap = { loc: msel.loc, kind: msel.kind, good: msel.good, name: it.name, q, buy, dest, avg: it.avg_cost, place: d.location_name, key: qKey(q) };
  cfBuild().ov.hidden = false;
  wantQuote(q);
  refreshConfirm();
}
function refreshConfirm() {
  if (!cfSnap || !cfEls || cfEls.ov.hidden) return;
  const s = cfSnap, c = cfEls, qd = quotes[s.key];
  c.title.textContent = s.buy ? 'Confirm purchase' : 'Confirm sale';
  c.body.replaceChildren();
  let ready = false;
  if (qd && qd.d && qd.d.ok && !qd.d.problem && qd.d.can_do !== false) {
    ready = true;
    const r = qd.d;
    c.body.appendChild(el('div', '', 'You will ' + (s.buy ? 'buy ' : 'sell ') + whole(s.q) + ' ' + s.name + ' for ' + money(r.total) + ' in total, ' + money(r.unit_price) + ' each on average.'));
    if (s.buy) c.body.appendChild(el('div', 'muted', s.dest === 'hold' ? 'They go into your hold.' : 'They go into storage at ' + s.place + '.'));
    else if (s.avg != null) { const each = r.unit_price - s.avg; c.body.appendChild(el('div', tone(each), 'You paid ' + money(s.avg) + ' each, so you make ' + sgn(each) + ' per item (' + sgn(each * s.q) + ' in total).')); }
    else c.body.appendChild(el('div', 'muted', 'Your cost is unknown, so the profit cannot be shown.'));
  } else if (qd && qd.d && qd.d.ok) c.body.appendChild(el('div', 'err', problemText(qd)));
  else if (qd && qd.err) c.body.appendChild(el('div', 'err', 'Could not get the exact price: ' + marketError(qd.err)));
  else c.body.appendChild(el('div', 'muted', 'Checking the price...'));
  c.yes.disabled = !ready || mbusy;
}

/* ---- drawing ---- */
function drawLocBox() {
  const ids = placeIds(), dl = dockedAt();
  mpick.set([['ALL', 'All locations'], ...ids.map(id => [id, locName(id), dl === id ? '@ship here' : ''])], mloc);
  applyBackdrop(mpick.btn, mloc);       /* the picture behind the box follows the chosen place */
}
function section(parent, loc, key, title, count, btn, drawBody, defOpen) {
  const k = loc + ':' + key, open = secOpen[k] !== undefined ? secOpen[k] : defOpen !== false;   /* defOpen: how it starts until you tap it */
  const box = el('div', 'msec'), h = el('div', 'sech');
  h.appendChild(el('span', '', (open ? ARROW_OPEN : ARROW_SHUT) + title + ' (' + count + ')'));
  if (btn) h.appendChild(btn);
  h.onclick = e => { if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return; secOpen[k] = !open; drawMarket(); };
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
/* ---- freight board (bottom of a place): take a contract that starts here ---- */
const frFree = d => Math.max(0, d.hold_size - d.hold_used);
function frMax(d, x) {
  const byHold = x.hold_each > 0 ? Math.floor((frFree(d) + 1e-9) / x.hold_each) : x.units_open;
  return Math.max(0, Math.min(x.units_open, byHold));
}
function freightError(e) {
  const d = e.data || {}, m = e.message;
  if (m === 'contract_not_found' || m === 'not_open') return 'That contract is no longer open.';
  if (m === 'not_enough_units') return 'Only ' + whole(d.available || 0) + ' units are still open.';
  if (m === 'not_enough_hold') return 'Not enough room in the hold (free ' + r2(d.hold_free || 0) + ', needed ' + r2(d.hold_needed || 0) + ').';
  if (m === 'freight_limit') return 'Freight limit reached (limit ' + r2(d.limit || 0) + ', carrying ' + r2(d.carrying || 0) + ').';
  if (m === 'market_rep_too_low') return 'Your market reputation is too low for this contract (needed ' + r2(d.needed || 0) + ', you have ' + r2(d.have || 0) + ').';
  if (m === 'own_contract') return 'You cannot haul your own contract.';
  if (m === 'not_docked_here') return 'Your ship must be docked at this place to accept freight.';
  if (m === 'no_route') return 'No route to that destination can be planned right now.';
  if (m === 'no_ship') return 'You have no ship.';
  if (m === 'bad_quantity') return 'Enter a whole number of 1 or more.';
  return 'Error: ' + m;
}
function frPop(d, loc, x, scale) {
  const root = el('div', 'pop sell'), left = el('div', 'popl'), right = el('div', 'popr');
  const row = el('div', 'poprow'), brow = el('div', 'poprow'), info = el('div', 'popinfo');
  const max = frMax(d, x), win = fmt(x.window_days * 86400 / scale);
  if (frQty[x.contract_id] === undefined) frQty[x.contract_id] = String(max);
  const inp = document.createElement('input');
  inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '0'; inp.step = '1'; inp.className = 'qin'; inp.setAttribute('aria-label', 'Units to haul');
  inp.value = frQty[x.contract_id];
  const acc = el('button', '', 'Accept'), chips = el('div', 'chips');
  const upd = () => {
    const q = qtyOf(inp); info.replaceChildren();
    let why = null, soft = false;
    if (!d.here) { why = 'Your ship is not docked at ' + locName(loc) + ', so you cannot accept this here.'; soft = true; }
    else if (max < 1) why = 'Not enough free hold space (free ' + r2(frFree(d)) + ', each unit needs ' + r2(x.hold_each) + ').';
    else if (isNaN(q) || q < 1) why = 'Enter a whole number of 1 or more.';
    else if (q > x.units_open) why = 'Only ' + whole(x.units_open) + ' are open.';
    else if (q * x.hold_each > frFree(d) + 1e-9) why = 'Not enough free hold space: needs ' + r2(q * x.hold_each) + ', free ' + r2(frFree(d)) + '.';
    if (!isNaN(q) && q >= 1) info.appendChild(el('div', '', 'For ' + whole(q) + (x.hold_each > 1 ? ' (' + whole(q * x.hold_each) + ' CU)' : '') + ': ' + money(q * x.pay_per_unit) + ' on delivery, plus up to ' + money(q * x.bonus_max_per_cu) + ' bonus if early.'));
    info.appendChild(el('div', 'muted', 'Deliver within ' + win + ' of accepting. Late = the load fails. The bonus shrinks as time passes. Uses ' + r2(x.hold_each) + ' hold per unit.'));
    if (why) info.appendChild(el('div', soft ? 'muted' : 'err', why));
    acc.disabled = !!why || frBusy;
  };
  const chip = (label, fn) => { const b = el('button', 'alt', label); b.onclick = () => { fn(); frQty[x.contract_id] = inp.value; upd(); }; chips.appendChild(b); };
  chip('1', () => { inp.value = 1; }); chip('10', () => { inp.value = 10; }); chip('Max', () => { inp.value = max; });
  inp.addEventListener('input', () => { frQty[x.contract_id] = inp.value; upd(); });
  inp.addEventListener('blur', () => setTimeout(() => { if (mRedraw && !isTyping()) { mRedraw = false; drawMarket(); } }, 350));
  acc.onclick = async () => {
    const q = qtyOf(inp); if (frBusy || !(q >= 1)) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    frBusy = true; acc.disabled = true;
    try {
      const r = await call('freight_accept', { contract: x.contract_id, units: q });
      delete frQty[x.contract_id]; frSel = null;
      const left = r.deadline_t != null && curGd() != null ? (r.deadline_t - curGd()) * 86400 / scale : (r.window_days || x.window_days) * 86400 / scale;
      say('Accepted ' + whole(r.hold_used != null ? r.hold_used : r.units * (x.hold_each > 0 ? x.hold_each : 1)) + ' CU to ' + locName(r.dest_location) + '. Deliver within ' + fmt(left) + '.', 'ok');
    } catch (e) { say(freightError(e), 'err'); }
    finally { frBusy = false; mRedraw = false; clearQuotes(); refreshMarket(); }
  };
  row.append(inp, chips); brow.append(acc); left.append(info); right.append(row, brow); root.append(left, right);
  upd();
  return root;
}
function drawFreight(box, d, loc, items) {
  const scale = (S.last && S.last.scale) || 60;
  [...items].sort((a, b) => (b.pay_per_unit - a.pay_per_unit) || a.dest_name.localeCompare(b.dest_name)).forEach(x => {
    const sel = frSel === x.contract_id, he = x.hold_each > 0 ? Number(x.hold_each) : 1;   // he = CU of hold one unit takes (a rig = 10)
    const r = el('div', 'row' + (sel ? ' sel' : ''));
    r.append(
      cell('', 'To ' + x.dest_name + (x.mine ? ' (yours)' : ''), whole(x.units_open * he) + ' CU open, window ' + fmt(x.window_days * 86400 / scale)),
      cell('num get', money(x.pay_per_unit / he) + ' / CU', 'bonus up to ' + money(x.bonus_max_per_cu / he)));
    r.onclick = () => { frSel = sel ? null : x.contract_id; drawMarket(); };
    box.appendChild(r);
    if (sel) box.appendChild(frPop(d, loc, x, scale));
  });
}
/* the place selector in a Produced / Consumed header (right side). All = this place only; a place = only the goods that place trades,
   and the Best column shows that place's price, stock and percent of its node. */
function placeSelect(sk, P) {
  const s = document.createElement('select');
  s.setAttribute('aria-label', 'Show another place');
  const ids = placeIds(); if (P !== 'ALL' && !ids.includes(P)) ids.push(P);
  s.appendChild(new Option('All', 'ALL'));
  ids.forEach(id => s.appendChild(new Option(locName(id), id)));
  s.value = P;
  s.onclick = e => e.stopPropagation();
  s.onchange = () => { selLoc[sk] = s.value; s.blur(); if (s.value !== 'ALL' && !(mc[s.value] && mc[s.value].d)) loadLoc(s.value); drawMarket(); };
  s.addEventListener('blur', () => setTimeout(() => { if (mRedraw && !isTyping()) { mRedraw = false; drawMarket(); } }, 350));
  return s;
}
/* one list of goods with its sortable header. showBest: the 'Best' column = the other place with the best price
   (producer list: pays the most; consumer list: cheapest to buy). Touch a header to sort by it. */
function goodsSection(parent, loc, d, key, title, list, showBest) {
  const grid = showBest ? '' : '1fr 84px 84px 72px';   // without the Best column the old four columns
  const sk = loc + ':' + key, P = showBest ? (selLoc[sk] || 'ALL') : 'ALL';
  let rows = list, wait = false;
  if (P !== 'ALL') {
    const pd = mc[P] && mc[P].d;
    if (!pd) { wait = true; rows = []; if (!mLoading[P]) loadLoc(P); }
    else {
      const idx = {}; (pd.goods || []).forEach(o => { idx[o.good_id] = o; });
      // produced: what that place pays when you sell there; consumed: what it asks when you buy there
      rows = list.filter(g => idx[g.good_id]).map(g => { const o = idx[g.good_id]; return { ...g, best_name: locName(P), best_price: key === 'produced' ? o.sell_price : o.buy_price, pl_stock: o.stock, pl_base: o.target_stock }; });
    }
  }
  const selBox = showBest ? placeSelect(sk, P) : null;
  section(parent, loc, key, title, wait ? list.length : rows.length, selBox, box => {
    if (wait) { box.appendChild(el('div', 'muted pad', 'Loading ' + locName(P) + '...')); return; }
    const hd = el('div', 'mhead'); if (grid) hd.style.gridTemplateColumns = grid;
    const cols = [['name', 'Good', '']];
    if (showBest) cols.push(['best_price', 'Best', 'num']);
    cols.push(['buy_price', 'Buy for', 'num'], ['sell_price', 'Sell at', 'num'], ['stock', 'Stock', 'num']);
    cols.forEach(([col, label, cls]) => {
      const sp = el('span', cls), b = document.createElement('button');
      b.type = 'button'; b.textContent = label + (gSort.col === col ? (gSort.dir === 1 ? ' \u25B2' : ' \u25BC') : '');
      b.onclick = () => pressSort(col);
      sp.appendChild(b); hd.appendChild(sp);
    });
    box.appendChild(hd);
    if (!rows.length) box.appendChild(el('div', 'muted pad', 'Nothing in this list is traded at ' + locName(P) + '.'));
    sortGoods(rows).forEach(g => {
      const sel = isSel(loc, 'goods', g.good_id);
      const r = el('div', 'mrow' + (sel ? ' sel' : '')); if (grid) r.style.gridTemplateColumns = grid;
      const cells = [cell('', g.name)];
      if (showBest) {
        if (P !== 'ALL') cells.push(cell('num', money(g.best_price), whole(g.pl_stock) + (g.pl_base > 0 ? ' (' + Math.round(100 * g.pl_stock / g.pl_base) + '%)' : '')));
        else cells.push(g.best_name ? cell('num', g.best_name, money(g.best_price)) : cell('num muted', '-'));
      }
      cells.push(cell('num pay', money(g.buy_price)), cell('num get', money(g.sell_price)), cell('num', whole(g.stock), g.target_stock > 0 ? '(' + Math.round(100 * g.stock / g.target_stock) + '%)' : ''));
      r.append(...cells);
      wireRow(r, 'goods:' + loc + ':' + g.good_id, { open: () => openDD(loc, 'goods', g.good_id), close: closeDD, isOpen: () => isDD(loc, 'goods', g.good_id), tap: () => toggleSel(loc, 'goods', g.good_id) });
      box.appendChild(r);
      if (sel) box.appendChild(placePop(d, 'goods', g));
      if (isDD(loc, 'goods', g.good_id)) box.appendChild(ddBox());
    });
  });
}
function drawLoc(parent, loc) {
  const c = mc[loc];
  if (!c || !c.d) { parent.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const d = c.d, cargo = (d.cargo || []).filter(x => !isRig(x.good_id)), stored = (d.storage || []).filter(x => !isRig(x.good_id)), goods = (d.goods || []).filter(x => !isRig(x.good_id));
  if (!d.here && d.remote_fee > 0) parent.appendChild(el('div', 'muted hint pad', 'Your ship is not docked here, so trades at this market carry an extra ' + Math.round(d.remote_fee * 100) + '% fee. Prices below include it.'));
  if (d.here) {
    const ub = el('button', 'ub', 'Unload all'); ub.disabled = mbusy || !cargo.length; ub.onclick = doUnloadAll;
    const scl = (S.last && S.last.scale) || 60, gd = curGd();
    section(parent, loc, 'cargo', 'Cargo, hold ' + r2(d.hold_used) + ' / ' + r2(d.hold_size), cargo.length + haul.length, ub, box => {
      if (!cargo.length && !haul.length) box.appendChild(el('div', 'muted pad', 'Empty'));
      cargo.forEach(x => stackRow(box, d, loc, 'cargo', x, c.bestCg && c.bestCg[x.good_id]));
      haul.forEach(h => {
        const r = el('div', 'row'), left = h.deadline_t != null && gd != null ? (h.deadline_t - gd) * 86400 / scl : null;
        r.append(cell('', 'Freight to ' + (h.dest_name || locName(h.dest_location)), r2(h.hold_used) + ' CU in the hold'), cell('num', left != null ? fmt(left) : '', 'left'));
        box.appendChild(r);
      });
    }, cargo.length + haul.length > 0);   /* an empty hold starts folded */
  }
  section(parent, loc, 'storage', 'Stored here', stored.length, null, box => {
    if (!stored.length) box.appendChild(el('div', 'muted pad', 'Nothing of yours is stored here.'));
    stored.forEach(x => stackRow(box, d, loc, 'storage', x, c.bestSt && c.bestSt[x.good_id]));
  });
  /* goods: split by what this place does with them (role comes from the server, migration 036); without it: one plain list */
  const prod = goods.filter(g => g.role === 'producer'), cons = goods.filter(g => g.role === 'consumer');
  const rest = goods.filter(g => g.role !== 'producer' && g.role !== 'consumer');
  if (!goods.length) section(parent, loc, 'goods', 'For sale', 0, null, box => box.appendChild(el('div', 'muted pad', 'Nothing is traded here.')));
  if (prod.length) goodsSection(parent, loc, d, 'produced', 'Produced here', prod, true);
  if (cons.length) goodsSection(parent, loc, d, 'consumed', 'Consumed here', cons, true);
  if (rest.length) goodsSection(parent, loc, d, 'goods', 'For sale', rest, false);
  const fr = c.fr || [];
  if (fr.length) section(parent, loc, 'freight', 'Freight', fr.length, null, box => drawFreight(box, d, loc, fr));
  else if (c.frErr) parent.appendChild(el('div', 'muted hint pad', 'The freight board could not load: ' + c.frErr));
}
function drawMarket() {
  if (isTyping()) { mRedraw = true; return; }
  mRedraw = false;
  if (!mloc) return;
  const body = $('mbody'); body.replaceChildren();
  drawLocBox();
  if (msel && curData() && !curItem()) { msel = null; mEdited = false; }
  if (dd && mc[dd.loc] && mc[dd.loc].d) {
    const d = mc[dd.loc].d, list = dd.kind === 'goods' ? d.goods : dd.kind === 'cargo' ? d.cargo : d.storage;
    if (!(list || []).some(x => x.good_id === dd.good)) dd = null;
  }
  if (mloc === 'ALL') {
    const ids = placeIds();
    if (!ids.length) body.appendChild(el('div', 'muted pad', 'Nothing yet.'));
    ids.forEach(id => {
      const open = !!openLocs[id], n = ((stAll && stAll.items) || []).filter(i => i.location_id === id && !isRig(i.good_id)).length;
      const g = el('div', 'locg');
      const nm = el('span', '', (open ? ARROW_OPEN : ARROW_SHUT) + locName(id));
      if (dockedAt() === id) { const ic = el('span', 'lpship'); ic.innerHTML = SHIP_SVG; ic.title = 'ship here'; ic.style.verticalAlign = 'middle'; nm.append(' ', ic); }
      g.append(nm, el('span', 'muted', n ? n + ' stored' : ''));
      g.onclick = () => { openLocs[id] = !open; if (!open) loadLoc(id); drawMarket(); };
      body.appendChild(g);
      if (open) { const inner = el('div', 'locbody'); drawLoc(inner, id); body.appendChild(inner); }
    });
  } else drawLoc(body, mloc);
}

/* ---- actions ---- */
function marketError(e) {
  const d = e.data || {}, m = e.message;
  if (m === 'price_changed') return 'The price changed (it is now ' + money(d.now || 0) + ' in total, you saw ' + money(d.expected || 0) + '). Please check the new price and try again.';
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
// what a confirmed trade asks the server to do (one place, so the buy and sell arguments cannot drift apart)
function tradeArgs(s) {
  return s.buy
    ? { action: 'trade_at', args: { location: s.loc, kind: 'buy', good: s.good, quantity: s.q, stack: s.dest === 'hold' ? 'cargo' : 'storage', expect_total: s.expect } }   // the server calls the hold 'cargo'; expect_total = the price guard
    : { action: 'trade_at', args: { location: s.loc, kind: 'sell', good: s.good, quantity: s.q, stack: s.kind === 'cargo' ? 'cargo' : 'storage', expect_total: s.expect } };
}
async function execute(action, args, okText) {
  mbusy = true; refreshPop(); drawMarket();
  try { const r = await call(action, args); say(okText(r), 'ok'); }
  catch (e) { say(marketError(e), 'err'); }
  finally { mbusy = false; mEdited = false; mRedraw = false; clearQuotes(); refreshMarket(); }
}
function runTrade(s) {
  if (mbusy) return;
  const t = tradeArgs(s);
  execute(t.action, t.args, r => s.buy
    ? 'Bought ' + s.q + ' ' + s.name + ' for ' + money(r.total) + ' (' + money(r.unit_price) + ' each) into ' + (s.dest === 'hold' ? 'the hold.' : 'storage at ' + s.place + '.')
    : 'Sold ' + s.q + ' ' + s.name + ' for ' + money(r.total) + ' (' + money(r.unit_price) + ' each).');
}
async function doAct(which) {
  if (mbusy || !msel) return;
  const it = curItem(), d = curData(); if (!it || !d) return;
  if (msel.kind === 'goods' && which === 'second') { buyTo = buyTo === 'hold' ? 'storage' : 'hold'; LS.set('pvs_buyto', buyTo); mEdited = false; drawMarket(); return; }
  const q = qtyOf(pop.inp); if (!(q >= 1)) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (which === 'main') { openConfirm(); return; }   // Buy or Sell: money moves, so ask first
  const s = { ...msel }, nm = it.name;               // Load / Unload: no money moves
  if (s.kind === 'cargo') execute('unload', { good: s.good, quantity: q }, () => 'Unloaded ' + q + ' ' + nm + ' into storage.');
  else execute('load', { good: s.good, quantity: q }, () => 'Loaded ' + q + ' ' + nm + ' into the hold.');
}
async function doUnloadAll() {
  if (mbusy) return;
  mbusy = true; drawMarket();
  try { const r = await call('unload_all'); say(r.units_moved ? 'Unloaded ' + r.goods_moved + ' kinds of goods (' + whole(r.units_moved) + ' units) into storage.' : 'The hold is already empty.', 'ok'); }
  catch (e) { say(marketError(e), 'err'); }
  finally { mbusy = false; refreshMarket(); }
}

const mpick = createPicker(v => {   /* the place picker (button list) goes into the #mloc box in index.html */
  mloc = v; msel = null; dd = null; mEdited = false; frSel = null;
  if (mloc === 'ALL') refreshMarket(); else { mAt = Date.now(); loadLoc(mloc); }
  drawMarket();
});
$('mloc').appendChild(mpick.root);
/* Every time the ship docks (anywhere, whichever screen is open): the place at the top becomes the docked place, and the selected row,
   the open lists and both place selectors go back to their defaults. Checked on every state update, when Market opens, and on a 2-second timer. */
function syncDock() {
  const dl = dockedAt();
  if (!dl) { mDockSeen = null; return; }     // in flight: forget, so docking again at the same place counts as a new dock
  if (dl === mDockSeen) return;
  mDockSeen = dl; LS.set('pvs_lastdock', dl);
  mloc = dl; msel = null; dd = null; frSel = null; mEdited = false;
  Object.keys(selLoc).forEach(k => delete selLoc[k]);
  if (S.current === 'market') { refreshMarket(); drawMarket(); }
}
setInterval(syncDock, 2000);
addScreen('market', 'Market', $('scr-market'), {
  onShow: () => { syncDock(); if (!mloc) mloc = defaultLoc(); refreshMarket(); drawMarket(); },
  update: ship => {
    syncDock();
    if (!mloc) mloc = defaultLoc();
    if (Date.now() - mAt > 20000) refreshMarket();
  },
});

/* called by main.js on log out */
export function resetMarket() {
  mloc = null; mDockSeen = undefined; msel = null; closeConfirm(); Object.keys(selLoc).forEach(k => delete selLoc[k]); dd = null; stAll = null; hold = null; frSel = null; frBusy = false;
  Object.keys(frQty).forEach(k => delete frQty[k]);
  Object.keys(mc).forEach(k => delete mc[k]);
  clearQuotes();
}
