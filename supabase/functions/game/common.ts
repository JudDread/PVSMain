// @ts-nocheck
// ======================================================================
// Shared helpers for the "game" function: the reply helper, database lookups,
// trip estimates, hold and storage views. index.ts, market.ts and freight.ts
// all import from here. This file imports NOTHING from them (no circles).
// ======================================================================
import { BODY_INDEX, bodyId, gToAuDay2, planTravel, planTravelBar } from './physics_bundle.ts';

// ---------- server ----------
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export async function getCharacter(db, user) {
  const { data, error } = await db.from('characters').select('*').eq('account_id', user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLocation(db, id) {
  const { data, error } = await db.from('locations').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function resolveFor(db, characterId) {
  const { error } = await db.rpc('resolve_due_actions', { p_character: characterId });
  if (error) console.error('resolve failed', error);
}

// Text patterns for ids coming from the browser.
export const LOC_RE = /^[a-z0-9_]{1,64}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const r2s = n => Math.round(n * 100) / 100;

// Time for a hop between two locations at the same body.
// d = distance between them (AU) = difference of their offsets from the body.
// Accelerate for half the way, brake for the other half: t = 2 * sqrt(d / a).
export function hopDurationDays(offsetA, offsetB, g) {
  const d = Math.abs(offsetA - offsetB);
  return 2 * Math.sqrt(d / gToAuDay2(g));
}

// How long would a trip from location `from` to location `to` take if it left now?
// Returns {ok, days, sun_danger} or {ok:false, reason}. NOTHING is saved.
// `cache` remembers long flights per destination body, because every location at
// the same body has the same flight (only the final hop differs).
export function estimateTrip(from, to, departT, g, cache) {
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

// ---------- trading (step 4b) ----------
// Prices, stock and the buy/sell maths all live in the database (migration 008).
// The server only checks who is asking, calls the SQL functions, and passes the result on.
// Step 2a: the ship being flown = the character's ACTIVE ship (characters.active_ship_id, set by SQL).
// The SQL twin is public.active_ship_of(character). Returns null when there is none.
export async function getShip(db, characterId) {
  const { data: ch, error: ce } = await db.from('characters').select('active_ship_id').eq('id', characterId).maybeSingle();
  if (ce) throw ce;
  if (!ch || !ch.active_ship_id) return null;
  const { data, error } = await db.from('ships').select('*').eq('id', ch.active_ship_id).maybeSingle();
  if (error) throw error;
  return data;
}

// What the ship carries, with names and hold space. Also returns hold_used.
export async function loadCargo(db, ship) {
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

// What I keep stored at ONE location, with names and units (same shape as the hold's cargo items).
export async function storageAt(db, characterId, locId) {
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

// ---------- step 3: pilot, thrust and endurance ----------
// Highest thrust the ship may use = its hull's max_g (never above the code limit of 12 g).
export async function getMaxG(db, ship) {
  const { data, error } = await db.from('hulls').select('max_g').eq('id', ship.hull_id).maybeSingle();
  if (error) throw error;
  return Math.min(12, Number(data?.max_g ?? ship.thrust_g ?? 3));
}

// READ-ONLY. For a list of trip durations (game days) flown at `g`: what each costs in endurance and whether
// the pilot can pay it now. All the maths is in SQL (endurance_check); this only passes it on.
export async function enduranceCheck(db, characterId, g, durations, nowT) {
  const { data, error } = await db.rpc('endurance_check', { p_character: characterId, p_g: g, p_durations: durations, p_now_t: nowT });
  if (error) throw error;
  return data;
}

// SPENDS the endurance for one flight (SQL endurance_use). Call once, right after the flight was saved.
// A refusal here could only come from a race (the check passed a moment ago): log it, the flight stands.
export async function enduranceSpend(db, characterId, g, days, nowT) {
  const { data, error } = await db.rpc('endurance_use', { p_character: characterId, p_g: g, p_days: days, p_now_t: nowT });
  if (error) throw error;
  if (!data?.ok) console.error('endurance_use refused after launch', data);
  return data;
}

// ---------- step 4: flights the endurance bar can pay for ----------
// Any thrust up to the hull's limit may launch. The ship burns at that thrust while the bar lasts, then flies on at
// the free thrust (3 g). SQL holds the numbers; these helpers only plan with them.

// The numbers a plan needs, read from SQL at game time nowT (one call, nothing saved).
//   bar = endurance now, max = size of the bar, freeG = thrust that costs nothing,
//   perG = bar lost per game hour for every g above freeG, drainHour = bar lost per game hour at thrust g.
export async function pilotNumbers(db, characterId, g, nowT) {
  const chk = await enduranceCheck(db, characterId, g, [], nowT);
  const freeG = Number(chk.free_g), perG = Number(chk.drain_per_g_hour);
  return { bar: Number(chk.endurance), max: Number(chk.max), freeG, perG, drainHour: Math.max(0, g - freeG) * perG };
}

// A hop is a short straight line: accelerate at the limit, then brake at the limit. Same rule as long flights:
// burn at g until the bar is empty (te), then at the free thrust. The moment to start braking (ts) is searched so the
// ship stops exactly at the destination (no overshoot). Returns {g, days, cost, burn_days, drops, g_eff}.
export function hopWithBar(offsetA, offsetB, g, p) {
  const d = Math.abs(offsetA - offsetB);
  const a1 = gToAuDay2(g), a3 = gToAuDay2(p.freeG);
  const full = 2 * Math.sqrt(d / a1);
  const drainHour = Math.max(0, g - p.freeG) * p.perG;
  if (!(g > p.freeG) || !(drainHour > 0)) return { g, days: full, cost: 0, burn_days: 0, drops: false, g_eff: g };
  if (!(p.bar > 1e-6)) return { g, days: 2 * Math.sqrt(d / a3), cost: 0, burn_days: 0, drops: true, g_eff: p.freeG };
  const te = p.bar / drainHour / 24;                                   // days until the bar is empty
  if (te >= full) return { g, days: full, cost: drainHour * full * 24, burn_days: full, drops: false, g_eff: g };
  // Distance covered and total time if braking starts at ts (limit = a1 before te, a3 after).
  const run = ts => {
    let v, x;
    if (ts <= te) { v = a1 * ts; x = 0.5 * a1 * ts * ts; }
    else { const dt = ts - te, v1 = a1 * te; v = v1 + a3 * dt; x = 0.5 * a1 * te * te + v1 * dt + 0.5 * a3 * dt * dt; }
    if (ts >= te) return { D: x + v * v / (2 * a3), end: ts + v / a3 };
    const tb = v / a1;
    if (ts + tb <= te) return { D: x + v * v / (2 * a1), end: ts + tb };
    const dt1 = te - ts, v2 = v - a1 * dt1, x2 = v * dt1 - 0.5 * a1 * dt1 * dt1;
    return { D: x + x2 + v2 * v2 / (2 * a3), end: te + v2 / a3 };
  };
  let lo = 0, hi = Math.sqrt(d / a3);                                 // hi = the all-free-g switch time: always enough
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (run(mid).D < d) lo = mid; else hi = mid; }
  return { g, days: run(hi).end, cost: p.bar, burn_days: te, drops: true, g_eff: g };
}

// Like estimateTrip, but with the bar. p = pilotNumbers(...). Returns
// {ok, days, sun_danger, cost, burn_days, drops, g_eff, r} or {ok:false, reason}. NOTHING is saved.
// r = the full plan result of a long flight (queue_travel saves its plan); long flights are cached per destination body.
export function estimateTripBar(from, to, departT, g, cache, p) {
  if (from.id === to.id) return { ok: false, reason: 'already_here' };
  if (!(to.anchor_body in BODY_INDEX) || BODY_INDEX[to.anchor_body] < 1) return { ok: false, reason: 'bad_destination' };
  if (!(from.anchor_body in BODY_INDEX)) return { ok: false, reason: 'bad_origin' };
  if (from.anchor_body === to.anchor_body) {
    const h = hopWithBar(Number(from.offset_au), Number(to.offset_au), g, p);
    return h.days > 0
      ? { ok: true, days: h.days, sun_danger: false, cost: h.cost, burn_days: h.burn_days, drops: h.drops, g_eff: h.g_eff }
      : { ok: false, reason: 'bad_destination' };
  }
  let r = cache[to.anchor_body];
  if (!r) {
    r = cache[to.anchor_body] = planTravelBar({
      from: { body: bodyId(from.anchor_body) },
      to: { body: bodyId(to.anchor_body) },
      departT, g, bar: p.bar, freeG: p.freeG, drainHour: p.drainHour,
    });
  }
  return r.ok
    ? { ok: true, days: r.durationDays, sun_danger: r.sunDanger, cost: r.cost, burn_days: r.burnDays, drops: r.drops, g_eff: r.gEff, r }
    : { ok: false, reason: r.reason };
}

// SPENDS the endurance for one flight (SQL endurance_fly). Call once, right after the flight was saved.
// burnDays = game days above the free thrust, totalDays = the whole flight. It never refuses.
export async function enduranceFly(db, characterId, g, burnDays, totalDays, nowT) {
  const { data, error } = await db.rpc('endurance_fly', { p_character: characterId, p_g: g, p_burn_days: burnDays, p_total_days: totalDays, p_now_t: nowT });
  if (error) throw error;
  if (!data?.ok) console.error('endurance_fly failed', data);
  return data;
}
