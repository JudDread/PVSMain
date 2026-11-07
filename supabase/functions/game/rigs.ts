// @ts-nocheck
// ======================================================================
// Rigging and shipyard actions (migrations 051-053). Every rule lives in SQL; this file only checks the shape of
// the request and passes the answer on. A refusal answers 409 with the SQL error and its numbers (for example
// over_power {need, free}, hold_too_small {hold_after, hold_used}, not_enough_credits {credits, cost}).
//   rigs            body.ship (optional)            the Rigging screen data for that ship (empty = the flown ship)
//   rig_fit         body.rig, body.ship (optional)  fit one rig from storage here (first) or the hold
//   rig_unfit       body.fit                        take one fitted rig off; it goes to storage
//   rig_unfit_all   body.ship (optional)            take EVERY rig off one ship
//   rig_apply       body.ship (optional), body.ops  [{op:'fit'|'unfit', rig}] (1-60)  ALL the planned changes in ONE call, all or nothing (migration 094); the Rigging screen uses this
//   facilities      body.location (optional)        what a place offers; with no place: which places have a facility
//   shipyard        body.location                   the rig store of a place: what it sells, what I have there to sell
//   rig_buy         body.location, body.rig, body.qty    buy; the rigs go to storage AT that place (you need not be there)
//   rig_sell        body.location, body.rig, body.qty    sell from storage at that place
//   hull_buy        body.location, body.hull        buy a hull; it is PARKED (docked) at that place, you need not be there (migration 055)
//   hull_sell       body.location, body.ship        sell a PARKED hull docked at that place (no rigs, empty hold, not the flown ship)
// ======================================================================
import { json, getCharacter, resolveFor, UUID_RE, LOC_RE } from './common.ts';

const RIG_RE = /^[a-z0-9_]{1,64}$/;

// A ship that is docked counts as docked only after a finished trip is settled, so settle first.
async function ready(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return null;
  await resolveFor(db, ch.id);
  return ch;
}

// body.ship: missing / empty = the flown ship (null); otherwise it must look like a uuid (SQL checks it is mine).
function shipArg(body) {
  const s = body.ship;
  if (s === undefined || s === null || s === '') return { ok: true, ship: null };
  if (!UUID_RE.test(String(s))) return { ok: false, ship: null };
  return { ok: true, ship: String(s) };
}

function qtyArg(body) {
  const q = body.qty === undefined ? 1 : Number(body.qty);
  return Number.isInteger(q) && q >= 1 && q <= 100 ? q : null;
}

async function ask(db, fn, args) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  if (!data || data.ok === false) return json(data ?? { error: fn + '_failed' }, 409);
  return json(data);
}

export async function rigsView(db, user, body) {
  const sa = shipArg(body);
  if (!sa.ok) return json({ error: 'bad_request' }, 400);
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('rig_view', { p_character: ch.id, p_ship: sa.ship });
  if (error) throw error;
  if (!data || data.ok === false) return json(data ?? { error: 'rig_view_failed' }, 409);
  // 094: the Rigging screen plans changes in the browser with the same power and hold rules, so every rig row also says what it adds
  // to the ship's power output (effects.power_output) and to its hold (effects.hold_cu).
  const rows = [...(data.fitted ?? []), ...(data.here ?? [])];
  const ids = [...new Set(rows.map(r => r.rig_id))];
  if (ids.length) {
    const { data: rg, error: e2 } = await db.from('rigs').select('id, effects').in('id', ids);
    if (e2) throw e2;
    const fx = {};
    (rg ?? []).forEach(r => { fx[r.id] = r.effects || {}; });
    rows.forEach(r => { const e = fx[r.rig_id] || {}; r.power_bonus = Number(e.power_output) || 0; r.hold_bonus = Number(e.hold_cu) || 0; });
  }
  return json(data);
}

