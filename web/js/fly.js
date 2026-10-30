// fly.js - the Fly screen: vertical thrust slider on the map, destination list, ship position, blue preview course, Launch / Confirm button
// 076 lasting states: the ship chip (top right of the map) with shield / armor / hull bars under it; touch it for the ship menu; touch the ship on the map
//   while docked at a zone and the zone box comes back (the same box as on arrival).
// under the map (left) and the in-flight buttons under the map (right).
// Step 4a: moving the thrust slider only makes a POSSIBLE course (blue line + new ETAs). Nothing changes until the
//   confirm button is pressed.
// Step 4b: the same works IN FLIGHT. While the ship flies or drifts you can pick a new destination (or the place you
//   left = cancel the trip), change the thrust, or use Hold the bar / Stop / Coast. Each is only a proposal (blue line)
//   until you press the confirm button. The server plans the real course from the ship's position and speed right now.
// Any thrust may launch. Above the free thrust (3 g) the flight PULSES: burn half the bar, refill at 3 g until full,
// burn again, for the whole trip. The rows show the average thrust that gives.
import { BODIES, bodyPos, stateAt, shipStateAbs, planTravelPulse, stopPlan, segmentEnd } from 'physics';
import { S, $, say, call, fmt, whole, curGd, addScreen, locName, enduranceNow } from 'core';
import { createMap } from 'map';
import { zoneIn, zoneEnter, zoneShow, zoneCheck, zoneDrones, zoneOnInfo, zoneInfoKnown } from 'zone';

const SHOW_FLIGHT_BUTTONS = false;     /* Hold the bar / Stop / Coast: not in the MVP. Set to true to bring the three buttons back. */
let reveal = false;                    /* true right after a line is tapped: scroll so the Launch button under it is in view */
let deps = null, depsAt = 0, selected = null, depsLoading = false, depsOpen = false;   /* depsOpen: the destination list is folded until its label is tapped */
let mode = null;                       /* in flight only: null (a picked destination) | 'hold' | 'stop' | 'coast' */
let thrustG = 3;                       /* the slider value (game g); the server decides if it is allowed */
let thrustBox = null, thrustIn = null, thrustTxt = null, thrustArea = null, loadTimer = null;
let ctlBox = null; const ctlBtn = {};
/* time left on the CURRENT trip: shown at the right under the map (in #actr), the same number the Launch / Confirm button shows when the current destination is picked.
   tripEndMs = the real clock time of arrival, worked out from the destination list each time it loads. Once the thrust slider is moved the list shows a
   PROPOSAL, so tripEndMs is then left alone (thrustTouched) until a course is confirmed or the ship docks. */
