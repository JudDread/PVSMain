// @ts-nocheck
// ======================================================================
// Step 4b: flight controls IN FLIGHT (change thrust, change destination, cancel the trip, hold the bar, stop, coast).
// Two actions, both for a ship that is traveling, hopping or drifting:
//   course_options {g}  READ-ONLY: where could I go from my position and speed right now, and how long would it take?
//   course_change  {mode, to?, g?}  mode = 'go' | 'hold' | 'stop' | 'coast'
//        go    fly to location `to` at thrust g, starting from where the ship is NOW with the speed it has now
//              (a new destination, a new thrust, or going back to where you left = cancelling the trip)
//        hold  the same destination, but at the free thrust (no more pulses; the endurance bar refills)
//        stop  burn against the ship's motion at the free thrust until it is at rest; then it DRIFTS (no destination)
//        coast cut the engine: keep speed and direction, drift (no destination)
// The page only PROPOSES (blue course); nothing here runs until the page sends course_change (the confirm button).
// The old trip is cancelled and the new course saved in ONE step (SQL ship_replan), so a ship never has two trips.
// ======================================================================
import { BODY_INDEX, bodyId, KMS, stateAt, shipStateAbs, stopPlan, coastPlan, planTravelPulse, pulseState, gameDaysAt, realMsAt, CLOCK } from './physics_bundle.ts';
import { json, getCharacter, getLocation, getLocationFor, visibleLocations, resolveFor, getShip, getMaxG, pilotNumbers, enduranceFly, enduranceFlyPulse, placeXY } from './common.ts';

const FLYING = ['traveling', 'hopping', 'drifting'];
const REST_DAYS = 3650;   // a drifting ship refills its bar at the flight rate (not the faster docked rate) for this long
const pick = (s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy });
const r1 = (n) => Math.round(n * 100) / 100;

// Where the ship is at game time t: in the plan's own frame (rel) and in space (abs). frame = body index or null.
// A hop (or a drift started inside a hop) is stored relative to a body; everything else is absolute.
export function shipNow(plan, t) {
  return { frame: plan.frame ?? null, rel: pick(stateAt(plan, t)), abs: pick(shipStateAbs(plan, t)) };
}

// Straight-line distance flown on the current leg (AU), in the plan's own frame. Feeds the pilot XP (see carry below).
export function legFlown(plan, rel) {
  const s0 = plan.segs && plan.segs.length ? plan.segs[0] : plan.end;   // a coast plan has no segments: its end IS its start
  return Math.hypot(rel.x - s0.x, rel.y - s0.y);
}

// Is the flight in progress in a REFILL phase of its pulses right now? Then the new plan must keep refilling to full
// before it burns again (regen0), or the ship would burn at once with a half-empty bar and break the pulse rule.
export function regenNow(act, t) {
  const q = act && act.payload && act.payload.pulse; if (!q) return false;
  const s = pulseState({ g: q.g, bar: q.bar0, regen0: q.regen0, mx: q.mx, freeG: q.freeG, refill: q.refill, perG: q.perG, share: q.share }, t - q.t0);
  return !s.burning;
}

// Plan a flight to location `to` from the ship's state now. Same rules as launching (planTrip in common.ts).
// Inside a body's frame and going to a place at that same body: a hop (plan in the body's frame, plan.frame set).
// Anything else: a flight in space to the destination body, starting from the ship's ABSOLUTE state.
// cache remembers flights per destination body (for the options list). Returns {ok, hop, r, days, sun_danger} or {ok:false, reason}.
export function planGo(cur, to, t, g, p, regen0, cache = {}) {
  if (!(to.anchor_body in BODY_INDEX) || BODY_INDEX[to.anchor_body] < 1) return { ok: false, reason: 'bad_destination' };
  const dest = bodyId(to.anchor_body);
  const nums = { g, bar: p.bar, mx: p.max, freeG: p.freeG, refill: p.refill, perG: p.perG, share: p.share, regen0 };
  if (cur.frame != null && cur.frame === dest) {
    const key = 'hop|' + to.id;
    const r = cache[key] ?? (cache[key] = planTravelPulse({ from: { state: cur.rel }, to: placeXY(to), departT: t, ...nums }));
    if (!r.ok) return { ok: false, reason: r.reason };
    r.plan.frame = cur.frame;
    return { ok: true, hop: true, r, days: r.durationDays, sun_danger: false };
  }
  const key = 'to|' + dest;
  const r = cache[key] ?? (cache[key] = planTravelPulse({ from: { state: cur.abs }, to: { body: dest }, departT: t, ...nums }));
  return r.ok ? { ok: true, hop: false, r, days: r.durationDays, sun_danger: r.sunDanger } : { ok: false, reason: r.reason };
}

