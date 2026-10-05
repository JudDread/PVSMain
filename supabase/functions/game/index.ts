// @ts-nocheck
// ======================================================================
// Vacuum State - "game" server function (Supabase Edge Function)
// AUTO-BUNDLED: physics.js + clock.js are pasted in below (exports removed).
// If you change shared/physics.js or shared/clock.js, the bundle must be rebuilt.
// ======================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---------- shared/physics.js ----------
// =====================================================================
// Vacuum State - physics core (Modules 1 + 2)
// Extracted from the Orbital Clock HTML. PURE FUNCTIONS ONLY:
//   - no DOM, no canvas, no Date.now(), no global ship/time variables
//   - everything is passed in and returned
// The same file runs in the browser, on the server, and in tests.
//
// UNITS (important - everything depends on these):
//   time      = game days since J2000 (2000-01-01 12:00 UTC)
//   distance  = AU
//   velocity  = AU per game day      (use KMS to convert to km/s)
//   accel     = AU per game day^2    (use gToAuDay2(g) to convert from g)
// Positions are 2D (x, y). The Sun is at (0, 0).
// =====================================================================

const J2000_MS = Date.UTC(2000, 0, 1, 12);
const G0 = 9.80665;                 // m/s^2 per "g"
const AU_M = 1.495978707e11;        // metres per AU
const DAY_S = 86400;
const KMS = AU_M / 1000 / DAY_S;    // multiply AU/day by this to get km/s
const C_KMS = 299792.458;
const KM_PER_AU = 149597870.7;

const DOCK_RADIUS_AU = 0.02;        // must be this close to dock
const DOCK_SPEED_KMS = 5;           // and this slow relative to the body
const SUN_DANGER_AU = 0.15;         // PLACEHOLDER: closer than this hurts ships (design TBD)

// Body data. a = orbit radius (AU), P = period (days), L = start angle at J2000 (deg).
// c, r, st are display-only (color, radius, is-asteroid) and are ignored by the math.
// Array INDEX is the body's id in this file. Index 0 is the Sun (not dockable).
// For saving to the database, prefer NAMES (bodyId / bodyName below) so reordering
// this list never corrupts saved data.
const BODIES = [
  { n: 'Sun',     a: 0,     P: 0,       L: 0,      c: '#ffd45e', r: 8 },
  { n: 'Mercury', a: .387,  P: 87.97,   L: 252.25, c: '#b3aca4', r: 2.5 },
  { n: 'Venus',   a: .723,  P: 224.70,  L: 181.98, c: '#e8c88a', r: 3.5 },
  { n: 'Earth',   a: 1,     P: 365.256, L: 100.46, c: '#5aa7ff', r: 3.8 },
  { n: 'Mars',    a: 1.524, P: 686.98,  L: 355.45, c: '#e0663f', r: 3.2 },
  { n: 'Vesta',   a: 2.362, P: 1325.4,  L: 60,     c: '#cfc7bb', r: 3,   st: 1 },
  { n: 'Ceres',   a: 2.77,  P: 1681.6,  L: 240,    c: '#9fd0c3', r: 3.4, st: 1 },
  { n: 'Jupiter', a: 5.203, P: 4332.59, L: 34.40,  c: '#d9a874', r: 6.5 },
  { n: 'Saturn',  a: 9.537, P: 10759.2, L: 49.94,  c: '#e7d29a', r: 5.8 },
  { n: 'Uranus',  a: 19.19, P: 30688.5, L: 313.23, c: '#8ee0e0', r: 4.5 },
  { n: 'Neptune', a: 30.07, P: 60182,   L: 304.88, c: '#5f7cf0', r: 4.5 },
];

const BODY_INDEX = Object.fromEntries(BODIES.map((b, i) => [b.n, i]));
function bodyId(name) {
  const i = BODY_INDEX[name];
  if (i === undefined) throw new Error('Unknown body: ' + name);
  return i;
}
const bodyName = (id) => BODIES[id]?.n;

const mag = (x, y) => Math.hypot(x, y);
const gToAuDay2 = (g) => g * G0 * DAY_S * DAY_S / AU_M;

// ---------------- Module 1: where are the bodies? ----------------

function bodyAngle(b, t) { return (b.L + 360 * t / b.P) * Math.PI / 180; }

function bodyPos(b, t) {
  if (!b.a) return [0, 0];
  const q = bodyAngle(b, t);
  return [b.a * Math.cos(q), b.a * Math.sin(q)];
}

function bodyVel(b, t) {
  if (!b.a) return [0, 0];
  const q = bodyAngle(b, t), w = 2 * Math.PI / b.P;
  return [-b.a * w * Math.sin(q), b.a * w * Math.cos(q)];
}

// A "target" is either {body: index} or a fixed point {x, y}.
// Returns a full state {x, y, vx, vy} at time t.
function targetState(tg, t) {
  if (tg.body != null) {
    const b = BODIES[tg.body], p = bodyPos(b, t), v = bodyVel(b, t);
    return { x: p[0], y: p[1], vx: v[0], vy: v[1] };
  }
  return { x: tg.x, y: tg.y, vx: 0, vy: 0 };
}

// ---------------- Module 2: flight plans ----------------
// A PLAN is plain JSON (safe to store in a database column):
//   { segs:[{t0,dur,x,y,vx,vy,ax,ay}, ...], t0, T, tEnd, tgt, dock, end:{x,y,vx,vy} }
//   t0 = departure time, T = duration (days), tEnd = arrival time,
//   dock = body index the ship docks at on arrival, or -1 (drifting in space).
// Given a plan and ANY time, stateAt() tells you exactly where the ship is.
// That is why the server never needs to "move" ships tick by tick.

function segmentEnd(s) {
  const u = s.dur;
  return {
    x: s.x + s.vx * u + .5 * s.ax * u * u,
    y: s.y + s.vy * u + .5 * s.ay * u * u,
    vx: s.vx + s.ax * u,
    vy: s.vy + s.ay * u,
  };
}