let etaEl = null, tripEndMs = null, thrustTouched = false;
function drawEta() {
  const box = $('actr'); if (!box) return;
  const show = isFlying() && deps && deps.dest && tripEndMs != null;
  if (!etaEl) {
    etaEl = document.createElement('span');
    etaEl.style.cssText = 'align-self:center;margin-left:auto;text-align:right;font-size:14px;color:#9fd4ff;white-space:nowrap';
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

/* ---------- thrust slider: vertical, on the right side of the map (made here, put inside the map box) ---------- */
/* The slider moves along a list of STOPS: every half g from 1 g up, plus the ship's exact top thrust when that falls between
   two half steps (skills such as Heavy Burn make it e.g. 6.18 g). The range input counts stops (0, 1, 2...), not g. */
let thrustStops = [1];
function stopsFor(maxG) {
  const m = Math.max(1, Number(maxG) || 1), half = Math.max(1, Math.floor(m * 2) / 2), out = [];
  for (let g = 1; g <= half + 1e-9; g += 0.5) out.push(g);
  if (m - half > 0.001) out.push(m);
  return out;
}
const stopIndex = g => { let k = 0; thrustStops.forEach((v, i) => { if (v <= g + 1e-9) k = i; }); return k; };   /* the highest stop at or below g */
function ensureThrust(maxG) {
  thrustStops = stopsFor(maxG);
  if (!thrustBox) {
    thrustBox = document.createElement('div'); thrustBox.className = 'thr';
    thrustTxt = document.createElement('div'); thrustTxt.className = 'thrl';
    thrustArea = document.createElement('div'); thrustArea.className = 'thra';
    thrustIn = document.createElement('input');
    thrustIn.type = 'range'; thrustIn.min = '0'; thrustIn.step = '1';
    thrustIn.oninput = () => {
      thrustG = thrustStops[Number(thrustIn.value)] ?? thrustG;
      thrustTouched = true;                                   /* the list now shows a proposal, not the real trip */
      /* in flight, moving the slider with nothing picked proposes the SAME destination at the new thrust */
      if (isFlying() && !selected && !mode && deps.dest) selected = deps.dest;
      if (isFlying() && mode && mode !== 'go') mode = null;
      drawAll();                                              /* possible course only: nothing is sent */
      clearTimeout(loadTimer);
      loadTimer = setTimeout(loadDeps, 400);                  /* fresh ETAs and costs once the finger rests */
    };
    thrustArea.appendChild(thrustIn);
    thrustBox.append(thrustTxt, thrustArea);
    $('map').parentNode.appendChild(thrustBox);
    window.addEventListener('resize', sizeThrust);
  }
  thrustIn.max = String(thrustStops.length - 1);
  thrustG = thrustStops[stopIndex(thrustG)];                  /* if the top came down, move to the highest stop that still fits */
  thrustIn.value = String(stopIndex(thrustG));
}
/* the slider is a normal range input turned 90 degrees: its length = the height of its area (max at the top) */
function sizeThrust() {
  if (!thrustArea) return;
  const H = thrustArea.clientHeight, W = thrustArea.clientWidth;
  if (!H || !W) return;
  thrustIn.style.width = H + 'px'; thrustIn.style.height = W + 'px'; thrustIn.style.top = H + 'px';
}
function drawThrust() {
  if (!thrustBox) return;
  thrustTxt.textContent = String(+thrustG.toFixed(2)) + ' g';          /* 6 g, 4.5 g, 6.18 g */
  thrustIn.value = String(stopIndex(thrustG));
}

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
function drawAll() { drawThrust(); drawControls(); drawDeps(); drawEta(); map.need(); }

/* ---------- destination list (docked: departures; in flight: course options from where the ship is now) ---------- */
async function loadDeps() {
  if (depsLoading) return;
  depsLoading = true;
  const asked = thrustG;
  const fl = !!flyingShip();
  try {
    deps = await call(fl ? 'course_options' : 'departures', { g: asked }); depsAt = Date.now();
    ensureThrust(deps.max_g || 3); ensureControls();
    if (!fl) { tripEndMs = null; thrustTouched = false; }
    else if (!thrustTouched && deps.dest) {                   /* the current destination's time, as the Confirm button would show it */
      const cur = (deps.departures || []).find(x => x.id === deps.dest);
      if (cur) tripEndMs = depsAt + Number(cur.eta_real_minutes) * 60000;
    }
    drawAll();
  }
  catch (e) {
    if (e.message === 'bad_thrust' && e.data && e.data.max_g) { ensureThrust(e.data.max_g); }   /* snaps the slider down to the highest allowed stop */
    else say('Error: ' + e.message, 'err');
  }
  finally { depsLoading = false; if (thrustG !== asked) loadDeps(); }
}
function selectedBody() {
  const id = mode === 'hold' && deps ? deps.dest : selected;
  const d = deps && deps.departures && deps.departures.find(x => x.id === id);
  return d ? d.anchor_body : null;
}
function drawDeps() {
  const box = $('deps'), go = $('go');
  const st = box.scrollTop;                                   /* keep the list where the finger left it */
  box.replaceChildren();
  const live = !!(deps && (deps.docked || deps.flying));
  if (thrustBox) thrustBox.hidden = !live;
  sizeThrust();
  if (!live) {
    box.textContent = 'Destinations appear when your ship is docked or in flight.';
    go.disabled = true; go.textContent = 'Launch'; map.need(); return;
  }
  const fl = isFlying();
  const list = deps.departures || [];
  if (!list.some(d => d.id === selected)) selected = null;
  const groups = {};
  list.forEach(d => (groups[d.anchor_body] = groups[d.anchor_body] || []).push(d));
  const pick = list.find(d => d.id === selected);
  const fresh = deps.g === thrustG;                           /* list matches the slider */
  const label = (fl ? 'Confirm' : 'Launch') + (!pick ? '' : !fresh ? ' ...' : ' ' + fmt(pick.eta_real_minutes * 60));
  let revealEl = null;
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
        r.onclick = () => { selected = d.id; mode = null; reveal = true; drawAll(); };
        box.appendChild(r);
        if (d.id === selected && !mode) {                      /* the selected line gets its own Launch button right under it */
          const lb = document.createElement('button'); lb.className = 'lbtn';
          lb.textContent = label; lb.disabled = !fresh;
          lb.onclick = ev => { ev.stopPropagation(); $('go').click(); };   /* the same button and the same checks as the one under the map */
          box.appendChild(lb); revealEl = lb;
        }
      });
    });
  box.scrollTop = st;
  if (revealEl && reveal) revealEl.scrollIntoView({ block: 'nearest' });
  reveal = false;
  if (fl && mode) { go.disabled = false; go.textContent = 'Confirm ' + mode; map.need(); return; }   /* hold / stop / coast */
  go.disabled = !pick || !fresh;
  go.textContent = label;
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
  speed: shipSpeedKms,
  preview: previewPlan,
  selectedBody,
  /* places a little away from their planet (offset > 0): the map draws them once zoomed in far enough, and they can be tapped */
  places: () => (S.last && S.last.locations || []).filter(l => Number(l.offset_au) > 0 && bodyIdx(l.anchor_body) > 0)
    .map(l => ({ id: l.id, name: l.name, body: bodyIdx(l.anchor_body), off: Number(l.offset_au), ang: (Number(l.angle_deg) || 0) * Math.PI / 180 })),
  selectedPlace: () => (mode === 'hold' && deps ? deps.dest : selected),
  pickPlace: id => {
    if (zoneShip && zoneDismissed === id && zoneShip.location_id === id) { zoneDismissed = null; drawZone(zoneShip); return; }   /* the place the ship is docked at: show its zone box again */
    const d = deps && deps.departures && deps.departures.find(x => x.id === id);
    if (d) { selected = d.id; mode = null; drawAll(); } else say('That place is not a destination from here.', 'muted');
  },
  pickShip: () => {                                          /* the ship itself was touched: at a zone place it brings the zone box back, anywhere else the ship menu */
    const zl = zoneShip && zoneShip.state === 'docked' ? locById(zoneShip.location_id) : null;
    if (zl && (zl.kind === 'range' || zl.kind === 'zone')) { zoneDismissed = null; drawZone(zoneShip); } else toggleChipMenu();
  },
  pick: name => {
    const d = deps && deps.departures && deps.departures.find(x => x.anchor_body === name && x.is_default);
    if (d) { selected = d.id; mode = null; drawAll(); } else say(name + ' is not a destination from here.', 'muted');
  },
});
$('zInner').onclick = () => map.preset('inner');
$('zSys').onclick = () => map.preset('sys');
$('zShip').onclick = () => map.preset('ship');

