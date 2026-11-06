// fly.js - the Fly screen (redone 2026-11-05 for phones): the map fills the frame and the controls float on it.
//   Top left: Inner / System / Ship + the mission timers. Top right: the ship chip with shield / armor / hull bars. Bottom: the arrival chip (in flight) above
//   the Launch / Destinations row. The destination list and the ship menu (with the zone dialog) are sheets that slide up from the bottom of the map.
// The thrust slider is gone: every flight asks for the ship's top thrust (maxG, from the server). Above the free thrust (3 g) the flight PULSES: burn half the
//   bar, refill at 3 g until full, burn again, for the whole trip. The rows show the average thrust that gives.
// Picking a destination is only a proposal (blue line + its time on the Launch button); nothing changes until Launch / Confirm is pressed. The same works IN FLIGHT:
//   pick a new destination (or the place you left = cancel the trip). The server plans the real course from the ship's position and speed right now.
// 076 lasting states: the ship chip menu holds the zone dialog (place info + Enter) when the ship is docked at a combat zone; it opens by itself on arrival.
import { BODIES, bodyPos, stateAt, shipStateAbs, planTravelPulse, stopPlan, segmentEnd } from 'physics';
import { S, $, say, call, fmt, whole, curGd, addScreen, screenWatchers, locName, enduranceNow, nowMs } from 'core';
import { createMap } from 'map';
import { zoneIn, zoneEnter, zoneShow, zoneCheck, zoneDrones, zoneOnInfo, zoneInfoKnown } from 'zone';

const SHOW_FLIGHT_BUTTONS = false;     /* Hold the bar / Stop / Coast: not in the MVP. Set to true to bring the three buttons back. */
let deps = null, depsAt = 0, selected = null, depsLoading = false, depsOpen = false;   /* depsOpen: the destination sheet is down until the Destinations button is tapped */
let mode = null;                       /* in flight only: null (a picked destination) | 'hold' | 'stop' | 'coast' */
let thrustG = 3, maxG = null;          /* thrustG = the thrust every flight asks for = the ship's top thrust (maxG, from the server's answer); 3 only until the first answer */
let ctlBox = null; const ctlBtn = {};
/* time left on the CURRENT trip: the small chip above the Launch button (#actr), the same number the Launch / Confirm button shows when the current destination is picked.
   tripEndMs = the real clock time of arrival, worked out from the destination list each time it loads. (thrustTouched is always false now that the slider is gone.) */
let etaEl = null, tripEndMs = null, thrustTouched = false;
function drawEta() {
  const box = $('actr'); if (!box) return;
  const show = isFlying() && deps && deps.dest && tripEndMs != null;
  if (!etaEl) {
    etaEl = document.createElement('span');
    etaEl.style.cssText = 'font-size:14px;color:#9fd4ff;white-space:nowrap';
    box.appendChild(etaEl);
  }
  if (!SHOW_FLIGHT_BUTTONS) box.hidden = !show;               /* with the three buttons on, drawControls() looks after the box */
  etaEl.hidden = !show;
  if (!show) return;
  const left = Math.round((tripEndMs - Date.now()) / 1000);
  etaEl.textContent = left > 0 ? 'Arrives in ' + fmt(left) : 'Arriving...';
}

/* the ship, if it is NOT docked (traveling, hopping or drifting) */
const flyingShip = () => { const s = S.last && (S.last.ships || [])[0]; return s && s.state !== 'docked' ? s : null; };
const isFlying = () => !!(deps && deps.flying);

/* ---------- in-flight controls: Hold the bar / Stop / Coast (buttons under the map, right side: #actr in index.html) ---------- */
function ensureControls() {
  if (!SHOW_FLIGHT_BUTTONS || ctlBox) return;                 /* off: the buttons are never made, so ctlBox stays null and everything below skips them */
  ctlBox = $('actr');
  [['hold', 'Hold the bar'], ['stop', 'Stop'], ['coast', 'Coast']].forEach(([m, label]) => {
    const b = document.createElement('button'); b.textContent = label; b.className = 'alt';
    b.onclick = () => { mode = mode === m ? null : m; if (mode) selected = null; drawAll(); };   /* a proposal: confirm with the button at the left */
    ctlBtn[m] = b; ctlBox.appendChild(b);
  });
}
function drawControls() {
  if (!ctlBox) return;
  ctlBox.hidden = !isFlying();
  if (!isFlying()) return;
  ctlBtn.hold.disabled = !deps.dest;                          /* nothing to hold toward while drifting */
  Object.entries(ctlBtn).forEach(([m, b]) => b.className = mode === m ? 'on' : 'alt');
}
function drawAll() { drawControls(); drawDeps(); drawEta(); map.need(); }

