// @ts-nocheck
// ======================================================================
// "game" function: REPUTATION helpers (migration 101). 2026-11-11.
// Standings live in character_reputations (a missing row = 0), changed only by SQL reputation_add, logged in reputation_log. No cap, can be negative.
// 'market' is NOT here (it stays characters.market_rep).
//   repSettle(db, characterId)  applies the standing rewards of missions (rep_reward) for claims / fails not yet counted; returns [{rep, name, applied, quest}]. Best effort.
//   repInfo(db, quests)         adds q.rep_reward = [{id, name, claim, fail, cap}] to the missions in the list that carry a standing reward (for the job cards).
//   repValues(db, characterId)  { faction id: value } for the Profile screen.
// ======================================================================
export async function repSettle(db, characterId) {
  try {
    const { data, error } = await db.rpc('quest_rep_settle', { p_character: characterId });
    if (error) { console.error('quest_rep_settle failed', error); return []; }
    return Array.isArray(data) ? data : [];
  } catch (e) { console.error('quest_rep_settle failed', e); return []; }
}

export async function repInfo(db, quests) {
  const { data: qs, error } = await db.from('quests').select('id,rep_reward').not('rep_reward', 'is', null);
  if (error) throw error;
  if (!qs || !qs.length) return;
  const { data: reps, error: re } = await db.from('reputations').select('id,name');
  if (re) throw re;
  const name = {}; for (const r of reps ?? []) name[r.id] = r.name;
  const byQuest = {}; for (const q of qs) byQuest[q.id] = q.rep_reward;
  for (const q of quests ?? []) {
    const rr = byQuest[q.id];
    if (!rr) continue;
    q.rep_reward = Object.keys(rr)
      .map((id) => ({ id, name: name[id] || id, claim: Number(rr[id].claim) || 0, fail: Number(rr[id].fail) || 0, cap: Number(rr[id].cap) || 0 }))
      .filter((x) => x.claim || x.fail);
  }
}

export async function repValues(db, characterId) {
  const { data, error } = await db.from('character_reputations').select('reputation_id,value').eq('character_id', characterId);
  if (error) throw error;
  const o = {}; for (const r of data ?? []) o[r.reputation_id] = Number(r.value);
  return o;
}
