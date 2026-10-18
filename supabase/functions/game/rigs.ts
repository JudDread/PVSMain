// @ts-nocheck
// ======================================================================
// Rigging and shipyard actions (migrations 051-053). Every rule lives in SQL; this file only checks the shape of
// the request and passes the answer on. A refusal answers 409 with the SQL error and its numbers (for example
// over_power {need, free}, hold_too_small {hold_after, hold_used}, not_enough_credits {credits, cost}).
//   rigs            body.ship (optional)            the Rigging screen data for that ship (empty = the flown ship)
//   rig_fit         body.rig, body.ship (optional)  fit one rig from storage here (first) or the hold
//   rig_unfit       body.fit                        take one fitted rig off; it goes to storage
//   rig_unfit_all   body.ship (optional)            take EVERY rig off one ship
//   facilities      body.location (optional)        what a place offers; with no place: which places have a facility
//   shipyard        body.location                   the rig store of a place: what it sells, what I have there to sell
//   rig_buy         body.location, body.rig, body.qty    buy; the rigs go to storage AT that place (you need not be there)
//   rig_sell        body.location, body.rig, body.qty    sell from storage at that place
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
  return await ask(db, 'rig_view', { p_character: ch.id, p_ship: sa.ship });
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