/* the list pops up over the map: it is as tall as the map area (map + the button row under it) */
function sizeDeps() {
  const mc = document.querySelector('#scr-travel .mapcol');
  if (mc) $('deps').style.setProperty('--depsh', (mc.offsetHeight + 8) + 'px');
}
function showDeps() { if (depsOpen) sizeDeps(); $('deps').hidden = !depsOpen; $('depscaret').textContent = depsOpen ? '-' : '+'; }
window.addEventListener('resize', () => { if (depsOpen) sizeDeps(); });
$('depshead').onclick = () => { depsOpen = !depsOpen; showDeps(); };
/* ---------- combat zone box (a precursor to combat): docked at a place of kind 'range' or 'zone' the Fly screen shows a box;
   one day the combat screen replaces it. OK hides it for this stay. The text comes from the place's `info` (data). ---------- */
let zoneBox = null, zoneDismissed = null, zoneShip = null;
zoneOnInfo(() => { if (zoneShip) drawZone(zoneShip); });      /* the range check answered: draw the box again with the choices the pilot really has */
function drawZone(ship) {
  zoneShip = ship;
  const l = ship && ship.state === 'docked' ? locById(ship.location_id) : null;
  if (!l || (l.kind !== 'range' && l.kind !== 'zone')) { zoneDismissed = null; if (zoneBox) zoneBox.hidden = true; return; }
  const wrap = document.querySelector('#scr-travel .mapwrap');
  if (!wrap) return;
  if (!zoneBox) {
    zoneBox = document.createElement('div');
    zoneBox.style.cssText = 'position:absolute;left:10px;right:56px;top:10px;z-index:5;padding:12px;border:1px solid #3a5a78;border-radius:8px;background:rgba(8,14,22,.95);color:#d7e4f0;font-size:14px;line-height:1.4';
    wrap.appendChild(zoneBox);
  }
  zoneCheck();                                                 /* already inside from an earlier visit? then zone.js opens its screen by itself */
  const inside = zoneIn();
  if (zoneDismissed === l.id && !inside) {                      /* "Not now" was pressed: one small button stays, and tapping the place on the map brings the box back too */
    const chip = document.createElement('button'); chip.className = 'alt'; chip.style.cssText = 'padding:6px 10px;font-size:13px';
    chip.textContent = l.name + ': tap for options';
    chip.onclick = () => { zoneDismissed = null; drawZone(ship); };
    zoneBox.replaceChildren(chip); zoneBox.hidden = false; return;
  }
  const title = document.createElement('div'); title.style.cssText = 'font-weight:bold;margin-bottom:6px'; title.textContent = l.name;
  const text = document.createElement('div'); text.textContent = l.info || 'This is where combat will happen.';
  const drs = inside ? [] : zoneDrones();                       /* an instanced range: one Enter button for each drone the pilot may ask for (only when there is a choice) */
  const mkEnter = (label, drone) => {                          /* drone = a choice object from zoneDrones(), or nothing */
    const b = document.createElement('button'); b.textContent = label; b.style.marginTop = '10px';
    b.onclick = async () => {
      b.disabled = true;
      try { if (inside) await zoneShow(); else await zoneEnter(drone); }
      catch (e) { say('Error: ' + ((e.data && (e.data.message || e.data.error)) || e.message), 'err'); }
      finally { b.disabled = false; }
    };
    return b;
  };
  const enters = drs.length > 1 ? drs.map(d => mkEnter('Enter: ' + d.name + (d.unlocked ? '' : ' (starts its mission)'), d)) : [mkEnter(inside ? 'Return to the zone' : 'Enter the zone')];
  if (!inside && !zoneInfoKnown()) enters.forEach(b => { b.disabled = true; b.textContent = 'Checking the range...'; });   /* no Enter until we know which drones the pilot may ask for */
  const ok = document.createElement('button'); ok.textContent = 'Not now'; ok.className = 'alt'; ok.style.marginTop = '10px';
  ok.onclick = () => { zoneDismissed = l.id; zoneBox.hidden = true; };
  zoneBox.replaceChildren(...(inside ? [title, text, ...enters] : [title, text, ...enters, ok]));
  zoneBox.hidden = false;
}

