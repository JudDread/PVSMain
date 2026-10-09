// assets.js - the Assets screen: everything the player owns at ONE place.
// Sections (each hides when empty): Hold -> Stored here -> Freight (contracts I posted, at their pickup).
// Display only: the server decides everything. Data: 'storage', 'freight_mine', 'freight_hauling'.
// Creates its own screen block (#scr-assets) and the "Hire hauler" pop-up (#ahire), so index.html needs only the import-map line.
import { S, $, say, call, fmt, locName, money, whole, r2, el, cell, LS, addScreen, setShipLine, curGd, dockedAt, defaultLoc } from 'core';

const ARROW_OPEN = '\u25BE ', ARROW_SHUT = '\u25B8 ';

let aloc = null;            // the chosen place (a location id)
let adock;                  // the place the ship was docked at last time we looked (to notice a new dock)
let aAt = 0, aLoading = false;
let stAll = null, fm = null, fh = null;   // answers of storage / freight_mine / freight_hauling
const secOpen = {};         // collapsed sections: key 'place:section' -> false
let asel = null;            // selected row { loc, kind: 'cargo' | 'storage' | 'open' | 'hfreight', id }
let abusy = false, aEdited = false, aRedraw = false, aconfirm = false;

/* ---------- screen block + styles (written here so index.html does not change) ---------- */
const scr = document.createElement('div'); scr.id = 'scr-assets'; scr.hidden = true;
const aselect = document.createElement('select'); aselect.id = 'aloc'; aselect.setAttribute('aria-label', 'Choose a place');
const ainfo = el('div', 'muted'); ainfo.id = 'ainfo';
const abody = el('div', 'muted', 'Loading...'); abody.id = 'abody';
scr.append(el('h2', '', 'Assets'), aselect, ainfo, el('div', 'muted hint', 'Tap a row for its buttons.'), abody);
$('scr-market').after(scr);

(() => {
  const st = document.createElement('style');
  st.textContent = [
    '#aloc { width: 100%; font-size: 16px; padding: 10px; margin: 4px 0; }',
    '#abody .row { padding-top: 3px !important; padding-bottom: 3px !important; min-height: 0 !important; line-height: 1.2 !important; }',
    '#abody .sub { line-height: 1.15 !important; }',
    '#abody .sech { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 0 !important; line-height: 1.2 !important; background: rgba(120,160,210,0.16) !important; border-top: 2px solid rgba(120,160,210,0.55) !important; border-bottom: 1px solid rgba(120,160,210,0.25) !important; font-weight: 600 !important; letter-spacing: 0.02em; }',
    '#abody .sech button { padding: 2px 10px !important; min-height: 0 !important; }',
    '#abody .msec + .msec { margin-top: 14px !important; }',
    '#ahire { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }',
    '#ahire .abox { background: #131a2a; border: 2px solid #e8b64a; border-radius: 10px; padding: 12px; width: 100%; max-width: 420px; max-height: 92%; overflow-y: auto; box-sizing: border-box; }',
    '#ahire .alab { font-size: 13px; color: #8d98b2; margin: 8px 0 0; }',
    '#ahire .aval { font-weight: 600; }',
    '#ahire .arow { display: flex; gap: 6px; align-items: center; }',
    '#ahire .arow input { flex: 1 1 auto; min-width: 0; }',
    '#ahire .abtns { display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end; }',
    '#ahire .abtns button { margin: 0; padding: 8px 18px; }',
  ].join('\n');
  document.head.appendChild(st);
})();

/* ---------- small helpers ---------- */
const isTyping = () => !!(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('ain'));
function qtyOf(inp) { const v = inp.value; if (v === '') return NaN; const q = Number(v); return Number.isInteger(q) && q >= 0 ? q : NaN; }
const num = x => Number(x) || 0;
const storedHere = () => ((stAll && stAll.items) || []).filter(i => i.location_id === aloc);
const freeHold = () => stAll ? Math.max(0, num(stAll.hold_size) - num(stAll.hold_used)) : 0;
const maxLoad = x => Math.max(0, Math.min(x.quantity, Math.floor((freeHold() + 1e-9) / num(x.hold_per_unit || 1))));
const isSel = (kind, id) => !!asel && asel.loc === aloc && asel.kind === kind && asel.id === id;

