// fly.js - the Fly screen: thrust slider, departure list, ship position, blue preview course, Launch button.
// Step 4a: moving the thrust slider only makes a POSSIBLE course (blue line + new ETAs). Nothing changes
// until the Launch button is pressed (that is the confirmation).
// Any thrust may launch: the ship burns while the endurance bar lasts, then flies on at the free thrust (3 g).
import { BODIES, bodyPos, stateAt, planTravelBar } from 'physics';
import { S, $, say, call, fmt, whole, curGd, addScreen } from 'core';
import { createMap } from 'map';

let deps = null, depsAt = 0, selected = null, depsLoading = false;
let thrustG = 3;                       /* the slider value (game g); the server decides if it is allowed */
let thrustBox = null, thrustIn = null, thrustTxt = null, loadTimer = null;

/* ---------- thrust slider (made here, inserted above the departure list) ---------- */
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
      drawThrust(); drawDeps(); map.need();                   /* possible course only: nothing is sent */
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
  let t = 'Thrust ' + thrustG.toFixed(1) + ' g' + (free ? ' (free, refills endurance)' : ' (uses endurance, then 3 g)');
  if (deps && deps.endurance != null) t += '  |  Endurance ' + whole(deps.endurance) + ' / ' + whole(deps.endurance_max);
  thrustTxt.textContent = t;
  thrustIn.value = String(thrustG);
}

/* ---------- travel screen: departure list ---------- */
async function loadDeps() {
  if (depsLoading) return;
  depsLoading = true;
  const asked = thrustG;
  try { deps = await call('departures', { g: asked }); depsAt = Date.now(); ensureThrust(deps.max_g || 3); drawThrust(); drawDeps(); }
  catch (e) {
    if (e.message === 'bad_thrust' && e.data && e.data.max_g) { thrustG = Math.max(1, Math.floor(e.data.max_g * 2) / 2); ensureThrust(e.data.max_g); }
    else say('Error: ' + e.message, 'err');
  }
  finally { depsLoading = false; if (thrustG !== asked) loadDeps(); }
}
function selectedBody() {
  const d = deps && deps.departures && deps.departures.find(x => x.id === selected);
  return d ? d.anchor_body : null;
}
function drawDeps() {
  const box = $('deps'), go = $('go');
  box.replaceChildren();
  if (thrustBox) thrustBox.hidden = !(deps && deps.docked);
  if (!deps || !deps.docked) {
    box.textContent = 'Destinations appear when your ship is docked.';
    go.disabled = true; go.textContent = 'Launch'; map.need(); return;
  }
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
        r.className = 'row' + (d.id === selected ? ' sel' : '');
        const n = document.createElement('span'); n.textContent = d.name + (d.sun_danger ? ' (near Sun!)' : '');
        const e = document.createElement('span'); e.className = 'eta';
        let t = fmt(d.eta_real_minutes * 60);
        if (d.drops && d.burn_real_minutes > 0) t += '  |  ' + deps.free_g + ' g after ' + fmt(d.burn_real_minutes * 60);
        else if (d.drops) t += '  |  at ' + (d.g_eff != null ? d.g_eff.toFixed(1) : deps.free_g) + ' g (bar too low)';
        e.textContent = t;
        r.append(n, e);
        r.onclick = () => { selected = d.id; drawDeps(); };
        box.appendChild(r);
      });
    });
  const pick = list.find(d => d.id === selected);
  const fresh = deps.g === thrustG;                           /* list matches the slider */
  go.disabled = !pick || !fresh;
  go.textContent = !pick ? 'Pick a destination'
    : !fresh ? 'Updating times...'
    : 'Launch to ' + pick.name + ' at ' + thrustG.toFixed(1) + ' g' + (pick.drops ? ' then ' + deps.free_g + ' g' : '') + ' (' + fmt(pick.eta_real_minutes * 60) + ')';
  map.need();
}