/* ---------- 076 LASTING STATES: the ship chip (top right of the map) with 3 small bars under it, and the ship menu ----------
   The server sends ship.cond = { name, sh/shm (shield now/max), ar/arm, hu/hum, shr/arr (regeneration per real second, 0 when it is not regenerating), fight, market }.
   Between answers the page only moves shield and armor along their rate (local seconds since the answer arrived), so the bars rise smoothly. */
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
  const dt = c.fight || c.market ? 0 : Math.max(0, (Date.now() - condRecv) / 1000);
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
function drawChipMenu() {
  if (!chipMenu) return;
  const pname = (S.last && S.last.character && S.last.character.name) || 'Pilot';
  const title = document.createElement('div'); title.className = 'shn'; title.textContent = pname;
  const rows = [title];
  if (condNow && condNow.name) { const hn = document.createElement('div'); hn.className = 'shh'; hn.textContent = condNow.name; rows.push(hn); }
  const set = document.createElement('button'); set.className = 'alt'; set.textContent = 'Settings (coming soon)'; set.disabled = true;
  rows.push(set);
  chipMenu.replaceChildren(...rows);
  chipBtn.title = pname;
}
function toggleChipMenu() {
  if (!ensureChip() || chipBox.hidden) return;
  if (chipMenu.hidden) { drawChipMenu(); chipMenu.hidden = false; } else chipMenu.hidden = true;
}
function drawChip(ship) {
  if (!ensureChip()) return;
  if (!ship) { chipBox.hidden = true; chipMenu.hidden = true; condNow = null; return; }
  const c = ship.cond || null;
  const key = c ? c.at + '|' + ship.id : null;
  if (key !== condKey) { condKey = key; condNow = c; condRecv = Date.now(); }       /* a new answer: the local seconds start again from it */
  if (!c) condNow = null;
  chipBox.hidden = false;
  drawChipBars();
  if (!chipMenu.hidden) drawChipMenu();
}
setInterval(drawChipBars, 1000);

addScreen('travel', 'Fly', $('scr-travel'), {
  onShow: () => { map.resize(); map.need(); sizeThrust(); },
  update: ship => {
    drawZone(ship);
    drawChip(ship);
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
export function resetFly() { tripEndMs = null; thrustTouched = false; deps = null; selected = null; mode = null; thrustG = 3; if (thrustIn) { thrustIn.value = String(stopIndex(3)); } if (ctlBox) ctlBox.hidden = true; if (chipBox) { chipBox.hidden = true; chipMenu.hidden = true; } condNow = null; condKey = null; }   /* log out */

setInterval(drawEta, 1000);                                     /* the countdown ticks once a second (does nothing unless the ship is flying) */