async function pendingAction(db, shipId) {
  const { data, error } = await db.from('scheduled_actions').select('id,payload,resolve_at').eq('ship_id', shipId).eq('status', 'pending').maybeSingle();
  if (error) throw error;
  return data;
}

// Common start of both actions. Returns {ch, ship} or {err: Response}.
async function begin(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return { err: json({ error: 'no_character' }, 400) };
  await resolveFor(db, ch.id);                       // settle a trip that just finished first
  await db.rpc('xp_settle', { p_character: ch.id });
  const ship = await getShip(db, ch.id);
  if (!ship) return { err: json({ error: 'no_ship' }, 400) };
  return { ch, ship };
}

// ---------- course_options: read-only ----------
export async function courseOptions(db, user, body) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ch, ship } = b;
  if (!FLYING.includes(ship.state) || !ship.plan) return json({ ok: true, flying: false, docked: ship.state === 'docked' });
  const t = gameDaysAt(Date.now());
  const maxG = await getMaxG(db, ship);
  const g = body.g == null ? Number(ship.thrust_g) : Number(body.g);
  if (!(g >= 1) || g > maxG + 1e-9) return json({ error: 'bad_thrust', max_g: maxG }, 400);
  const p = await pilotNumbers(db, ch.id, g, t);
  const act = await pendingAction(db, ship.id);
  const cur = shipNow(ship.plan, t);
  const regen0 = regenNow(act, t);
  const out = {
    ok: true, flying: true, docked: false, state: ship.state, game_days: t, real_ms: Date.now(), scale: CLOCK.scale,
    g, max_g: maxG, endurance: p.bar, endurance_max: p.max, free_g: p.freeG, refill: p.refill, per_g: p.perG, share: p.share, regen0,
    dest: act && act.payload ? (act.payload.to_location ?? null) : null,
    origin: (act && act.payload && act.payload.from) || ship.plan.origin || null,
    speed_kms: Math.hypot(cur.abs.vx, cur.abs.vy) * KMS,
    departures: [],
  };
  const locs = await visibleLocations(db, ch.id);   // 059: only places this pilot may see
  const cache = {};
  for (const to of locs ?? []) {
    const est = planGo(cur, to, t, g, p, regen0, cache);
    if (!est.ok) continue;
    out.departures.push({
      id: to.id, name: to.name, anchor_body: to.anchor_body, kind: to.kind, is_default: to.is_default,
      eta_game_days: est.days, eta_real_minutes: est.days * 1440 / CLOCK.scale,
      sun_danger: est.sun_danger, pulsed: !!est.r.pulsed, g_avg: Math.round(est.r.gAvg * 100) / 100,
    });
  }
  out.departures.sort((x, y) => x.eta_real_minutes - y.eta_real_minutes);
  return json(out);
}