export async function rigFit(db, user, body) {
  const rig = String(body.rig ?? '');
  const sa = shipArg(body);
  if (!RIG_RE.test(rig) || !sa.ok) return json({ error: 'bad_request' }, 400);
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, 'rig_fit', { p_character: ch.id, p_rig: rig, p_ship: sa.ship });
}

// body.fit = the id of the FITTED rig (ship_rigs.id, from rigs.fitted[].fit_id).
export async function rigUnfit(db, user, body) {
  const fit = String(body.fit ?? '');
  if (!UUID_RE.test(fit)) return json({ error: 'bad_request' }, 400);
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, 'rig_unfit', { p_character: ch.id, p_fit: fit });
}

export async function rigUnfitAll(db, user, body) {
  const sa = shipArg(body);
  if (!sa.ok) return json({ error: 'bad_request' }, 400);
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, 'rig_unfit_all', { p_character: ch.id, p_ship: sa.ship });
}

// 094: body.ops = the planned steps IN ORDER, each {op:'fit'|'unfit', rig}. SQL runs them with rig_fit / rig_unfit and undoes everything if one is refused.
// A refusal answers 409 {error, ...numbers, step}.
const OPS_MAX = 60;
export async function rigApply(db, user, body) {
  const sa = shipArg(body);
  const ops = body.ops;
  if (!sa.ok || !Array.isArray(ops) || ops.length < 1 || ops.length > OPS_MAX) return json({ error: 'bad_request' }, 400);
  const clean = [];
  for (const o of ops) {
    const op = o ? o.op : null, rig = String(o && o.rig !== undefined ? o.rig : '');
    if ((op !== 'fit' && op !== 'unfit') || !RIG_RE.test(rig)) return json({ error: 'bad_request' }, 400);
    clean.push({ op, rig });
  }
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, 'rig_apply', { p_character: ch.id, p_ship: sa.ship, p_ops: clean });
}

// No body.location: which places have a facility at all (for the place list), e.g. { places: [{ location_id, kinds: ['shipyard'] }] }.
// With body.location: what that one place offers (SQL facilities_view).
export async function facilitiesView(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const loc = String(body.location ?? '');
  if (loc === '') {
    const { data, error } = await db.from('shipyards').select('location_id');
    if (error) throw error;
    return json({ ok: true, places: (data ?? []).map(r => ({ location_id: r.location_id, kinds: ['shipyard'] })) });
  }
  if (!LOC_RE.test(loc)) return json({ error: 'bad_request' }, 400);
  return await ask(db, 'facilities_view', { p_character: ch.id, p_location: loc });
}

export async function shipyardView(db, user, body) {
  const loc = String(body.location ?? '');
  if (!LOC_RE.test(loc)) return json({ error: 'bad_request' }, 400);
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, 'rig_store_view', { p_character: ch.id, p_location: loc });
}

export async function rigTrade(db, user, body, kind) {
  const loc = String(body.location ?? ''), rig = String(body.rig ?? '');
  const qty = qtyArg(body);
  if (!LOC_RE.test(loc) || !RIG_RE.test(rig) || qty === null) return json({ error: 'bad_request' }, 400);
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, kind === 'buy' ? 'rig_buy' : 'rig_sell', { p_character: ch.id, p_location: loc, p_rig: rig, p_qty: qty });
}

export async function hullBuy(db, user, body) {
  const loc = String(body.location ?? ''), hull = String(body.hull ?? '');
  if (!LOC_RE.test(loc) || !RIG_RE.test(hull)) return json({ error: 'bad_request' }, 400);
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, 'hull_buy', { p_character: ch.id, p_location: loc, p_hull: hull });
}

export async function hullSell(db, user, body) {
  const loc = String(body.location ?? ''), ship = String(body.ship ?? '');
  if (!LOC_RE.test(loc) || !UUID_RE.test(ship)) return json({ error: 'bad_request' }, 400);
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  return await ask(db, 'hull_sell', { p_character: ch.id, p_location: loc, p_ship: ship });
}
