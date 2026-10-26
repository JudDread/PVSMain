// @ts-nocheck
// ======================================================================
// AUTO-BUNDLED COPY of shared/combat.js (pure functions, nothing removed).
// REBUILD AND REDEPLOY this file whenever shared/combat.js changes.
// Do not edit by hand. combat.ts imports from here.
// ======================================================================

// =====================================================================
// Vacuum State - combat core (COMBAT MVP steps 3-4)
// PURE FUNCTIONS ONLY (same rule as physics.js):
//   - no DOM, no Date.now(), no random numbers, no global state
//   - everything is passed in and returned; the SAME file runs in the
//     browser, on the server and on the test page
//   - DETERMINISTIC: the same input always gives the same fight
//
// UNITS
//   distance  = km          speed = km/s (per GAME second)
//   accel     = km/s^2      (1 g = G_KMS2)
//   rates in the sheet (reuse, heat, regen, endurance) are per REAL second
//   scale     = game seconds per real second (the ONE game clock: 60 = 1x)
//     so a 5-real-second step moves a ship for 5 x scale game seconds.
//   accuracy  = POINTS (0..100) while adding; a hit chance is 0..1 at the end
//
// FLOW
//   resolveBase()  -> `base`: hull + fitted rigs + skills, worked out ONCE
//                     when a ship enters a zone (stored as combat_ships.stats)
//   newShip()      -> a fight state (the combat_ships row, as an object)
//   advance()      -> works the fight forward in 5-real-second steps
//   activeStats()  -> the numbers right now (modules switched on or off,
//                     heat shutdown) - cheap, called every step
// =====================================================================

export const G_KMS2 = 9.80665 / 1000;             // km/s^2 per g
export const CLASS_RANK = { Pod: 0, Light: 1, Medium: 2, Heavy: 3, Super: 4 };
export const ORDER_KINDS = ['attack_max', 'attack_opt', 'follow', 'stop', 'flee', 'heading'];
export const STANCES = ['free', 'economy', 'full'];

// Effect keys that always apply (they are not switched with a module).
const PASSIVE_KEYS = new Set(['power_output', 'hold_cu', 'missile_ammo']);