/* ---------- destination list (docked: departures; in flight: course options from where the ship is now) ---------- */
async function loadDeps() {
  if (depsLoading) return;
  depsLoading = true;
  const asked = thrustG;
  const fl = !!flyingShip();
  try {
    deps = await call(fl ? 'course_options' : 'departures', { g: asked }); depsAt = Date.now();
    maxG = Number(deps.max_g) || 3; thrustG = maxG; ensureControls();   /* always the ship's top thrust (a changed top is picked up here; the list is asked for again below) */
    if (!fl) { tripEndMs = null; thrustTouched = false; }
    else if (!thrustTouched && deps.dest) {                   /* the current destination's time, as the Confirm button would show it */
      const cur = (deps.departures || []).find(x => x.id === deps.dest);
      if (cur) tripEndMs = depsAt + Number(cur.eta_real_minutes) * 60000;
    }
    drawAll();
  }
  catch (e) {
    if (e.message === 'bad_thrust' && e.data && e.data.max_g) { maxG = Number(e.data.max_g); thrustG = maxG; }   /* the server says what the top is: ask again with that */
    else say('Error: ' + e.message, 'err');
  }
  finally { depsLoading = false; if (thrustG !== asked) loadDeps(); }
}
function selectedBody() {
  const id = mode === 'hold' && deps ? deps.dest : selected;
  const d = deps && deps.departures && deps.departures.find(x => x.id === id);
  return d ? d.anchor_body : null;
}
/* the Launch / Confirm button: the word, and under it (small) the trip time of the picked destination */
function setGo(main, sub) {
  const go = $('go'); go.replaceChildren(document.createTextNode(main));
  if (sub) { const s = document.createElement('small'); s.textContent = sub; go.appendChild(s); }
}
function drawDeps() {
  const box = $('deps'), go = $('go');
  const st = box.scrollTop;                                   /* keep the list where the finger left it */
  box.replaceChildren();
  const live = !!(deps && (deps.docked || deps.flying));
  if (!live) {
    box.textContent = 'Destinations appear when your ship is docked or in flight.';
    go.disabled = true; setGo('Launch'); map.need(); return;
  }
  const fl = isFlying();
  const list = deps.departures || [];
  if (!list.some(d => d.id === selected)) selected = null;
  const groups = {};
  list.forEach(d => (groups[d.anchor_body] = groups[d.anchor_body] || []).push(d));
  const pick = list.find(d => d.id === selected);
  const fresh = deps.g === thrustG;                           /* the list was asked for at the thrust we use now */
  const main = fl ? 'Confirm' : 'Launch', sub = !pick ? '' : !fresh ? '...' : fmt(pick.eta_real_minutes * 60);
  Object.entries(groups)
    .sort((x, y) => x[1][0].eta_real_minutes - y[1][0].eta_real_minutes)
    .forEach(([, rows]) => {
      rows.forEach(d => {
        const r = document.createElement('div');
        r.className = 'row' + (d.id === selected && !mode ? ' sel' : '');
        const n = document.createElement('span');
        n.textContent = d.name + (d.sun_danger ? ' (near Sun!)' : '') +
          (fl && d.id === deps.dest ? ' (current destination)' : '') + (fl && d.id === deps.origin ? ' (where you left: cancels the trip)' : '');
        const e = document.createElement('span'); e.className = 'eta';
        let t = fmt(d.eta_real_minutes * 60);
        if (d.pulsed) t += '  |  avg ' + d.g_avg.toFixed(1) + ' g';
        e.textContent = t;
        r.append(n, e);
        r.onclick = () => { selected = d.id; mode = null; drawAll(); };
        box.appendChild(r);
      });
    });
  box.scrollTop = st;
  if (fl && mode) { go.disabled = false; setGo('Confirm', mode); map.need(); return; }   /* hold / stop / coast */
  go.disabled = !pick || !fresh;
  setGo(main, sub);
  map.need();
}

