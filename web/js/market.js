// market.js - the Market screen (goods in markets, in storage and in the hold). Display only: the server decides every trade.
import { S, $, say, call, fmt, curGd, locName, money, whole, r2, el, cell, sgn, tone, LS, addScreen, setShipLine } from 'core';

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
const frQty = {};            // freight board: contract id -> what is typed in its units box (survives redraws)
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
  const close = () => box;   // no Close button: tap the row again to close (same as the buy/sell window)
  const GRID = 'display:grid;grid-template-columns:minmax(0,1.3fr) repeat(4,minmax(0,1fr));column-gap:10px;align-items:start';
  if (!d) { box.appendChild(el('div', 'muted', 'Loading destinations...')); return close(); }
  if (d.error) { box.appendChild(el('div', 'err', d.error === 'no_market' ? 'This place does not trade that.' : 'Could not load: ' + d.error)); return close(); }
  if (d.docked === false && dd.kind === 'cargo') { box.appendChild(el('div', 'muted', 'Dock somewhere to compare destinations.')); return close(); }
  const hd = el('div', 'rhead'); hd.style.cssText = GRID;
  if (dd.kind === 'goods') {
    const g = md && (md.goods || []).find(x => x.good_id === dd.good);
    const why = d.hypothetical && md ? buyBlockReason(md, g) : null;
    if (d.hypothetical) box.appendChild(el('div', 'muted', (why === 'Hold full' ? 'Your hold is full' : why === 'Low funds' ? 'You cannot afford any' : 'None in stock here') + ', so the load columns show N/A.'));
    if (!d.rows.length) { box.appendChild(el('div', 'muted', 'No other place trades this good.')); return close(); }
    hd.append(el('span', '', 'Destination'), el('span', 'num', 'Sells'), el('span', 'num', 'Each'),
      el('span', 'num', d.hypothetical ? why : (md && md.hold_used > 0 ? 'For ' + whole(d.max_load) : 'Max load')), el('span', 'num', 'Per min'));
    box.appendChild(hd);
    d.rows.forEach(x => {
      const r = el('div', 'rrow'); r.style.cssText = GRID;
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
  if (!d.rows.length) { box.appendChild(el('div', 'muted', 'No place trades this good.')); return close(); }
  hd.append(el('span', '', 'Destination'), el('span', 'num', 'Sells'), el('span', 'num', 'Each'), el('span', 'num', 'For ' + whole(d.quantity)), el('span', 'num', 'Per min'));
  box.appendChild(hd);
  d.rows.forEach(x => {
    const r = el('div', 'rrow'); r.style.cssText = GRID;
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
function toggleSel(loc, kind, good) { if (isDD(loc, kind, good)) { dd = null; msel = null; mEdited = false; drawMarket(); return; } msel = isSel(loc, kind, good) ? null : { loc, kind, good }; mEdited = false; drawMarket(); }

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
// one info line for an order: the exact total from the server, or why it cannot be priced yet
function quoteLine(verb, q, nm, qd) {
  if (qd && qd.d && qd.d.ok && !nm) { const l = el('div', '', verb + ' ' + whole(q) + ': ' + money(qd.d.total) + ' in total, ' + money(qd.d.unit_price) + ' avg'); l.style.whiteSpace = 'nowrap'; return l; }
  if (qd && qd.d && qd.d.ok) return el('div', '', verb + ' ' + whole(q) + ' ' + nm + ': ' + money(qd.d.total) + ' in total (' + money(qd.d.unit_price) + ' each on average)');
  if (qd && qd.err) return el('div', 'muted', 'Could not get the exact price: ' + marketError(qd.err));
  return el('div', 'muted', 'Checking the price...');
}
function refreshPop() {
  const it = curItem(), d = curData(); if (!it || !d) return;
  const q = qtyOf(pop.inp), bad = isNaN(q) || q < 1, p = pop;
  p.info.replaceChildren();
  if (isNaN(q)) p.info.appendChild(el('div', '', msel.kind === 'goods' && !mEdited ? 'Checking the most you can buy...' : 'Enter a whole number (0 or more).'));
  if (msel.kind === 'goods') {
    const dest = buyDest(d), mq = wantQuote(0);
    p.b1.textContent = 'Buy'; p.b1.disabled = bad || mbusy;
    p.b2.textContent = 'To: ' + (dest === 'hold' ? 'Hold' : 'Storage'); p.b2.disabled = mbusy || !d.here;
    if (!isNaN(q)) { const qd = q >= 1 ? wantQuote(q) : null; if (q >= 1) { p.info.appendChild(quoteLine('Buy', q, it.name, qd)); if (qd && qd.d && qd.d.ok && qd.d.problem) p.info.appendChild(el('div', 'err', problemText(qd))); if (qd && qd.d && qd.d.can_do === false) p.b1.disabled = true; } if (dest === 'hold') p.info.appendChild(el('div', 'muted', 'Hold space free: ' + r2(Math.max(0, d.hold_size - d.hold_used)))); }
    p.info.appendChild(el('div', 'muted', 'Goes into ' + (dest === 'hold' ? 'your hold.' : 'your storage at ' + d.location_name + '.') + (d.here ? '' : ' Hold needs your ship docked here.')));
    if (mq && mq.d && mq.d.ok && mq.d.max_quantity === 0) p.info.appendChild(el('div', 'muted', 'You cannot buy any right now: ' + ({ stock: 'sold out', credits: 'low funds', hold: 'hold full' }[mq.d.limit] || 'not available') + '.'));
    else if (mq && mq.d && mq.d.ok) p.info.appendChild(el('div', 'muted', 'Most you can buy now: ' + whole(mq.d.max_quantity) + '.'));
    return;
  }
  const sells = it.sell_here != null, cargo = msel.kind === 'cargo';
  p.b1.textContent = 'Sell'; p.b1.disabled = bad || !sells || q > it.quantity || mbusy;
  if (cargo) { p.b2.textContent = 'Unload'; p.b2.disabled = bad || q > it.quantity || mbusy; }
  else { p.b2.textContent = 'Load'; p.b2.disabled = bad || !d.here || q > it.quantity || q > maxLoad(d, it) || mbusy; }
  if (!sells) p.info.appendChild(el('div', 'muted', 'This place does not buy that.'));
  else if (!isNaN(q) && q >= 1 && q <= it.quantity) { p.info.appendChild(quoteLine('Sell', q, '', wantQuote(q))); p.info.appendChild(el('div', 'muted', 'You have ' + whole(it.quantity) + '.')); }
  if (!isNaN(q) && q > it.quantity) p.info.appendChild(el('div', 'err', 'You only have ' + whole(it.quantity) + '.'));
}
function placePop(d, kind, it) {
  const p = pop;
  p.title.textContent = kind === 'goods' ? 'Buy ' + it.name : '';
  p.title.style.display = kind === 'goods' ? '' : 'none';   // cargo / stored: the row above already says what it is
  if (!mEdited) { if (kind === 'goods') { const mq = quotes[qKey(0)]; p.inp.value = mq && mq.d && mq.d.ok ? mq.d.max_quantity : ''; } else p.inp.value = it.quantity; }
  p.chips.replaceChildren();
  addChip('1', () => { p.inp.value = 1; mEdited = true; refreshPop(); });
  addChip('10', () => { p.inp.value = 10; mEdited = true; refreshPop(); });
  if (kind === 'storage') addChip('Full', () => { mEdited = true; p.inp.value = maxLoad(d, it); refreshPop(); });   // as much as fits the empty hold space
  addChip(kind === 'goods' ? 'Max' : 'All', () => { mEdited = false; if (kind === 'goods') { delete quotes[qKey(0)]; p.inp.value = ''; } else p.inp.value = it.quantity; refreshPop(); });
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
    if (!isNaN(q) && q >= 1) info.appendChild(el('div', '', 'For ' + whole(q) + ': ' + money(q * x.pay_per_unit) + ' on delivery, plus up to ' + money(q * x.bonus_max_per_cu) + ' bonus if early.'));
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
      say('Accepted ' + whole(r.units) + ' CU to ' + locName(r.dest_location) + '. Deliver within ' + fmt(left) + '.', 'ok');
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
    const sel = frSel === x.contract_id;
    const r = el('div', 'row' + (sel ? ' sel' : ''));
    r.append(
      cell('', 'To ' + x.dest_name + (x.mine ? ' (yours)' : ''), whole(x.units_open) + ' CU open, window ' + fmt(x.window_days * 86400 / scale)),
      cell('num get', money(x.pay_per_unit) + ' / CU', 'bonus up to ' + money(x.bonus_max_per_cu)));
    r.onclick = () => { frSel = sel ? null : x.contract_id; drawMarket(); };
    box.appendChild(r);
    if (sel) box.appendChild(frPop(d, loc, x, scale));
  });
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
    const hd = el('div', 'mhead');
    [['name', 'Good', ''], ['buy_price', 'Buy for', 'num'], ['sell_price', 'Sell at', 'num'], ['stock', 'Stock', 'num']].forEach(([col, label, cls]) => {
      const sp = el('span', cls), b = document.createElement('button');
      b.type = 'button'; b.textContent = label + (gSort.col === col ? (gSort.dir === 1 ? ' \u25B2' : ' \u25BC') : '');
      b.onclick = () => pressSort(col);
      sp.appendChild(b); hd.appendChild(sp);
    });
    box.appendChild(hd);
    sortGoods(goods).forEach(g => {
      const sel = isSel(loc, 'goods', g.good_id);
      const r = el('div', 'mrow' + (sel ? ' sel' : ''));
      r.append(cell('', g.name), cell('num pay', money(g.buy_price)), cell('num get', money(g.sell_price)), cell('num', whole(g.stock)));
      wireRow(r, 'goods:' + loc + ':' + g.good_id, { open: () => openDD(loc, 'goods', g.good_id), close: closeDD, isOpen: () => isDD(loc, 'goods', g.good_id), tap: () => toggleSel(loc, 'goods', g.good_id) });
      box.appendChild(r);
      if (sel) box.appendChild(placePop(d, 'goods', g));
      if (isDD(loc, 'goods', g.good_id)) box.appendChild(ddBox());
    });
  });
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
  finally { mbusy = false; mEdited = false; mRedraw = false; clearQuotes(); refreshMarket(); }
}
async function doUnloadAll() {
  if (mbusy) return;
  mbusy = true; drawMarket();
  try { const r = await call('unload_all'); say(r.units_moved ? 'Unloaded ' + r.goods_moved + ' kinds of goods (' + whole(r.units_moved) + ' units) into storage.' : 'The hold is already empty.', 'ok'); }
  catch (e) { say(marketError(e), 'err'); }
  finally { mbusy = false; refreshMarket(); }
}

$('mloc').onchange = () => {
  mloc = $('mloc').value; msel = null; dd = null; mEdited = false; frSel = null;
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
  mloc = null; mdock = undefined; msel = null; dd = null; stAll = null; hold = null; frSel = null; frBusy = false;
  Object.keys(frQty).forEach(k => delete frQty[k]);
  Object.keys(mc).forEach(k => delete mc[k]);
  clearQuotes();
}