function stateAt(plan, t) {
  for (const s of plan.segs) {
    if (t < s.t0 + s.dur) {
      const u = Math.max(t - s.t0, 0);
      return {
        x: s.x + s.vx * u + .5 * s.ax * u * u,
        y: s.y + s.vy * u + .5 * s.ay * u * u,
        vx: s.vx + s.ax * u,
        vy: s.vy + s.ay * u,
        ax: s.ax, ay: s.ay, a: mag(s.ax, s.ay),
      };
    }
  }
  const e = plan.end, u = t - plan.tEnd;
  return { x: e.x + e.vx * u, y: e.y + e.vy * u, vx: e.vx, vy: e.vy, ax: 0, ay: 0, a: 0 };
}

// Two equal-length burns: speed up toward the target, then brake to match its velocity.
// st = ship state {x,y,vx,vy} at time t0. tg = target. g = max thrust in g's.
// Returns a plan, or null if no route exists within 6000 days.
function solvePlan(st, t0, tg, g) {
  const Amax = gToAuDay2(g);
  const coef = (T) => {
    const tau = T / 2, q = targetState(tg, t0 + T);
    const a1x = (q.x - st.x - 1.5 * st.vx * tau - .5 * q.vx * tau) / (tau * tau);
    const a1y = (q.y - st.y - 1.5 * st.vy * tau - .5 * q.vy * tau) / (tau * tau);
    const a2x = (q.vx - st.vx - a1x * tau) / tau;
    const a2y = (q.vy - st.vy - a1y * tau) / tau;
    return { a1x, a1y, a2x, a2y, q, m: Math.max(mag(a1x, a1y), mag(a2x, a2y)) };
  };
  let T = 0.01, prev = T;
  while (T < 6000 && coef(T).m > Amax) { prev = T; T *= 1.03; }
  if (T >= 6000) return null;
  let lo = prev, hi = T;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (coef(mid).m > Amax) lo = mid; else hi = mid; }
  const c = coef(hi), tau = hi / 2;
  const s1 = { t0, dur: tau, x: st.x, y: st.y, vx: st.vx, vy: st.vy, ax: c.a1x, ay: c.a1y };
  const e1 = segmentEnd(s1);
  const s2 = { t0: t0 + tau, dur: tau, x: e1.x, y: e1.y, vx: e1.vx, vy: e1.vy, ax: c.a2x, ay: c.a2y };
  return {
    segs: [s1, s2], t0, T: hi, tEnd: t0 + hi, tgt: tg,
    dock: tg.body != null ? tg.body : -1,
    end: { x: c.q.x, y: c.q.y, vx: c.q.vx, vy: c.q.vy },
  };
}

// Burn straight against current velocity until stopped.
function stopPlan(st, t0, g) {
  const v = mag(st.vx, st.vy);
  if (v * KMS < 1e-4) return null;
  const Amax = gToAuDay2(g);
  if (Amax <= 0) return coastPlan(st, t0);
  const s = { t0, dur: v / Amax, x: st.x, y: st.y, vx: st.vx, vy: st.vy, ax: -st.vx / v * Amax, ay: -st.vy / v * Amax };
  return { segs: [s], t0, T: s.dur, tEnd: t0 + s.dur, tgt: null, dock: -1, end: segmentEnd(s) };
}

function coastPlan(st, t0) {
  return { segs: [], t0, T: 0, tEnd: t0, tgt: null, dock: -1, end: { x: st.x, y: st.y, vx: st.vx, vy: st.vy } };
}

// ---------------- Server-friendly wrappers (NEW) ----------------

// Closest approach to the Sun along a plan, in AU (sampled).
function sunClearance(plan, samples = 200) {
  let min = Infinity;
  for (let k = 0; k <= samples; k++) {
    const s = stateAt(plan, plan.t0 + plan.T * k / samples);
    min = Math.min(min, mag(s.x, s.y));
  }
  return min;
}

// Where is a ship at time t?  ship = {docked: bodyIndex}  or  {plan}
function shipStateAt(ship, t) {
  if (ship.docked != null) {
    const s = targetState({ body: ship.docked }, t);
    return { ...s, ax: 0, ay: 0, a: 0 };
  }
  return stateAt(ship.plan, t);
}

// THE main entry point for Module 3.
//   from: {body: idx}  (docked)   or  {state:{x,y,vx,vy}}  (in space)
//   to:   {body: idx}  or  {x, y}
//   departT: game days since J2000.   g: thrust in g's.
// Returns {ok:false, reason} or {ok:true, plan, departT, arriveT, durationDays, ...}
function planTravel({ from, to, departT, g }) {
  const fail = (reason) => ({ ok: false, reason });
  if (!Number.isFinite(departT)) return fail('bad_time');
  if (!(g > 0) || g > 12) return fail('bad_thrust');
  if (to.body != null && !(to.body >= 1 && to.body < BODIES.length)) return fail('bad_destination');
  if (to.body == null && !(Number.isFinite(to.x) && Number.isFinite(to.y))) return fail('bad_destination');
  if (from.body != null && !(from.body >= 1 && from.body < BODIES.length)) return fail('bad_origin');
  if (from.body != null && to.body === from.body) return fail('same_location');

  const st = from.body != null ? targetState({ body: from.body }, departT) : from.state;
  if (!st) return fail('bad_origin');
  const plan = solvePlan(st, departT, to, g);
  if (!plan) return fail('no_route');

  const mid = stateAt(plan, departT + plan.T / 2);
  const sun = sunClearance(plan);
  return {
    ok: true, plan, departT,
    arriveT: plan.tEnd,
    durationDays: plan.T,
    distanceAU: Math.hypot(plan.end.x - st.x, plan.end.y - st.y),
    midSpeedKms: mag(mid.vx, mid.vy) * KMS,
    sunClearanceAU: sun,
    sunDanger: sun < SUN_DANGER_AU,
    arrival: plan.dock >= 0 ? { kind: 'docked', body: plan.dock } : { kind: 'drifting' },
  };
}

