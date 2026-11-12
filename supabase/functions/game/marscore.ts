// @ts-nocheck
// ======================================================================
// "game" function: MARS CORE 1 'Quiet Passage' (migrations 102 + 103). 2026-11-12.
// Accept (missions.ts calls mars1Accept when the mission is 'mars_1'): only while DOCKED AT MARS with 10 CU of free hold. SQL mars_1_start puts the
// 10 CU package (5 passengers and their gear) into the hold, bound for Earth Orbit, no timer, a token freight price of 0.01 per unit.
// mars1Check (after every freight settle and when the job list is read) records the delivery, or the loss (the job is then offered again at Mars at once).
// mars1Decide (action 'mission_choice' {quest, choice: 'report' | 'quiet'}) is the pilot's choice after the delivery: standing for Earth / Mars (SQL reputation_add), then the
// mission is 'ready' and the normal Claim pays 500,000 credits + 250 XP.
// mars1Info adds q.story = {pending, choice, result, ended_at} to the mission in the job list (the pop-ups on the page).
// All money / goods / standing work is in SQL; this file only passes the answers on.
// ======================================================================
import { gameDaysAt } from './physics_bundle.ts';
import { json, getCharacter, getShip, resolveFor } from './common.ts';

export const MARS1_ID = 'mars_1';
const UNITS = 10;

export async function mars1Accept(db, ch) {
  await resolveFor(db, ch.id);                                   // a trip that has just ended must show as docked
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'You have no ship.' }, 409);
  if (ship.state !== 'docked' || ship.location_id !== 'mars') return json({ error: 'You must be docked at Mars to accept this job.' }, 409);
  const { data, error } = await db.rpc('mars_1_start', { p_character: ch.id, p_now_t: gameDaysAt(Date.now()) });
  if (error) throw error;
  if (!data || !data.ok) {
    const e = data && data.error;
    if (e === 'not_offered') return json({ error: 'not_offered' }, 409);
    if (e === 'not_at_mars') return json({ error: 'You must be docked at Mars to accept this job.' }, 409);
    if (e === 'not_enough_hold') return json({ error: 'You need ' + UNITS + ' CU of free hold for this job. You have ' + Math.floor(Number(data.hold_free) || 0) + ' CU free.' }, 409);
    if (e === 'freight_limit') return json({ error: 'Your ship cannot carry that much freight right now.' }, 409);
    console.error('mars_1_start refused', data);
    return json({ error: 'The job could not be started right now. Try again in a little while.' }, 409);
  }
  const { data: l } = await db.from('locations').select('name').eq('id', data.dest).maybeSingle();
  return json({ ok: true, status: 'active', dest: data.dest, dest_name: (l && l.name) || 'Earth Orbit' });
}

// Records the delivery / loss (SQL mars_1_check). Best effort: never stops a freight action.
export async function mars1Check(db, characterId) {
  try {
    const { error } = await db.rpc('mars_1_check', { p_character: characterId });
    if (error) console.error('mars_1_check failed', error);
  } catch (e) { console.error('mars_1_check failed', e); }
}

// The pilot's choice after the delivery.
export async function mars1Decide(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  if (String(body.quest ?? '') !== MARS1_ID) return json({ error: 'bad_request' }, 400);
  const choice = String(body.choice ?? '');
  if (choice !== 'report' && choice !== 'quiet') return json({ error: 'bad_request' }, 400);
  await resolveFor(db, ch.id);
  await mars1Check(db, ch.id);                                   // make sure the delivery is on record
  const { data, error } = await db.rpc('mars_1_decide', { p_character: ch.id, p_choice: choice });
  if (error) throw error;
  if (!data || !data.ok) return json({ error: data && data.error === 'nothing_to_decide' ? 'There is nothing to decide right now.' : 'bad_request' }, 409);
  return json({ ok: true, choice: data.choice, rep: data.rep });
}

// What the page needs for the pop-ups: pending = delivered and the choice is still open; result / ended_at = how the last run ended (an offered job keeps it).
export async function mars1Info(db, characterId, quests) {
  const q = (quests || []).find((x) => x.id === MARS1_ID);
  if (!q) return;
  const { data: row, error } = await db.from('character_quests').select('counters').eq('character_id', characterId).eq('quest_id', MARS1_ID).maybeSingle();
  if (error) throw error;
  const c = (row && row.counters) || {};
  const offered = q.status === 'offered';
  q.story = {
    pending: q.status === 'active' && !!c.delivered_at && !c.choice,
    choice: c.choice ?? null,
    result: offered ? (c.last_result ?? null) : null,
    ended_at: offered ? (Number(c.last_ended_at) || null) : null,
  };
}
