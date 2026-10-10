// @ts-nocheck
// ======================================================================
// Vacuum State - "game" server function (Supabase Edge Function)
// Physics + clock live in ./physics_bundle.ts (auto-bundled from shared/).
// ======================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { J2000_MS, G0, AU_M, DAY_S, KMS, C_KMS, KM_PER_AU, DOCK_RADIUS_AU, DOCK_SPEED_KMS, SUN_DANGER_AU, BODIES, BODY_INDEX, bodyId, bodyName, mag, gToAuDay2, bodyAngle, bodyPos, bodyVel, targetState, segmentEnd, stateAt, solvePlan, stopPlan, coastPlan, sunClearance, shipStateAt, planTravel, LAUNCH_MS, CLOCK, gameDaysAt, realMsAt, rescale, gameDate } from './physics_bundle.ts';

import { cors, json, getCharacter, getLocation, resolveFor, getShip, estimateTrip, hopDurationDays, getMaxG, enduranceCheck, enduranceSpend } from './common.ts';
import { routes, cargoRoutes, cargoDest, storageView, storageMove, marketAt, tradeAt, quote, unloadAll } from './market.ts';
import { freightResolve, freightPost, freightCancel, freightBoard, freightAccept, freightAbandon, freightList } from './freight.ts';
import { shipLeave, shipBoard } from './ships.ts';

