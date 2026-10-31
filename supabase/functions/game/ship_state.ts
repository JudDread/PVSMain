// @ts-nocheck
// ship_state.ts - LASTING STATES (migration 076): a ship's shield, armor, hull and missile ammo between fights.
// Stored on the ship (ships.shield_v / armor_v / hull_v / ammo_v + cond_at); NULL cond_at = full. Nothing here runs on a timer:
// the current value is worked out when somebody reads it. Docked at a place with a HANGAR (077 location_services) = full. Elsewhere shield and armor
// regenerate at the fight rates (per REAL second, from combat.js); hull and ammo do not.
// The maximum and the rates come from the hull and the fitted rigs (the pilot's skills do not touch them yet; if a skill ever
// adds shield or armor, add its effect to skillFx below and in combat.ts skillEffects).
// Loaded lazily by index.ts (me) so a fault here can never stop the game.
import { DEFAULTS, resolveBase, newShip, statsOf } from './combat_bundle.ts';
import { can } from './services.ts';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

export async function loadCfg(db) {
  const { data, error } = await db.from('game_state').select('value').eq('key', 'combat').maybeSingle();
  if (error) throw error;
  return { ...DEFAULTS, ...((data && data.value) || {}) };
}

/* the hull fraction needed to enter a zone with a retreat rule (game_state 'combat' -> entry_hull_frac, default 0.3) */
export const entryHullFrac = (cfg) => { const f = Number(cfg && cfg.entry_hull_frac); return Number.isFinite(f) && f >= 0 && f < 1 ? f : 0.3; };

/* the maximum numbers of a ship (from its hull and fitted rigs) */
export async function shipMaxes(db, ship, cfg) {
  const { data: hull, error: he } = await db.from('hulls').select('*').eq('id', ship.hull_id).maybeSingle();
  if (he) throw he;
  if (!hull) throw new Error('unknown hull ' + ship.hull_id);
  const { data: fr, error: fe } = await db.from('ship_rigs').select('rig_id,fitted_at').eq('ship_id', ship.id).order('fitted_at');
  if (fe) throw fe;
  const ids = (fr ?? []).map((r) => r.rig_id);
  let rigs = [];
  if (ids.length) {
    const { data: rr, error: re } = await db.from('rigs').select('*').in('id', [...new Set(ids)]);
    if (re) throw re;
    const byId = new Map((rr ?? []).map((r) => [r.id, r]));
    rigs = ids.map((id) => byId.get(id)).filter(Boolean);
  }
  const base = resolveBase({ hull, rigs, skillFx: [], pilot: {} });
  const st = statsOf(newShip({ id: 'x', base, cfg }), cfg);
  const isWeapon = (r) => r.kind === 'weapon';
  return { name: hull.name, weapons: rigs.filter(isWeapon).map((r) => r.name), rigs: rigs.filter((r) => !isWeapon(r)).map((r) => r.name), shield_max: st.shield_max, armor_max: st.armor_max, hull_max: st.hull_max, shield_regen: st.shield_regen, armor_repair: st.armor_repair, ammo_max: num(base.ammo) };
}

/* the STORED numbers of a ship brought up to nowMs (pure: no database). A ship with nothing stored is full. */
export function applyStored(ship, mx, nowMs) {
  const full = { shield: mx.shield_max, armor: mx.armor_max, hull: mx.hull_max, ammo: mx.ammo_max };
  if (!ship || ship.cond_at == null) return full;
  const dt = Math.max(0, (nowMs - Date.parse(ship.cond_at)) / 1000);
  const cap = (v, m) => (v == null ? m : Math.max(0, Math.min(m, num(v, m))));      // a stored value is never above today's maximum
  return {
    shield: Math.min(mx.shield_max, cap(ship.shield_v, mx.shield_max) + mx.shield_regen * dt),
    armor: Math.min(mx.armor_max, cap(ship.armor_v, mx.armor_max) + mx.armor_repair * dt),
    hull: cap(ship.hull_v, mx.hull_max),
    ammo: cap(ship.ammo_v, mx.ammo_max),
  };
}

/* write the numbers of a ship that has just left a fight (s = the fight ship: shield, armor, hull, ammo) */
export async function storeCondition(db, shipId, s, whenMs) {
  if (!shipId) return;
  const z = (v) => Math.max(0, num(v));
  const { error } = await db.from('ships').update({
    shield_v: z(s.shield), armor_v: z(s.armor), hull_v: z(s.hull), ammo_v: z(s.ammo), cond_at: new Date(whenMs).toISOString(),
  }).eq('id', shipId);
  if (error) console.error('storeCondition failed', error);
}

/* what the Fly screen chip shows (index.ts me, for the flown ship). Never throws a number it cannot back up. */
export async function shipCondition(db, ship, nowMs) {
  const cfg = await loadCfg(db);
  const mx = await shipMaxes(db, ship, cfg);
  let cur, fight = false, hangar = false;
  const { data: fr, error: fe } = await db.from('combat_ships').select('shield,armor,hull,ammo').eq('ship_id', ship.id).maybeSingle();
  if (fe) throw fe;
  if (fr) {                                                            // in a fight: the fight's own numbers (the last snapshot)
    fight = true;
    cur = { shield: num(fr.shield), armor: num(fr.armor), hull: num(fr.hull), ammo: num(fr.ammo) };
  } else if (ship.state === 'docked' && ship.location_id && await can(db, ship.location_id, 'hangar')) {
    hangar = true;                                                     // a hangar repairs and rearms the ship fully
    cur = { shield: mx.shield_max, armor: mx.armor_max, hull: mx.hull_max, ammo: mx.ammo_max };
    if (ship.cond_at != null) {
      const { error: ce } = await db.from('ships').update({ shield_v: null, armor_v: null, hull_v: null, ammo_v: null, cond_at: null }).eq('id', ship.id);
      if (ce) console.error('clear condition failed', ce);
    }
  } else {
    cur = applyStored(ship, mx, nowMs);
  }
  const live = !fight && !hangar && ship.cond_at != null;               // numbers that are still regenerating
  return {
    name: mx.name, weapons: mx.weapons, rigs: mx.rigs, at: nowMs, fight, hangar,
    sh: r1(cur.shield), shm: r1(mx.shield_max), shr: live ? r2(mx.shield_regen) : 0,
    ar: r1(cur.armor), arm: r1(mx.armor_max), arr: live ? r2(mx.armor_repair) : 0,
    hu: r1(cur.hull), hum: r1(mx.hull_max),
    am: Math.round(cur.ammo), amm: Math.round(mx.ammo_max),
  };
}