// time left from a deadline in GAME days, in real seconds (1 game day = 86400 / scale real seconds)
function remain(dl) {
  const sec = (Number(dl) - curGd()) * 86400 / S.last.scale;
  return sec > 0 ? { text: fmt(sec), late: false } : { text: 'overdue', late: true };
}
function timerSpan(dl) {
  const s = el('span', 'ftimer'); s.dataset.dl = dl;
  const t = remain(dl); s.textContent = t.text; if (t.late) s.classList.add('lose');
  return s;
}
setInterval(() => {   // the live countdowns: once a second, only while this screen is open
  if (!S.last || S.current !== 'assets') return;
  scr.querySelectorAll('.ftimer').forEach(s => { const t = remain(s.dataset.dl); s.textContent = t.text; s.classList.toggle('lose', t.late); });
}, 1000);

function assetError(e) {
  const d = e.data || {}, m = e.message;
  if (m === 'not_enough_stored') return 'You only have ' + (d.have || 0) + ' stored there.';
  if (m === 'not_enough_credits') return 'Not enough credits (the pay costs ' + money(d.cost || 0) + ', you have ' + money(d.credits || 0) + ').';
  if (m === 'not_enough_hold') return 'Not enough room in the hold (free ' + r2(d.hold_free || 0) + ', needed ' + r2(d.hold_needed || 0) + ').';
  if (m === 'not_enough_cargo') return 'You only have ' + (d.have || 0) + ' in the hold.';
  if (m === 'not_docked' || m === 'not_docked_here') return 'Your ship must be docked at this place for that.';
  if (m === 'too_many_contracts') return 'You have too many open contracts. Cancel one first.';
  if (m === 'same_location') return 'The destination must be a different place.';
  if (m === 'bad_price') return 'The price must be above 0 and at most 1,000,000, with up to 2 decimals.';
  if (m === 'bad_quantity') return 'Enter a whole number of 1 or more.';
  if (m === 'unknown_location' || m === 'unknown_good') return 'That place or good is not known.';
  if (m === 'contract_not_found' || m === 'batch_not_found') return 'That contract or load no longer exists.';
  if (m === 'already_closed' || m === 'already_cancelled') return 'That contract is already closed.';
  if (m === 'not_active') return 'That load is no longer active.';
  if (m === 'server_error') return 'Server error. Check the function logs.';
  return 'Error: ' + m;
}

/* ---------- loading (one after the other: the server settles freight on every call) ---------- */
async function refreshAssets() {
  aAt = Date.now();
  if (aLoading || !S.sb) return;
  aLoading = true;
  try {
    stAll = await call('storage');
    fm = await call('freight_mine');
    fh = await call('freight_hauling');
  } catch (e) { say(assetError(e), 'err'); }
  finally { aLoading = false; }
  drawAssets();
}

/* ---------- the dropdown under a selected row: built ONCE, moved on every redraw, so a number you type survives ---------- */
const pop = (() => {
  const root = el('div', 'pop'), left = el('div', 'popl'), right = el('div', 'popr');
  const title = el('div', 'poptitle'), info = el('div', 'popinfo'), row = el('div', 'poprow'), brow = el('div', 'poprow');
  const inp = document.createElement('input');
  inp.type = 'number'; inp.inputMode = 'numeric'; inp.min = '0'; inp.step = '1'; inp.className = 'ain'; inp.setAttribute('aria-label', 'Quantity');
  const chips = el('div', 'chips'), b1 = el('button', '', ''), b2 = el('button', 'alt', '');
  row.append(inp, chips); brow.append(b1, b2);
  left.append(title, info); right.append(row, brow); root.append(left, right);
  inp.addEventListener('input', () => { aEdited = true; refreshPop(); });
  inp.addEventListener('blur', () => setTimeout(() => { if (aRedraw && !isTyping()) { aRedraw = false; drawAssets(); } }, 350));
  b1.onclick = () => doAct(1); b2.onclick = () => doAct(2);
  return { root, title, info, row, brow, inp, chips, b1, b2 };
})();
function addChip(label, fn) { const b = el('button', 'alt', label); b.onclick = fn; pop.chips.appendChild(b); }

