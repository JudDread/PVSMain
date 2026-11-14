// fleet.ts - fleets (migrations 105 + 106).
// Actions: fleet_create, fleet_invite, fleet_accept, fleet_decline, fleet_leave, fleet_kick, fleet_seen.
// Also fleetForMe(): the fleet part of the `me` answer (members with their ship, invitations, the 'removed' notice).
// The rules live in SQL (the fleet_* functions). This file checks the input, words the refusals and gathers what the screen shows.
// index.ts loads this file only when it is needed (a dynamic import), so a fault here can never stop the game from starting.
import { json, getCharacter, visibleLocations } from './common.ts';

// The wording of every refusal (the SQL returns only a code).
const WORDS = {
  already_in_fleet: 'You are already in a fleet.',
  in_combat: 'You cannot change fleets while you are in a fight.',
  no_such_pilot: 'No pilot has that name.',
  self: 'That is you.',
  target_in_fleet: 'That pilot is already in a fleet.',
  already_invited: 'That pilot already has an invitation.',
  fleet_full: 'The fleet is full.',
  no_fleet: 'You are not in a fleet.',
  not_leader: 'Only the fleet leader can do that.',
  no_invite: 'That invitation has run out.',
  not_a_member: 'That pilot is not in your fleet.',
  target_in_combat: 'That pilot is in a fight and cannot be removed yet.',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(db, fn, args) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw error;
  return data;
}

export async function fleetCall(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character', message: 'Create your pilot first.' }, 400);
  const a = { p_character: ch.id };
  const name = String(body.name ?? '').trim().slice(0, 40);
  const fleet = String(body.fleet ?? '');
  let r;
  switch (body.action) {
    case 'fleet_create': r = await rpc(db, 'fleet_create', a); break;
    case 'fleet_invite': r = await rpc(db, 'fleet_invite', { ...a, p_name: name }); break;
    case 'fleet_accept':
      if (!UUID.test(fleet)) return json({ error: 'no_invite', message: WORDS.no_invite }, 409);
      r = await rpc(db, 'fleet_accept', { ...a, p_fleet: fleet }); break;
    case 'fleet_decline':
      if (!UUID.test(fleet)) return json({ error: 'no_invite', message: WORDS.no_invite }, 409);
      r = await rpc(db, 'fleet_decline', { ...a, p_fleet: fleet }); break;
    case 'fleet_leave': r = await rpc(db, 'fleet_leave', a); break;
    case 'fleet_kick': r = await rpc(db, 'fleet_kick', { ...a, p_name: name }); break;
    case 'fleet_seen': await rpc(db, 'fleet_seen', a); return json({ ok: true });
    default: return json({ error: 'unknown_action' }, 400);
  }
  if (!r || !r.ok) {
    const code = (r && r.code) || 'failed';
    return json({ error: code, message: WORDS[code] || 'That did not work. Try again.' }, 409);
  }
  // a new fleet: an old 'you were removed' notice no longer matters
  if (body.action === 'fleet_create' || body.action === 'fleet_accept') await rpc(db, 'fleet_seen', a);
  const vis = new Set((await visibleLocations(db, ch.id)).map((l) => l.id));
  return json({ ok: true, fleet: await fleetForMe(db, ch, vis) });
}

// What the screen needs: { max, notice, invites[], fleet: null | { id, leader_id, members[], invited[] } }.
// Each member: id, name, leader, hull (the ship type's name), state, loc (a place id the pilot may see, else null), fight,
// cond (shield / armor / hull for the chip, allies only; the same object as the pilot's own chip).
// `canSee` = the set of place ids this pilot may see (a ship docked at a hidden place does not give it away).
export async function fleetForMe(db, ch, canSee) {
  const v = await rpc(db, 'fleet_view', { p_character: ch.id });
  const out = { max: v.max_members, notice: v.notice ?? null, invites: v.invites ?? [], fleet: null };
  const f = v.fleet;
  if (!f) return out;
  const members = f.members ?? [];
  const { data: chs } = await db.from('characters').select('id,active_ship_id').in('id', members.map((m) => m.id));
  const shipOf = new Map((chs ?? []).map((c) => [c.id, c.active_ship_id]));
  const sids = [...shipOf.values()].filter(Boolean);
  let ships = []; let fights = new Set(); const hulls = {};
  if (sids.length) {
    const [a, b, h] = await Promise.all([
      db.from('ships').select('*').in('id', sids),
      db.from('combat_ships').select('ship_id').in('ship_id', sids),
      db.from('hulls').select('id,name'),
    ]);
    ships = a.data ?? [];
    fights = new Set((b.data ?? []).map((x) => x.ship_id));
    (h.data ?? []).forEach((x) => { hulls[x.id] = x.name; });
  }
  const byId = new Map(ships.map((s) => [s.id, s]));
  let condOf = null;
  try { condOf = (await import('./ship_state.ts')).shipCondition; } catch (e) { console.error('ship_state skipped for the fleet', e); }
  const list = await Promise.all(members.map(async (m) => {
    const s = byId.get(shipOf.get(m.id));
    const e = {
      id: m.id, name: m.name, leader: !!m.leader,
      hull: s ? (hulls[s.hull_id] || s.hull_id) : null,
      state: s ? s.state : null,
      loc: s && s.state === 'docked' && canSee.has(s.location_id) ? s.location_id : null,
      fight: s ? fights.has(s.id) : false,
      cond: null,
    };
    if (m.id !== ch.id && s && condOf) {
      try { e.cond = await condOf(db, s, Date.now()); } catch (err) { console.error('ally condition skipped', err); }
    }
    return e;
  }));
  out.fleet = { id: f.id, leader_id: f.leader_id, members: list, invited: f.invited ?? [] };
  return out;
}
