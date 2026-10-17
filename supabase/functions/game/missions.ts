// @ts-nocheck
// ======================================================================
// Missions: the server side of the Missions screen (migration 048).
// All rules live in SQL (quest_sync / quest_list / quest_step / quest_claim);
// this file only checks who is asking and passes the request on.
// ======================================================================
import { json, getCharacter } from './common.ts';

// Everything the Missions screen needs (also starts any mission that is due).
export async function missionsView(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('quest_list', { p_character: ch.id });
  if (error) throw error;
  return json({ ok: true, quests: data.quests, ready: data.ready });
}

// The player did one step of a mission, e.g. {quest:'tutorial_1', step:'profile'}.
// The server only accepts step names that belong to that mission.
export async function missionStep(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('quest_step', {
    p_character: ch.id, p_quest: String(body.quest ?? ''), p_step: String(body.step ?? ''),
  });
  if (error) throw error;
  if (!data.ok) return json({ error: data.error }, 409);
  return json(data);
}

// The player taps Claim. SQL pays once only.
export async function missionClaim(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('quest_claim', { p_character: ch.id, p_quest: String(body.quest ?? '') });
  if (error) throw error;
  if (!data.ok) return json({ error: data.error }, 409);
  return json(data);
}