// ---------- server ----------
const STARTER_LOCATION = 'luna'; // a row id in the locations table


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
  await db.rpc('xp_settle', { p_character: ch.id }); // pay XP for trips that just finished
  const ship = await getShip(db, ch.id); // the ACTIVE ship
  if (!ship) return json({ error: 'no_ship' }, 400);
  if (ship.state !== 'docked') return json({ error: 'ship_busy' }, 409);

  const from = await getLocation(db, ship.location_id);
  const to = await getLocation(db, String(body.to ?? ''));
  if (!from || !to) return json({ error: 'bad_destination' }, 400);
  if (!(to.anchor_body in BODY_INDEX) || BODY_INDEX[to.anchor_body] < 1) return json({ error: 'bad_destination' }, 400);
  if (!(from.anchor_body in BODY_INDEX)) return json({ error: 'bad_origin' }, 400);
  if (from.id === to.id) return json({ error: 'already_here' }, 400);
  const departT = gameDaysAt(Date.now());

  // Thrust for this flight: the page may ask for more than the usual 3 g, up to the hull's limit.
  // Above the free thrust (3 g) the flight costs endurance (SQL endurance_check / endurance_use).
  const maxG = await getMaxG(db, ship);
  const g = body.g == null ? Number(ship.thrust_g) : Number(body.g);
  if (!(g >= 1) || g > maxG + 1e-9) return json({ error: 'bad_thrust', max_g: maxG }, 400);

  // Same planet: a short "hop" (accelerate half way, brake the rest).
  if (from.anchor_body === to.anchor_body) {
    const dur = hopDurationDays(Number(from.offset_au), Number(to.offset_au), g);
    if (!(dur > 0)) return json({ error: 'bad_destination' }, 400);
    const chk = await enduranceCheck(db, ch.id, g, [dur], departT);
    if (!chk.results[0].ok) return json({ error: 'not_enough_endurance', needed: chk.results[0].cost, available: chk.endurance }, 409);
    const hopAt = new Date(realMsAt(departT + dur)).toISOString();
    const { data: hop, error: h1 } = await db.from('scheduled_actions').insert({
      character_id: ch.id, ship_id: ship.id, action_type: 'hop',
      payload: { from: from.id, to: to.anchor_body, to_location: to.id, departT, arriveT: departT + dur, g, distance_au: Math.abs(Number(from.offset_au) - Number(to.offset_au)) },
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
    await enduranceSpend(db, ch.id, g, dur, departT);
    return json({
      ok: true, kind: 'hop', g, endurance_cost: chk.results[0].cost, action_id: hop.id, from: from.name, to: to.name, resolve_at: hopAt,
      duration_game_days: dur, duration_real_minutes: dur * 1440 / CLOCK.scale, sun_danger: false,
    });
  }

  const r = planTravel({
    from: { body: bodyId(from.anchor_body) },
    to: { body: bodyId(to.anchor_body) },
    departT,
    g,
  });
  if (!r.ok) return json({ error: r.reason }, 400);
  const chk = await enduranceCheck(db, ch.id, g, [r.durationDays], departT);
  if (!chk.results[0].ok) return json({ error: 'not_enough_endurance', needed: chk.results[0].cost, available: chk.endurance }, 409);

  const resolveAt = new Date(realMsAt(r.arriveT)).toISOString();
  const { data: action, error: e1 } = await db.from('scheduled_actions').insert({
    character_id: ch.id, ship_id: ship.id, action_type: 'travel',
    payload: { from: from.id, to: to.anchor_body, to_location: to.id, departT, arriveT: r.arriveT, g, distance_au: r.distanceAU },
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
  await enduranceSpend(db, ch.id, g, r.durationDays, departT);
  return json({
    ok: true, g, endurance_cost: chk.results[0].cost, action_id: action.id, from: from.name, to: to.name, resolve_at: resolveAt,
    duration_game_days: r.durationDays,
    duration_real_minutes: r.durationDays * 1440 / CLOCK.scale,
    sun_danger: r.sunDanger,
  });
}

// "departures": where can my docked ship go right now, and how long would each trip take?
// Read-only: nothing is saved. The server does the maths; the page only displays it.
async function departures(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id); // the ACTIVE ship
  if (!ship) return json({ error: 'no_ship' }, 400);
  const out = { ok: true, game_days: gameDaysAt(Date.now()), real_ms: Date.now(), scale: CLOCK.scale, docked: ship.state === 'docked', from: null, departures: [] };
  const maxG = await getMaxG(db, ship);
  const g = body.g == null ? Number(ship.thrust_g) : Number(body.g);
  if (!(g >= 1) || g > maxG + 1e-9) return json({ error: 'bad_thrust', max_g: maxG }, 400);
  out.g = g; out.max_g = maxG;
  if (!out.docked) return json(out);

  const from = await getLocation(db, ship.location_id);
  if (!from) return json({ error: 'bad_origin' }, 400);
  out.from = from.id;
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  const departT = out.game_days, cache = {};
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
  // Endurance cost of each trip at this thrust (SQL does the maths; one call for the whole list).
  if (out.departures.length) {
    const chk = await enduranceCheck(db, ch.id, g, out.departures.map(d => d.eta_game_days), departT);
    out.endurance = chk.endurance; out.endurance_max = chk.max;
    out.departures.forEach((d, i) => { d.endurance_cost = chk.results[i].cost; d.affordable = chk.results[i].ok; });
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
    await db.rpc('xp_settle', { p_character: ch.id }); // pay XP for trips that just finished
    await freightResolve(db, ch.id, false); // then settle freight that has arrived or run out of time
    const [ships, actions, events] = await Promise.all([
      db.from('ships').select('*').eq('character_id', ch.id),
      db.from('scheduled_actions').select('id,action_type,status,payload,resolve_at,resolved_at').eq('character_id', ch.id).order('created_at', { ascending: false }).limit(10),
      db.from('event_log').select('*').eq('character_id', ch.id).order('created_at', { ascending: false }).limit(20),
    ]);
    // Active ship FIRST (the page uses the first ship), then the others, oldest first.
    const act = ch.active_ship_id;
    out.ships = (ships.data ?? []).slice().sort((a, b) =>
      ((b.id === act) - (a.id === act)) || String(a.created_at).localeCompare(String(b.created_at)));
    out.actions = actions.data; out.events = events.data;
    // Level, XP (including XP earned so far on a trip in flight) and the endurance bar, worked out by SQL.
    const { data: pilot, error: pe } = await db.rpc('pilot_status', { p_character: ch.id, p_now_t: out.game_days });
    if (pe) throw pe;
    out.pilot = pilot;
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
      case 'departures': return await departures(db, user, body);
      case 'cycle_speed': return await cycleSpeed(db, user);
      case 'routes': return await routes(db, user, body);
      case 'cargo_routes': return await cargoRoutes(db, user, body);
      case 'cargo_dest': return await cargoDest(db, user, body);
      case 'storage': return await storageView(db, user);
      case 'load': return await storageMove(db, user, body, 'load');
      case 'unload': return await storageMove(db, user, body, 'unload');
      case 'market_at': return await marketAt(db, user, body);
      case 'trade_at': return await tradeAt(db, user, body);
      case 'quote': return await quote(db, user, body);
      case 'unload_all': return await unloadAll(db, user);
      case 'freight_post': return await freightPost(db, user, body);
      case 'freight_cancel': return await freightCancel(db, user, body);
      case 'freight_board': return await freightBoard(db, user, body);
      case 'freight_accept': return await freightAccept(db, user, body);
      case 'freight_abandon': return await freightAbandon(db, user, body);
      case 'freight_mine': return await freightList(db, user, 'mine');
      case 'freight_hauling': return await freightList(db, user, 'hauling');
      case 'ship_leave': return await shipLeave(db, user);
      case 'ship_board': return await shipBoard(db, user, body);
      default: return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