/* the ship's speed in km/s for the map: from its stored plan (in a hop: relative to the body); null while docked */
const AU_DAY_KMS = 149597870.7 / 86400;
function shipSpeedKms() {
  const ship = S.last && (S.last.ships || [])[0];
  if (!ship || ship.state === 'docked' || !ship.plan) return null;
  const s = stateAt(ship.plan, curGd());
  return Math.hypot(s.vx, s.vy) * AU_DAY_KMS;
}
/* where is the ship right now? (from its stored plan, or from the body it sits at) */
function shipPoint() {
  const ship = S.last && (S.last.ships || [])[0]; if (!ship) return null;
  const gd = curGd();
  if (ship.state === 'traveling' && ship.plan) { const s = stateAt(ship.plan, gd); return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, ax: s.ax, ay: s.ay, a: s.a, plan: ship.plan }; }
  /* a hop (or a drift that began in a hop): its plan is stored relative to the body (plan.frame); shipStateAbs adds the body.
     A drift in space has no frame: shipStateAbs gives the plain state. */
  if ((ship.state === 'hopping' || ship.state === 'drifting') && ship.plan) {
    const s = shipStateAbs(ship.plan, gd);
    let course = null;
    if (ship.state === 'hopping') course = ship.plan;                                 /* the hop itself (the map adds the body to a plan in its frame) */
    else if (ship.plan.segs.length) course = ship.plan;                               /* after Stop: the braking path to the stopping point (nothing once at rest) */
    else if (Math.hypot(s.vx, s.vy) > 1e-9) course = coastPreview({ x: s.x, y: s.y, vx: s.vx, vy: s.vy }, gd);   /* after Coast: a line ahead along the heading */
    return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, ax: s.ax, ay: s.ay, a: s.a, plan: course };
  }
  let body = null, off = { x: 0, y: 0 };
  if (ship.state === 'docked') { const l = (S.last.locations || []).find(x => x.id === ship.location_id); body = l && l.anchor_body; off = l ? placeXY(l) : off; }
  else if (ship.state === 'hopping') { const a = (S.last.actions || []).find(x => x.status === 'pending'); body = a && a.payload && a.payload.to; }
  const i = BODIES.findIndex(b => b.n === body); if (i < 1) return null;
  const p = bodyPos(BODIES[i], gd); return { x: p[0] + off.x, y: p[1] + off.y, plan: null };
}

/* 091: the other pilots as map points. The server sends name, hull and either the docked place or the flight plan; the position is worked out here,
   with the same shared physics as the own ship, so they move smoothly between the 30-second answers. */
function otherPoints() {
  const arr = (S.last && S.last.others) || [];
  if (!arr.length) return [];
  const gd = curGd(), locs = S.last.locations || [], out = [];
  for (const o of arr) {
    let p = null;
    try {
      if (o.plan && o.state === 'traveling') p = stateAt(o.plan, gd);
      else if (o.plan && (o.state === 'hopping' || o.state === 'drifting')) p = shipStateAbs(o.plan, gd);
      else if (o.loc) {
        const l = locs.find(x => x.id === o.loc), i = l ? bodyIdx(l.anchor_body) : -1;
        if (i > 0) { const b = bodyPos(BODIES[i], gd), off = placeXY(l); p = { x: b[0] + off.x, y: b[1] + off.y }; }
      }
    } catch (e) { p = null; }
    if (p) out.push({ x: p.x, y: p.y, name: o.name, hull: o.hull, fight: o.fight, docked: !!o.loc });
  }
  return out;
}
function pilotsText(list) {
  if (list.length === 1) return list[0].name + ' · ' + list[0].hull + (list[0].fight ? ' (in combat)' : '');
  return list.length + ' pilots: ' + list.slice(0, 8).map(o => o.name).join(', ') + (list.length > 8 ? ' and ' + (list.length - 8) + ' more' : '');
}

/* Blue preview course. Display only: same shared physics as the server, recomputed every 3 s because the planets move
   (and at once when the slider, the pick or the button changes). The real course is planned by the server at confirm. */
