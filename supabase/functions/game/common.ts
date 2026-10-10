// @ts-nocheck
// ======================================================================
// Shared helpers for the "game" function: the reply helper, database lookups,
// trip estimates, hold and storage views. index.ts, market.ts and freight.ts
// all import from here. This file imports NOTHING from them (no circles).
// ======================================================================
import { BODY_INDEX, bodyId, gToAuDay2, planTravel } from './physics_bundle.ts';

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