// ---------- shared/clock.js ----------
// =====================================================================
// Vacuum State - game clock ("time contract")
// ONE clock for the whole game. Nothing else keeps its own time.
//
//   game time = days since J2000 (same unit physics.js uses)
//   real time = normal JavaScript milliseconds (Date.now())
//
// scale = how many game seconds pass per real second.
//   60 means 1 real minute = 1 game hour (your GDD). Earth orbit = ~6 real days.
// =====================================================================

const LAUNCH_MS = Date.UTC(2026, 9, 3, 0, 0, 0); // Oct 3 2026 00:00 UTC (month is 0-based)

const CLOCK = {
  epochRealMs: LAUNCH_MS,                                   // the moment the game "starts"
  epochGameDays: (LAUNCH_MS - J2000_MS) / 864e5,            // start in the REAL sky positions
  scale: 60,
};

function gameDaysAt(realMs, c = CLOCK) {
  return c.epochGameDays + (realMs - c.epochRealMs) * c.scale / 864e5;
}

function realMsAt(gameDays, c = CLOCK) {
  return c.epochRealMs + (gameDays - c.epochGameDays) * 864e5 / c.scale;
}

// Change the speed WITHOUT game time jumping (used for dev "100x" testing).
function rescale(c, nowMs, newScale) {
  return { epochRealMs: nowMs, epochGameDays: gameDaysAt(nowMs, c), scale: newScale };
}

const gameDate = (gameDays) => new Date(J2000_MS + gameDays * 864e5).toISOString();

// ---------- server ----------
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const STARTER_LOCATION = 'luna'; // a row id in the locations table