let pv = { key: '', plan: null };
const bodyIdx = name => BODIES.findIndex(b => b.n === name);
function coastPreview(st, t) {                                 /* 2 game days of straight flight, so there is a line to see */
  const s = { t0: t, dur: 2, x: st.x, y: st.y, vx: st.vx, vy: st.vy, ax: 0, ay: 0 };
  return { segs: [s], t0: t, T: 2, tEnd: t + 2, tgt: null, dock: -1, end: segmentEnd(s) };
}
/* where a place sits relative to its planet (AU): its distance at its fixed angle (same rule as placeXY on the server) */
const placeXY = l => { const r = Number(l.offset_au) || 0, a = (Number(l.angle_deg) || 0) * Math.PI / 180; return { x: r * Math.cos(a), y: r * Math.sin(a) }; };
const locById = id => (S.last && S.last.locations || []).find(x => x.id === id);
/* a hop is planned in the body's own frame: positions are the places' offsets from the body (AU) along one fixed axis */
function hopPreview(fromState, toLoc, t, g, frame, regen0) {
  const r = planTravelPulse({ from: { state: fromState }, to: placeXY(toLoc), departT: t, g,
    bar: Number(deps.endurance), mx: Number(deps.endurance_max), freeG: Number(deps.free_g), refill: Number(deps.refill),
    perG: Number(deps.per_g), share: Number(deps.share), regen0: !!regen0 });
  if (!r.ok) return null;
  r.plan.frame = frame; return r.plan;
}
function previewPlan() {
  const ship = S.last && (S.last.ships || [])[0];
  if (!ship || !deps) return null;
  if (ship.state === 'docked') {
    if (!deps.docked) return null;
    const d = (deps.departures || []).find(x => x.id === selected); if (!d) return null;
    const l = locById(ship.location_id), dl = locById(d.id);
    if (!l || !dl) return null;
    const key = 'D|' + selected + '|' + thrustG + '|' + Math.floor(Date.now() / 3000);
    if (pv.key !== key) {
      if (l.anchor_body === d.anchor_body) {                    /* same body: a hop */
        pv = { key, plan: hopPreview({ ...placeXY(l), vx: 0, vy: 0 }, dl, curGd(), thrustG, bodyIdx(l.anchor_body), false) };
      } else {
        const r = planTravelPulse({ from: { body: bodyIdx(l.anchor_body) },
          to: { body: bodyIdx(d.anchor_body) }, departT: curGd(), g: thrustG,
          bar: Number(deps.endurance), mx: Number(deps.endurance_max), freeG: Number(deps.free_g), refill: Number(deps.refill),
          perG: Number(deps.per_g), share: Number(deps.share) });
        pv = { key, plan: r.ok ? r.plan : null };
      }
    }
    return pv.plan;
  }
  if (!deps.flying) return null;
  const sp = shipPoint(); if (!sp || sp.vx == null) return null;
  const frame = ship.plan && ship.plan.frame != null ? ship.plan.frame : null;
  const key = 'F|' + ship.state + '|' + mode + '|' + selected + '|' + thrustG + '|' + Math.floor(Date.now() / 3000);
  if (pv.key !== key) {
    pv = { key, plan: null };
    const st = { x: sp.x, y: sp.y, vx: sp.vx, vy: sp.vy }, t = curGd();
    const rel = frame != null ? stateAt(ship.plan, t) : null;   /* state in the body's frame, when the ship is inside one */
    const relSt = rel ? { x: rel.x, y: rel.y, vx: rel.vx, vy: rel.vy } : null;
    if (mode === 'stop') {
      if (frame == null) pv.plan = stopPlan(st, t, Number(deps.free_g));
      else { const p = stopPlan(relSt, t, Number(deps.free_g)); if (p) { p.frame = frame; pv.plan = p; } }
    }
    else if (mode === 'coast') pv.plan = coastPreview(st, t);
    else {
      const d = (deps.departures || []).find(x => x.id === (mode === 'hold' ? deps.dest : selected));
      if (d) {
        const g = mode === 'hold' ? Number(deps.free_g) : thrustG;
        if (frame != null && BODIES[frame].n === d.anchor_body) {
          const dl = locById(d.id); if (dl) pv.plan = hopPreview(relSt, dl, t, g, frame, deps.regen0);
        } else {
          const bar = enduranceNow();
          const r = planTravelPulse({ from: { state: st }, to: { body: bodyIdx(d.anchor_body) }, departT: t, g,
            bar: bar == null ? Number(deps.endurance) : bar, mx: Number(deps.endurance_max), freeG: Number(deps.free_g),
            refill: Number(deps.refill), perG: Number(deps.per_g), share: Number(deps.share), regen0: !!deps.regen0 });
          pv.plan = r.ok ? r.plan : null;
        }
      }
    }
  }
  return pv.plan;
}

