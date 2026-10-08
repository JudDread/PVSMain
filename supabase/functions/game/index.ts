// @ts-nocheck
// ======================================================================
// Vacuum State - "game" server function (Supabase Edge Function)
// Physics + clock live in ./physics_bundle.ts (auto-bundled from shared/).
// ======================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { J2000_MS, G0, AU_M, DAY_S, KMS, C_KMS, KM_PER_AU, DOCK_RADIUS_AU, DOCK_SPEED_KMS, SUN_DANGER_AU, BODIES, BODY_INDEX, bodyId, bodyName, mag, gToAuDay2, bodyAngle, bodyPos, bodyVel, targetState, segmentEnd, stateAt, solvePlan, stopPlan, coastPlan, sunClearance, shipStateAt, planTravel, LAUNCH_MS, CLOCK, gameDaysAt, realMsAt, rescale, gameDate } from './physics_bundle.ts';

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
    await freightResolve(db, ch.id, false); // then settle freight that has arrived or run out of time
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
  // Freight riding in this ship's hold (active batches) also uses hold space. Same sum as SQL ship_hold_used.
  const { data: fb, error: fe } = await db.from('freight_batches').select('hold_used').eq('ship_id', ship.id).eq('status', 'active');
  if (fe) throw fe;
  let freightUsed = 0;
  for (const b of fb ?? []) freightUsed += Number(b.hold_used);
  holdUsed += freightUsed;
  return { cargo, hold_used: Math.round(holdUsed * 1000) / 1000, freight_used: Math.round(freightUsed * 1000) / 1000 };
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
  const per = Number(gd.hold_per_unit);
  const { hold_used } = await loadCargo(db, ship);
  const r2 = n => Math.round(n * 100) / 100;
  // Most you could buy at the origin (market stock + credits): asked of the server (market_quote, quantity 0).
  const { data: q0, error: qe0 } = await db.rpc('market_quote', { p_character: ch.id, p_location: originId, p_kind: 'buy', p_good: good, p_quantity: 0, p_stack: 'storage' });
  if (qe0) throw qe0;
  if (!q0 || !q0.ok) return json({ error: (q0 && q0.error) || 'no_market' }, 400);
  const holdCap = Math.max(0, Math.floor((Number(ship.hold_size) - hold_used + 1e-9) / per));
  const maxLoad = Math.max(0, Math.min(Number(q0.max_quantity), holdCap));
  const qty = maxLoad > 0 ? maxLoad : 1; // nothing affordable: rank by a single unit and say so
  // What the WHOLE load costs to buy (price rises as you buy; remote fee included when the ship is not docked there).
  const { data: q1, error: qe1 } = await db.rpc('market_quote', { p_character: ch.id, p_location: originId, p_kind: 'buy', p_good: good, p_quantity: qty, p_stack: 'storage' });
  if (qe1) throw qe1;
  if (!q1 || !q1.ok || q1.total == null) return json({ error: (q1 && q1.error) || 'no_market' }, 400);
  const buyTotal = Number(q1.total), buyAvg = Number(q1.unit_price);

  const from = await getLocation(db, originId);
  if (!from) return json({ error: explicit ? 'unknown_location' : 'bad_origin' }, 400);
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  // What the WHOLE load would sell for at every other place (price falls as you sell; no remote fee at destinations).
  const { data: lots, error: le2 } = await db.rpc('market_sell_lots', { p_character: ch.id, p_good: good, p_quantity: qty, p_origin: originId });
  if (le2) throw le2;
  const departT = gameDaysAt(Date.now()), g = Number(ship.thrust_g), cache = {};
  const rows = [];
  for (const p of lots ?? []) {
    if (p.location_id === originId) continue;
    const to = (locs ?? []).find(l => l.id === p.location_id);
    if (!to) continue;
    const est = estimateTrip(from, to, departT, g, cache);
    if (!est.ok) continue;
    const etaMin = est.days * 1440 / CLOCK.scale;
    const total = r2(Number(p.total) - buyTotal);
    const unit = r2(Number(p.avg_price) - buyAvg);
    rows.push({
      location_id: p.location_id, name: p.location_name, anchor_body: to.anchor_body,
      sell_price: Number(p.avg_price), stock: r2(Number(p.stock)), target_stock: r2(Number(p.target_stock)),
      eta_real_minutes: etaMin, sun_danger: est.sun_danger,
      profit_each: unit, profit_load: total, ppm: etaMin > 0 ? r2(total / etaMin) : 0,
    });
  }
  rows.sort((a, b) => b.ppm - a.ppm);
  return json({
    ok: true, docked, origin_id: originId, remote, good_id: good, name: gd.name, unit: gd.unit,
    buy_here: buyAvg, buy_total: buyTotal, max_load: maxLoad, load_used: qty, hypothetical: maxLoad === 0, rows,
  });
}