/* where is the ship right now? (from its stored plan, or from the body it sits at) */
function shipPoint() {
  const ship = S.last && (S.last.ships || [])[0]; if (!ship) return null;
  const gd = curGd();
  if (ship.state === 'traveling' && ship.plan) { const s = stateAt(ship.plan, gd); return { x: s.x, y: s.y, vx: s.vx, vy: s.vy, ax: s.ax, ay: s.ay, a: s.a, plan: ship.plan }; }
  let body = null;
  if (ship.state === 'docked') { const l = (S.last.locations || []).find(x => x.id === ship.location_id); body = l && l.anchor_body; }
  else if (ship.state === 'hopping') { const a = (S.last.actions || []).find(x => x.status === 'pending'); body = a && a.payload && a.payload.to; }
  const i = BODIES.findIndex(b => b.n === body); if (i < 1) return null;
  const p = bodyPos(BODIES[i], gd); return { x: p[0], y: p[1], plan: null };
}

/* Blue preview course for the highlighted destination at the SLIDER's thrust. Display only: same shared physics
   as the server, recomputed every 3 s because the planets move (and at once when the slider or pick changes).
   The real flight is planned by the server at launch. */
let pv = { key: '', plan: null };
function previewPlan() {
  const ship = S.last && (S.last.ships || [])[0];
  if (!ship || ship.state !== 'docked' || !deps || !deps.docked) return null;
  const d = (deps.departures || []).find(x => x.id === selected); if (!d) return null;
  const l = (S.last.locations || []).find(x => x.id === ship.location_id);
  if (!l || l.anchor_body === d.anchor_body) return null;      /* same-body hop: no course line */
  const key = selected + '|' + thrustG + '|' + Math.floor(Date.now() / 3000);
  if (pv.key !== key) {
    const free = deps.free_g != null ? deps.free_g : 3;
    const r = planTravelBar({ from: { body: BODIES.findIndex(b => b.n === l.anchor_body) },
      to: { body: BODIES.findIndex(b => b.n === d.anchor_body) }, departT: curGd(), g: thrustG,
      bar: Number(deps.endurance), freeG: free, drainHour: Math.max(0, thrustG - free) * Number(deps.drain_per_g_hour || 0) });
    pv = { key, plan: r.ok ? r.plan : null };
  }
  return pv.plan;
}

const map = createMap($('map'), {
  ship: shipPoint,
  preview: previewPlan,
  selectedBody,
  pick: name => {
    const d = deps && deps.departures && deps.departures.find(x => x.anchor_body === name && x.is_default);
    if (d) { selected = d.id; drawDeps(); } else say(name + ' is not a destination from here.', 'muted');
  },
});
$('zInner').onclick = () => map.preset('inner');
$('zSys').onclick = () => map.preset('sys');
$('zShip').onclick = () => map.preset('ship');

addScreen('travel', 'Fly', $('scr-travel'), {
  onShow: () => { map.resize(); map.need(); },
  update: ship => {
    if (ship && ship.state === 'docked') {
      if (!deps || !deps.docked || deps.from !== ship.location_id || Date.now() - depsAt > 30000) loadDeps();
    } else if (deps && deps.docked) { deps = null; drawDeps(); }
    map.need();
  },
});

/* Launch = the confirmation of the course and thrust shown in blue. */
$('go').onclick = async () => {
  const go = $('go'); go.disabled = true;
  try {
    const r = await call('queue_travel', { to: selected, g: thrustG });
    say('Launched to ' + r.to + ' at ' + r.g + ' g. Trip takes ' + r.duration_real_minutes.toFixed(1) + ' real minutes.' +
      (r.drops && r.burn_real_minutes > 0 ? ' The bar runs out after ' + fmt(r.burn_real_minutes * 60) + '; the ship then flies on at 3 g.' : '') +
      (r.endurance_cost > 0 ? ' Endurance used: ' + whole(r.endurance_cost) + '.' : '') +
      (r.sun_danger ? ' WARNING: passes close to the Sun.' : ''), 'ok');
    deps = null; selected = null; drawDeps();
    await S.refresh();
  } catch (e) {
    say('Error: ' + e.message, 'err');
    loadDeps();
  }
};

/* called by main.js */
export function invalidateDeps() { deps = null; }                      /* ETAs changed (game speed): fetch them again */
export function resetFly() { deps = null; selected = null; thrustG = 3; if (thrustIn) { thrustIn.value = '3'; } }   /* log out */
