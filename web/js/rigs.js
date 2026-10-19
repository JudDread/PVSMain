// rigs.js - the Rigging screen: fit and take off rigs and weapons on ONE hull (the one you fly or a parked one).
// Reached from Assets (touch the ship card or a hull row); it has no tab of its own. Display only: the server decides everything.
// Data: 'rigs' (this hull: slots, power, hold, what is fitted, rigs here with can_fit / the reason), 'facilities' (places with a shipyard).
// Actions: rig_fit, rig_unfit, rig_unfit_all. The Shipyard button opens Facilities at this place (openFacilities), where a bought rig can be fitted at once.
// Creates its own screen block (#scr-rigging), so index.html needs only the import-map line.
import { S, $, say, call, locName, whole, r2, el, cell, addScreen, openScreen, hullName } from 'core';
import { rigError, KIND_LABEL, hullPic } from 'rigtext';
import { openFacilities } from 'facilities';

const KINDS = ['weapon', 'engineering', 'utility'];
const KIND_HEAD = { weapon: 'Weapons', engineering: 'Engineering rigs', utility: 'Utility rigs' };

let rid = null;                 // the ship being rigged
let rback = null;               // where Back goes (a function); none = the Assets screen
let rdata = null;               // the 'rigs' answer, or { error }
let yards = null;               // { place id: [facility kinds] }
let rAt = 0, rLoading = false, rbusy = false, rconfirm = false;

/* ---------- screen block + styles ---------- */
const scr = document.createElement('div'); scr.id = 'scr-rigging'; scr.hidden = true;
const rbody = el('div', 'muted', 'Loading...'); rbody.id = 'rbody';
scr.appendChild(rbody);
$('scr-market').after(scr);

