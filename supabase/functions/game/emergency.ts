// @ts-nocheck
// ======================================================================
// "game" function: EMERGENCY DELIVERY (daily job, migrations 099 + 100). 2026-11-11.
// Accept (missions.ts calls emergencyAccept when the mission is 'emergency_delivery'):
//   - the ship must be docked; the destination is a RANDOM visible place with a market (not the place the ship is docked at);
//   - timer = flight time at `reference_g` (3 g) x `window_factor` (1), never below `min_minutes` REAL minutes;
//   - pay = distance (AU of that flight plan) x `pay_per_au` (100,000), never below `min_pay` (5,000), for the whole 20 CU package;
//   - then SQL emergency_start does everything in one go (the 20 CU package goes into the hold, the mission becomes 'active', due_at is set).
// The package is 20 CU, fixed in SQL (the 'units' value in game_state 'emergency' is not read).
// All money / goods work is in SQL; this file picks the place, works out the numbers and passes the answer on.
// emergencyCheck (after every freight settle) and emergencyTick (when the job list is read) record the outcome and offer the job again after the daily reset.
// ======================================================================
import { gameDaysAt, realMsAt } from './physics_bundle.ts';
import { json, getShip, resolveFor, planTrip } from './common.ts';

export const EMERGENCY_ID = 'emergency_delivery';
const UNITS = 20;
// Pilot numbers for planTrip, as in bot.ts: at 3 g (the free thrust) the flight never pulses.
const BOT_P = { bar: 100, max: 100, freeG: 3, refill: 20, perG: 50, share: 0.5 };

async function emergencySettings(db) {
  const { data, error } = await db.from('game_state').select('value').eq('key', 'emergency').maybeSingle();
  if (error) throw error;
  const v = (data && data.value) || {};
  const num = (x, d) => (x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x)) ? Number(x) : d);
  return { pay_per_au: num(v.pay_per_au, 100000), min_pay: num(v.min_pay, 5000), min_minutes: num(v.min_minutes, 5), window_factor: num(v.window_factor, 1), g: num(v.reference_g, 3) };
}

// The player taps Accept on the Emergency Delivery job.
export async function emergencyAccept(db, ch) {
  await resolveFor(db, ch.id);                                   // a trip that has just ended must show as docked
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'You have no ship.' }, 409);
  if (ship.state !== 'docked' || !ship.location_id) return json({ error: 'You must be docked to accept this job.' }, 409);
  const cfg = await emergencySettings(db);

  const [rl, rm] = await Promise.all([db.from('locations').select('*').eq('hidden', false), db.from('markets').select('location_id')]);
  if (rl.error) throw rl.error;
  if (rm.error) throw rm.error;
  const here = (rl.data ?? []).find((l) => l.id === ship.location_id);
  if (!here) return json({ error: 'This place cannot start a delivery.' }, 409);
  const withMarket = new Set((rm.data ?? []).map((m) => m.location_id));
  const cands = (rl.data ?? []).filter((l) => l.id !== here.id && withMarket.has(l.id));
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }   // shuffle

  const nowMs = Date.now(), nowT = gameDaysAt(nowMs);
  const P = { ...BOT_P, freeG: Math.max(BOT_P.freeG, cfg.g) };
  let pick = null;
  for (const l of cands.slice(0, 8)) {
    const tp = planTrip(here, l, nowT, cfg.g, P, {});
    if (tp && tp.ok && tp.days > 0 && tp.r) { pick = { l, tp }; break; }
  }
  if (!pick) return json({ error: 'No delivery route is open from here right now. Try again in a little while.' }, 409);

  const minDays = (gameDaysAt(nowMs + 60000) - gameDaysAt(nowMs)) * cfg.min_minutes;     // min_minutes REAL minutes in game days
  const windowDays = Math.max(pick.tp.days * cfg.window_factor, minDays);
  const dueAt = new Date(realMsAt(nowT + windowDays)).toISOString();
  const total = Math.max(cfg.min_pay, Math.round(Number(pick.tp.r.distanceAU) * cfg.pay_per_au));
  const price = Math.ceil((total / UNITS) * 100) / 100;                                   // credits per unit, 2 decimals

  const { data, error } = await db.rpc('emergency_start', { p_character: ch.id, p_dest: pick.l.id, p_price: price, p_window_days: windowDays, p_now_t: nowT, p_due_at: dueAt });
  if (error) throw error;
  if (!data || !data.ok) {
    const e = data && data.error;
    if (e === 'not_offered') return json({ error: 'not_offered' }, 409);
    if (e === 'not_docked') return json({ error: 'You must be docked to accept this job.' }, 409);
    if (e === 'not_enough_hold') return json({ error: 'You need ' + UNITS + ' CU of free hold for this shipment. You have ' + Math.floor(Number(data.hold_free) || 0) + ' CU free.' }, 409);
    if (e === 'freight_limit') return json({ error: 'Your ship cannot carry that much freight right now.' }, 409);
    console.error('emergency_start refused', data);
    return json({ error: 'The job could not be posted right now. Try again in a little while.' }, 409);
  }
  return json({ ok: true, status: 'active', dest: pick.l.id, dest_name: pick.l.name, due_at: dueAt, pay_total: data.pay_total, bonus_total: data.bonus_total });
}

// Records the outcome of the pilot's emergency run (SQL emergency_check). Best effort: never stops a freight action.
export async function emergencyCheck(db, characterId) {
  try {
    const { error } = await db.rpc('emergency_check', { p_character: characterId });
    if (error) console.error('emergency_check failed', error);
  } catch (e) { console.error('emergency_check failed', e); }
}

// Check, then offer the job again when a daily reset has passed since the pilot accepted it (SQL emergency_daily_tick). Best effort.
export async function emergencyTick(db, characterId) {
  await emergencyCheck(db, characterId);
  try {
    const { error } = await db.rpc('emergency_daily_tick', { p_character: characterId });
    if (error) console.error('emergency_daily_tick failed', error);
  } catch (e) { console.error('emergency_daily_tick failed', e); }
}

// Adds what the Jobs screen needs to the emergency mission in the list `quests`:
//   repeats (shows 'Completed n times / Failed n times'), emergency {dest, dest_name, pay_total, bonus_total, result, ended_at} (the pop-ups),
//   daily {next_at} (the time of the next reset, for the 'Next emergency call in' clock).
export async function emergencyInfo(db, characterId, quests) {
  const q = (quests || []).find((x) => x.id === EMERGENCY_ID);
  if (!q) return;
  q.repeats = true;
  const { data: row, error } = await db.from('character_quests').select('counters').eq('character_id', characterId).eq('quest_id', EMERGENCY_ID).maybeSingle();
  if (error) throw error;
  const c = (row && row.counters) || {};
  const offered = q.status === 'offered';                       // an offered job shows the LAST run's outcome (migration 100 keeps it)
  const dest = c.dest ?? (offered ? c.last_dest : null) ?? null;
  const result = c.result ?? (offered ? c.last_result : null) ?? null;
  const endedAt = Number(c.ended_at ?? (offered ? c.last_ended_at : null)) || null;
  if (dest || result) {
    let destName = dest;
    if (dest) { const { data: l } = await db.from('locations').select('name').eq('id', dest).maybeSingle(); if (l && l.name) destName = l.name; }
    q.emergency = { dest, dest_name: destName, pay_total: Number(c.pay_total) || 0, bonus_total: Number(c.bonus_total) || 0, result, ended_at: endedAt };
  }
  if (q.status === 'claimed' || q.status === 'failed') {
    const d = new Date();
    q.daily = { next_at: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString() };
  }
}
