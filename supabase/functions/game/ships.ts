// @ts-nocheck
// ======================================================================
// Leave ship / board ship (step 2b). The SQL functions ship_leave and ship_board
// (migration 025) do the real work; this file only checks who is asking and passes
// the answer on. Imports from common.ts and freight.ts only.
// ======================================================================
import { json, getCharacter, UUID_RE, resolveFor } from './common.ts';
import { freightResolve } from './freight.ts';

// Step out of the active ship (docked): cargo -> storage, freight abandoned, a life pod becomes the active ship.
export async function shipLeave(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);                 // settle a finished trip first
  await freightResolve(db, ch.id, false);      // settle freight that arrived or ran out of time
  const { data, error } = await db.rpc('ship_leave', { p_character: ch.id });
  if (error) throw error;
  if (!data || !data.ok) return json(data ?? { error: 'server_error' }, 409);
  return json(data);
}

// Board one of my parked ships (body.ship = its id). Pod and ship must be docked at the same place.
export async function shipBoard(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const ship = String(body.ship ?? '');
  if (!UUID_RE.test(ship)) return json({ error: 'bad_ship' }, 400);
  await resolveFor(db, ch.id);
  await freightResolve(db, ch.id, false);
  const { data, error } = await db.rpc('ship_board', { p_character: ch.id, p_ship: ship });
  if (error) throw error;
  if (!data || !data.ok) return json(data ?? { error: 'server_error' }, 409);
  return json(data);
}
