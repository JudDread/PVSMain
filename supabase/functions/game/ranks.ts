// @ts-nocheck
// ======================================================================
// "game" function: the RANKS action (leaderboards). 2026-11-11, migrations 097 + 098.
// One call returns all six boards (level / XP, total damage, jobs, sales, net worth, distance): the top ten of each plus the asking pilot's own rank.
// The work is done by the SQL function leaderboard_view (players only, ties share a rank). This file only passes it through.
// Read only: nothing is changed. The browser asks once when the Ranks screen opens (no polling).
// ======================================================================
import { json, getCharacter } from './common.ts';

export async function ranksView(db, user) {
  const ch = await getCharacter(db, user);
  const { data, error } = await db.rpc('leaderboard_view', { p_character: ch ? ch.id : null, p_top: 10 });
  if (error) throw error;
  return json(data);
}
