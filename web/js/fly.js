// fly.js - the Fly screen: departure list, ship position, blue preview course, Launch button.
import { BODIES, bodyPos, stateAt, planTravel } from 'physics';
import { S, $, say, call, fmt, curGd, addScreen } from 'core';
import { createMap } from 'map';

let deps = null, depsAt = 0, selected = null, depsLoading = false;

/* ---------- travel screen: departure list ---------- */
async function loadDeps() {
  if (depsLoading) return;
  depsLoading = true;
  try { deps = await call('departures'); depsAt = Date.now(); drawDeps(); }
  catch (e) { say('Error: ' + e.message, 'err'); }
  finally { depsLoading = false; }
}
function selectedBody() {
  const d = deps && deps.departures && deps.departures.find(x => x.id === selected);
  return d ? d.anchor_body : null;
}
function drawDeps() {
  const box = $('deps'), go = $('go');
  box.replaceChildren();
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
        const e = document.createElement('span'); e.className = 'eta'; e.textContent = fmt(d.eta_real_minutes * 60);
        r.append(n, e);
        r.onclick = () => { selected = d.id; drawDeps(); };
        box.appendChild(r);
      });
    });
  const pick = list.find(d => d.id === selected);
  go.disabled = !pick;
  go.textContent = pick ? 'Launch to ' + pick.name + ' (' + fmt(pick.eta_real_minutes * 60) + ')' : 'Pick a destination';
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

/* Blue preview course for the highlighted destination. Display only: same shared physics as the server,
   recomputed every 3 s because the planets move. The real flight is planned by the server at launch. */
let pv = { key: '', plan: null };
function previewPlan() {
  const ship = S.last && (S.last.ships || [])[0];
  if (!ship || ship.state !== 'docked' || !deps || !deps.docked) return null;
  const d = (deps.departures || []).find(x => x.id === selected); if (!d) return null;
  const l = (S.last.locations || []).find(x => x.id === ship.location_id);
  if (!l || l.anchor_body === d.anchor_body) return null;      /* same-body hop: no course line */
  const key = selected + '|' + Math.floor(Date.now() / 3000);
  if (pv.key !== key) {
    const r = planTravel({ from: { body: BODIES.findIndex(b => b.n === l.anchor_body) },
      to: { body: BODIES.findIndex(b => b.n === d.anchor_body) }, departT: curGd(), g: Number(ship.thrust_g) });
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

$('go').onclick = async () => {
  try {
    const r = await call('queue_travel', { to: selected });
    say('Launched to ' + r.to + '. Trip takes ' + r.duration_real_minutes.toFixed(1) + ' real minutes.' + (r.sun_danger ? ' WARNING: passes close to the Sun.' : ''), 'ok');
    deps = null; selected = null; drawDeps();
    await S.refresh();
  } catch (e) { say('Error: ' + e.message, 'err'); }
};

/* called by main.js */
export function invalidateDeps() { deps = null; }                      /* ETAs changed (game speed): fetch them again */
export function resetFly() { deps = null; selected = null; }           /* log out */
