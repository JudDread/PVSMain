// @ts-nocheck
// ======================================================================
// Missions: the server side of the Missions screen (migrations 048, 050).
// All rules live in SQL (quest_sync / quest_list / quest_step / quest_accept / quest_claim / quest_seen);
// this file only checks who is asking and passes the request on.
// ======================================================================
import { json, getCharacter } from './common.ts';
import { repSettle, repInfo } from './reputation.ts';                                    // 2026-11-11: standing rewards of missions (migration 101)
import { EMERGENCY_ID, emergencyAccept, emergencyTick, emergencyInfo } from './emergency.ts';   // 2026-11-11: the daily Emergency Delivery job (migrations 099 + 100)

// 059: a mission can show or hide places (quests.effects, SQL quest_effects_apply). The accept / claim has already succeeded, so try twice.
async function applyEffects(db, characterId, quest, event) {
  for (let k = 0; k < 2; k++) {
    const { error } = await db.rpc('quest_effects_apply', { p_character: characterId, p_quest: quest, p_event: event });
    if (!error) return;
    console.error('quest effects failed', error);
  }
  throw new Error('quest_effects_failed');
}

// Missions that refuse to start unless the flown ship has a weapon fitted (a rig of kind 'weapon' in a weapon slot).
// To give another mission the same check, add its id here.
const NEEDS_WEAPON = ['esc_1', 'esc_2'];

// true when the pilot's active ship has at least one fitted rig whose kind is 'weapon'.
async function hasWeaponFitted(db, characterId) {
  const { data: c, error: e1 } = await db.from('characters').select('active_ship_id').eq('id', characterId).maybeSingle();
  if (e1) throw e1;
  if (!c || !c.active_ship_id) return false;
  const { data: fitted, error: e2 } = await db.from('ship_rigs').select('rig_id').eq('ship_id', c.active_ship_id);
  if (e2) throw e2;
  const ids = (fitted || []).map((r) => r.rig_id);
  if (ids.length === 0) return false;
  const { data: weapons, error: e3 } = await db.from('rigs').select('id').in('id', ids).eq('kind', 'weapon');
  if (e3) throw e3;
  return (weapons || []).length > 0;
}

