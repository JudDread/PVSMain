// @ts-nocheck
// ======================================================================
// Missions: the server side of the Missions screen (migrations 048, 050).
// All rules live in SQL (quest_sync / quest_list / quest_step / quest_accept / quest_claim / quest_seen);
// this file only checks who is asking and passes the request on.
// ======================================================================
import { json, getCharacter } from './common.ts';

// 059: a mission can show or hide places (quests.effects, SQL quest_effects_apply). The accept / claim has already succeeded, so try twice.
async function applyEffects(db, characterId, quest, event) {
  for (let k = 0; k < 2; k++) {
    const { error } = await db.rpc('quest_effects_apply', { p_character: characterId, p_quest: quest, p_event: event });
    if (!error) return;
    console.error('quest effects failed', error);
  }
  throw new Error('quest_effects_failed');
}

// Everything the Missions screen needs (also starts any mission that is due).
// chains = the open cards, quests = the pilot's missions (each has its chain), ready = rewards waiting, new = missions not looked at yet.
export async function missionsView(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  // 058: post the pilot's private tutorial freight job when its turn has come (does nothing otherwise; a failure never blocks the list)
  try { await db.rpc('tutorial_freight_post', { p_character: ch.id }); } catch (e) { /* ignore */ }
  const { data, error } = await db.rpc('quest_list', { p_character: ch.id });
  if (error) throw error;
  return json({ ok: true, chains: data.chains, quests: data.quests, ready: data.ready, new: data.new });
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

// The player taps Accept on an offered mission. 409 not_offered when it is not waiting for Accept.
export async function missionAccept(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('quest_accept', { p_character: ch.id, p_quest: String(body.quest ?? '') });
  if (error) throw error;
  if (!data.ok) return json({ error: data.error }, 409);
  await applyEffects(db, ch.id, String(body.quest ?? ''), 'accept');
  return json(data);
}

// The player taps Claim. SQL pays once only.
export async function missionClaim(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { data, error } = await db.rpc('quest_claim', { p_character: ch.id, p_quest: String(body.quest ?? '') });
  if (error) throw error;
  if (!data.ok) return json({ error: data.error }, 409);
  await applyEffects(db, ch.id, String(body.quest ?? ''), 'claim');
  return json(data);
}

// The player has looked at the Missions screen: the "new mission" dot goes out.
export async function missionsSeen(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { error } = await db.rpc('quest_seen', { p_character: ch.id });
  if (error) throw error;
  return json({ ok: true });
}