(() => {
  const st = document.createElement('style');
  st.textContent = [
    '#rbody .row { padding-top: 4px !important; padding-bottom: 4px !important; min-height: 0 !important; line-height: 1.2 !important; }',
    '#rbody .sub { line-height: 1.15 !important; }',
    '#rbody .sech { padding: 5px 8px !important; min-height: 0 !important; line-height: 1.2 !important; font-weight: 600 !important; letter-spacing: 0.02em; background: #2a3a5a !important; border-top: 2px solid #5b74a6 !important; border-bottom: 1px solid #3a4c70 !important; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }',
    '#rbody .sech button { margin: 0; padding: 3px 10px; }',
    '#rbody .msec + .msec { margin-top: 12px !important; }',
    '#rbody .rtop { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 0 8px; }',
    '#rbody .rtop button { margin: 0; padding: 6px 12px; }',
    '#rbody .rname { font-size: 20px; font-weight: 800; color: #f3d28a; margin: 6px 0 2px; }',
    '#rbody .rstats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin: 8px 0 10px; }',
    '#rbody .rstat .k { font-size: 11px; color: #8d98b2; }',
    '#rbody .rstat .v { font-size: 15px; font-weight: 600; }',
    '#rbody .rbar { height: 8px; border-radius: 4px; background: #1c2438; overflow: hidden; margin-top: 4px; }',
    '#rbody .rbar > div { height: 100%; background: #e8b64a; }',
    '#rbody .rbar > div.hot { background: #e06b5a; }',
    '#rbody .rpow { grid-column: 1 / -1; }',
    '#rbody .rempty { color: #6f7a94; font-style: italic; }',
    '#rbody .rside { display: flex; align-items: center; gap: 8px; }',
    '#rbody .rside button { margin: 0; padding: 4px 12px; }',
    '#rbody .rwhy { font-size: 12px; color: #c98a7a; text-align: right; max-width: 150px; }',
    '#rbody .rpw { font-size: 12px; color: #8d98b2; white-space: nowrap; }',
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

/* ---------- drawing ---------- */
function goBack() { if (rback) rback(); else openScreen('assets'); }
const maxGOf = id => { const s = ((S.last && S.last.ships) || []).find(x => x.id === id); return s && s.max_g != null ? r2(s.max_g) + ' g' : '-'; };

function stat(parent, k, v, cls) {
  const d = el('div', 'rstat' + (cls ? ' ' + cls : ''));
  d.append(el('div', 'k', k), el('div', 'v', v));
  parent.appendChild(d); return d;
}

function drawRig() {
  const b = rbody; b.replaceChildren();
  const top = el('div', 'rtop'), back = el('button', 'alt', '\u2039 Back'); back.onclick = goBack;
  top.appendChild(back); b.appendChild(top);
  if (!rdata) { b.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  if (rdata.error) { b.appendChild(el('div', 'err pad', rdata.error)); return; }
  const d = rdata, s = d.ship, docked = s.state === 'docked';

  b.appendChild(hullPic(s.hull_id, 'banner'));
  b.appendChild(el('div', 'rname', (s.hull_name || hullName(s.hull_id)) + (s.is_active ? ' (flying)' : ' (parked)')));
  b.appendChild(el('div', 'sub', docked ? 'Docked at ' + locName(s.location_id) + '. ' + s.class + ' hull, weapons up to ' + String(s.max_weapon_tier).toLowerCase() + '.' : 'Travelling: rigs can only be changed while the ship is docked.'));

  const stats = el('div', 'rstats');
  stat(stats, 'Max acceleration', maxGOf(s.id));
  stat(stats, 'Hold', r2(d.hold.used) + ' / ' + r2(d.hold.size) + ' CU');
  const pw = d.power, pct = pw.output > 0 ? Math.min(100, Math.round(pw.used / pw.output * 100)) : 0;
  const ps = stat(stats, 'Power used', whole(pw.used) + ' / ' + whole(pw.output) + ' (' + whole(pw.free) + ' free)', 'rpow');
  const bar = el('div', 'rbar'), fill = el('div', pct >= 90 ? 'hot' : ''); fill.style.width = pct + '%'; bar.appendChild(fill); ps.appendChild(bar);
  b.appendChild(stats);

  // fitted rigs by slot type, with the empty slots shown
  const fitted = d.fitted || [];
  const fsec = el('div', 'msec'), fh = el('div', 'sech');
  fh.appendChild(el('span', '', 'Fitted (' + fitted.length + ')'));
  if (fitted.length && docked) {
    const all = el('button', 'alt', rconfirm ? 'Tap again to confirm' : 'Take everything off');
    all.disabled = rbusy; all.onclick = () => { if (!rconfirm) { rconfirm = true; drawRig(); } else doUnfitAll(); };
    fh.appendChild(all);
  }
  fsec.appendChild(fh);
  KINDS.forEach(k => {
    const slot = d.slots[k]; if (!slot || !slot.total) return;
    fsec.appendChild(el('div', 'sub pad', KIND_HEAD[k] + ' ' + slot.used + '/' + slot.total));
    fitted.filter(x => x.kind === k).forEach(x => {
      const r = el('div', 'row'), side = el('div', 'rside');
      side.appendChild(el('span', 'rpw', whole(x.power_use) + ' power'));
      const off = el('button', 'alt', 'Take off'); off.disabled = rbusy || !docked; off.onclick = () => doUnfit(x); side.appendChild(off);
      r.append(cell('', x.name, x.effect_text + (x.works_now ? '' : ' (inactive)')), side);
      fsec.appendChild(r);
    });
    for (let i = slot.used; i < slot.total; i++) fsec.appendChild(el('div', 'row rempty', 'empty ' + (KIND_LABEL[k] || k).toLowerCase() + ' slot'));
  });
  b.appendChild(fsec);

  // rigs available at this place (storage here + the hold)
  if (docked) {
    const here = d.here || [];
    const hsec = el('div', 'msec'), hh = el('div', 'sech');
    hh.appendChild(el('span', '', 'Rigs and weapons here (' + here.length + ')'));
    const place = s.location_id;
    if (yards && (yards[place] || []).length) {
      const shop = el('button', 'alt', 'Shipyard');
      shop.onclick = () => openFacilities(place, { shipId: s.id, label: s.hull_name || hullName(s.hull_id), shipLoc: place, back: () => openRigging(s.id, rback) });
      hh.appendChild(shop);
    }
    hsec.appendChild(hh);
    if (!here.length) hsec.appendChild(el('div', 'muted pad', 'None in your storage or hold here.' + (yards && (yards[place] || []).length ? ' The Shipyard button opens the store.' : '')));
    here.forEach(x => {
      const r = el('div', 'row'), side = el('div', 'rside');
      const where = [x.in_storage > 0 ? whole(x.in_storage) + ' in storage' : '', x.in_hold > 0 ? whole(x.in_hold) + ' in hold' : ''].filter(Boolean).join(', ');
      side.appendChild(el('span', 'rpw', whole(x.power_use) + ' power'));
      if (x.can_fit) { const f = el('button', '', 'Fit'); f.disabled = rbusy; f.onclick = () => doFit(x); side.appendChild(f); }
      else side.appendChild(el('span', 'rwhy', rigError({ message: x.problem.error, data: x.problem })));
      r.append(cell('', x.name + (x.elite ? ' (elite)' : ''), where + ' - ' + x.effect_text + (x.works_now ? '' : ' (inactive)')), side);
      hsec.appendChild(r);
    });
    b.appendChild(hsec);
  }
}

/* ---------- actions ---------- */
async function act(fn, okText) {
  if (rbusy) return;
  rbusy = true; rconfirm = false; drawRig();
  try { const r = await fn(); say(okText(r), 'ok'); }
  catch (e) { say(rigError(e), 'err'); }
  finally { rbusy = false; if (S.refresh) S.refresh(); refreshRig(); }
}
const doFit = x => act(() => call('rig_fit', { rig: x.rig_id, ship: rid }), () => 'Fitted ' + x.name + '.');
const doUnfit = x => act(() => call('rig_unfit', { fit: x.fit_id }), () => 'Took off ' + x.name + '. It is in your storage at ' + locName(rdata.ship.location_id) + '.');
const doUnfitAll = () => act(() => call('rig_unfit_all', { ship: rid }), r => r.count ? 'Took off ' + r.count + ' rigs and weapons. They are in your storage at ' + locName(rdata.ship.location_id) + '.' : 'Nothing was fitted.');

/* ---------- wiring ---------- */
// Open the Rigging screen for a ship of yours. back (optional) = what Back does; default: the Assets screen.
export function openRigging(shipId, back) {
  rid = shipId; rback = back || null; rdata = null; rconfirm = false;
  openScreen('rigging');
}
addScreen('rigging', 'Rigging', scr, {
  noTab: true,
  onShow: () => { rconfirm = false; refreshRig(); drawRig(); },
  update: () => { if (Date.now() - rAt > 12000) refreshRig(); },
});

/* called by main.js on log out */
export function resetRigging() {
  rid = null; rback = null; rdata = null; yards = null; rconfirm = false; rbusy = false;
  rbody.replaceChildren();
}