async function getCharacter(db, user) {
  const { data, error } = await db.from('characters').select('*').eq('account_id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

async function getLocation(db, id) {
  const { data, error } = await db.from('locations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function resolveFor(db, characterId) {
  const { error } = await db.rpc('resolve_due_actions', { p_character: characterId });
  if (error) console.error('resolve failed', error);
}

async function createCharacter(db, user, body) {
  const name = String(body.name ?? '').trim();
  if (name.length < 3 || name.length > 24 || !/^[A-Za-z0-9 _-]+$/.test(name))
    return json({ error: 'bad_name', hint: '3-24 letters, numbers, spaces, - or _' }, 400);
  const start = await getLocation(db, STARTER_LOCATION);
  if (!start) return json({ error: 'start_location_missing' }, 500);
  const { data: ch, error } = await db.from('characters').insert({ account_id: user.id, name }).select().single();
  if (error) {
    if (error.code === '23505') return json({ error: 'name_taken_or_already_have_character' }, 409);
    throw error;
  }
  const { error: e2 } = await db.from('ships').insert({ character_id: ch.id, location_id: start.id, state: 'docked' });
  if (e2) throw e2;
  await db.from('event_log').insert({ character_id: ch.id, kind: 'welcome', message: `Welcome, ${name}. Your ship is docked at ${start.name}.` });
  return json({ ok: true, character: ch });
}

// Time for a hop between two locations at the same body.
// d = distance between them (AU) = difference of their offsets from the body.
// Accelerate for half the way, brake for the other half: t = 2 * sqrt(d / a).
function hopDurationDays(offsetA, offsetB, g) {
  const d = Math.abs(offsetA - offsetB);
  return 2 * Math.sqrt(d / gToAuDay2(g));
}

// How long would a trip from location `from` to location `to` take if it left now?
// Returns {ok, days, sun_danger} or {ok:false, reason}. NOTHING is saved.
// `cache` remembers long flights per destination body, because every location at
// the same body has the same flight (only the final hop differs).
function estimateTrip(from, to, departT, g, cache) {
  if (from.id === to.id) return { ok: false, reason: 'already_here' };
  if (!(to.anchor_body in BODY_INDEX) || BODY_INDEX[to.anchor_body] < 1) return { ok: false, reason: 'bad_destination' };
  if (!(from.anchor_body in BODY_INDEX)) return { ok: false, reason: 'bad_origin' };
  if (from.anchor_body === to.anchor_body) {
    const days = hopDurationDays(Number(from.offset_au), Number(to.offset_au), g);
    return days > 0 ? { ok: true, days, sun_danger: false } : { ok: false, reason: 'bad_destination' };
  }
  let r = cache[to.anchor_body];
  if (!r) {
    r = cache[to.anchor_body] = planTravel({
      from: { body: bodyId(from.anchor_body) },
      to: { body: bodyId(to.anchor_body) },
      departT, g,
    });
  }
  return r.ok ? { ok: true, days: r.durationDays, sun_danger: r.sunDanger } : { ok: false, reason: r.reason };
}

// body.to = a LOCATION id (e.g. 'luna', 'mars'). The flight is planned to the
// location's anchor body; the ship docks at the chosen location on arrival.
async function queueTravel(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id); // settle any finished trip first
  const { data: ship, error: se } = await db.from('ships').select('*').eq('character_id', ch.id).order('created_at').limit(1).maybeSingle();
  if (se) throw se;
  if (!ship) return json({ error: 'no_ship' }, 400);
  if (ship.state !== 'docked') return json({ error: 'ship_busy' }, 409);

  const from = await getLocation(db, ship.location_id);
  const to = await getLocation(db, String(body.to ?? ''));
  if (!from || !to) return json({ error: 'bad_destination' }, 400);
  if (!(to.anchor_body in BODY_INDEX) || BODY_INDEX[to.anchor_body] < 1) return json({ error: 'bad_destination' }, 400);
  if (!(from.anchor_body in BODY_INDEX)) return json({ error: 'bad_origin' }, 400);
  if (from.id === to.id) return json({ error: 'already_here' }, 400);
  const departT = gameDaysAt(Date.now());

  // Same planet: a short "hop" (accelerate half way, brake the rest).
  if (from.anchor_body === to.anchor_body) {
    const dur = hopDurationDays(Number(from.offset_au), Number(to.offset_au), Number(ship.thrust_g));
    if (!(dur > 0)) return json({ error: 'bad_destination' }, 400);
    const hopAt = new Date(realMsAt(departT + dur)).toISOString();
    const { data: hop, error: h1 } = await db.from('scheduled_actions').insert({
      character_id: ch.id, ship_id: ship.id, action_type: 'hop',
      payload: { from: from.id, to: to.anchor_body, to_location: to.id, departT, arriveT: departT + dur },
      resolve_at: hopAt,
    }).select().single();
    if (h1) {
      if (h1.code === '23505') return json({ error: 'ship_busy' }, 409);
      throw h1;
    }
    const { error: h2 } = await db.from('ships')
      .update({ state: 'hopping', plan: null, location_id: null })
      .eq('id', ship.id).eq('state', 'docked');
    if (h2) {
      await db.from('scheduled_actions').update({ status: 'failed' }).eq('id', hop.id);
      throw h2;
    }
    return json({
      ok: true, kind: 'hop', action_id: hop.id, from: from.name, to: to.name, resolve_at: hopAt,
      duration_game_days: dur, duration_real_minutes: dur * 1440 / CLOCK.scale, sun_danger: false,
    });
  }

  const r = planTravel({
    from: { body: bodyId(from.anchor_body) },
    to: { body: bodyId(to.anchor_body) },
    departT,
    g: Number(ship.thrust_g),
  });
  if (!r.ok) return json({ error: r.reason }, 400);

  const resolveAt = new Date(realMsAt(r.arriveT)).toISOString();
  const { data: action, error: e1 } = await db.from('scheduled_actions').insert({
    character_id: ch.id, ship_id: ship.id, action_type: 'travel',
    payload: { from: from.id, to: to.anchor_body, to_location: to.id, departT, arriveT: r.arriveT },
    resolve_at: resolveAt,
  }).select().single();
  if (e1) {
    if (e1.code === '23505') return json({ error: 'ship_busy' }, 409);
    throw e1;
  }
  const { error: e2 } = await db.from('ships')
    .update({ state: 'traveling', plan: r.plan, location_id: null })
    .eq('id', ship.id).eq('state', 'docked');
  if (e2) {
    await db.from('scheduled_actions').update({ status: 'failed' }).eq('id', action.id);
    throw e2;
  }
  return json({
    ok: true, action_id: action.id, from: from.name, to: to.name, resolve_at: resolveAt,
    duration_game_days: r.durationDays,
    duration_real_minutes: r.durationDays * 1440 / CLOCK.scale,
    sun_danger: r.sunDanger,
  });
}

// "departures": where can my docked ship go right now, and how long would each trip take?
// Read-only: nothing is saved. The server does the maths; the page only displays it.
async function departures(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  const { data: ship, error: se } = await db.from('ships').select('*').eq('character_id', ch.id).order('created_at').limit(1).maybeSingle();
  if (se) throw se;
  if (!ship) return json({ error: 'no_ship' }, 400);
  const out = { ok: true, game_days: gameDaysAt(Date.now()), real_ms: Date.now(), scale: CLOCK.scale, docked: ship.state === 'docked', from: null, departures: [] };
  if (!out.docked) return json(out);

  const from = await getLocation(db, ship.location_id);
  if (!from) return json({ error: 'bad_origin' }, 400);
  out.from = from.id;
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  const departT = out.game_days, g = Number(ship.thrust_g), cache = {};
  for (const to of locs ?? []) {
    const est = estimateTrip(from, to, departT, g, cache);
    if (!est.ok) continue; // the place we are at, or a place we cannot reach
    out.departures.push({
      id: to.id, name: to.name, anchor_body: to.anchor_body, kind: to.kind, is_default: to.is_default,
      eta_game_days: est.days,
      eta_real_minutes: est.days * 1440 / CLOCK.scale,
      sun_danger: est.sun_danger,
    });
  }
  out.departures.sort((a, b) => a.eta_real_minutes - b.eta_real_minutes);
  return json(out);
}

async function me(db, user) {
  const ch = await getCharacter(db, user);
  const out = { game_days: gameDaysAt(Date.now()), real_ms: Date.now(), scale: CLOCK.scale, speed: CLOCK.scale / 60, dev: await isDev(db, user), character: ch };
  const { data: locs } = await db.from('locations').select('id,name,anchor_body,kind,offset_au,is_default');
  out.locations = locs ?? [];
  if (ch) {
    await resolveFor(db, ch.id); // settle any finished trip before reporting
    const [ships, actions, events] = await Promise.all([
      db.from('ships').select('*').eq('character_id', ch.id),
      db.from('scheduled_actions').select('id,action_type,status,payload,resolve_at,resolved_at').eq('character_id', ch.id).order('created_at', { ascending: false }).limit(10),
      db.from('event_log').select('*').eq('character_id', ch.id).order('created_at', { ascending: false }).limit(20),
    ]);
    out.ships = ships.data; out.actions = actions.data; out.events = events.data;
  }
  return json(out);
}

// ---------- speed control (developer button) ----------
// The clock settings live in the database (game_state key 'clock'), so every request
// uses the same speed. 1x = scale 60. Changing speed re-bases the clock (game time does
// NOT jump) and re-times any trip in flight.
const DEFAULT_CLOCK = { ...CLOCK };
const BASE_SCALE = 60;
const SPEEDS = [1, 2, 10]; // the cycle: 1x -> 2x -> 10x -> 1x

async function loadClock(db) {
  const { data, error } = await db.from('game_state').select('value').eq('key', 'clock').maybeSingle();
  if (error) throw error;
  Object.assign(CLOCK, DEFAULT_CLOCK, data?.value ?? {});
}

async function isDev(db, user) {
  const { data, error } = await db.from('game_state').select('value').eq('key', 'dev_accounts').maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.value) && data.value.includes(user.id);
}

async function cycleSpeed(db, user) {
  if (!(await isDev(db, user))) return json({ error: 'not_allowed' }, 403);
  const current = Math.round((CLOCK.scale / BASE_SCALE) * 1000) / 1000;
  const next = SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length]; // unknown speed -> falls back to 1x
  const newClock = rescale(CLOCK, Date.now(), next * BASE_SCALE);
  const { error } = await db.from('game_state').upsert({ key: 'clock', value: newClock });
  if (error) throw error;
  Object.assign(CLOCK, newClock);

  // Trips already in flight keep their game-time arrival; only the real-time due date moves.
  const { data: pending, error: pe } = await db.from('scheduled_actions').select('id,payload').eq('status', 'pending');
  if (pe) throw pe;
  let retimed = 0;
  for (const a of pending ?? []) {
    const arriveT = Number(a.payload?.arriveT);
    if (!Number.isFinite(arriveT)) continue;
    const { error: ue } = await db.from('scheduled_actions')
      .update({ resolve_at: new Date(realMsAt(arriveT)).toISOString() })
      .eq('id', a.id).eq('status', 'pending');
    if (ue) throw ue;
    retimed++;
  }
  return json({ ok: true, speed: next, scale: CLOCK.scale, game_days: gameDaysAt(Date.now()), real_ms: Date.now(), trips_retimed: retimed });
}