// All numbers here are the START values. They live as DATA in
// game_state key 'combat' (migration 066); the server merges that row over these.
export const DEFAULTS = {
  step_s: 5,               // one fight step, REAL seconds
  catchup_max_s: 600,      // most fight time worked forward in one wake-up
  heat_cap_per_power: 45,  // heat capacity = power x this
  heat_cool_per_power: 0.65, // passive cooling per second = power x this
  heat_eff_start: 0.8,     // effectiveness starts falling at this share of capacity
  heat_eff_end: 0.99,      // ... and reaches the floor here
  heat_eff_floor: 0.6,     // (sheet: 0.5)
  shutdown_s: 15,          // modules offline at least this long (sheet: 30)
  resume_frac: 0.6,        // ... and until heat is below this share (sheet: 0.4)
  shutdown_g: 3,           // thrust cap while shut down
  heat_thrust_g: 3,        // thrust above this adds heat
  heat_g_per_power: 0.15,  // heat per second per G over, x hull power
  reserve_frac: 0.3,       // ECONOMY keeps this share of the bar when closing / chasing
  recover_frac: 0.25,      // an emptied bar must refill to this share before big thrust again
  econ_heat_line: 0.8,     // ECONOMY stops big thrust at this share of heat capacity
  class_step_pts: 20,      // accuracy points lost per class step (shooter bigger than target)
  laser_mob_mult: 0.5,     // lasers take this share of the target's mobility penalty
  hold_factor: 0.98,       // 'attack at MAX range' holds this share of the max range
  follow_km: 50000,        // distance kept by the FOLLOW order
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sumFx = (list, key) => {
  let s = 0;
  for (const fx of list) { const v = fx && fx[key]; if (typeof v === 'number') s += v; }
  return s;
};
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

// ---------------------------------------------------------------------
// WEAPON FAMILY: rigs.family ('laser','railgun','plasma','missile').
// The id fallback keeps old rows working if the column is empty.
// ---------------------------------------------------------------------
export function weaponFamily(rig) {
  if (rig.family) return rig.family;
  const id = rig.id || '';
  if (id.includes('railgun')) return 'railgun';
  if (id.includes('laser')) return 'laser';
  if (id.includes('plasma')) return 'plasma';
  if (id.includes('missile')) return 'missile';
  return 'other';
}

// ---------------------------------------------------------------------
// STAT RESOLVER, part 1: build `base` (JSON, stored on the combat row).
//   hull    = a hulls row (+ optional effects jsonb)
//   rigs    = the FITTED rigs rows (weapon columns + effects + heat_per_sec), in fitted order
//   skillFx = list of effect objects from the pilot's skills, same key format as rigs.effects
//   pilot   = {free_g, endurance_max, refill_flight_hour, ref_g, burn_hours_ref, burn_keep}
//             (the server works these out per pilot: free_g_of, refill_flight_of, ...)
// Unknown effect keys are simply ignored, so a new rig or skill is only a data row.
// ---------------------------------------------------------------------
export function resolveBase({ hull, rigs = [], skillFx = [], pilot = {} }) {
  const always = [hull.effects || {}, ...skillFx];
  const modules = [];
  let launcherAmmo = 0, hasLauncher = false;

  for (const r of rigs) {
    const fx = r.effects || {};
    const passive = {}, switched = {};
    for (const k of Object.keys(fx)) {
      if (PASSIVE_KEYS.has(k)) passive[k] = fx[k]; else switched[k] = fx[k];
    }
    if (Object.keys(passive).length) always.push(passive);
    const isWeapon = r.kind === 'weapon';
    const heat = Number(r.heat_per_sec) || 0;
    // a rig with no combat effect and no heat is not a module (no chip)
    if (!isWeapon && Object.keys(switched).length === 0 && heat <= 0) continue;
    const m = { id: r.id, name: r.name, kind: r.kind, heat, fx: switched };
    if (isWeapon) {
      m.family = weaponFamily(r);
      m.w = {
        damage: Number(r.damage) || 0,
        reuse: Number(r.reuse_sec) || 1,
        optR: Number(r.optimal_range_km) || 0,
        maxR: Number(r.max_range_km) || 0,
        optAcc: Number(r.optimal_accuracy) || 0,
        maxAcc: Number(r.max_accuracy) || 0,
      };
      if (m.family === 'missile') { hasLauncher = true; launcherAmmo += Number(r.ammo) || 0; }
    }
    modules.push(m);
  }

  const P = {
    free_g: Number(pilot.free_g ?? 3),
    endurance_max: Number(pilot.endurance_max ?? 100),
    refill_flight_hour: Number(pilot.refill_flight_hour ?? 20),
    ref_g: Number(pilot.ref_g ?? 4),
    burn_hours_ref: Number(pilot.burn_hours_ref ?? 1.5),
    burn_keep: Number(pilot.burn_keep ?? 1),
  };
  return {
    hull: {
      id: hull.id, class: hull.class,
      shields: Number(hull.shields) || 0, armor: Number(hull.armor) || 0,
      hull_points: Number(hull.hull_points) || 0, mobility: Number(hull.mobility) || 0,
      max_g: Number(hull.max_g) || 0, power: Number(hull.power) || 0,
    },
    always,
    modules,
    power: (Number(hull.power) || 0) + sumFx(always, 'power_output'),
    ammo: hasLauncher ? launcherAmmo + sumFx(always, 'missile_ammo') : 0,
    pilot: P,
  };
}

// ---------------------------------------------------------------------
// STAT RESOLVER, part 2: the numbers NOW.
//   (base + flat bonuses) x (1 + all percent bonuses ADDED)
//   on      = array of 0/1 per module (null = all on)
//   offline = heat shutdown: every module off (hull and passive effects stay)
// ---------------------------------------------------------------------
export function activeStats(base, on = null, offline = false, cfg = DEFAULTS) {
  const fxs = base.always.slice();
  const act = [];
  base.modules.forEach((m, i) => {
    if (!offline && (on == null || on[i] !== 0)) { act.push(m); fxs.push(m.fx); }
  });
  const S = (k) => sumFx(fxs, k);
  const H = base.hull, P = base.pilot;

  const weapons = [];
  let rigHeat = 0;
  for (const m of act) {
    if (m.kind !== 'weapon') { rigHeat += m.heat; continue; }
    const f = m.family;
    weapons.push({
      id: m.id, fam: f, heat: m.heat,
      damage: m.w.damage * (1 + (S('damage_pct') + S(f + '_damage_pct')) / 100),
      reuse: Math.max(1, m.w.reuse - (f === 'missile' ? S('missile_cooldown_s') : 0)),
      optR: m.w.optR * (1 + (S('range_pct') + S(f + '_range_pct')) / 100),
      maxR: m.w.maxR * (1 + (S('range_pct') + S(f + '_range_pct')) / 100),
      optAcc: m.w.optAcc, maxAcc: m.w.maxAcc,
      accPts: S('accuracy_pts') + S(f + '_accuracy_pct'),
    });
  }
  return {
    shield_max: Math.max(0, (H.shields + S('shield_add')) * (1 + S('shield_pct') / 100)),
    armor_max: Math.max(0, (H.armor + S('armor_add')) * (1 + S('armor_pct') / 100)),
    hull_max: Math.max(0, (H.hull_points + S('hull_add')) * (1 + S('hull_pct') / 100)),
    shield_regen: S('shield_regen_per_s'),
    armor_repair: S('armor_repair_per_s'),
    pd: clamp(S('pd_chance_pct'), 0, 100),
    mobility: Math.max(0, H.mobility + S('maneuver_pct') / 100 + S('mobility_add')),
    max_g: (H.max_g + S('thrust_g')) * (1 + S('max_g_pct') / 100),   // NO thrust cap (developer, 2026-10-24)
    free_g: P.free_g + S('free_g_add'),
    use_mult: Math.max(0, 1 + S('endurance_use_pct') / 100),
    rec_mult: Math.max(0, 1 + S('endurance_recovery_pct') / 100),
    power: base.power,
    heatCap: base.power * cfg.heat_cap_per_power,
    cooling: base.power * cfg.heat_cool_per_power,
    rigHeat,
    weapons,
  };
}

export const statsOf = (ship, cfg = DEFAULTS) => activeStats(ship.base, ship.on, ship.tripped, cfg);

// ---------------------------------------------------------------------
// ACCURACY (always ADDITIVE, in points)
// ---------------------------------------------------------------------
// A straight line from optimal accuracy at the optimal range to max accuracy
// at the max range; flat inside the optimal range; nothing beyond the max.
export function rangeAccuracy(w, rangeKm) {
  if (rangeKm > w.maxR) return 0;
  if (rangeKm <= w.optR || w.maxR <= w.optR) return w.optAcc;
  return w.optAcc + (w.maxAcc - w.optAcc) * (rangeKm - w.optR) / (w.maxR - w.optR);
}

// hit chance 0..1 = range accuracy + shooter bonuses - target mobility
//   (lasers take half) - class steps x 20, clamped only at the end.
export function hitChance(w, rangeKm, targetMobility, classSteps, cfg = DEFAULTS) {
  if (rangeKm > w.maxR) return 0;
  let pts = rangeAccuracy(w, rangeKm) * 100 + w.accPts;
  pts -= targetMobility * 100 * (w.fam === 'laser' ? cfg.laser_mob_mult : 1);
  pts -= cfg.class_step_pts * classSteps;
  return clamp(pts, 0, 100) / 100;
}

export const classSteps = (shooter, target) =>
  Math.max(0, (CLASS_RANK[shooter.base.hull.class] || 0) - (CLASS_RANK[target.base.hull.class] || 0));

// ---------------------------------------------------------------------
// HEAT
// ---------------------------------------------------------------------
// 1 up to 80% of capacity, falling in a straight line to the floor at 99%.
export function heatEffectiveness(heat, cap, cfg = DEFAULTS) {
  if (cap <= 0) return 1;
  const f = heat / cap;
  if (f <= cfg.heat_eff_start) return 1;
  if (f >= cfg.heat_eff_end) return cfg.heat_eff_floor;
  return 1 - (1 - cfg.heat_eff_floor) * (f - cfg.heat_eff_start) / (cfg.heat_eff_end - cfg.heat_eff_start);
}

// ---------------------------------------------------------------------
// DAMAGE PER SECOND: damage / reuse x accuracy x heat effectiveness
// (missiles lose the target's point-defence chance)
// ---------------------------------------------------------------------
export function weaponDps(w, acc, eff, pdPct = 0) {
  const pd = w.fam === 'missile' ? 1 - pdPct / 100 : 1;
  return (w.damage / w.reuse) * acc * eff * pd;
}

// What the screens show: DPS of a shooter against a target at a range
// (ignores ammo; a shut-down ship does 0). Never 'kills in X seconds'.
export function dpsAt(shooter, target, rangeKm, cfg = DEFAULTS) {
  if (shooter.tripped) return { total: 0, list: [] };
  const ss = statsOf(shooter, cfg), ts = statsOf(target, cfg);
  const eff = heatEffectiveness(shooter.heat, ss.heatCap, cfg);
  const steps = classSteps(shooter, target);
  const list = ss.weapons.map((w) => {
    const acc = hitChance(w, rangeKm, ts.mobility, steps, cfg);
    return { id: w.id, acc, dps: weaponDps(w, acc, eff, ts.pd) };
  });
  return { total: list.reduce((a, b) => a + b.dps, 0), list };
}

// Healing per second (shield regen + armor repair) of a ship now.
export function hpsOf(ship, cfg = DEFAULTS) {
  const s = statsOf(ship, cfg);
  return s.shield_regen + s.armor_repair;
}

// ---------------------------------------------------------------------
// ENDURANCE (the same bar as the map). Bar units per REAL second.
// Same maths as endurance_drain_hour in SQL, converted with the clock scale.
// ---------------------------------------------------------------------
export function drainPerRealSec(g, maxBar, pilot, useMult, scale) {
  const perGameHour = maxBar / (pilot.burn_hours_ref * Math.pow(pilot.burn_keep, g - pilot.ref_g));
  return perGameHour * scale / 3600 * useMult;
}

// ---------------------------------------------------------------------
// A FIGHT STATE (one per combat_ships row)
// ---------------------------------------------------------------------
export function newShip({ id, side = 'players', base, x = 0, y = 0, vx = 0, vy = 0,
  endurance, stance = 'economy', on = null, targetId = null, order = { kind: 'stop' }, cfg = DEFAULTS }) {
  const onArr = on || base.modules.map(() => 1);
  const st = activeStats(base, onArr, false, cfg);
  return {
    id, side, base, on: onArr, x, y, vx, vy,
    shield: st.shield_max, armor: st.armor_max, hull: st.hull_max,
    heat: 0, tripped: false, shutdown_left: 0,
    ammo: base.ammo,
    endurance: endurance ?? base.pilot.endurance_max, drained: false,
    stance, targetId, order, alive: true, left: false,
  };
}

function nearestHostile(s, ships) {
  let best = null, bd = Infinity;
  for (const o of ships) {
    if (o.id === s.id || o.side === s.side) continue;
    const d = dist(s, o);
    if (d < bd || (d === bd && best && o.id < best.id)) { bd = d; best = o; }
  }
  return best;
}

// distance the ship wants to hold, from its ORDER and the weapons that are on
function holdRange(kind, ss, cfg, override) {
  // step 4: the pilot may set his own station-keeping distance on an order (order.hold_km); it replaces the worked-out one
  if (override > 0 && kind !== 'stop') return override;
  if (kind === 'follow' || ss.weapons.length === 0) return cfg.follow_km;
  let wsum = 0, rsum = 0;
  for (const w of ss.weapons) {
    const wt = w.damage / w.reuse;
    wsum += wt;
    rsum += wt * (kind === 'attack_max' ? w.maxR * cfg.hold_factor : w.optR);
  }
  return wsum > 0 ? rsum / wsum : cfg.follow_km;
}

// STATION KEEPING / CLOSING / STOP / FLEE: what change of velocity is wanted
// this step, as {dx, dy, gCmd, closing}. dir (dx, dy) is a unit vector.
function guide(s, tgt, ss, cfg, dtG) {
  const kind = (s.order && s.order.kind) || 'stop';
  if (kind === 'flee') {
    let n = Math.hypot(s.x, s.y), ex = 1, ey = 0;
    if (n > 1) { ex = s.x / n; ey = s.y / n; }
    else if (tgt) { const d = dist(s, tgt) || 1; ex = (s.x - tgt.x) / d; ey = (s.y - tgt.y) / d; }
    return { dx: ex, dy: ey, gCmd: ss.max_g, closing: false };
  }
  if (kind === 'heading') {            // step 4: thrust on a compass heading (order.dir_deg), no braking, until another order replaces it
    const ang = ((s.order && s.order.dir_deg) || 0) * Math.PI / 180;
    return { dx: Math.cos(ang), dy: Math.sin(ang), gCmd: ss.max_g, closing: true };
  }
  let ux = 0, uy = 0, closing = false;
  if (kind !== 'stop' && tgt) {
    const rx = tgt.x - s.x, ry = tgt.y - s.y;
    const d0 = Math.hypot(rx, ry) || 1;
    const ex = rx / d0, ey = ry / d0;
    const R = holdRange(kind, ss, cfg, s.order && s.order.hold_km);
    const d = d0 - R;
    const tol = Math.max(1000, 0.01 * R);
    closing = d > tol;
    const aPlan = Math.max(1e-9, ss.max_g * G_KMS2);
    const w = Math.sign(d) * Math.min(Math.sqrt(aPlan * Math.abs(d)), Math.abs(d) / dtG);
    ux = tgt.vx + w * ex; uy = tgt.vy + w * ey;
  }
  const dvx = ux - s.vx, dvy = uy - s.vy;
  const mag = Math.hypot(dvx, dvy);
  if (mag < 1e-12) return { dx: 0, dy: 0, gCmd: 0, closing };
  return { dx: dvx / mag, dy: dvy / mag, gCmd: (mag / dtG) / G_KMS2, closing };
}

// THRUST vs ENDURANCE vs HEAT for one step. Returns the average g actually
// used, the new bar, the heat added by thrust, and whether the bar emptied.
function thrustBudget(s, ss, gCmd, closing, dtReal, scale, cfg) {
  const P = s.base.pilot, free = ss.free_g, maxBar = P.endurance_max;
  let cap = ss.max_g;
  if (s.tripped) cap = Math.min(cap, cfg.shutdown_g);
  if (s.drained) cap = Math.min(cap, free);
  if (s.stance === 'free') cap = Math.min(cap, free);
  if (s.stance === 'economy' && s.heat >= cfg.econ_heat_line * ss.heatCap) cap = Math.min(cap, free);
  const g = Math.max(0, Math.min(gCmd, cap));
  const refill = P.refill_flight_hour * ss.rec_mult * scale / 3600;
  const thr = Math.max(cfg.heat_thrust_g, free);
  const hk = cfg.heat_g_per_power * ss.power;
  let bar = s.endurance, gEff, heatG, emptied = false;

  if (g <= free + 1e-12) {
    gEff = g;
    bar = Math.min(maxBar, bar + refill * dtReal);
    heatG = hk * Math.max(0, g - thr) * dtReal;
  } else {
    // ECONOMY keeps the reserve only while closing / chasing; station keeping may spend it
    const floor = (s.stance === 'economy' && closing) ? cfg.reserve_frac * maxBar : 0;
    const drain = drainPerRealSec(g, maxBar, P, ss.use_mult, scale);
    const avail = Math.max(0, bar - floor);
    const tHigh = drain > 0 ? Math.min(dtReal, avail / drain) : dtReal;
    const gLow = Math.min(free, g);
    gEff = (tHigh * g + (dtReal - tHigh) * gLow) / dtReal;
    bar = Math.min(maxBar, Math.max(0, bar - drain * tHigh) + refill * (dtReal - tHigh));
    if (floor === 0 && tHigh < dtReal) emptied = true;
    heatG = hk * (tHigh * Math.max(0, g - thr) + (dtReal - tHigh) * Math.max(0, gLow - thr));
  }
  return { gEff, bar, heatG, emptied };
}

// ---------------------------------------------------------------------
// ONE STEP for every ship (simultaneous: all damage is worked out from the
// positions and heat at the START of the step, then applied).
// ---------------------------------------------------------------------
function stepAll(ships, dt, scale, cfg, zone, events, tEnd) {
  const live = ships.filter((s) => s.alive && !s.left);
  const byId = new Map(live.map((s) => [s.id, s]));
  const start = new Map(live.map((s) => [s.id, { id: s.id, x: s.x, y: s.y, vx: s.vx, vy: s.vy }]));
  const stat = new Map(live.map((s) => [s.id, statsOf(s, cfg)]));
  const wasTripped = new Map(live.map((s) => [s.id, s.tripped]));
  const dtG = dt * scale;

  // AUTO-TARGET: only when there is no valid target; it stays until it dies or leaves
  for (const s of live) {
    if (!(s.targetId && byId.has(s.targetId))) {
      const n = nearestHostile(s, live);
      s.targetId = n ? n.id : null;
    }
  }

  // 1. FIRE (reads only; nothing is changed yet)
  const incoming = new Map();   // target id -> total damage this step
  const plan = new Map();       // shooter id -> {heat, ammo}
  const best = new Map();       // target id -> {actor, amount} (the biggest hitter)
  for (const s of live) {
    const out = { heat: 0, ammo: 0 };
    plan.set(s.id, out);
    const tgt = s.targetId ? byId.get(s.targetId) : null;
    if (!tgt || s.tripped) continue;
    const ss = stat.get(s.id), ts = stat.get(tgt.id);
    const r = Math.hypot(start.get(tgt.id).x - start.get(s.id).x, start.get(tgt.id).y - start.get(s.id).y);
    const eff = heatEffectiveness(s.heat, ss.heatCap, cfg);
    const steps = classSteps(s, tgt);
    let ammoLeft = s.ammo, dmg = 0;
    for (const w of ss.weapons) {
      if (r > w.maxR) continue;
      let frac = 1;
      if (w.fam === 'missile') {
        const want = dt / w.reuse, use = Math.min(want, ammoLeft);
        frac = want > 0 ? use / want : 0;
        ammoLeft -= use; out.ammo += use;
      }
      if (frac <= 0) continue;
      out.heat += w.heat * dt * frac;
      dmg += weaponDps(w, hitChance(w, r, ts.mobility, steps, cfg), eff, ts.pd) * dt * frac;
    }
    if (dmg > 0) {
      incoming.set(tgt.id, (incoming.get(tgt.id) || 0) + dmg);
      const b = best.get(tgt.id);
      if (!b || dmg > b.amount) best.set(tgt.id, { actor: s.id, amount: dmg });
      events.push({ t: tEnd, kind: 'damage', actor_id: s.id, target_id: tgt.id, amount: dmg, note: null });
    }
  }

  // 2. MOVE, HEAT, REGEN, DAMAGE for each ship
  for (const s of live) {
    const ss = stat.get(s.id), fp = plan.get(s.id), st0 = start.get(s.id);
    const tgt = s.targetId ? start.get(s.targetId) : null;
    const offline = wasTripped.get(s.id);

    // movement
    const gd = guide({ ...st0, order: s.order }, tgt, ss, cfg, dtG);
    const tb = thrustBudget(s, ss, gd.gCmd, gd.closing, dt, scale, cfg);
    const a = tb.gEff * G_KMS2;
    const ax = gd.dx * a, ay = gd.dy * a;
    s.x = st0.x + st0.vx * dtG + 0.5 * ax * dtG * dtG;
    s.y = st0.y + st0.vy * dtG + 0.5 * ay * dtG * dtG;
    s.vx = st0.vx + ax * dtG;
    s.vy = st0.vy + ay * dtG;
    s.endurance = tb.bar;
    if (tb.emptied) s.drained = true;
    else if (s.drained && s.endurance >= cfg.recover_frac * s.base.pilot.endurance_max) s.drained = false;

    // heat
    let gain = tb.heatG;
    if (!offline) gain += fp.heat + ss.rigHeat * dt;
    s.heat = clamp(s.heat + gain - ss.cooling * dt, 0, ss.heatCap);
    if (!s.tripped) {
      if (ss.heatCap > 0 && s.heat >= ss.heatCap) {
        s.tripped = true; s.shutdown_left = cfg.shutdown_s;
        events.push({ t: tEnd, kind: 'shutdown', actor_id: s.id, target_id: null, amount: s.heat, note: null });
      }
    } else {
      s.shutdown_left = Math.max(0, s.shutdown_left - dt);
      if (s.shutdown_left <= 0 && s.heat < cfg.resume_frac * ss.heatCap) {
        s.tripped = false;
        events.push({ t: tEnd, kind: 'resume', actor_id: s.id, target_id: null, amount: s.heat, note: null });
      }
    }

    // ammo
    s.ammo = Math.max(0, s.ammo - fp.ammo);

    // regen first, then the damage of this step: shield -> armor -> hull
    if (!offline) {
      s.shield = Math.min(ss.shield_max, s.shield + ss.shield_regen * dt);
      s.armor = Math.min(ss.armor_max, s.armor + ss.armor_repair * dt);
    }
    let d = incoming.get(s.id) || 0;
    const t1 = Math.min(d, s.shield); s.shield -= t1; d -= t1;
    const t2 = Math.min(d, s.armor); s.armor -= t2; d -= t2;
    const t3 = Math.min(d, s.hull); s.hull -= t3; d -= t3;
    if (s.hull <= 1e-9) {
      s.hull = 0; s.alive = false;
      const b = best.get(s.id);
      events.push({ t: tEnd, kind: 'kill', actor_id: b ? b.actor : null, target_id: s.id, amount: 0, note: null });
    } else if (zone && Math.hypot(s.x, s.y) >= zone.exit_km) {
      s.left = true;
      events.push({ t: tEnd, kind: 'exit', actor_id: s.id, target_id: null, amount: Math.hypot(s.vx, s.vy), note: null });
    }
  }
}

// ---------------------------------------------------------------------
// WORK A FIGHT FORWARD by `seconds` REAL seconds in steps of cfg.step_s
// (the last step may be shorter). Returns NEW ship objects (the input is not
// changed), the summary events (one per attacker / target pair per step, plus
// shutdown, resume, kill and exit rows), and how many seconds were worked.
//   opts: {scale (default 60), cfg (merged over DEFAULTS), zone: {exit_km}}
// ---------------------------------------------------------------------
export function advance(ships, seconds, opts = {}) {
  const cfg = { ...DEFAULTS, ...(opts.cfg || {}) };
  const scale = opts.scale ?? 60;
  const total = Math.max(0, Math.min(seconds, cfg.catchup_max_s));
  let cur = JSON.parse(JSON.stringify(ships));
  const events = [];
  let t = 0;
  while (total - t > 1e-9) {
    const dt = Math.min(cfg.step_s, total - t);
    stepAll(cur, dt, scale, cfg, opts.zone || null, events, t + dt);
    t += dt;
  }
  return { ships: cur, events, advanced: total };
}
