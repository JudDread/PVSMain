// rigs.js - the Rigging screen: fit and take off rigs and weapons on ONE hull (the one you fly or a parked one).
// Reached from Assets (touch the ship card or a hull row); it has no tab of its own. Display only: the server decides everything.
// 2026-11-07 phone layout + DRAFT: every Fit / Take off moves the rig AT ONCE in a copy of the ship kept in the browser (the same rules as the
// server: free slot, power incl. power amplifiers, hold incl. cargo expansion, hull class, weapon tier, qualification). Nothing is sent until
// Apply: ONE call 'rig_apply' with the list of steps, all or nothing; a refusal keeps the draft and shows its reason in the bottom bar.
// Data: 'rigs' (this hull: slots, power, hold, what is fitted, rigs here; each rig row also has power_bonus and hold_bonus since 094), 'facilities'
// (places with a shipyard). Action: rig_apply. The Shipyard button opens Facilities at this place (openFacilities), where a bought rig can be fitted at once.
// facilities.js is loaded only when that button is pressed (import()), NOT at the top: a top-level import would make Facilities register its tab before Assets.
// Creates its own screen block (#scr-rigging), so index.html needs only the import-map line.
import { S, $, say, call, locName, whole, r2, el, addScreen, openScreen, hullName } from 'core';
import { rigError, KIND_LABEL, hullPic } from 'rigtext';

const KINDS = ['weapon', 'engineering', 'utility'];
const KIND_HEAD = { weapon: 'Weapons', engineering: 'Engineering rigs', utility: 'Utility rigs' };
const STATIC_PROBLEMS = ['hull_class', 'weapon_tier', 'needs_qualification', 'unknown_rig', 'is_pod'];   // problems that a change of the draft cannot fix
const num = v => Number(v) || 0;

let rid = null;                 // the ship being rigged
let rback = null;               // where Back goes (a function); none = the Assets screen
let rdata = null;               // the 'rigs' answer, or { error }
let yards = null;               // { place id: [facility kinds] }
let rAt = 0, rLoading = false, rbusy = false;
let ops = [];                   // the DRAFT: [{ op: 'fit' | 'unfit', rig }] in the order the pilot did them
let rerr = '';                  // why the server refused the last Apply (shown in the bottom bar)
let rdiscard = false;           // Back was tapped once with changes waiting: tap again to leave
let bannerEl = null, bannerId = null;   // the hull picture across the top: made once per hull, reused at every redraw (no reload, no flicker)

/* ---------- screen block + styles ---------- */
const scr = document.createElement('div'); scr.id = 'scr-rigging'; scr.hidden = true;
const rbody = el('div', 'muted', 'Loading...'); rbody.id = 'rbody';
scr.appendChild(rbody);
$('scr-market').after(scr);