// ---------- trading (step 4b) ----------
// Prices, stock and the buy/sell maths all live in the database (migration 008).
// The server only checks who is asking, calls the SQL functions, and passes the result on.
async function getShip(db, characterId) {
  const { data, error } = await db.from('ships').select('*').eq('character_id', characterId).order('created_at').limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

// What the ship carries, with names and hold space. Also returns hold_used.
async function loadCargo(db, ship) {
  const { data: rows, error } = await db.from('ship_cargo').select('good_id,quantity,avg_cost').eq('ship_id', ship.id);
  if (error) throw error;
  const ids = (rows ?? []).map(r => r.good_id);
  let goods = [];
  if (ids.length) {
    const { data, error: ge } = await db.from('goods').select('id,name,unit,hold_per_unit').in('id', ids);
    if (ge) throw ge;
    goods = data ?? [];
  }
  let holdUsed = 0;
  const cargo = (rows ?? []).map(r => {
    const g = goods.find(x => x.id === r.good_id) || {};
    const per = Number(g.hold_per_unit ?? 1);
    holdUsed += r.quantity * per;
    return { good_id: r.good_id, name: g.name ?? r.good_id, unit: g.unit ?? 'unit', hold_per_unit: per, quantity: r.quantity,
      avg_cost: r.avg_cost == null ? null : Number(r.avg_cost) };
  });
  cargo.sort((a, b) => a.name.localeCompare(b.name));
  return { cargo, hold_used: Math.round(holdUsed * 1000) / 1000 };
}

// "market": prices and stock where my docked ship is, plus my cargo and credits. Read-only.
async function market(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'no_ship' }, 400);
  const { cargo, hold_used } = await loadCargo(db, ship);
  const out = {
    ok: true, docked: ship.state === 'docked', location_id: null, location_name: null,
    credits: Number(ch.credits), hold_size: Number(ship.hold_size), hold_used, cargo, goods: [],
  };
  if (!out.docked) return json(out);
  const loc = await getLocation(db, ship.location_id);
  out.location_id = ship.location_id; out.location_name = loc ? loc.name : ship.location_id;
  const { data, error } = await db.rpc('market_view', { p_character: ch.id, p_location: ship.location_id });
  if (error) throw error;
  out.goods = (data ?? []).map(r => ({
    good_id: r.good_id, name: r.good_name, category: r.category, unit: r.unit,
    hold_per_unit: Number(r.hold_per_unit), target_stock: Number(r.target_stock), stock: Number(r.stock),
    mid_price: Number(r.mid_price), buy_price: Number(r.buy_price), sell_price: Number(r.sell_price),
  }));
  // For each item in the hold: what it would sell for here, and the profit or loss against what was paid.
  const r2 = n => Math.round(n * 100) / 100;
  for (const c of out.cargo) {
    const g = out.goods.find(x => x.good_id === c.good_id);
    c.sell_here = g ? g.sell_price : null;
    c.profit_each = (g && c.avg_cost != null) ? r2(g.sell_price - c.avg_cost) : null;
    c.profit_total = (g && c.avg_cost != null) ? r2((g.sell_price - c.avg_cost) * c.quantity) : null;
  }
  return json(out);
}

