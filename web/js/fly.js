// fly.js - the Fly screen: thrust slider, destination list, ship position, blue preview course, confirm button.
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

let deps = null, depsAt = 0, selected = null, depsLoading = false;
let mode = null;                       /* in flight only: null (a picked destination) | 'hold' | 'stop' | 'coast' */
let thrustG = 3;                       /* the slider value (game g); the server decides if it is allowed */
let thrustBox = null, thrustIn = null, thrustTxt = null, loadTimer = null;
let ctlBox = null, ctlTxt = null; const ctlBtn = {};

/* the ship, if it is NOT docked (traveling, hopping or drifting) */
const flyingShip = () => { const s = S.last && (S.last.ships || [])[0]; return s && s.state !== 'docked' ? s : null; };
const isFlying = () => !!(deps && deps.flying);

/* ---------- thrust slider (made here, inserted above the destination list) ---------- */
function ensureThrust(maxG) {
  const top = Math.max(1, Math.floor(maxG * 2) / 2);          /* half-g steps */
  if (!thrustBox) {
    thrustBox = document.createElement('div');
    thrustBox.style.margin = '8px 0';
    thrustTxt = document.createElement('div');
    thrustIn = document.createElement('input');
    thrustIn.type = 'range'; thrustIn.min = '1'; thrustIn.step = '0.5';
    thrustIn.style.width = '100%';
    thrustIn.oninput = () => {
      thrustG = Number(thrustIn.value);
      /* in flight, moving the slider with nothing picked proposes the SAME destination at the new thrust */
      if (isFlying() && !selected && !mode && deps.dest) selected = deps.dest;
      if (isFlying() && mode && mode !== 'go') mode = null;
      drawAll();                                              /* possible course only: nothing is sent */
      clearTimeout(loadTimer);
      loadTimer = setTimeout(loadDeps, 400);                  /* fresh ETAs and costs once the finger rests */
    };
    thrustBox.append(thrustTxt, thrustIn);
    $('deps').parentNode.insertBefore(thrustBox, $('deps'));
  }
  thrustIn.max = String(top);
  if (thrustG > top) thrustG = top;
  thrustIn.value = String(thrustG);
}
function drawThrust() {
  if (!thrustBox) return;
  const free = thrustG <= (deps && deps.free_g != null ? deps.free_g : 3);
  let t = 'Thrust ' + thrustG.toFixed(1) + ' g' + (free ? ' (free, refills endurance)' : ' (pulses: burns half the bar, refills, repeats)');
  if (deps && deps.endurance != null) t += '  |  Endurance ' + whole(deps.endurance) + ' / ' + whole(deps.endurance_max);
  thrustTxt.textContent = t;
  thrustIn.value = String(thrustG);
}

/* ---------- in-flight controls: Hold the bar / Stop / Coast (made here, inserted above the thrust slider) ---------- */
function ensureControls() {
  if (ctlBox) return;
  ctlBox = document.createElement('div');
  ctlBox.style.margin = '8px 0';
  ctlTxt = document.createElement('div');
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px';
  [['hold', 'Hold the bar'], ['stop', 'Stop'], ['coast', 'Coast']].forEach(([m, label]) => {
    const b = document.createElement('button'); b.textContent = label; b.className = 'alt';
    b.onclick = () => { mode = mode === m ? null : m; if (mode) selected = null; drawAll(); };   /* a proposal: confirm below */
    ctlBtn[m] = b; row.appendChild(b);
  });
  ctlBox.append(ctlTxt, row);
  $('deps').parentNode.insertBefore(ctlBox, thrustBox || $('deps'));
}
function drawControls() {
  if (!ctlBox) return;
  ctlBox.hidden = !isFlying();
  if (!isFlying()) return;
  const sh = flyingShip();
  const spd = deps.speed_kms != null ? Math.round(deps.speed_kms).toLocaleString() + ' km/s' : '?';
  let t = sh && sh.state === 'drifting'
    ? 'Drifting at ' + spd + ' (no destination). Pick a destination below.'
    : (sh && sh.state === 'hopping' ? 'Hopping to ' : 'Flying to ') + (deps.dest ? locName(deps.dest) : '?') + ' at ' + spd + '.';
  t += ' Pick a place, change the thrust, or use a button; nothing happens until you confirm.';
  ctlTxt.textContent = t;
  ctlBtn.hold.disabled = !deps.dest;                          /* nothing to hold toward while drifting */
  Object.entries(ctlBtn).forEach(([m, b]) => b.className = mode === m ? 'on' : 'alt');
}
function drawAll() { drawThrust(); drawControls(); drawDeps(); map.need(); }

