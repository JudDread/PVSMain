// @ts-nocheck
// ======================================================================
// services.ts - WHAT A PLACE OFFERS (migration 077, table location_services).
// A place is only a point you can fly to. What you can DO there is a list of services kept as data:
//   'hangar' (leave / keep a ship, store goods, fit rigs, repair and rearm, post freight), 'market', 'shipyard', 'combat'.
// Every question goes through can(db, place, service). Today it only looks for a row; later the same function can look at the
// pilot too (corporation base, standing, blockade) without touching any caller.
// Taking things back is never blocked (boarding a parked ship, loading from storage): putting things down needs the service.
// The table is remembered for a minute, so a change in the data shows within 60 seconds.
// Imports from common.ts only.
// ======================================================================
import { json, getCharacter, getShip } from './common.ts';

const TTL_MS = 60000;
let cache = null, cacheAt = 0;

/* Map: place id -> [services] */
export async function placeServices(db) {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  const { data, error } = await db.from('location_services').select('location_id,service');
  if (error) throw error;
  const m = new Map();
  for (const r of data ?? []) { if (!m.has(r.location_id)) m.set(r.location_id, []); m.get(r.location_id).push(r.service); }
  cache = m; cacheAt = Date.now();
  return m;
}

/* Does this place offer the service? (character is not used yet) */
export async function can(db, locationId, service, character = null) {
  if (!locationId) return false;
  const m = await placeServices(db);
  const list = m.get(locationId);
  return !!(list && list.includes(service));
}

/* Actions that PUT things down need the service at the place where the ship is docked. A ship that is not docked is left to the action's own check. */
const NEEDS = {
  ship_leave: 'hangar',
  unload: 'hangar', unload_all: 'hangar',
  rig_fit: 'hangar', rig_unfit: 'hangar', rig_unfit_all: 'hangar',
};
const REFUSAL = 'This place has no market. Go to a market location to do that.';
const refuse = (service) => json({ error: 'no_service', service, message: REFUSAL }, 409);

/* Called by index.ts before every action. Returns a refusal (Response) or null. */
export async function gate(db, user, action, body) {
  if (action === 'freight_post') {                               // freight needs a hangar at the pickup and at the destination
    for (const id of [String((body && body.pickup) ?? ''), String((body && body.dest) ?? '')]) {
      if (id && !(await can(db, id, 'hangar'))) return refuse('hangar');
    }
    return null;
  }
  const need = NEEDS[action];
  if (!need) return null;
  const ch = await getCharacter(db, user);
  if (!ch) return null;
  const ship = await getShip(db, ch.id);
  if (!ship || ship.state !== 'docked' || !ship.location_id) return null;
  return (await can(db, ship.location_id, need, ch)) ? null : refuse(need);
}
