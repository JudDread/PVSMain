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
  // Same planet: that is a short "hop", built in the next step.
  if (from.anchor_body === to.anchor_body) return json({ error: 'same_body_hop_not_built_yet' }, 400);

  const departT = gameDaysAt(Date.now());
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

async function me(db, user) {
  const ch = await getCharacter(db, user);
  const out = { game_days: gameDaysAt(Date.now()), real_ms: Date.now(), scale: CLOCK.scale, character: ch };
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
    switch (body.action) {
      case 'me': return await me(db, user);
      case 'create_character': return await createCharacter(db, user, body);
      case 'queue_travel': return await queueTravel(db, user, body);
      default: return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