/* ---------- destination list (docked: departures; in flight: course options from where the ship is now) ---------- */
async function loadDeps() {
  if (depsLoading) return;
  depsLoading = true;
  const asked = thrustG;
  const fl = !!flyingShip();
  try {
    deps = await call(fl ? 'course_options' : 'departures', { g: asked }); depsAt = Date.now();
    ensureThrust(deps.max_g || 3); ensureControls(); drawAll();
  }
  catch (e) {
    if (e.message === 'bad_thrust' && e.data && e.data.max_g) { thrustG = Math.max(1, Math.floor(e.data.max_g * 2) / 2); ensureThrust(e.data.max_g); }
    else say('Error: ' + e.message, 'err');
  }
  finally { depsLoading = false; if (thrustG !== asked) loadDeps(); }
}
function selectedBody() {
  const id = mode === 'hold' && deps ? deps.dest : selected;
  const d = deps && deps.departures && deps.departures.find(x => x.id === id);
  return d ? d.anchor_body : null;
}
function modeLabel() {
  if (mode === 'hold') return 'Confirm: hold the bar (free thrust to ' + locName(deps.dest) + ')';
  if (mode === 'stop') return 'Confirm: stop the ship (brakes at ' + Number(deps.free_g) + ' g, free)';
  return 'Confirm: cut the engine and coast';
}
function drawDeps() {
  const box = $('deps'), go = $('go');
  box.replaceChildren();
  const live = !!(deps && (deps.docked || deps.flying));
  if (thrustBox) thrustBox.hidden = !live;
  if (!live) {
    box.textContent = 'Destinations appear when your ship is docked or in flight.';
    go.disabled = true; go.textContent = 'Launch'; map.need(); return;
  }
  const fl = isFlying();
  const list = deps.departures || [];
  if (!list.some(d => d.id === selected)) selected = null;
  const groups = {};
  list.forEach(d => (groups[d.anchor_body] = groups[d.anchor_body] || []).push(d));
  Object.entries(groups)
    .sort((x, y) => x[1][0].eta_real_minutes - y[1][0].eta_real_minutes)
    .forEach(([body, rows]) => {
      const h = document.createElement('div'); h.className = 'grp'; h.textContent = body; box.appendChild(h);
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
  const pick = list.find(d => d.id === selected);
  const fresh = deps.g === thrustG;                           /* list matches the slider */
  if (fl && mode) { go.disabled = false; go.textContent = modeLabel(); map.need(); return; }
  go.disabled = !pick || !fresh;
  go.textContent = !pick ? 'Pick a destination'
    : !fresh ? 'Updating times...'
    : (fl ? 'Confirm course to ' : 'Launch to ') + pick.name + ' at ' + thrustG.toFixed(1) + ' g' + (pick.pulsed ? ' (avg ' + pick.g_avg.toFixed(1) + ' g)' : '') + ' (' + fmt(pick.eta_real_minutes * 60) + ')';
  map.need();
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
  let body = null, off = 0;
  if (ship.state === 'docked') { const l = (S.last.locations || []).find(x => x.id === ship.location_id); body = l && l.anchor_body; off = l ? Number(l.offset_au) || 0 : 0; }
  else if (ship.state === 'hopping') { const a = (S.last.actions || []).find(x => x.status === 'pending'); body = a && a.payload && a.payload.to; }
  const i = BODIES.findIndex(b => b.n === body); if (i < 1) return null;
  const p = bodyPos(BODIES[i], gd); return { x: p[0] + off, y: p[1], plan: null };
}

/* Blue preview course. Display only: same shared physics as the server, recomputed every 3 s because the planets move
   (and at once when the slider, the pick or the button changes). The real course is planned by the server at confirm. */
let pv = { key: '', plan: null };
const bodyIdx = name => BODIES.findIndex(b => b.n === name);
function coastPreview(st, t) {                                 /* 2 game days of straight flight, so there is a line to see */
  const s = { t0: t, dur: 2, x: st.x, y: st.y, vx: st.vx, vy: st.vy, ax: 0, ay: 0 };
  return { segs: [s], t0: t, T: 2, tEnd: t + 2, tgt: null, dock: -1, end: segmentEnd(s) };
}
const locById = id => (S.last && S.last.locations || []).find(x => x.id === id);
/* a hop is planned in the body's own frame: positions are the places' offsets from the body (AU) along one fixed axis */
function hopPreview(fromState, toLoc, t, g, frame, regen0) {
  const r = planTravelPulse({ from: { state: fromState }, to: { x: Number(toLoc.offset_au) || 0, y: 0 }, departT: t, g,
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
        pv = { key, plan: hopPreview({ x: Number(l.offset_au) || 0, y: 0, vx: 0, vy: 0 }, dl, curGd(), thrustG, bodyIdx(l.anchor_body), false) };
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
  preview: previewPlan,
  selectedBody,
  /* places a little away from their planet (offset > 0): the map draws them once zoomed in far enough, and they can be tapped */
  places: () => (S.last && S.last.locations || []).filter(l => Number(l.offset_au) > 0 && bodyIdx(l.anchor_body) > 0)
    .map(l => ({ id: l.id, name: l.name, body: bodyIdx(l.anchor_body), off: Number(l.offset_au) })),
  selectedPlace: () => (mode === 'hold' && deps ? deps.dest : selected),
  pickPlace: id => {
    const d = deps && deps.departures && deps.departures.find(x => x.id === id);
    if (d) { selected = d.id; mode = null; drawAll(); } else say('That place is not a destination from here.', 'muted');
  },
  pick: name => {
    const d = deps && deps.departures && deps.departures.find(x => x.anchor_body === name && x.is_default);
    if (d) { selected = d.id; mode = null; drawAll(); } else say(name + ' is not a destination from here.', 'muted');
  },
});
$('zInner').onclick = () => map.preset('inner');
$('zSys').onclick = () => map.preset('sys');
$('zShip').onclick = () => map.preset('ship');

addScreen('travel', 'Fly', $('scr-travel'), {
  onShow: () => { map.resize(); map.need(); },
  update: ship => {
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
    deps = null; selected = null; mode = null; drawAll();
    await S.refresh();
  } catch (e) {
    say('Error: ' + (e.message === 'arrived' ? 'the ship has just arrived; look again.' : e.message), 'err');
    deps = null; mode = null; await S.refresh(); loadDeps();
  }
};

/* called by main.js */
export function invalidateDeps() { deps = null; }                      /* ETAs changed (game speed): fetch them again */
export function resetFly() { deps = null; selected = null; mode = null; thrustG = 3; if (thrustIn) { thrustIn.value = '3'; } if (ctlBox) ctlBox.hidden = true; }   /* log out */
