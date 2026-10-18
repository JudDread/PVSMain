// @ts-nocheck
// ======================================================================
// Rigging actions (migration 051): the data for the Rigging screen, fit a rig, unfit a rig.
// Every rule lives in SQL (rig_view, rig_fit, rig_unfit, rig_fit_problem); this file only checks the shape of
// the request and passes the answer on. A refused fit or unfit answers 409 with the SQL error and its numbers.
// ======================================================================
import { json, getCharacter, resolveFor, UUID_RE } from './common.ts';

const RIG_RE = /^[a-z0-9_]{1,64}$/;

// Settles a finished trip first (so a ship that just arrived counts as docked), then asks SQL.
async function ready(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return null;
  await resolveFor(db, ch.id);
  return ch;
}

// What the Rigging screen shows: the ship, its slots, power, hold, what is fitted, and the rigs at this place
// (in storage here or in the hold) with 'can_fit' and the reason when not.
export async function rigsView(db, user) {
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('rig_view', { p_character: ch.id });
  if (error) throw error;
  if (!data || data.ok === false) return json({ error: data?.error ?? 'rig_view_failed' }, 409);
  return json(data);
}

// body.rig = a rig id, e.g. 'rig_laser'. Takes one from storage here (first) or the hold.
export async function rigFit(db, user, body) {
  const rig = String(body.rig ?? '');
  if (!RIG_RE.test(rig)) return json({ error: 'bad_request' }, 400);
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('rig_fit', { p_character: ch.id, p_rig: rig });
  if (error) throw error;
  if (!data || data.ok === false) return json(data ?? { error: 'rig_fit_failed' }, 409);
  return json(data);
}

// body.fit = the id of the FITTED rig (ship_rigs.id, from rigs.fitted[].fit_id). It goes to storage here.
export async function rigUnfit(db, user, body) {
  const fit = String(body.fit ?? '');
  if (!UUID_RE.test(fit)) return json({ error: 'bad_request' }, 400);
  const ch = await ready(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('rig_unfit', { p_character: ch.id, p_fit: fit });
  if (error) throw error;
  if (!data || data.ok === false) return json(data ?? { error: 'rig_unfit_failed' }, 409);
  return json(data);
}