const map = createMap($('map'), {
  ship: shipPoint,
  others: otherPoints,
  pickPilots: list => say(pilotsText(list), 'muted'),
  speed: shipSpeedKms,
  insetBottom: () => { const b = document.querySelector('#scr-travel .fbar'); return b ? b.offsetHeight + 12 : 0; },   /* the Launch row (and the arrival chip) cover the map's bottom: the scale bar sits above them */
  preview: previewPlan,
  selectedBody,
  /* places a little away from their planet (offset > 0): the map draws them once zoomed in far enough, and they can be tapped */
  places: () => (S.last && S.last.locations || []).filter(l => Number(l.offset_au) > 0 && bodyIdx(l.anchor_body) > 0)
    .map(l => ({ id: l.id, name: l.name, kind: l.kind, body: bodyIdx(l.anchor_body), off: Number(l.offset_au), ang: (Number(l.angle_deg) || 0) * Math.PI / 180 })),
  selectedPlace: () => (mode === 'hold' && deps ? deps.dest : selected),
  pickPlace: id => {
    if (zoneShip && zoneShip.location_id === id && zonePlace(zoneShip)) { openChipMenu(); return; }   /* the place the ship is docked at: the ship menu (it holds the zone choices) */
    const d = deps && deps.departures && deps.departures.find(x => x.id === id);
    if (d) { selected = d.id; mode = null; drawAll(); } else say('That place is not a destination from here.', 'muted');
  },
  pickShip: () => toggleChipMenu(),                           /* the ship itself was touched: the ship menu (at a zone place it holds the zone choices) */
  pick: name => {
    const d = deps && deps.departures && deps.departures.find(x => x.anchor_body === name && x.is_default);
    if (d) { selected = d.id; mode = null; drawAll(); } else say(name + ' is not a destination from here.', 'muted');
  },
});
$('zInner').onclick = () => map.preset('inner');
$('zSys').onclick = () => map.preset('sys');
$('zShip').onclick = () => map.preset('ship');

/* the map fills the frame: its height = the window minus what is above it (the top bar) minus the tab bar. Runs when the screen opens, on every resize and when the top bar changes height. */
function sizeFrame() {
  const wrap = document.querySelector('#scr-travel .mapwrap'), nav = $('nav');
  if (!wrap || $('scr-travel').hidden) return;
  const top = wrap.getBoundingClientRect().top + window.scrollY;
  const navH = nav && !nav.hidden ? nav.offsetHeight : 0;
  wrap.style.height = Math.max(240, Math.floor(window.innerHeight - top - navH)) + 'px';
}
window.addEventListener('resize', sizeFrame);
if (window.visualViewport) window.visualViewport.addEventListener('resize', sizeFrame);
if (window.ResizeObserver) new ResizeObserver(sizeFrame).observe($('topbar'));
screenWatchers.push(name => { document.body.classList.toggle('fly', name === 'travel'); sizeFrame(); });   /* body.fly: slimmer page margins, no scrolling space under the map */

/* the destination list is a sheet that slides up from the bottom of the map (above the Launch row): the Destinations button opens and closes it */
function showDeps() { $('deps').classList.toggle('open', depsOpen); $('depscaret').textContent = depsOpen ? '-' : '+'; }
function closeDeps() { if (depsOpen) { depsOpen = false; showDeps(); } }
document.addEventListener('click', ev => {                    /* a touch anywhere else closes the list (composedPath: a tapped row may already be gone from the page) */
  if (depsOpen && !ev.composedPath().includes($('deps')) && !ev.composedPath().includes($('depshead'))) closeDeps();
});
$('depshead').onclick = () => { depsOpen = !depsOpen; if (depsOpen && chipMenu) chipMenu.hidden = true; showDeps(); };
/* ---------- the ship chip (top right of the map) with 3 small bars under it, and the SHIP MENU ----------
   The server sends ship.cond = { name (hull), weapons[], rigs[] (names), sh/shm (shield now/max), ar/arm, hu/hum, shr/arr (regeneration per real second,
   0 when it is not regenerating), am/amm (missile ammo), fight, market }. Between answers the page only moves shield and armor along their rate
   (local seconds since the answer arrived), so the bars rise smoothly.
   The menu opens by touching the chip or the ship on the map. At a place of kind 'range' or 'zone' it also holds the zone choices
   (what the old zone box held: the place's info text and the Enter buttons) and it opens by itself once when the ship arrives there.
   The ship part is built from one description object (shipInfo), so other ships (allies, when fleets exist) can use the same layout. */
let zoneShip = null, zoneOpenFor = null;
zoneOnInfo(() => { if (zoneShip) drawChip(zoneShip); });       /* the range check answered: the menu may open now, and shows the choices the pilot really has */
function zonePlace(ship) {
  const l = ship && ship.state === 'docked' ? locById(ship.location_id) : null;
  return l && (l.svc ? l.svc.includes('combat') : (l.kind === 'range' || l.kind === 'zone')) ? l : null;   /* 077: the place's services say it is a combat zone (kind is the fallback for an old answer) */
}
function drawZone(ship) {                                      /* called on every update: no box any more, it only keeps the ship and asks the range check */
  zoneShip = ship;
  if (zonePlace(ship)) zoneCheck();                            /* already inside from an earlier visit? then zone.js opens its screen by itself */
}

const SHIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 20 21l-8-4.2L4 21z"/></svg>';
let chipBox = null, chipBtn = null, chipBars = [], chipMenu = null, condNow = null, condRecv = 0, condKey = null;
function mkChipBar(color) {
  const w = document.createElement('div'), f = document.createElement('i'), t = document.createElement('span');
  w.className = 'shb'; f.style.background = color; w.append(f, t);
  return { w, set(frac, text) { f.style.width = Math.max(0, Math.min(100, frac * 100)) + '%'; t.textContent = text; } };
}
function ensureChip() {
  if (chipBox) return true;
  const wrap = document.querySelector('#scr-travel .mapwrap');
  if (!wrap) return false;
  chipBox = document.createElement('div'); chipBox.className = 'shc'; chipBox.hidden = true;
  chipBtn = document.createElement('button'); chipBtn.className = 'shq'; chipBtn.innerHTML = SHIP_ICON;
  chipBtn.onclick = ev => { ev.stopPropagation(); toggleChipMenu(); };
  chipBars = [mkChipBar('#3f8cff'), mkChipBar('#c9a24a'), mkChipBar('#4cd37a')];      /* shield, armor, hull: the same colors as the combat screen */
  chipBox.append(chipBtn, ...chipBars.map(b => b.w));
  chipMenu = document.createElement('div'); chipMenu.className = 'shm'; chipMenu.hidden = true;
  wrap.append(chipBox, chipMenu);
  document.addEventListener('click', ev => {                   /* a touch anywhere else closes the menu */
    if (chipMenu && !chipMenu.hidden && !chipMenu.contains(ev.target) && !chipBox.contains(ev.target)) chipMenu.hidden = true;
  });
  return true;
}
function liveCond() {                                          /* the numbers now: the answer's numbers moved along their rates */
  const c = condNow; if (!c) return null;
  const dt = c.fight || c.hangar ? 0 : Math.max(0, (Date.now() - condRecv) / 1000);
  return { sh: Math.min(c.shm, c.sh + c.shr * dt), ar: Math.min(c.arm, c.ar + c.arr * dt), hu: c.hu };
}
function drawChipBars() {
  if (!chipBox || chipBox.hidden) return;
  const c = condNow, v = liveCond();
  chipBars.forEach(b => { b.w.style.visibility = c ? 'visible' : 'hidden'; });
  if (!c || !v) return;
  chipBars[0].set(c.shm > 0 ? v.sh / c.shm : 0, String(Math.round(v.sh)));
  chipBars[1].set(c.arm > 0 ? v.ar / c.arm : 0, String(Math.round(v.ar)));
  chipBars[2].set(c.hum > 0 ? v.hu / c.hum : 0, String(Math.round(v.hu)));
}
const mkDiv = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; };
function namesList(arr) {                                      /* ['Railgun', 'Railgun', 'Shield'] -> rows 'Railgun x2', 'Shield' ; none -> 'None fitted' */
  const n = new Map(); (arr || []).forEach(x => n.set(x, (n.get(x) || 0) + 1));
  if (!n.size) return [mkDiv('shl', 'None fitted')];
  return [...n].map(([k, v]) => mkDiv('shl', v > 1 ? k + ' x' + v : k));
}
/* the rows that describe one ship: info = { pilot, hull, weapons[], rigs[], am, amm } (your ship now; an ally's later) */
function shipRows(info) {
  const rows = [mkDiv('shn', info.pilot || 'Pilot')];
  if (info.hull) rows.push(mkDiv('shh', info.hull));
  if (info.maxG) rows.push(mkDiv('shl', 'Max thrust ' + (+Number(info.maxG).toFixed(2)) + ' g'));
  rows.push(mkDiv('shs', 'Weapons'), ...namesList(info.weapons), mkDiv('shs', 'Rigs'), ...namesList(info.rigs));
  if (info.amm > 0) rows.push(mkDiv('shl', 'Ammo: ' + info.am + ' / ' + info.amm));
  return rows;
}
/* the zone choices (what the old zone box held), for the place the ship is docked at */
function zoneRows(l) {
  const inside = zoneIn();
  const rows = [mkDiv('shn', l.name), mkDiv('shi', l.info || 'This is where combat will happen.')];
  const drs = inside ? [] : zoneDrones();                       /* an instanced range: one Enter button for each drone the pilot may ask for (only when there is a choice) */
  const mkEnter = (label, drone) => {                          /* drone = a choice object from zoneDrones(), or nothing */
    const b = document.createElement('button'); b.textContent = label; b.className = 'zgo';
    b.onclick = async () => {
      b.disabled = true;
      try { chipMenu.hidden = true; if (inside) await zoneShow(); else await zoneEnter(drone); }
      catch (e) { say('Error: ' + ((e.data && (e.data.message || e.data.error)) || e.message), 'err'); }
      finally { b.disabled = false; }
    };
    return b;
  };
  const enters = drs.length > 1 ? drs.map(d => mkEnter('Enter: ' + d.name + (d.unlocked ? '' : ' (starts its mission)'), d)) : [mkEnter(inside ? 'Return to the zone' : 'Enter the zone')];
  if (!inside && !zoneInfoKnown()) enters.forEach(b => { b.disabled = true; b.textContent = 'Checking the range...'; });   /* no Enter until we know which drones the pilot may ask for */
  rows.push(...enters, mkDiv('shd', ''));
  return rows;
}
function drawChipMenu() {
  if (!chipMenu) return;
  const pname = (S.last && S.last.character && S.last.character.name) || 'Pilot';
  const c = condNow;
  const zl = zonePlace(zoneShip);
  const rows = zl ? zoneRows(zl) : [];
  rows.push(...shipRows({ pilot: pname, hull: c && c.name, maxG, weapons: c && c.weapons, rigs: c && c.rigs, am: c ? c.am : 0, amm: c ? c.amm : 0 }));
  const set = document.createElement('button'); set.className = 'alt'; set.textContent = 'Settings (coming soon)'; set.disabled = true;
  rows.push(set);
  chipMenu.replaceChildren(...rows);
  chipBtn.title = pname;
}
function openChipMenu() { if (ensureChip() && !chipBox.hidden) { closeDeps(); drawChipMenu(); chipMenu.hidden = false; } }
function toggleChipMenu() {
  if (!ensureChip() || chipBox.hidden) return;
  if (chipMenu.hidden) openChipMenu(); else chipMenu.hidden = true;
}
function drawChip(ship) {
  if (!ensureChip()) return;
  if (!ship) { chipBox.hidden = true; chipMenu.hidden = true; condNow = null; zoneOpenFor = null; return; }
  const c = ship.cond || null;
  const key = c ? c.at + '|' + ship.id : null;
  if (key !== condKey) { condKey = key; condNow = c; condRecv = Date.now(); }       /* a new answer: the local seconds start again from it */
  if (!c) condNow = null;
  chipBox.hidden = false;
  drawChipBars();
  /* ARRIVAL at a zone place: the menu opens by itself, once per stay (not while the ship is inside a fight: zone.js has its own screen then) */
  const zl = zonePlace(ship);
  if (!zl) zoneOpenFor = null;
  else if (zoneOpenFor !== zl.id && zoneInfoKnown()) { zoneOpenFor = zl.id; if (!zoneIn()) { openChipMenu(); return; } }
  if (!chipMenu.hidden) drawChipMenu();
}
setInterval(drawChipBars, 1000);