// Everything the Missions screen needs (also starts any mission that is due).
// chains = the open cards, quests = the pilot's missions (each has its chain), ready = rewards waiting, new = missions not looked at yet.
export async function missionsView(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  // 058: post the pilot's private tutorial freight job when its turn has come (does nothing otherwise; a failure never blocks the list)
  try { await db.rpc('tutorial_freight_post', { p_character: ch.id }); } catch (e) { /* ignore */ }
  // 090 + 086: a new wave moves its place and hides it at the end of the window; a repeatable mission whose wait is over is offered again (best effort)
  try { await db.rpc('quest_wave_tick'); } catch (e) { /* ignore */ }
  try { await db.rpc('quest_repeat', { p_character: ch.id }); } catch (e) { /* ignore */ }
  await repSettle(db, ch.id);                      // 101: standing for finished / failed missions (best effort)
  await emergencyTick(db, ch.id);                  // 099: record the outcome of an emergency run, offer the daily job again after the reset (best effort)
  const { data, error } = await db.rpc('quest_list', { p_character: ch.id });
  if (error) throw error;
  // 075: a step 'damage:<zone>:<amount>' shows how much of the amount is done
  try {
    const { data: cqs } = await db.from('character_quests').select('quest_id,counters,claims,fails').eq('character_id', ch.id);
    const counters = new Map((cqs ?? []).map((r) => [r.quest_id, r.counters || {}]));
    const times = new Map((cqs ?? []).map((r) => [r.quest_id, r]));
    for (const q of data.quests ?? []) {
      const tm = times.get(q.id);                                    // 086: how many times the mission was claimed / failed
      q.claims = tm ? Number(tm.claims) || 0 : 0;
      q.fails = tm ? Number(tm.fails) || 0 : 0;
      const c = counters.get(q.id);
      for (const s of q.steps ?? []) {
        if (typeof s.id !== 'string' || !s.id.startsWith('damage:') || s.done) continue;
        const need = Number(s.id.split(':')[2]);
        if (!(need > 0)) continue;
        const got = Math.min(need, Math.floor(Number((c && c[s.id]) || 0)));
        s.label = s.label + ' (' + got.toLocaleString('en-US') + ' / ' + need.toLocaleString('en-US') + ')';
      }
    }
  } catch (e) { /* the counters are only a display: the list never fails because of them */ }
  // 090: repeatable and wave missions: the page shows their history, and for a wave the clock (open now, or when the next wave starts)
  try {
    const { data: rq } = await db.from('quests').select('id,wave_period_s').or('repeat_after_s.not.is.null,wave_period_s.not.is.null');
    const rinfo = new Map();
    for (const x of rq ?? []) {
      let wave = null;
      if (x.wave_period_s != null) {
        const w = await waveOf(db, x.id);
        if (w) wave = { open: !!w.is_open, ends_at: w.open_until, next_at: w.next_start };
      }
      rinfo.set(x.id, wave);
    }
    for (const q of data.quests ?? []) if (rinfo.has(q.id)) { q.repeats = true; q.wave = rinfo.get(q.id); }
  } catch (e) { console.error('wave info failed', e); }
  // 099: the emergency job: destination, outcome (for the pop-ups), counters and the next call
  try { await emergencyInfo(db, ch.id, data.quests ?? []); } catch (e) { console.error('emergency info failed', e); }
  try { await repInfo(db, data.quests ?? []); } catch (e) { console.error('rep info failed', e); }   // 101: which jobs change which standing
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
// 090: 1450000 ms -> '24:10', 3725000 ms -> '1:02:05'
function clockText(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
}
async function waveOf(db, quest) {                                // the wave clock of a mission (null = not a wave mission)
  const { data: qw } = await db.from('quests').select('wave_period_s').eq('id', quest).maybeSingle();
  if (!qw || qw.wave_period_s == null) return null;
  const { data: wi, error } = await db.rpc('quest_wave_info', { p_quest: quest });
  if (error) throw error;
  return Array.isArray(wi) ? (wi[0] || null) : wi;
}

export async function missionAccept(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  if (String(body.quest ?? '') === EMERGENCY_ID) return await emergencyAccept(db, ch);   // 099: picks the place and the timer, puts the package in the hold
  if (NEEDS_WEAPON.includes(String(body.quest ?? '')) && !(await hasWeaponFitted(db, ch.id))) {
    return json({ error: 'This mission needs a weapon. Fit one in a weapon slot on the Rigging screen, then come back.' }, 409);   // the page's red bar shows the 'error' text, so the sentence goes there
  }
  // 090: a wave mission can only be accepted while its wave is open; the timer is then the end of the wave
  const wave = await waveOf(db, String(body.quest ?? ''));
  if (wave && !wave.is_open) return json({ error: 'Not available. Next wave in ' + clockText(Date.parse(wave.next_start) - Date.now()) }, 409);
  const { data, error } = await db.rpc('quest_accept', { p_character: ch.id, p_quest: String(body.quest ?? '') });
  if (error) throw error;
  if (!data.ok) return json({ error: data.error }, 409);
  if (wave) {
    const { error: due } = await db.from('character_quests').update({ due_at: wave.open_until }).eq('character_id', ch.id).eq('quest_id', String(body.quest ?? '')).eq('status', 'active');
    if (due) console.error('wave end not saved as the timer', due);
  }
  await applyEffects(db, ch.id, String(body.quest ?? ''), 'accept');
  // 086: some missions move their place to a new random angle at every accept (quests.randomize_place), so each run looks like a different ship
  try {
    const { data: qd } = await db.from('quests').select('randomize_place,wave_period_s').eq('id', String(body.quest ?? '')).maybeSingle();
    if (qd && qd.randomize_place && qd.wave_period_s == null) {                  // 090: a wave mission moves its place when the wave starts, not at every accept
      const angle = Math.round(Math.random() * 3600) / 10;
      const { error: le } = await db.from('locations').update({ angle_deg: angle }).eq('id', qd.randomize_place);
      if (le) console.error('randomize_place failed', le);
    }
  } catch (e) { console.error('randomize_place failed', e); }
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
  const rep = await repSettle(db, ch.id);          // 101: the standing this claim changed, e.g. [{name:'Earth', applied:1}]
  return json({ ...data, rep });
}

// The player has looked at the Missions screen: the "new mission" dot goes out.
export async function missionsSeen(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const { error } = await db.rpc('quest_seen', { p_character: ch.id });
  if (error) throw error;
  return json({ ok: true });
}