// ---- cargo selling options (used by "cargo_routes" and "cargo_dest") ----
// For ONE carried good: every place that trades it, with what the whole stack would sell for there.
// Cost = what I paid (avg_cost) when known, so profit is real. If the cost is unknown (bought before
// migration 009) cost_known is false and the figures are INCOME (sell price x quantity), not profit.
// The place I am docked at is included (is_here, no travel time, ppm null). Uses today's prices and ETA.
const r2s = n => Math.round(n * 100) / 100;
async function cargoOptions(db, ch, ship, from, locs, c, cache, departT) {
  const qty = Math.floor(Number(c.quantity));
  if (!(qty >= 1)) return [];
  // price of the WHOLE stack at every place that trades it (the place where the goods are carries the remote fee if the ship is not docked there)
  const { data: prices, error: pe } = await db.rpc('market_sell_lots', { p_character: ch.id, p_good: c.good_id, p_quantity: qty, p_origin: from.id });
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
    const sell = Number(p.avg_price); // average price per unit over the whole stack
    const total = r2s(Number(p.total) - (known ? c.avg_cost * qty : 0));
    const each = r2s(total / qty);
    rows.push({
      location_id: p.location_id, name: p.location_name, anchor_body: to.anchor_body, is_here: here,
      sell_price: sell, stock: r2s(Number(p.stock)), target_stock: r2s(Number(p.target_stock)),
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
  return { ch, ship, from, cargo: stacks, locs, departT: gameDaysAt(Date.now()), cache: {}, source, remote, docked };
}

// "cargo_routes": for each good in my hold (or in storage at body.location), the best place to sell the whole stack.
async function cargoRoutes(db, user, body) {
  const x = await cargoPrelude(db, user, body || {});
  if (x.resp) return x.resp;
  const items = [];
  for (const c of x.cargo) {
    const rows = await cargoOptions(db, x.ch, x.ship, x.from, x.locs, c, x.cache, x.departT);
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
  const rows = await cargoOptions(db, x.ch, x.ship, x.from, x.locs, c, x.cache, x.departT);
  rows.sort((p, q) => (p.is_here ? -1 : q.is_here ? 1 : q.ppm - p.ppm));
  return json({ ok: true, docked: x.docked, source: x.source, location_id: x.from.id, remote: x.remote, good_id: good, name: c.name, unit: c.unit,
    quantity: c.quantity, avg_cost: c.avg_cost, cost_known: c.avg_cost != null, rows });
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
    hold_per_unit: Number(g.hold_per_unit), target_stock: r2s(Number(g.target_stock)), stock: r2s(Number(g.stock)),
    mid_price: r2s(Number(g.mid_price)), buy_price: Number(g.buy_price), sell_price: Number(g.sell_price),
  }));

  // my storage at this location
  const storage = await storageAt(db, ch.id, locId);

  // what each of my stacks would sell for here, and the profit against what I paid
  const r2 = n => Math.round(n * 100) / 100;
  const myCargo = here ? cargo : [];
  // each stack: what the WHOLE stack would sell for here (server quote, remote fee included), average price per unit, profit
  for (const [list, stackName] of [[myCargo, 'cargo'], [storage, 'storage']]) {
    for (const c of list) {
      c.sell_here = null; c.profit_each = null; c.profit_total = null;
      const q = Math.floor(Number(c.quantity));
      if (!(q >= 1)) continue;
      const { data: qs, error: qerr } = await db.rpc('market_quote', { p_character: ch.id, p_location: locId, p_kind: 'sell', p_good: c.good_id, p_quantity: q, p_stack: stackName });
      if (qerr) throw qerr;
      if (!qs || !qs.ok || qs.total == null) continue;
      c.sell_here = Number(qs.unit_price);
      if (c.avg_cost != null) {
        c.profit_total = r2(Number(qs.total) - c.avg_cost * c.quantity);
        c.profit_each = r2(c.profit_total / c.quantity);
      }
    }
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

// "quote": body = { location, kind: 'buy'|'sell', good, quantity (0 = just the maximum), stack: 'storage'|'cargo' }.
// Read-only. Asks SQL market_quote: the exact total and average price for that quantity (same maths as trade_at),
// plus the most you can buy / sell (max_quantity) and what limits it. Nothing is traded.
async function quote(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const loc = String(body.location ?? ''), good = String(body.good ?? '');
  const kind = body.kind, stack = body.stack, qty = Number(body.quantity ?? 0);
  if (!LOC_RE.test(loc)) return json({ error: 'unknown_location' }, 400);
  if (!LOC_RE.test(good)) return json({ error: 'unknown_good' }, 400);
  if (kind !== 'buy' && kind !== 'sell') return json({ error: 'bad_request' }, 400);
  if (stack !== 'storage' && stack !== 'cargo') return json({ error: 'bad_request' }, 400);
  if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) return json({ error: 'bad_quantity' }, 400);
  await resolveFor(db, ch.id);
  const { data, error } = await db.rpc('market_quote', { p_character: ch.id, p_location: loc, p_kind: kind, p_good: good, p_quantity: qty, p_stack: stack });
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

// ---------- freight contracts (migrations 020/021) ----------
// All money and goods maths lives in the database (freight_* functions). The server: checks who is asking,
// works out game time and the delivery WINDOW per destination (trip time at the reference thrust x a factor),
// calls the SQL, and passes the answer on. Delivery and expiry are resolved LAZILY: freightResolve runs at the
// start of every freight action and in `me`.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function freightSettings(db) {
  const { data, error } = await db.from('game_state').select('value').eq('key', 'freight').maybeSingle();
  if (error) throw error;
  const v = data?.value ?? {};
  const num = (x, d) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d);
  return {
    window_factor: num(v.window_factor, 1.5),
    reference_thrust_g: num(v.reference_thrust_g, 1),
    min_window_days: num(v.min_window_days, 0.416667),
  };
}