// "routes": body = { good: 'water_ice', location?: 'luna' }. If I bought this good at the ORIGIN and flew to each other
// place that trades it, what would I make? The origin is `location` when given (the market I am looking at), otherwise
// the place my ship is docked at. Trips are measured from the ORIGIN (where the goods are). When my ship is not docked at
// the origin, the buy price includes the remote fee (same price the Market screen shows). Read-only. Today's prices and ETA.
async function routes(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const good = String(body.good ?? '');
  if (!/^[a-z0-9_]{1,64}$/.test(good)) return json({ error: 'unknown_good' }, 400);
  const explicit = body.location != null && body.location !== '';
  if (explicit && !LOC_RE.test(String(body.location))) return json({ error: 'unknown_location' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'no_ship' }, 400);
  const docked = ship.state === 'docked';
  const originId = explicit ? String(body.location) : (docked ? ship.location_id : null);
  if (!originId) return json({ ok: true, docked: false, rows: [] });
  const remote = !(docked && ship.location_id === originId);

  const { data: gd, error: ge } = await db.from('goods').select('id,name,unit,hold_per_unit').eq('id', good).maybeSingle();
  if (ge) throw ge;
  if (!gd) return json({ error: 'unknown_good' }, 400);
  const { data: prices, error: pe } = await db.rpc('market_prices_for_good', { p_character: ch.id, p_good: good });
  if (pe) throw pe;
  const here = (prices ?? []).find(p => p.location_id === originId);
  if (!here) return json({ error: 'no_market' }, 400);
  let buyHere = Number(here.buy_price);
  if (remote) {
    const { data: mv, error: me2 } = await db.rpc('market_view_at', { p_character: ch.id, p_location: originId });
    if (me2) throw me2;
    const mg = ((mv && mv.goods) || []).find(x => x.good_id === good);
    if (mg) buyHere = Number(mg.buy_price);
  }

  const { hold_used } = await loadCargo(db, ship);
  const per = Number(gd.hold_per_unit);
  // Max load = the most you could buy right now (same limits as the Max buy button).
  const maxLoad = Math.max(0, Math.floor(Math.min(
    Number(here.stock), Number(ch.credits) / buyHere, (Number(ship.hold_size) - hold_used + 1e-9) / per)));
  const qty = maxLoad > 0 ? maxLoad : 1; // nothing affordable: rank by a single unit and say so
  const r2 = n => Math.round(n * 100) / 100;

  const from = await getLocation(db, originId);
  if (!from) return json({ error: explicit ? 'unknown_location' : 'bad_origin' }, 400);
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  const departT = gameDaysAt(Date.now()), g = Number(ship.thrust_g), cache = {};
  const rows = [];
  for (const p of prices ?? []) {
    if (p.location_id === originId) continue;
    const to = (locs ?? []).find(l => l.id === p.location_id);
    if (!to) continue;
    const est = estimateTrip(from, to, departT, g, cache);
    if (!est.ok) continue;
    const etaMin = est.days * 1440 / CLOCK.scale;
    const unit = r2(Number(p.sell_price) - buyHere);
    const total = r2(unit * qty);
    rows.push({
      location_id: p.location_id, name: p.location_name, anchor_body: to.anchor_body,
      sell_price: Number(p.sell_price), stock: Number(p.stock), target_stock: Number(p.target_stock),
      eta_real_minutes: etaMin, sun_danger: est.sun_danger,
      profit_each: unit, profit_load: total, ppm: etaMin > 0 ? r2(total / etaMin) : 0,
    });
  }
  rows.sort((a, b) => b.ppm - a.ppm);
  return json({
    ok: true, docked, origin_id: originId, remote, good_id: good, name: gd.name, unit: gd.unit,
    buy_here: buyHere, max_load: maxLoad, load_used: qty, hypothetical: maxLoad === 0, rows,
  });
}

// ---- cargo selling options (used by "cargo_routes" and "cargo_dest") ----
// For ONE carried good: every place that trades it, with what the whole stack would sell for there.
// Cost = what I paid (avg_cost) when known, so profit is real. If the cost is unknown (bought before
// migration 009) cost_known is false and the figures are INCOME (sell price x quantity), not profit.
// The place I am docked at is included (is_here, no travel time, ppm null). Uses today's prices and ETA.
const r2s = n => Math.round(n * 100) / 100;
async function cargoOptions(db, ch, ship, from, locs, c, cache, departT, feePrices) {
  const { data: prices, error: pe } = await db.rpc('market_prices_for_good', { p_character: ch.id, p_good: c.good_id });
  if (pe) throw pe;
  const known = c.avg_cost != null, g = Number(ship.thrust_g);
  const rows = [];
  for (const p of prices ?? []) {
    const here = p.location_id === from.id; // the place the goods ARE (hold: where the ship is docked; storage: that location)
    const to = (locs ?? []).find(l => l.id === p.location_id);
    if (!to) continue;
    let etaMin = 0, sun = false;
    if (!here) {
      const est = estimateTrip(from, to, departT, g, cache);
      if (!est.ok) continue;
      etaMin = est.days * 1440 / CLOCK.scale; sun = est.sun_danger;
    }
    // selling right where the goods are, with the ship elsewhere, costs the remote fee (feePrices comes from market_view_at)
    const sell = (here && feePrices && feePrices[c.good_id] != null) ? feePrices[c.good_id] : Number(p.sell_price);
    const each = r2s(sell - (known ? c.avg_cost : 0));
    const total = r2s(each * c.quantity);
    rows.push({
      location_id: p.location_id, name: p.location_name, anchor_body: to.anchor_body, is_here: here,
      sell_price: sell, stock: Number(p.stock), target_stock: Number(p.target_stock),
      eta_real_minutes: etaMin, sun_danger: sun, profit_each: each, profit_total: total,
      ppm: here ? null : (etaMin > 0 ? r2s(total / etaMin) : 0),
    });
  }
  return rows;
}
// "Best": if HERE pays the highest price of all, here wins. Otherwise the other place with the best profit per minute.
function pickBest(rows) {
  const here = rows.find(r => r.is_here);
  const others = rows.filter(r => !r.is_here);
  let bestOther = null, topPrice = 0;
  for (const r of others) {
    if (!bestOther || r.ppm > bestOther.ppm) bestOther = r;
    if (r.sell_price > topPrice) topPrice = r.sell_price;
  }
  if (here && (!bestOther || here.sell_price >= topPrice)) return here;
  return bestOther;
}
// body.source: 'hold' (default: what the docked ship carries, measured from where it is docked)
//              'storage' + body.location: what I keep at that location, measured from THAT location (where the goods are).
async function cargoPrelude(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return { resp: json({ error: 'no_character' }, 400) };
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return { resp: json({ error: 'no_ship' }, 400) };
  const docked = ship.state === 'docked';
  const source = body && body.source === 'storage' ? 'storage' : 'hold';
  let originId, stacks;
  if (source === 'storage') {
    originId = String(body.location ?? '');
    if (!LOC_RE.test(originId)) return { resp: json({ error: 'unknown_location' }, 400) };
    stacks = await storageAt(db, ch.id, originId);
  } else {
    if (!docked) return { resp: json({ ok: true, docked: false, items: [], rows: [] }) };
    originId = ship.location_id;
    stacks = (await loadCargo(db, ship)).cargo;
  }
  const from = await getLocation(db, originId);
  if (!from) return { resp: json({ error: source === 'storage' ? 'unknown_location' : 'bad_origin' }, 400) };
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  const remote = !(docked && ship.location_id === originId);
  let feePrices = null;
  if (remote && stacks.length) {
    const { data: mv, error: me2 } = await db.rpc('market_view_at', { p_character: ch.id, p_location: originId });
    if (me2) throw me2;
    feePrices = {};
    for (const g of (mv && mv.goods) || []) feePrices[g.good_id] = Number(g.sell_price);
  }
  return { ch, ship, from, cargo: stacks, locs, departT: gameDaysAt(Date.now()), cache: {}, source, remote, feePrices, docked };
}