(() => {
  const st = document.createElement('style');
  st.textContent = [
    '#rbody button { height: 34px; min-height: 0; margin: 0; padding: 0 10px; font-size: 13px; flex: none; }',
    '#rbody .row { padding: 4px 8px !important; min-height: 0 !important; line-height: 1.2 !important; color: #fff; font-weight: 500; font-size: 13px; align-items: center; border-top: 0 !important; border-bottom: 1px solid #2f3a58 !important; gap: 8px; }',
    '#rbody .row.chg { border-left: 3px solid #e8b64a !important; }',
    '#rbody .rl { min-width: 0; flex: 1; }',
    '#rbody .sub { line-height: 1.15 !important; font-size: 11px !important; font-weight: 400 !important; }',
    '#rbody .rwhy { font-size: 11px; font-weight: 400; color: #ff7b6b; line-height: 1.15; }',
    '#rbody .sech { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 34px; line-height: 1.2 !important; background: rgba(120,160,210,0.16) !important; border-top: 2px solid rgba(120,160,210,0.55) !important; border-bottom: 1px solid rgba(120,160,210,0.25) !important; font-weight: 500 !important; letter-spacing: 0.02em; color: #fff !important; display: flex; justify-content: space-between; align-items: center; }',
    '#rbody .msec + .msec { margin-top: 10px !important; }',
    '#rbody .rtop { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 6px; }',
    '#rbody .rcard { display: flex; gap: 10px; align-items: center; padding: 6px 8px; border: 1px solid #333d57; border-radius: 10px; background: #131a2a; }',
    '#rbody .hpic.banner { border-radius: 0; margin: 0 0 8px; }',
    '#rbody .rname { font-size: 16px; font-weight: 500; color: #fff; }',
    '#rbody .rstats { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 8px 4px 0; }',
    '#rbody .rstat .k { font-size: 11px; color: #8d98b2; font-weight: 400; }',
    '#rbody .rstat .v { font-size: 14px; font-weight: 500; color: #fff; }',
    '#rbody .rstat .v.chg { color: #e8b64a; }',
    '#rbody .rbar { height: 8px; border-radius: 4px; background: #1c2438; overflow: hidden; margin: 6px 4px 0; }',
    '#rbody .rbar > div { height: 100%; background: #e8b64a; }',
    '#rbody .rbar > div.hot { background: #e06b5a; }',
    '#rbody .rempty { color: #6f7a94; font-style: italic; font-weight: 400; }',
    '#rbody .rside { display: flex; align-items: center; gap: 8px; flex: none; }',
    '#rbody .rpw { font-size: 11px; font-weight: 400; color: #8d98b2; white-space: nowrap; }',
    '#rbody .rsub { padding: 5px 8px 0; font-size: 11px; font-weight: 400; color: #8d98b2; }',
    '#rbody .rbot { position: sticky; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); z-index: 5; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 6px 8px; background: #131a2a; border: 1px solid #3a4666; border-radius: 10px; }',
    '#rbody .rbot .rmsg { min-width: 0; flex: 1; font-size: 13px; font-weight: 500; color: #fff; }',
    '#rbody .rbtns { display: flex; gap: 8px; flex: none; }',
  ].join('\n');
  document.head.appendChild(st);
})();

/* ---------- loading ---------- */
async function refreshRig() {
  rAt = Date.now();
  if (rLoading || !S.sb || !rid) return;
  rLoading = true;
  const id = rid;
  try {
    if (!yards) {
      const p = await call('facilities');
      const m = {}; (p.places || []).forEach(x => { m[x.location_id] = x.kinds || []; }); yards = m;
    }
    const d = await call('rigs', { ship: id });
    if (id === rid) rdata = d;
  } catch (e) {
    if (id === rid) rdata = { error: rigError(e) };
  } finally { rLoading = false; }
  drawRig();
}