// ---------- course_change: the confirmed change ----------
export async function courseChange(db, user, body) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ch, ship } = b;
  if (!FLYING.includes(ship.state) || !ship.plan) return json({ error: 'not_in_flight' }, 409);
  const mode = String(body.mode ?? '');
  if (!['go', 'hold', 'stop', 'coast'].includes(mode)) return json({ error: 'bad_mode' }, 400);

  const t = gameDaysAt(Date.now());
  const act = await pendingAction(db, ship.id);
  const cur = shipNow(ship.plan, t);
  const p = await pilotNumbers(db, ch.id, 1, t);     // the numbers do not depend on g except drainHour (unused here)
  const origin = (act && act.payload && act.payload.from) || ship.plan.origin || null;
  // Distance flown so far (straight line, summed over every leg since the original launch). It rides along into the
  // next trip's distance so the pilot XP for the part already flown is not lost when the course changes.
  const carry = (act ? Number(act.payload.carried_au ?? 0) : Number(ship.plan.xp_au ?? 0)) + legFlown(ship.plan, cur.rel);

  // ----- stop / coast: the ship ends up DRIFTING (no destination, no trip pending) -----
  if (mode === 'stop' || mode === 'coast') {
    let plan, st;
    if (mode === 'stop') {
      // Stop = come to rest relative to what the plan is relative to: a body (inside a hop) or the Sun (in space).
      st = cur.frame != null ? cur.rel : cur.abs;
      plan = stopPlan(st, t, p.freeG) ?? coastPlan(st, t);   // already at rest: nothing to brake
      if (cur.frame != null) plan.frame = cur.frame;
    } else {
      // Coast = keep the speed and direction IN SPACE (so a hop's body speed is kept too).
      plan = coastPlan(cur.abs, t);
    }
    plan.xp_au = carry; if (origin) plan.origin = origin;
    const res = await replan(db, ch, ship, 'drifting', plan, null, null, null);
    if (res.err) return res.err;
    await enduranceFly(db, ch.id, p.freeG, 0, REST_DAYS, t);   // free thrust: the bar refills
    return json({ ok: true, mode, kind: 'drift', brake_game_days: plan.T, brake_real_minutes: plan.T * 1440 / CLOCK.scale });
  }

  // ----- go / hold: a new flight from here, with the speed we have now -----
  let to, g;
  if (mode === 'hold') {
    const id = act && act.payload && act.payload.to_location;
    if (!id) return json({ error: 'no_destination' }, 400);
    to = await getLocation(db, id); g = p.freeG;
  } else {
    to = await getLocationFor(db, ch.id, String(body.to ?? ''));   // 059: hidden and not shown = bad_destination
    const maxG = await getMaxG(db, ship);
    g = body.g == null ? Number(ship.thrust_g) : Number(body.g);
    if (!(g >= 1) || g > maxG + 1e-9) return json({ error: 'bad_thrust', max_g: maxG }, 400);
  }
  if (!to) return json({ error: 'bad_destination' }, 400);
  const regen0 = regenNow(act, t);
  const pg = { ...p, drainHour: Math.max(0, g - p.freeG) * p.perG };
  const est = planGo(cur, to, t, g, pg, regen0);
  if (!est.ok) return json({ error: est.reason }, 400);
  const r = est.r;
  const payload = {
    from: origin, to: to.anchor_body, to_location: to.id,
    departT: act && act.payload && act.payload.departT != null ? act.payload.departT : t,   // keeps the XP-in-flight estimate smooth
    arriveT: r.arriveT, g, distance_au: carry + r.distanceAU, carried_au: carry, pulse: r.pulse ?? null, replan: true,
  };
  if (origin) r.plan.origin = origin;
  const resolveAt = new Date(realMsAt(r.arriveT)).toISOString();
  const res = await replan(db, ch, ship, est.hop ? 'hopping' : 'traveling', r.plan, est.hop ? 'hop' : 'travel', payload, resolveAt);
  if (res.err) return res.err;
  if (r.pulsed) await enduranceFlyPulse(db, ch.id, g, r.durationDays, t, regen0);
  else await enduranceFly(db, ch.id, r.gEff, 0, r.durationDays, t);
  return json({
    ok: true, mode, kind: est.hop ? 'hop' : 'travel', g, pulsed: !!r.pulsed, g_avg: r1(r.gAvg), to: to.name, resolve_at: resolveAt,
    duration_game_days: r.durationDays, duration_real_minutes: r.durationDays * 1440 / CLOCK.scale, sun_danger: est.sun_danger,
  });
}

async function replan(db, ch, ship, state, plan, actionType, payload, resolveAt) {
  const { data, error } = await db.rpc('ship_replan', {
    p_character: ch.id, p_ship: ship.id, p_state: state, p_plan: plan,
    p_action_type: actionType, p_payload: payload, p_resolve_at: resolveAt,
  });
  if (error) throw error;
  if (!data || !data.ok) return { err: json({ error: data && data.error ? data.error : 'replan_failed' }, 409) };
  return { ok: true };
}