/* 086: TIMERS of timed missions. One touchable chip for each running timer (they stack downward, top left of the map, under the zoom buttons). A touch shows the mission's name for 4 seconds.
   The list comes from the server (me.mission_timers); when a clock reaches zero the page asks the server once, which marks the mission failed and removes the chip. */
const tmrSt = document.createElement('style');
tmrSt.textContent = '#scr-travel .tmrs{position:absolute;top:48px;left:8px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;z-index:6}'
  + '#scr-travel .tmrs button{margin:0;padding:6px 10px;min-height:0;width:auto;font-size:14px;font-weight:700;background:#131a2a;color:#e8b64a;border:1px solid #3a4666;border-radius:8px}'
  + '#scr-travel .tmrs button.low{color:#ff6b6b;border-color:#ff6b6b}';
document.head.appendChild(tmrSt);
let tmrBox = null;
const tmrBtn = {}, tmrName = {}, tmrDone = {};
const tmrClock = ms => {                                       /* 1450000 -> '24:10' ; 3725000 -> '1:02:05' */
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
};
function drawTimers() {
  const wrap = document.querySelector('#scr-travel .mapwrap');
  if (!wrap) return;
  const list = (S.last && S.last.character && S.last.mission_timers) || [];
  if (!tmrBox) { tmrBox = document.createElement('div'); tmrBox.className = 'tmrs'; wrap.appendChild(tmrBox); }
  /* sit just under the view buttons at the top left of the map (Inner / System / Ship, found by their label; if they cannot be found the CSS position is used) */
  const wr = wrap.getBoundingClientRect();
  if (wr.height > 0) {
    const zb = [...document.querySelectorAll('#scr-travel button')].filter(b => !tmrBox.contains(b) && /^\s*(inner|system|ship)\s*$/i.test(b.textContent)
      && b.getBoundingClientRect().top < wr.top + 160 && b.getBoundingClientRect().bottom > wr.top - 60);
    if (zb.length) {
      const rects = zb.map(b => b.getBoundingClientRect());
      tmrBox.style.top = Math.max(8, Math.round(Math.max(...rects.map(r => r.bottom)) - wr.top + 8)) + 'px';
      tmrBox.style.left = Math.max(4, Math.round(Math.min(...rects.map(r => r.left)) - wr.left)) + 'px';
    }
  }
  const ids = new Set(list.map(t => t.id));
  for (const id in tmrBtn) if (!ids.has(id)) { tmrBtn[id].remove(); delete tmrBtn[id]; delete tmrDone[id]; }
  for (const t of list) {
    let b = tmrBtn[t.id];
    if (!b) {
      b = document.createElement('button');
      b.onclick = ev => { ev.stopPropagation(); tmrName[t.id] = Date.now() + 4000; drawTimers(); };
      tmrBtn[t.id] = b; tmrBox.appendChild(b);
    }
    const ms = new Date(t.due_at).getTime() - nowMs();
    b.textContent = (tmrName[t.id] > Date.now() ? t.title + '  ' : '') + tmrClock(ms);
    b.classList.toggle('low', ms < 60000);
    if (ms <= 0 && !tmrDone[t.id]) { tmrDone[t.id] = true; if (S.refresh) S.refresh(); }
  }
}
setInterval(drawTimers, 1000);

