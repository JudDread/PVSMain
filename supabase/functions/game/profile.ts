// @ts-nocheck
// ======================================================================
// Profile: the server side of the Profile screen (migration 049).
// body.name = a pilot's name; empty = my own profile. The server decides what other pilots may see:
// everything except the activity log (that comes back only for your own profile).
// ======================================================================
import { json, getCharacter, getShip, getMaxG } from './common.ts';
import { gameDaysAt } from './physics_bundle.ts';

export async function profileView(db, user, body) {
  const me = await getCharacter(db, user);
  if (!me) return json({ error: 'no_character' }, 400);
  const name = String(body.name ?? '').trim();
  const self = !name || name === me.name;

  let target = me;
  if (!self) {
    const { data, error } = await db.from('characters').select('id,name,is_bot').eq('name', name).maybeSingle();
    if (error) throw error;
    if (!data || data.is_bot) return json({ error: 'not_found' }, 404);   // bots are invisible
    target = data;
  }

  if (self) await db.rpc('xp_settle', { p_character: target.id });   // pay XP for trips that just finished
  const { data: pilot, error: pe } = await db.rpc('pilot_status', { p_character: target.id, p_now_t: gameDaysAt(Date.now()) });
  if (pe) throw pe;
  const { data, error } = await db.rpc('profile_data', { p_character: target.id, p_self: self });
  if (error) throw error;
  if (!data.ok) return json({ error: data.error }, 404);
  // Top thrust of the active ship INCLUDING skills (own profile only).
  let maxG = null;
  if (self) {
    try { const ship = await getShip(db, target.id); if (ship) maxG = await getMaxG(db, ship); } catch (e) { console.error(e); }
  }
  return json({ ...data, self, level: pilot.level, max_g: maxG });
}