function curRow() {
  if (!asel || !stAll || !fm || !fh) return null;
  if (asel.kind === 'cargo') return (stAll.cargo || []).find(x => x.good_id === asel.id) || null;
  if (asel.kind === 'storage') return storedHere().find(x => x.good_id === asel.id) || null;
  if (asel.kind === 'open') return (fm.items || []).find(c => c.contract_id === asel.id && num(c.units_open) > 0) || null;
  if (asel.kind === 'hfreight') return (fh.items || []).find(b => b.batch_id === asel.id && b.status === 'active') || null;
  return null;
}
function placePop(it) {
  const p = pop, k = asel.kind, qty = k === 'cargo' || k === 'storage';
  p.row.style.display = qty ? '' : 'none';
  p.b2.style.display = k === 'storage' ? '' : 'none';
  p.title.style.display = qty ? 'none' : '';
  p.title.textContent = k === 'open' ? 'Open freight: ' + it.good_name : 'Freight on board';
  p.chips.replaceChildren();
  if (qty) {
    if (!aEdited) p.inp.value = it.quantity;
    addChip('1', () => { p.inp.value = 1; aEdited = true; refreshPop(); });
    addChip('10', () => { p.inp.value = 10; aEdited = true; refreshPop(); });
    if (k === 'storage') addChip('Full', () => { p.inp.value = maxLoad(it); aEdited = true; refreshPop(); });
    addChip('All', () => { p.inp.value = it.quantity; aEdited = true; refreshPop(); });
  }
  refreshPop();
  return p.root;
}
function refreshPop() {
  const it = curRow(); if (!it || !asel) return;
  const p = pop, k = asel.kind, here = dockedAt() === aloc;
  p.info.replaceChildren();
  const line = (cls, t) => p.info.appendChild(el('div', cls, t));
  if (k === 'cargo' || k === 'storage') {
    const q = qtyOf(p.inp), bad = isNaN(q) || q < 1, over = !isNaN(q) && q > it.quantity;
    if (isNaN(q)) line('', 'Enter a whole number (1 or more).');
    if (over) line('err', 'You only have ' + whole(it.quantity) + '.');
    if (k === 'cargo') { p.b1.textContent = 'Unload'; p.b1.disabled = bad || over || abusy; line('muted', 'Moves goods from the hold into storage here.'); return; }
    p.b1.textContent = 'Load'; p.b1.disabled = bad || over || !here || q > maxLoad(it) || abusy;
    p.b2.textContent = 'Hire hauler'; p.b2.disabled = bad || over || abusy;
    line('muted', here ? 'Hold space free: ' + r2(freeHold()) + '.' : 'Loading needs your ship docked here.');
    line('muted', 'Hire hauler: another pilot carries these goods to a place you choose, for a price you set.');
    return;
  }
  if (k === 'open') {
    const open = num(it.units_open), pay = num(it.price_per_unit);
    p.b1.textContent = 'Cancel contract'; p.b1.disabled = abusy;
    line('', 'Goes to ' + locName(it.dest_location) + '. Pays the hauler ' + money(pay) + ' per CU.');
    const fee = r100(open * pay * CANCEL_FEE_PCT), back = r100(open * num(it.bonus_per_unit));
    line('muted', 'Cancelling returns ' + whole(open) + ' units to storage at ' + locName(it.pickup_location) + ' and refunds ' + money(r100(open * pay + back - fee)) + ' credits (' + money(r100(open * pay)) + ' pay' + (back > 0 ? ' + ' + money(back) + ' bonus pool' : '') + ' minus a ' + money(fee) + ' fee that is kept).');
    if (num(it.units_in_transit) > 0) line('muted', 'Loads already on the way are not affected.');
    return;
  }
  // freight on board my ship (the hauler's view: no good name, no owner)
  p.b1.textContent = aconfirm ? 'Tap again to abandon' : 'Abandon'; p.b1.disabled = abusy;
  line('', 'Deliver to: ' + (it.dest_name || locName(it.dest_location)));
  line('', 'Payment for delivery: ' + money(num(it.units) * num(it.pay_per_unit)) + ' (' + money(it.pay_per_unit) + ' per CU)');
  line('', 'Current bonus: about ' + money(it.bonus_now_total || 0) + ' (' + money(it.bonus_now_per_cu || 0) + ' per CU, falling to 0)');
  const t = el('div', ''); t.append('Time remaining: ', timerSpan(it.deadline_t)); p.info.appendChild(t);
  if (aconfirm) line('err', 'The load goes back to the queue, and you may lose market reputation.');
}