// Window (GAME days) for freight from `from` to `to`: trip time at the reference thrust x factor, never below the minimum.
// Returns null when no trip can be planned. The SQL enforces the minimum again.
function freightWindow(fs, from, to, nowT, cache) {
  const est = estimateTrip(from, to, nowT, fs.reference_thrust_g, cache);
  if (!est.ok) return null;
  return Math.max(fs.min_window_days, est.days * fs.window_factor);
}

// Settle freight that has arrived (delivered) or run out of time (failed). `strict` = throw on an SQL error.
async function freightResolve(db, characterId, strict = true) {
  const { error } = await db.rpc('freight_resolve_due', { p_now_t: gameDaysAt(Date.now()), p_character: characterId });
  if (error) {
    if (strict) throw error;
    console.error('freight resolve failed', error);
  }
}

// Common start of every freight action: who is asking, settle trips, settle freight.
async function freightStart(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return { resp: json({ error: 'no_character' }, 400) };
  await resolveFor(db, ch.id);
  await freightResolve(db, ch.id);
  return { ch };
}
const freightAnswer = (data) => json(data, data && data.ok ? 200 : 400);

// "freight_post": body = { good, pickup, dest, units, price }. price = credits per unit paid to the hauler.
async function freightPost(db, user, body) {
  const good = String(body.good ?? ''), pickup = String(body.pickup ?? ''), dest = String(body.dest ?? '');
  const units = Number(body.units), price = Number(body.price);
  if (!LOC_RE.test(good)) return json({ error: 'unknown_good' }, 400);
  if (!LOC_RE.test(pickup) || !LOC_RE.test(dest)) return json({ error: 'unknown_location' }, 400);
  if (!Number.isInteger(units) || units < 1 || units > 1000000) return json({ error: 'bad_quantity' }, 400);
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) return json({ error: 'bad_price' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc('freight_post', { p_character: x.ch.id, p_good: good, p_pickup: pickup, p_dest: dest, p_units: units, p_price: price });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_cancel": body = { contract }.
async function freightCancel(db, user, body) {
  const contract = String(body.contract ?? '');
  if (!UUID_RE.test(contract)) return json({ error: 'contract_not_found' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc('freight_cancel', { p_character: x.ch.id, p_contract: contract });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_board": body = { location? }. The hauler's list at a pickup (default: where my ship is docked).
// The server sends the window for every destination, measured from the pickup.
async function freightBoard(db, user, body) {
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  let locId = body && body.location != null && body.location !== '' ? String(body.location) : null;
  if (!locId) {
    const ship = await getShip(db, x.ch.id);
    if (!ship) return json({ error: 'no_ship' }, 400);
    if (ship.state !== 'docked') return json({ ok: true, docked: false, location_id: null, items: [] });
    locId = ship.location_id;
  }
  if (!LOC_RE.test(locId)) return json({ error: 'unknown_location' }, 400);
  const from = await getLocation(db, locId);
  if (!from) return json({ error: 'unknown_location' }, 400);
  const fs = await freightSettings(db);
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  const nowT = gameDaysAt(Date.now()), cache = {}, windows = {};
  for (const to of locs ?? []) {
    if (to.id === from.id) continue;
    const w = freightWindow(fs, from, to, nowT, cache);
    if (w != null) windows[to.id] = w;
  }
  const { data, error } = await db.rpc('freight_board', { p_character: x.ch.id, p_location: locId, p_windows: windows });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_accept": body = { contract, units }. My ship (docked at the pickup) takes `units` of that contract.
async function freightAccept(db, user, body) {
  const contract = String(body.contract ?? ''), units = Number(body.units);
  if (!UUID_RE.test(contract)) return json({ error: 'contract_not_found' }, 400);
  if (!Number.isInteger(units) || units < 1 || units > 1000000) return json({ error: 'bad_quantity' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  // Find the route (pickup -> dest) to work out the window. The hauler cannot read contracts, the server can.
  const { data: c, error: ce } = await db.from('freight_contracts').select('pickup_location,dest_location').eq('id', contract).maybeSingle();
  if (ce) throw ce;
  if (!c) return json({ error: 'contract_not_found' }, 400);
  const [from, to] = await Promise.all([getLocation(db, c.pickup_location), getLocation(db, c.dest_location)]);
  if (!from || !to) return json({ error: 'contract_not_found' }, 400);
  const fs = await freightSettings(db);
  const nowT = gameDaysAt(Date.now());
  const windowDays = freightWindow(fs, from, to, nowT, {});
  if (windowDays == null) return json({ error: 'no_route' }, 400);
  const { data, error } = await db.rpc('freight_accept', { p_character: x.ch.id, p_contract: contract, p_units: units, p_now_t: nowT, p_window_days: windowDays });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_abandon": body = { batch }.
async function freightAbandon(db, user, body) {
  const batch = String(body.batch ?? '');
  if (!UUID_RE.test(batch)) return json({ error: 'batch_not_found' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc('freight_abandon', { p_character: x.ch.id, p_batch: batch });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_mine": my contracts (as owner). "freight_hauling": my loads (as hauler) + market rep + freight room.
// Hauling also gets game_days so the page can count down deadlines.
async function freightList(db, user, kind) {
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc(kind === 'mine' ? 'freight_mine' : 'freight_hauling', { p_character: x.ch.id });
  if (error) throw error;
  if (data && data.ok) { data.game_days = gameDaysAt(Date.now()); data.scale = CLOCK.scale; }
  return freightAnswer(data);
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
      default: return json({ error: 'unknown_action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error' }, 500);
  }
});