/* ---------- the draft: a copy of the ship in the browser, with the server's rules ---------- */
// Start from what the server sent, then replay every step of the draft. Each step was legal when the pilot made it, so the replay is too.
function freshState() {
  const d = rdata, st = { fitted: [], here: {}, slots: {}, output: num(d.power.output), used: num(d.power.used), size: num(d.hold.size), hold_used: num(d.hold.used), bad: [] };
  (d.fitted || []).forEach(x => st.fitted.push({ ...x, changed: false }));
  (d.here || []).forEach(x => { st.here[x.rig_id] = { ...x, changed: false }; });
  KINDS.forEach(k => { const s = (d.slots && d.slots[k]) || {}; st.slots[k] = { total: num(s.total), used: num(s.used) }; });
  return st;
}
// null = the rig in the list 'here' can be fitted; else { error, ...numbers } with the same names as the server's rig_fit_problem
function fitProblem(st, h) {
  if (h.problem && STATIC_PROBLEMS.includes(h.problem.error)) return h.problem;
  const sl = st.slots[h.kind];
  if (!sl || sl.used >= sl.total) return { error: 'no_free_slot', kind: h.kind, slots: sl ? sl.total : 0 };
  const free = st.output - st.used;
  if (num(h.power_use) > free + 1e-9) return { error: 'over_power', need: num(h.power_use), free };
  return null;
}
// null = the fitted rig can come off; else the refusal (same names as the server's rig_unfit)
function unfitProblem(st, f) {
  const outAfter = st.output - num(f.power_bonus), usedAfter = st.used - num(f.power_use);
  if (usedAfter > outAfter + 1e-9) return { error: 'over_power_after_removal', output_after: outAfter, used_after: usedAfter };
  const holdAfter = st.size - num(f.hold_bonus);
  if (holdAfter + 1e-9 < st.hold_used) return { error: 'hold_too_small', hold_after: holdAfter, hold_used: st.hold_used };
  return null;
}
function simFit(st, rigId) {
  const h = st.here[rigId]; if (!h) return { error: 'no_rig_here' };
  const p = fitProblem(st, h); if (p) return p;
  if (num(h.in_storage) > 0) h.in_storage = num(h.in_storage) - 1;          // the server takes it from storage first, then from the hold
  else { h.in_hold = num(h.in_hold) - 1; st.hold_used -= num(h.cu); }
  h.changed = true;
  if (num(h.in_storage) + num(h.in_hold) <= 0) delete st.here[rigId];
  st.fitted.push({ rig_id: h.rig_id, name: h.name, kind: h.kind, tier: h.tier, elite: h.elite, power_use: h.power_use, effect_text: h.effect_text, works_now: h.works_now, power_bonus: num(h.power_bonus), hold_bonus: num(h.hold_bonus), cu: h.cu, changed: true });
  st.slots[h.kind].used += 1; st.used += num(h.power_use); st.output += num(h.power_bonus); st.size += num(h.hold_bonus);
  return null;
}
function simUnfit(st, rigId) {
  let i = -1; st.fitted.forEach((x, n) => { if (x.rig_id === rigId) i = n; });   // the newest copy, like the server
  if (i < 0) return { error: 'not_fitted' };
  const f = st.fitted[i], p = unfitProblem(st, f); if (p) return p;
  st.fitted.splice(i, 1);
  st.slots[f.kind].used -= 1; st.used -= num(f.power_use); st.output -= num(f.power_bonus); st.size -= num(f.hold_bonus);
  const h = st.here[rigId] || (st.here[rigId] = { rig_id: f.rig_id, name: f.name, kind: f.kind, tier: f.tier, elite: f.elite, power_use: f.power_use, effect_text: f.effect_text, works_now: f.works_now, cu: f.cu || 10, in_storage: 0, in_hold: 0, power_bonus: f.power_bonus, hold_bonus: f.hold_bonus, problem: null });
  h.in_storage = num(h.in_storage) + 1; h.changed = true;   // it goes to storage at the ship's place
  return null;
}
function replay() {
  const st = freshState();
  ops.forEach(o => { const p = o.op === 'fit' ? simFit(st, o.rig) : simUnfit(st, o.rig); if (p) st.bad.push(p); });
  return st;
}
// a step that undoes the LAST step just removes it; any other step is added to the end
function pushOp(op, rig) {
  const last = ops[ops.length - 1];
  if (last && last.rig === rig && last.op !== op) ops.pop(); else ops.push({ op, rig });
  rerr = ''; rdiscard = false; drawRig();
}
function takeAllOff() {
  const st = replay();
  // rigs that only draw power come off first, rigs that add power or hold last, so every step stays legal
  const order = st.fitted.slice().sort((a, b) => ((num(a.power_bonus) + num(a.hold_bonus) > 0) ? 1 : 0) - ((num(b.power_bonus) + num(b.hold_bonus) > 0) ? 1 : 0));
  let first = null;
  order.forEach(f => { const p = simUnfit(st, f.rig_id); if (p) { if (!first) first = p; } else ops.push({ op: 'unfit', rig: f.rig_id }); });
  rerr = ''; rdiscard = false;
  if (first) say(rigError({ message: first.error, data: first }), 'err');
  drawRig();
}

/* ---------- drawing ---------- */
function goBack() { if (rback) rback(); else openScreen('assets'); }
const maxGOf = id => { const s = ((S.last && S.last.ships) || []).find(x => x.id === id); return s && s.max_g != null ? r2(s.max_g) + ' g' : '-'; };
const why = (p, kind) => rigError({ message: p.error, data: p });

function stat(parent, k, v, changed) {
  const d = el('div', 'rstat'), val = el('div', 'v' + (changed ? ' chg' : ''), v);
  d.append(el('div', 'k', k), val);
  parent.appendChild(d); return d;
}