/* ---------- drawing ---------- */
function drawLocBox() {
  const ids = new Set();
  ((stAll && stAll.items) || []).forEach(i => ids.add(i.location_id));
  ((fm && fm.items) || []).forEach(c => { if (num(c.units_open) > 0 || ((fm.loads || []).some(l => l.contract_id === c.contract_id))) ids.add(c.pickup_location); });
  if (dockedAt()) ids.add(dockedAt());
  if (aloc) ids.add(aloc);
  const list = [...ids].sort((a, b) => locName(a).localeCompare(locName(b))), dl = dockedAt();
  const sig = list.map(i => i + (dl === i ? '*' : '')).join(';');
  if (aselect.dataset.sig !== sig) {
    aselect.replaceChildren(...list.map(id => { const o = document.createElement('option'); o.value = id; o.textContent = locName(id) + (dl === id ? ' (ship here)' : ''); return o; }));
    aselect.dataset.sig = sig;
  }
  if (aselect.value !== aloc && document.activeElement !== aselect) aselect.value = aloc;
}
function section(parent, key, title, count, btn, drawBody) {
  const k = aloc + ':' + key, open = secOpen[k] !== false;
  const box = el('div', 'msec'), h = el('div', 'sech');
  h.appendChild(el('span', '', (open ? ARROW_OPEN : ARROW_SHUT) + title + ' (' + count + ')'));
  if (btn) h.appendChild(btn);
  h.onclick = e => { if (e.target.tagName === 'BUTTON') return; secOpen[k] = !open; drawAssets(); };
  box.appendChild(h);
  if (open) drawBody(box);
  parent.appendChild(box);
}
function toggle(kind, id) {
  asel = isSel(kind, id) ? null : { loc: aloc, kind, id };
  aEdited = false; aconfirm = false; drawAssets();
}
function stackRow(box, kind, x, selectable) {
  const sel = isSel(kind, x.good_id), r = el('div', 'row' + (sel ? ' sel' : ''));
  r.append(cell('', whole(x.quantity) + ' x ' + x.name, x.avg_cost != null ? 'paid ' + money(x.avg_cost) + ' each' : 'cost unknown'), el('span', 'num', ''));
  if (selectable) r.onclick = () => toggle(kind, x.good_id);
  box.appendChild(r);
  if (sel) box.appendChild(placePop(x));
}
function drawAssets() {
  if (isTyping()) { aRedraw = true; return; }
  aRedraw = false;
  if (!aloc) return;
  const body = abody; body.replaceChildren();
  drawLocBox();
  ainfo.textContent = 'Credits ' + money((S.last && S.last.character) ? S.last.character.credits : 0) + (stAll ? '   |   Hold ' + r2(stAll.hold_used) + ' / ' + r2(stAll.hold_size) : '');
  if (!stAll || !fm || !fh) { body.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  if (asel && (asel.loc !== aloc || !curRow())) { asel = null; aEdited = false; aconfirm = false; }

  const sh = (S.last.ships || [])[0], moving = !!sh && sh.state !== 'docked', here = dockedAt() === aloc;
  const cargo = stAll.cargo || [], hf = (fh.items || []).filter(b => b.status === 'active'), stored = storedHere();
  let shown = 0;

  // 1) HOLD: where the ship is docked, or anywhere while it is travelling
  if ((here || moving) && (cargo.length || hf.length)) {
    shown++;
    let ub = null;
    if (here && cargo.length) { ub = el('button', 'alt', 'Unload all'); ub.disabled = abusy; ub.onclick = doUnloadAll; }
    section(body, 'hold', 'Hold ' + r2(stAll.hold_used) + ' / ' + r2(stAll.hold_size) + (moving ? ', travelling' : ''), cargo.length + hf.length, ub, box => {
      cargo.forEach(x => stackRow(box, 'cargo', x, here));
      hf.forEach(b => {
        const sel = isSel('hfreight', b.batch_id), r = el('div', 'row' + (sel ? ' sel' : ''));
        const right = el('span', 'num'); right.append(timerSpan(b.deadline_t), el('span', 'sub', 'left'));
        r.append(cell('', 'Freight: ' + whole(b.units) + ' CU', 'to ' + (b.dest_name || locName(b.dest_location)) + ', pays ' + money(b.pay_per_unit) + ' each'), right);
        r.onclick = () => toggle('hfreight', b.batch_id);
        box.appendChild(r);
        if (sel) box.appendChild(placePop(b));
      });
    });
  }

  // 2) STORED HERE
  if (stored.length) {
    shown++;
    section(body, 'storage', 'Stored here', stored.length, null, box => stored.forEach(x => stackRow(box, 'storage', x, true)));
  }

  // 3) FREIGHT: contracts I posted that start here. One line for the open units, one line per load on the way.
  const lines = [];
  (fm.items || []).filter(c => c.pickup_location === aloc).forEach(c => {
    if (num(c.units_open) > 0 && c.status === 'open') lines.push({ kind: 'open', c });
    (fm.loads || []).filter(l => l.contract_id === c.contract_id).forEach(l => lines.push({ kind: 'transit', c, l }));
  });
  if (lines.length) {
    shown++;
    section(body, 'freight', 'Freight', lines.length, null, box => lines.forEach(({ kind, c, l }) => {
      if (kind === 'open') {
        const sel = isSel('open', c.contract_id), r = el('div', 'row' + (sel ? ' sel' : ''));
        r.append(cell('', whole(c.units_open) + ' x ' + c.good_name, 'open, to ' + locName(c.dest_location) + ', pays ' + money(c.price_per_unit) + ' each'), cell('num muted', 'waiting', 'for a hauler'));
        r.onclick = () => toggle('open', c.contract_id);
        box.appendChild(r);
        if (sel) box.appendChild(placePop(c));
      } else {
        const r = el('div', 'row'), right = el('span', 'num'); right.append(timerSpan(l.deadline_t), el('span', 'sub', 'left'));
        r.append(cell('', whole(l.units) + ' x ' + c.good_name, 'in transit to ' + locName(l.dest_location)), right);
        box.appendChild(r);   // no dropdown: nothing you can do with a load on the way
      }
    }));
  }
  if (!shown) body.appendChild(el('div', 'muted pad', 'Nothing of yours is at ' + locName(aloc) + '.'));
}

/* ---------- actions ---------- */
async function run(fn, okText) {
  if (abusy) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  abusy = true; drawAssets();
  try { const r = await fn(); say(okText(r), 'ok'); }
  catch (e) { say(assetError(e), 'err'); }
  finally { abusy = false; aEdited = false; aRedraw = false; aconfirm = false; if (S.refresh) S.refresh(); refreshAssets(); }
}
function doAct(which) {
  if (abusy || !asel) return;
  const it = curRow(); if (!it) return;
  const k = asel.kind;
  if (k === 'cargo' || k === 'storage') {
    const q = qtyOf(pop.inp); if (!(q >= 1)) return;
    if (k === 'storage' && which === 2) { openHire(it, q); return; }
    const nm = it.name, act = k === 'cargo' ? 'unload' : 'load';
    run(() => call(act, { good: it.good_id, quantity: q }), () => (k === 'cargo' ? 'Unloaded ' : 'Loaded ') + q + ' ' + nm + (k === 'cargo' ? ' into storage.' : ' into the hold.'));
  } else if (k === 'open') {
    run(() => call('freight_cancel', { contract: it.contract_id }),
      r => 'Contract cancelled: ' + whole(r.returned_units) + ' units back in storage at ' + locName(it.pickup_location) + ', ' + money(r.refund) + ' credits refunded (' + money(r.fee || 0) + ' fee kept).' + (r.still_in_transit ? ' ' + whole(r.still_in_transit) + ' units already on the way will still be delivered.' : ''));
  } else if (k === 'hfreight') {
    if (!aconfirm) { aconfirm = true; refreshPop(); return; }
    run(() => call('freight_abandon', { batch: it.batch_id }), r => 'Abandoned ' + whole(r.units) + ' units of freight. They went back to the queue.');
  }
}
function doUnloadAll() {
  run(() => call('unload_all'), r => r.units_moved ? 'Unloaded ' + r.goods_moved + ' kinds of goods (' + whole(r.units_moved) + ' units) into storage.' : 'The hold is already empty.');
}

/* ---------- the "Hire hauler" pop-up: centred, on top of everything, nothing else works until it closes ---------- */
const hire = (() => {
  const root = document.createElement('div'); root.id = 'ahire'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
  const box = el('div', 'abox');
  const vGood = el('div', 'aval'), vPick = el('div', 'aval');
  const q = document.createElement('input'); q.type = 'number'; q.inputMode = 'numeric'; q.min = '1'; q.step = '1'; q.setAttribute('aria-label', 'Quantity');
  const chips = el('div', 'chips');
  const qrow = el('div', 'arow'); qrow.append(q, chips);
  const dest = document.createElement('select'); dest.setAttribute('aria-label', 'Destination');
  const price = document.createElement('input'); price.type = 'number'; price.inputMode = 'decimal'; price.min = '0'; price.step = '0.01'; price.placeholder = 'credits per CU'; price.setAttribute('aria-label', 'Pay per CU');
  const total = el('div', ''), credits = el('div', 'muted'), err = el('div', 'err');
  const bc = el('button', 'alt', 'Cancel'), bp = el('button', '', 'Post');
  const btns = el('div', 'abtns'); btns.append(bc, bp);
  box.append(el('h2', '', 'Hire a hauler'),
    el('div', 'alab', 'Goods'), vGood, el('div', 'alab', 'Pickup (where the goods are)'), vPick,
    el('div', 'alab', 'Quantity (CU)'), qrow,
    el('div', 'alab', 'Deliver to'), dest,
    el('div', 'alab', 'Pay per CU (cargo unit), for the hauler'), price,
    el('div', 'alab', ''), total, credits, err, btns);
  root.appendChild(box);
  document.body.appendChild(root);
  return { root, vGood, vPick, q, chips, dest, price, total, credits, err, bc, bp };
})();
let hs = null, hbusy = false;   // hs = { good, name, pickup, have }

// These two must match game_state 'freight' (bonus_pct, cancel_fee_pct). The SERVER decides the real amounts;
// this is only for the numbers shown before posting.
const BONUS_PCT = 0.10, CANCEL_FEE_PCT = 0.01;
const r100 = (x) => Math.round(x * 100) / 100;
function hireCheck() {
  const q = qtyOf(hire.q), ps = hire.price.value.trim(), price = Number(ps);
  const qOk = !isNaN(q) && q >= 1 && q <= hs.have;
  const pOk = /^\d+(\.\d{1,2})?$/.test(ps) && price > 0 && price <= 1000000;
  const total = qOk && pOk ? r100(q * price) : null;
  const bonus = total != null ? r100(q * r100(price * BONUS_PCT)) : null;
  return { q, price, qOk, pOk, total, bonus, cost: total != null ? r100(total + bonus) : null };
}
function refreshHire() {
  if (!hs) return;
  const c = hireCheck(), cr = num(S.last && S.last.character && S.last.character.credits);
  hire.total.className = '';
  if (c.total != null) hire.total.textContent = 'You pay now: ' + money(c.cost) + ' = ' + money(c.total) + ' pay (' + whole(c.q) + ' x ' + money(c.price) + ') + ' + money(c.bonus) + ' bonus pool (fast-delivery bonus, paid by you; what the hauler does not earn comes back). All held until delivery. If you cancel you get it back minus ' + money(r100(c.total * CANCEL_FEE_PCT)) + ' (1% of the pay).';
  else { hire.total.className = 'muted'; hire.total.textContent = 'Enter a quantity and a price (up to 2 decimals).'; }
  hire.credits.textContent = 'Your credits: ' + money(cr);
  let msg = '';
  if (!isNaN(c.q) && c.q > hs.have) msg = 'You only have ' + whole(hs.have) + ' stored here.';
  else if (c.cost != null && c.cost > cr) msg = 'Not enough credits for that.';
  if (msg) hire.err.textContent = msg; else if (!hbusy && hire.err.dataset.server !== '1') hire.err.textContent = '';
  hire.bp.disabled = hbusy || c.cost == null || c.cost > cr;
  hire.bc.disabled = hbusy;
}
function closeHire() { hire.root.hidden = true; document.body.style.overflow = ''; hs = null; }
function openHire(it, q) {
  hs = { good: it.good_id, name: it.name, pickup: aloc, have: it.quantity };
  hire.vGood.textContent = it.name; hire.vPick.textContent = locName(aloc);
  hire.q.value = q;
  hire.chips.replaceChildren();
  [['1', () => 1], ['10', () => 10], ['All', () => hs.have]].forEach(([l, f]) => { const b = el('button', 'alt', l); b.onclick = () => { hire.q.value = f(); refreshHire(); }; hire.chips.appendChild(b); });
  const locs = ((S.last && S.last.locations) || []).filter(l => l.id !== aloc).sort((a, b) => a.name.localeCompare(b.name));
  hire.dest.replaceChildren(...locs.map(l => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name; return o; }));
  const mem = LS.get('pvs_hdest'); if (mem && locs.some(l => l.id === mem)) hire.dest.value = mem;
  hire.price.value = '';
  hire.err.textContent = ''; hire.err.dataset.server = '';
  hire.root.hidden = false; document.body.style.overflow = 'hidden';
  refreshHire();
}
hire.q.addEventListener('input', () => { hire.err.dataset.server = ''; refreshHire(); });
hire.price.addEventListener('input', () => { hire.err.dataset.server = ''; refreshHire(); });
hire.dest.addEventListener('change', () => { hire.err.dataset.server = ''; });
hire.bc.onclick = () => { if (!hbusy) closeHire(); };
hire.bp.onclick = async () => {
  if (hbusy || !hs) return;
  const c = hireCheck(); if (c.total == null) return;
  const d = hire.dest.value, h = hs;
  hbusy = true; hire.err.textContent = ''; hire.err.dataset.server = ''; refreshHire();
  try {
    const r = await call('freight_post', { good: h.good, pickup: h.pickup, dest: d, units: c.q, price: c.price });
    LS.set('pvs_hdest', d);
    if (S.last && S.last.character && r.credits != null) { S.last.character.credits = r.credits; setShipLine(); }
    closeHire();
    say('Posted: ' + whole(c.q) + ' x ' + h.name + ', ' + locName(h.pickup) + ' to ' + locName(d) + ', ' + money(c.price) + ' per CU. ' + money(r.escrow != null ? r.escrow : c.total) + ' pay + ' + money(r.bonus_pool != null ? r.bonus_pool : c.bonus) + ' bonus pool held until delivery.', 'ok');
    aEdited = false; if (S.refresh) S.refresh(); refreshAssets();
  } catch (e) {
    hire.err.textContent = assetError(e); hire.err.dataset.server = '1';
  } finally { hbusy = false; if (hs) refreshHire(); }
};

/* ---------- wiring ---------- */
aselect.onchange = () => { aloc = aselect.value; asel = null; aEdited = false; aconfirm = false; drawAssets(); };
addScreen('assets', 'Assets', scr, {
  onShow: () => { adock = dockedAt(); if (!aloc) aloc = defaultLoc(); refreshAssets(); drawAssets(); },
  update: ship => {
    const dl = (ship && ship.state === 'docked') ? ship.location_id : null;
    if (dl) LS.set('pvs_lastdock', dl);
    let changed = false;
    if (dl !== adock) { adock = dl; changed = true; if (dl) aloc = dl; }
    if (!aloc) { aloc = defaultLoc(); changed = true; }
    if (changed || Date.now() - aAt > 12000) refreshAssets();
  },
});

/* called by main.js on log out */
export function resetAssets() {
  aloc = null; adock = undefined; asel = null; stAll = fm = fh = null; aconfirm = false; aEdited = false;
  closeHire();
  abody.replaceChildren();
}