addScreen('travel', 'Fly', $('scr-travel'), {
  onShow: () => { sizeFrame(); map.resize(); map.need(); },
  update: ship => {
    drawZone(ship);
    drawChip(ship);
    drawTimers();
    if (!ship) { map.need(); return; }
    const fl = ship.state !== 'docked';
    /* the list on screen must match the ship's state: docked list for a docked ship, course options for a flying one */
    const fits = deps && (fl ? deps.flying : (deps.docked && deps.from === ship.location_id));
    if (deps && !fits) { deps = null; mode = null; drawAll(); }
    if (!deps || Date.now() - depsAt > 30000) loadDeps();
    map.need();
  },
});

/* The confirm button: Launch (docked) or Confirm course (in flight). It is the only thing that changes the ship. */
function courseMessage(r) {
  if (r.kind === 'drift') return r.mode === 'stop'
    ? 'Braking to a stop (about ' + r.brake_real_minutes.toFixed(1) + ' real minutes). Then the ship drifts: pick a destination.'
    : 'Engine cut. The ship keeps its speed and direction.';
  return (r.mode === 'hold' ? 'Holding the bar: ' : 'New course: ') + r.to + ' at ' + r.g + ' g' +
    (r.pulsed ? ' (pulsing, average ' + r.g_avg.toFixed(1) + ' g)' : '') + '. Trip takes ' + r.duration_real_minutes.toFixed(1) + ' real minutes.' +
    (r.sun_danger ? ' WARNING: passes close to the Sun.' : '');
}
$('go').onclick = async () => {
  const go = $('go'); go.disabled = true;
  try {
    if (isFlying()) {
      const r = await call('course_change', mode ? { mode } : { mode: 'go', to: selected, g: thrustG });
      say(courseMessage(r), 'ok');
    } else {
      const r = await call('queue_travel', { to: selected, g: thrustG });
      say('Launched to ' + r.to + ' at ' + r.g + ' g' + (r.pulsed ? ' (pulsing, average ' + r.g_avg.toFixed(1) + ' g)' : '') +
        '. Trip takes ' + r.duration_real_minutes.toFixed(1) + ' real minutes.' +
        (r.sun_danger ? ' WARNING: passes close to the Sun.' : ''), 'ok');
    }
    thrustTouched = false; tripEndMs = null;
    deps = null; selected = null; mode = null; depsOpen = false; showDeps(); drawAll();   /* a launched trip closes the list */
    await S.refresh();
  } catch (e) {
    say('Error: ' + (e.message === 'arrived' ? 'the ship has just arrived; look again.' : e.message), 'err');
    deps = null; mode = null; await S.refresh(); loadDeps();
  }
};

/* called by main.js */
export function invalidateDeps() { deps = null; }                      /* ETAs changed (game speed): fetch them again */
export function resetFly() { tripEndMs = null; thrustTouched = false; deps = null; selected = null; mode = null; thrustG = 3; maxG = null; if (ctlBox) ctlBox.hidden = true; if (chipBox) { chipBox.hidden = true; chipMenu.hidden = true; } condNow = null; condKey = null; zoneOpenFor = null; zoneShip = null; }   /* log out */

setInterval(drawEta, 1000);                                     /* the countdown ticks once a second (does nothing unless the ship is flying) */