// "cargo_routes": for each good in my hold (or in storage at body.location), the best place to sell the whole stack.
async function cargoRoutes(db, user, body) {
  const x = await cargoPrelude(db, user, body || {});
  if (x.resp) return x.resp;
  const items = [];
  for (const c of x.cargo) {
    const rows = await cargoOptions(db, x.ch, x.ship, x.from, x.locs, c, x.cache, x.departT, x.feePrices);
    items.push({ good_id: c.good_id, name: c.name, unit: c.unit, quantity: c.quantity, avg_cost: c.avg_cost,
      cost_known: c.avg_cost != null, best: pickBest(rows) });
  }
  return json({ ok: true, docked: x.docked, source: x.source, location_id: x.from.id, remote: x.remote, items });
}

// "cargo_dest": body = { good, source?, location? }. The destinations list for ONE stack: every place that trades it,
// the place where the goods are first (is_here), then the others by profit per minute (best first).
async function cargoDest(db, user, body) {
  const good = String(body.good ?? '');
  if (!/^[a-z0-9_]{1,64}$/.test(good)) return json({ error: 'unknown_good' }, 400);
  const x = await cargoPrelude(db, user, body);
  if (x.resp) return x.resp;
  const c = x.cargo.find(k => k.good_id === good);
  if (!c) return json({ error: x.source === 'storage' ? 'not_in_storage' : 'not_in_cargo' }, 400);
  const rows = await cargoOptions(db, x.ch, x.ship, x.from, x.locs, c, x.cache, x.departT, x.feePrices);
  rows.sort((p, q) => (p.is_here ? -1 : q.is_here ? 1 : q.ppm - p.ppm));
  return json({ ok: true, docked: x.docked, source: x.source, location_id: x.from.id, remote: x.remote, good_id: good, name: c.name, unit: c.unit,
    quantity: c.quantity, avg_cost: c.avg_cost, cost_known: c.avg_cost != null, rows });
}

// "buy" / "sell": body = { good: 'water_ice', quantity: 10 }. Whole units only.
async function trade(db, user, body, kind) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const good = String(body.good ?? '');
  const qty = Number(body.quantity);
  if (!/^[a-z0-9_]{1,64}$/.test(good)) return json({ error: 'unknown_good' }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) return json({ error: 'bad_quantity' }, 400);
  await resolveFor(db, ch.id); // a ship that has just arrived can trade at once
  const { data, error } = await db.rpc(kind === 'buy' ? 'trade_buy' : 'trade_sell', { p_character: ch.id, p_good: good, p_quantity: qty });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}

// ---------- storage (Module 5 step 1; migration 010) ----------
// Goods a character keeps AT A LOCATION, separate from the ship's hold. The maths lives in the database
// (storage_load / storage_unload); the server only checks who is asking and passes the result on.

// "storage": everything I keep, at every location, plus my hold and where my ship is. Read-only.
async function storageView(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'no_ship' }, 400);
  const { cargo, hold_used } = await loadCargo(db, ship);
  const docked = ship.state === 'docked';
  const out = {
    ok: true, docked, location_id: docked ? ship.location_id : null, location_name: null,
    hold_size: Number(ship.hold_size), hold_used, cargo, items: [],
  };
  if (docked) { const loc = await getLocation(db, ship.location_id); out.location_name = loc ? loc.name : ship.location_id; }
  const { data: rows, error } = await db.from('storage').select('location_id,good_id,quantity,avg_cost').eq('character_id', ch.id);
  if (error) throw error;
  if (!rows || !rows.length) return json(out);
  const gIds = [...new Set(rows.map(r => r.good_id))], lIds = [...new Set(rows.map(r => r.location_id))];
  const [gr, lr] = await Promise.all([
    db.from('goods').select('id,name,unit,hold_per_unit').in('id', gIds),
    db.from('locations').select('id,name').in('id', lIds),
  ]);
  if (gr.error) throw gr.error;
  if (lr.error) throw lr.error;
  out.items = rows.map(r => {
    const g = (gr.data ?? []).find(x => x.id === r.good_id) || {};
    const l = (lr.data ?? []).find(x => x.id === r.location_id) || {};
    return {
      location_id: r.location_id, location_name: l.name ?? r.location_id, is_here: docked && r.location_id === ship.location_id,
      good_id: r.good_id, name: g.name ?? r.good_id, unit: g.unit ?? 'unit', hold_per_unit: Number(g.hold_per_unit ?? 1),
      quantity: r.quantity, avg_cost: r.avg_cost == null ? null : Number(r.avg_cost),
    };
  });
  out.items.sort((a, b) => (b.is_here - a.is_here) || a.location_name.localeCompare(b.location_name) || a.name.localeCompare(b.name));
  return json(out);
}

// "load" / "unload": body = { good: 'water_ice', quantity: 10 }. Whole units only. Needs the ship docked.
async function storageMove(db, user, body, kind) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const good = String(body.good ?? '');
  const qty = Number(body.quantity);
  if (!/^[a-z0-9_]{1,64}$/.test(good)) return json({ error: 'unknown_good' }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) return json({ error: 'bad_quantity' }, 400);
  await resolveFor(db, ch.id); // a ship that has just arrived can load at once
  const { data, error } = await db.rpc(kind === 'load' ? 'storage_load' : 'storage_unload', { p_character: ch.id, p_good: good, p_quantity: qty });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}

