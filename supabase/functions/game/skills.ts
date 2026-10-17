// @ts-nocheck
// ======================================================================
// Skills (migration 046). The maths lives in SQL: skill_buy, cal_status, skill_effect.
// This file only checks who is asking, calls SQL and passes the answer on.
// Actions: 'skills' (the whole list + my Grades + my Cal), 'skill_buy' {skill} (buy ONE Grade).
// ======================================================================
import { json, getCharacter, resolveFor } from './common.ts';

const SKILL_RE = /^[a-z0-9_]{1,40}$/;

// Everything the Skills screen needs, in one answer.
async function skillsPayload(db, characterId) {
  const [skills, mine, cal, mx] = await Promise.all([
    db.from('skills').select('*').order('sort_order'),
    db.from('character_skills').select('skill_id,grade').eq('character_id', characterId),
    db.rpc('cal_status', { p_character: characterId }),
    db.rpc('skill_setting', { p_key: 'max_grade', p_default: 10 }),
  ]);
  if (skills.error) throw skills.error;
  if (mine.error) throw mine.error;
  if (cal.error) throw cal.error;
  if (mx.error) throw mx.error;
  const maxGrade = Number(mx.data) || 10;
  const grades = {};
  for (const r of mine.data ?? []) grades[r.skill_id] = r.grade;
  const available = Number(cal.data?.available ?? 0);
  const list = (skills.data ?? []).map(s => {
    const grade = grades[s.id] ?? 0;
    const nextCost = grade < maxGrade ? grade + 1 : null; // Grade N costs N Cal
    return {
      id: s.id, group_id: s.group_id, group_name: s.group_name, group_sort: s.group_sort, name: s.name,
      effect: s.effect, per_grade: Number(s.per_grade), active: s.active, locked_note: s.locked_note,
      grade, next_cost: nextCost, can_buy: !!s.active && nextCost != null && available >= nextCost,
    };
  });
  return { ok: true, max_grade: maxGrade, cal: cal.data, skills: list };
}

export async function skillsView(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  await db.rpc('xp_settle', { p_character: ch.id }); // pay XP for trips that just finished, so the level is current
  return json(await skillsPayload(db, ch.id));
}

export async function skillBuy(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const skill = String(body.skill ?? '');
  if (!SKILL_RE.test(skill)) return json({ error: 'bad_request' }, 400);
  await resolveFor(db, ch.id);
  await db.rpc('xp_settle', { p_character: ch.id });
  const { data, error } = await db.rpc('skill_buy', { p_character: ch.id, p_skill: skill });
  if (error) throw error;
  if (!data?.ok) return json(data, 409); // unknown_skill, not_active, max_grade, not_enough_cal (need, have)
  return json({ ...data, ...(await skillsPayload(db, ch.id)) });
}