function drawRig() {
  const b = rbody; b.replaceChildren();
  const top = el('div', 'rtop'), back = el('button', 'alt', rdiscard ? 'Discard ' + ops.length + (ops.length === 1 ? ' change?' : ' changes?') : '\u2039 Back');
  back.onclick = () => { if (ops.length && !rdiscard) { rdiscard = true; drawRig(); } else { ops = []; rerr = ''; rdiscard = false; goBack(); } };
  top.appendChild(back); b.appendChild(top);
  if (!rdata) { b.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  if (rdata.error) { b.appendChild(el('div', 'err pad', rdata.error)); return; }
  const d = rdata, s = d.ship, docked = s.state === 'docked';
  const st = replay();
  if (st.bad.length) {   // the ship changed under the draft (for example a rig was sold): start again from what the server says
    ops = []; rerr = ''; say('The ship changed since you started, so your changes were cleared.', 'err'); drawRig(); return;
  }
  if (docked) top.appendChild(el('span', 'sub', 'Docked at ' + locName(s.location_id)));
  if (!bannerEl || bannerId !== s.hull_id) { bannerEl = hullPic(s.hull_id, 'banner'); bannerId = s.hull_id; }
  b.insertBefore(bannerEl, b.firstChild);                       // the ship picture: full width at the very top, above the Back row

  const card = el('div', 'rcard'), mid = el('div', '');
  mid.append(el('div', 'rname', (s.hull_name || hullName(s.hull_id)) + (s.is_active ? ' (flying)' : ' (parked)')),
    el('div', 'sub', docked ? s.class + ' hull, weapons up to ' + String(s.max_weapon_tier).toLowerCase() : 'Travelling: rigs can only be changed while the ship is docked.'));
  card.append(mid); b.appendChild(card);

  const stats = el('div', 'rstats');
  stat(stats, 'Max accel', maxGOf(s.id), false);
  stat(stats, 'Hold', r2(st.hold_used) + ' / ' + r2(st.size) + ' CU', Math.abs(st.hold_used - num(d.hold.used)) > 1e-9 || Math.abs(st.size - num(d.hold.size)) > 1e-9);
  stat(stats, 'Power used', whole(st.used) + ' / ' + whole(st.output), Math.abs(st.used - num(d.power.used)) > 1e-9 || Math.abs(st.output - num(d.power.output)) > 1e-9);
  b.appendChild(stats);
  const pct = st.output > 0 ? Math.min(100, Math.round(st.used / st.output * 100)) : 0;
  const bar = el('div', 'rbar'), fill = el('div', pct >= 90 ? 'hot' : ''); fill.style.width = pct + '%'; bar.appendChild(fill); b.appendChild(bar);

  // fitted rigs by slot type, with the empty slots shown
  const fsec = el('div', 'msec'), fh = el('div', 'sech');
  fh.appendChild(el('span', '', 'Fitted (' + st.fitted.length + ')'));
  if (st.fitted.length && docked) {
    const all = el('button', 'alt', 'Take all off');
    all.disabled = rbusy; all.onclick = takeAllOff;
    fh.appendChild(all);
  }
  fsec.appendChild(fh);
  KINDS.forEach(k => {
    const slot = st.slots[k]; if (!slot || !slot.total) return;
    fsec.appendChild(el('div', 'rsub', KIND_HEAD[k] + ' ' + slot.used + '/' + slot.total));
    st.fitted.filter(x => x.kind === k).forEach(x => {
      const r = el('div', 'row' + (x.changed ? ' chg' : '')), left = el('div', 'rl'), side = el('div', 'rside');
      left.append(el('div', '', x.name), el('div', 'sub', x.effect_text + (x.works_now ? '' : ' (inactive)')));
      side.appendChild(el('span', 'rpw', whole(x.power_use)));
      if (docked) {
        const p = unfitProblem(st, x);
        if (p) left.appendChild(el('div', 'rwhy', why(p)));
        else { const off = el('button', 'alt', 'Take off'); off.disabled = rbusy; off.onclick = () => pushOp('unfit', x.rig_id); side.appendChild(off); }
      }
      r.append(left, side);
      fsec.appendChild(r);
    });
    for (let i = slot.used; i < slot.total; i++) fsec.appendChild(el('div', 'row rempty', 'empty ' + (KIND_LABEL[k] || k).toLowerCase() + ' slot'));
  });
  b.appendChild(fsec);

  // rigs available at this place (storage here + the hold)
  if (docked) {
    const here = Object.values(st.here);
    const hsec = el('div', 'msec'), hh = el('div', 'sech');
    hh.appendChild(el('span', '', 'Rigs and weapons here (' + here.length + ')'));
    const place = s.location_id;
    if (yards && (yards[place] || []).length) {
      const shop = el('button', 'alt', 'Shipyard');
      shop.onclick = async () => {
        const fac = await import('facilities');
        fac.openFacilities(place, { shipId: s.id, label: s.hull_name || hullName(s.hull_id), shipLoc: place, back: () => openRigging(s.id, rback) });
      };
      hh.appendChild(shop);
    }
    hsec.appendChild(hh);
    if (!here.length) hsec.appendChild(el('div', 'muted pad', 'None in your storage or hold here.' + (yards && (yards[place] || []).length ? ' The Shipyard button opens the store.' : '')));
    here.forEach(x => {
      const r = el('div', 'row' + (x.changed ? ' chg' : '')), left = el('div', 'rl'), side = el('div', 'rside');
      const where = [num(x.in_storage) > 0 ? whole(x.in_storage) + ' in storage' : '', num(x.in_hold) > 0 ? whole(x.in_hold) + ' in hold' : ''].filter(Boolean).join(', ');
      left.append(el('div', '', x.name + (x.elite ? ' (elite)' : '')), el('div', 'sub', where + ' - ' + x.effect_text + (x.works_now ? '' : ' (inactive)')));
      side.appendChild(el('span', 'rpw', whole(x.power_use)));
      const p = fitProblem(st, x);
      if (p) left.appendChild(el('div', 'rwhy', why(p)));
      else { const f = el('button', '', 'Fit'); f.disabled = rbusy; f.onclick = () => pushOp('fit', x.rig_id); side.appendChild(f); }
      r.append(left, side);
      hsec.appendChild(r);
    });
    b.appendChild(hsec);
  }

  // the bottom bar: only while changes are waiting
  if (ops.length) {
    const bot = el('div', 'rbot'), msg = el('div', 'rmsg'), btns = el('div', 'rbtns');
    msg.appendChild(el('div', '', ops.length + (ops.length === 1 ? ' change' : ' changes')));
    if (rerr) msg.appendChild(el('div', 'rwhy', rerr));
    const reset = el('button', 'alt', 'Reset'); reset.disabled = rbusy; reset.onclick = () => { ops = []; rerr = ''; rdiscard = false; drawRig(); };
    const apply = el('button', '', 'Apply'); apply.disabled = rbusy; apply.onclick = doApply;
    btns.append(reset, apply); bot.append(msg, btns); b.appendChild(bot);
  }
}

/* ---------- actions ---------- */
// ONE call with every step of the draft. The server undoes everything if one step is refused: the draft stays and the reason shows in the bar.
async function doApply() {
  if (rbusy || !ops.length) return;
  rbusy = true; rerr = ''; rdiscard = false; drawRig();
  const n = ops.length;
  try {
    await call('rig_apply', { ship: rid, ops: ops.slice() });
    ops = [];
    say('Applied ' + n + (n === 1 ? ' change.' : ' changes.'), 'ok');
  } catch (e) {
    rerr = rigError(e) + (e.data && e.data.step ? ' (change ' + e.data.step + ')' : '');
  } finally { rbusy = false; if (S.refresh) S.refresh(); refreshRig(); }
}

/* ---------- wiring ---------- */
// Open the Rigging screen for a ship of yours. back (optional) = what Back does; default: the Assets screen.
// The draft belongs to ONE ship: opening another ship clears it.
export function openRigging(shipId, back) {
  if (shipId !== rid) { ops = []; rerr = ''; }
  rid = shipId; rback = back || null; rdata = null; rdiscard = false;
  openScreen('rigging');
}
addScreen('rigging', 'Rigging', scr, {
  noTab: true,
  onShow: () => { rdiscard = false; refreshRig(); drawRig(); },
  update: () => { if (!ops.length && !rbusy && Date.now() - rAt > 12000) refreshRig(); },   // no refresh under a waiting draft
});

/* called by main.js on log out */
export function resetRigging() {
  bannerEl = null; bannerId = null; rid = null; rback = null; rdata = null; yards = null; rbusy = false; ops = []; rerr = ''; rdiscard = false;
  rbody.replaceChildren();
}