// ---------- market anywhere (Module 5 step 2; migration 011) ----------
const LOC_RE = /^[a-z0-9_]{1,64}$/;

// What I keep stored at ONE location, with names and units (same shape as the hold's cargo items).
async function storageAt(db, characterId, locId) {
  const { data: rows, error: se } = await db.from('storage').select('good_id,quantity,avg_cost').eq('character_id', characterId).eq('location_id', locId);
  if (se) throw se;
  let names = [];
  if ((rows ?? []).length) {
    const { data: gd, error: ge } = await db.from('goods').select('id,name,unit,hold_per_unit').in('id', rows.map(r => r.good_id));
    if (ge) throw ge;
    names = gd ?? [];
  }
  return (rows ?? []).map(r => {
    const g = names.find(x => x.id === r.good_id) || {};
    return { good_id: r.good_id, name: g.name ?? r.good_id, unit: g.unit ?? 'unit', hold_per_unit: Number(g.hold_per_unit ?? 1),
      quantity: r.quantity, avg_cost: r.avg_cost == null ? null : Number(r.avg_cost) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// "market_at": body = { location: 'luna' }. Everything the Market screen needs for ONE location:
// that market's goods (prices include the remote fee when my ship is not docked there), my storage there,
// and my cargo (only when my ship is docked there). Read-only.
async function marketAt(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const locId = String(body.location ?? '');
  if (!LOC_RE.test(locId)) return json({ error: 'unknown_location' }, 400);
  const loc = await getLocation(db, locId);
  if (!loc) return json({ error: 'unknown_location' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'no_ship' }, 400);
  const { cargo, hold_used } = await loadCargo(db, ship);
  const docked = ship.state === 'docked';
  const here = docked && ship.location_id === locId;

  const { data: mv, error: mvErr } = await db.rpc('market_view_at', { p_character: ch.id, p_location: locId });
  if (mvErr) throw mvErr;
  const goods = ((mv && mv.goods) || []).map(g => ({
    good_id: g.good_id, name: g.name, category: g.category, unit: g.unit,
    hold_per_unit: Number(g.hold_per_unit), target_stock: Number(g.target_stock), stock: Number(g.stock),
    mid_price: Number(g.mid_price), buy_price: Number(g.buy_price), sell_price: Number(g.sell_price),
  }));

  // my storage at this location
  const storage = await storageAt(db, ch.id, locId);

  // what each of my stacks would sell for here, and the profit against what I paid
  const r2 = n => Math.round(n * 100) / 100;
  const myCargo = here ? cargo : [];
  for (const c of [...myCargo, ...storage]) {
    const g = goods.find(x => x.good_id === c.good_id);
    c.sell_here = g ? g.sell_price : null;
    c.profit_each = (g && c.avg_cost != null) ? r2(g.sell_price - c.avg_cost) : null;
    c.profit_total = (g && c.avg_cost != null) ? r2((g.sell_price - c.avg_cost) * c.quantity) : null;
  }

  // which locations have a market at all (for the location box)
  const { data: mk, error: me2 } = await db.from('markets').select('location_id');
  if (me2) throw me2;
  const market_ids = [...new Set((mk ?? []).map(r => r.location_id))];

  return json({
    ok: true, location_id: locId, location_name: loc.name, docked, here,
    ship_location_id: docked ? ship.location_id : null,
    remote_fee: Number((mv && mv.remote_fee) ?? 0), credits: Number(ch.credits),
    hold_size: Number(ship.hold_size), hold_used, cargo: myCargo, storage, goods, market_ids,
  });
}

// "trade_at": body = { location, kind: 'buy'|'sell', good, quantity, stack: 'storage'|'cargo' }.
// buy: stack = where the goods go. sell: stack = where they come from. 'cargo' needs the ship docked at that location.
async function tradeAt(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const loc = String(body.location ?? ''), good = String(body.good ?? '');
  const kind = body.kind, stack = body.stack, qty = Number(body.quantity);
  if (!LOC_RE.test(loc)) return json({ error: 'unknown_location' }, 400);
  if (!LOC_RE.test(good)) return json({ error: 'unknown_good' }, 400);
  if (kind !== 'buy' && kind !== 'sell') return json({ error: 'bad_request' }, 400);
  if (stack !== 'storage' && stack !== 'cargo') return json({ error: 'bad_request' }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) return json({ error: 'bad_quantity' }, 400);
  await resolveFor(db, ch.id);
  const { data, error } = await db.rpc('trade_market', { p_character: ch.id, p_location: loc, p_kind: kind, p_good: good, p_quantity: qty, p_stack: stack });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}

// "unload_all": move everything in the hold into storage where the ship is docked.
async function unloadAll(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  const { data, error } = await db.rpc('storage_unload_all', { p_character: ch.id });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'not_logged_in' }, 401);

  // Server-only client: bypasses the read-only rules. Never exposed to the browser.
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  try {
    await loadClock(db);
    switch (body.action) {
      case 'me': return await me(db, user);
      case 'create_character': return await createCharacter(db, user, body);
      case 'queue_travel': return await queueTravel(db, user, body);
      case 'departures': return await departures(db, user);
      case 'cycle_speed': return await cycleSpeed(db, user);
      case 'market': return await market(db, user);
      case 'routes': return await routes(db, user, body);
      case 'cargo_routes': return await cargoRoutes(db, user, body);
      case 'cargo_dest': return await cargoDest(db, user, body);
      case 'buy': return await trade(db, user, body, 'buy');
      case 'sell': return await trade(db, user, body, 'sell');
      case 'storage': return await storageView(db, user);
      case 'load': return await storageMove(db, user, body, 'load');
      case 'unload': return await storageMove(db, user, body, 'unload');
      case 'market_at': return await marketAt(db, user, body);
      case 'trade_at': return await tradeAt(db, user, body);
      case 'unload_all': return await unloadAll(db, user);
      default: return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
