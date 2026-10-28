// @ts-nocheck
// ======================================================================
// Combat actions (COMBAT MVP step 4a). The fight maths is shared/combat.js (bundled as ./combat_bundle.ts);
// this file only loads and stores the fight and checks who is asking.
//   combat_zone    {}                          where am I: outside a zone (can I enter?) or inside (works the fight forward, returns it)
//   combat_enter   {drone?}                     enter the zone of the place where the flown ship is docked (drone = a drone_types id, ranges only)
//   combat_order   {kind, target?, hold_km?}   attack_max | attack_opt | follow | stop | flee; hold_km = own station-keeping distance
//   combat_stance  {stance}                    free | economy | full  (the burn switch)
//   combat_module  {index, on}                 switch one weapon / rig on or off
// There is no 'leave' action: a ship leaves by flying beyond the exit radius (then it drifts on the Fly screen).
// A fight = a zone + an INSTANCE. Instanced zones (the ESC range) give every pilot his own fight (instance = character id);
// other zones have one shared fight (instance ''). A zone with retreat_hull_frac stops the fight for a pilot whose hull falls below it.
// Imports from common.ts and the two bundles only.
// ======================================================================
import { json, getCharacter, getLocation, getShip, resolveFor, placeXY, pilotNumbers, UUID_RE } from './common.ts';
import { CLOCK, gameDaysAt, bodyId, coastPlan, KMS, KM_PER_AU } from './physics_bundle.ts';
import { DEFAULTS, ORDER_KINDS, STANCES, resolveBase, newShip, advance, statsOf, dpsAt, hpsOf } from './combat_bundle.ts';

const REST_DAYS = 3650;          // same as course.ts: a drifting ship refills its bar at the flight rate
const RECENT_EVENTS = 12;        // events shown to the page
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;
const refuse = (error, message, status = 409) => json({ error, message }, status);

// ---------- settings ----------
async function loadSettings(db) {
  const { data, error } = await db.from('game_state').select('key,value').in('key', ['combat', 'pilot']);
  if (error) throw error;
  const rows = {};
  for (const r of data ?? []) rows[r.key] = r.value || {};
  return { cfg: { ...DEFAULTS, ...(rows.combat || {}) }, pilotCfg: rows.pilot || {} };
}

// ---------- row <-> fight state ----------
// A combat_ships row is the snapshot at snap_at; the fight object is what combat.js works with (extra fields ship_id / drone_type ride along).
function fromRow(r) {
  const snapMs = Date.parse(r.snap_at);
  const left = r.tripped && r.shutdown_until ? Math.max(0, (Date.parse(r.shutdown_until) - snapMs) / 1000) : 0;
  return {
    id: r.id, side: r.side, base: r.stats, on: Array.isArray(r.modules) ? r.modules : [],
    x: num(r.x_km), y: num(r.y_km), vx: num(r.vx_kms), vy: num(r.vy_kms),
    shield: num(r.shield), armor: num(r.armor), hull: num(r.hull), heat: num(r.heat),
    tripped: !!r.tripped, shutdown_left: left, ammo: num(r.ammo), endurance: num(r.endurance), drained: !!r.drained,
    stance: r.burn_stance || 'economy', targetId: r.target_id || null,
    order: { kind: r.order_kind || 'stop', hold_km: r.hold_km == null ? null : num(r.hold_km), dir_deg: r.order_dir == null ? null : num(r.order_dir) },
    alive: true, left: false, ship_id: r.ship_id || null, drone_type: r.drone_type || null,
  };
}
function rowPatch(s, snapMs) {
  return {
    x_km: s.x, y_km: s.y, vx_kms: s.vx, vy_kms: s.vy,
    shield: s.shield, armor: s.armor, hull: s.hull, heat: s.heat,
    tripped: s.tripped, shutdown_until: s.tripped ? new Date(snapMs + s.shutdown_left * 1000).toISOString() : null,
    ammo: s.ammo, target_id: s.targetId, order_kind: s.order.kind, hold_km: s.order.hold_km ?? null, order_dir: s.order.dir_deg ?? null,
    burn_stance: s.stance, modules: s.on, endurance: s.endurance, drained: s.drained,
    snap_at: new Date(snapMs).toISOString(),
  };
}

// ---------- building a ship's stats (once, at entry) ----------
async function pilotBlock(db, characterId, pilotCfg, t) {
  if (!characterId) {   // a drone: the plain settings, no skills
    return {
      free_g: num(pilotCfg.free_g, 3), endurance_max: num(pilotCfg.endurance_max, 100), bar: num(pilotCfg.endurance_max, 100),
      refill_flight_hour: num(pilotCfg.refill_flight_hour, 20), ref_g: num(pilotCfg.ref_g, 4),
      burn_hours_ref: num(pilotCfg.burn_hours_ref, 1.5), burn_keep: num(pilotCfg.burn_keep, 1),
    };
  }
  const p = await pilotNumbers(db, characterId, 4, t);   // bar, max, freeG, refill (skills included)
  return {
    free_g: p.freeG, endurance_max: p.max, bar: p.bar, refill_flight_hour: p.refill,
    ref_g: num(pilotCfg.ref_g, 4), burn_hours_ref: num(pilotCfg.burn_hours_ref, 1.5), burn_keep: num(pilotCfg.burn_keep, 1),
  };
}
async function skillEffects(db, characterId) {
  if (!characterId) return [];
  // Heavy Burn raises max thrust (+3% per Grade); the combat skills are still switched off (their hooks come later)
  const { data, error } = await db.rpc('skill_effect', { p_character: characterId, p_skill: 'heavy_burn' });
  if (error) throw error;
  const boost = num(data);
  return boost > 0 ? [{ max_g_pct: boost * 100 }] : [];
}
async function loadRigs(db, ids) {
  if (!ids.length) return [];
  const { data, error } = await db.from('rigs').select('*').in('id', [...new Set(ids)]);
  if (error) throw error;
  const byId = new Map((data ?? []).map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
async function fittedRigIds(db, shipId) {
  const { data, error } = await db.from('ship_rigs').select('rig_id,fitted_at').eq('ship_id', shipId).order('fitted_at');
  if (error) throw error;
  return (data ?? []).map((r) => r.rig_id);
}

// ---------- where a ship appears ----------
// At the ENTRY radius. A lone ship: a fixed angle from its id. With other player ships in the zone: the angle
// (of 72) that is farthest from all of them. (Fleet mates arriving together come with the fleet step.)
function spawnAngle(R, others, seed) {
  if (!others.length) {
    let h = 0;
    for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return (h % 3600) / 3600 * 2 * Math.PI;
  }
  let best = 0, bestD = -1;
  for (let k = 0; k < 72; k++) {
    const a = k * Math.PI / 36, x = R * Math.cos(a), y = R * Math.sin(a);
    let m = Infinity;
    for (const o of others) m = Math.min(m, Math.hypot(o.x - x, o.y - y));
    if (m > bestD) { bestD = m; best = a; }
  }
  return best;
}

// Out of missiles: switch the launchers off (nothing is spent and no heat is made while they are off)
function missilesOff(s) {
  if (!(s.base.ammo > 0) || s.ammo >= 0.01) return;
  const mods = s.base.modules, on = Array.isArray(s.on) ? s.on.slice() : [];
  while (on.length < mods.length) on.push(1);
  mods.forEach((m, i) => { if (m.family === 'missile') on[i] = 0; });
  s.on = on;
}

// ---------- working a zone forward ----------
// Claims the fight (SQL combat_instance_claim), works every ship forward to now, stores the result, handles ships that
// died or left. Returns {zone, cfg, pilotCfg}; null when the place has no zone.
async function workZone(db, zoneId, instance, nowMs) {
  const { data: zone, error: ze } = await db.from('combat_zones').select('*').eq('location_id', zoneId).maybeSingle();
  if (ze) throw ze;
  if (!zone) return null;
  const { cfg, pilotCfg } = await loadSettings(db);
  const { data: claim, error: ce } = await db.rpc('combat_instance_claim', { p_zone: zoneId, p_instance: instance || '', p_now: new Date(nowMs).toISOString() });
  if (ce) throw ce;
  const ctx = { zone, cfg, pilotCfg, instance: instance || '' };
  if (claim && claim.work) await advanceZone(db, ctx, nowMs);
  return ctx;
}

async function advanceZone(db, ctx, nowMs) {
  const { zone, cfg, instance } = ctx;
  const { data: rows, error } = await db.from('combat_ships').select('*').eq('zone_id', zone.location_id).eq('instance', instance);
  if (error) throw error;
  if (!rows || !rows.length) return;
  const snapMs = Math.min(...rows.map((r) => Date.parse(r.snap_at)));
  const elapsed = (nowMs - snapMs) / 1000;
  if (!(elapsed > 0.5)) return;

  // Work forward ONE STEP AT A TIME (same maths as one long advance) so the RETREAT rule can look at every pilot's hull after each step:
  // a pilot whose hull falls below zone.retreat_hull_frac leaves the fight at once (the ship stays docked, nothing is lost).
  const retreatFrac = zone.retreat_hull_frac == null ? null : num(zone.retreat_hull_frac);
  const total = Math.max(0, Math.min(elapsed, cfg.catchup_max_s));
  const res = { ships: rows.map(fromRow), events: [] };
  for (let t = 0; total - t > 1e-9;) {
    const dt = Math.min(cfg.step_s, total - t);
    const r = advance(res.ships, dt, { scale: CLOCK.scale, cfg, zone: { exit_km: num(zone.exit_radius_km) } });
    for (const e of r.events) res.events.push({ ...e, t: e.t + t });
    res.ships = r.ships;
    t += dt;
    if (retreatFrac) {
      for (const s of res.ships) {
        if (!s.ship_id || !s.alive || s.left) continue;
        const hm = statsOf(s, cfg).hull_max;
        if (hm > 0 && s.hull < retreatFrac * hm) {
          s.left = true; s.retreated = true;
          res.events.push({ kind: 'retreat', actor_id: s.id, target_id: null, amount: s.hull / hm, note: null, t });
        }
      }
    }
  }

  // events: damage rows are summed per attacker / target pair for the whole catch-up (saves database space)
  const evRows = [];
  const dmg = new Map();
  for (const e of res.events) {
    const at = new Date(Math.min(nowMs, snapMs + e.t * 1000)).toISOString();
    if (e.kind === 'damage') {
      const k = e.actor_id + '|' + e.target_id;
      const d = dmg.get(k) || { zone_id: zone.location_id, instance, at, kind: 'damage', actor_id: e.actor_id, target_id: e.target_id, amount: 0, note: null };
      d.amount += e.amount; d.at = at; dmg.set(k, d);
    } else {
      evRows.push({ zone_id: zone.location_id, instance, at, kind: e.kind, actor_id: e.actor_id ?? null, target_id: e.target_id ?? null, amount: e.amount ?? null, note: e.note ?? null });
    }
  }
  for (const d of dmg.values()) evRows.push(d);
  if (evRows.length) {
    const { error: ie } = await db.from('combat_events').insert(evRows);
    if (ie) console.error('combat_events insert failed', ie);
  }

  // who owns the player ships (for the bar write-back and the exit drift)
  const shipIds = res.ships.filter((s) => s.ship_id).map((s) => s.ship_id);
  const owner = new Map();
  if (shipIds.length) {
    const { data: sh, error: se } = await db.from('ships').select('id,character_id').in('id', shipIds);
    if (se) throw se;
    for (const r of sh ?? []) owner.set(r.id, r.character_id);
  }
  // MISSIONS: a player ship that destroyed a drone whose type has a kill_quest finishes that mission's step 'kill:<drone type>'.
  // (The server does this itself: the page cannot be trusted to say what died. A mission that is not accepted yet simply ignores it.)
  const kills = res.events.filter((e) => e.kind === 'kill' && e.actor_id && e.target_id);
  if (kills.length) {
    const typeOf = new Map(rows.map((r) => [r.id, r.drone_type]));
    const wanted = [...new Set(kills.map((e) => typeOf.get(e.target_id)).filter(Boolean))];
    if (wanted.length) {
      const { data: dts } = await db.from('drone_types').select('id,kill_quest,xp_reward').in('id', wanted);
      const dinfo = new Map((dts ?? []).map((d) => [d.id, d]));
      for (const e of kills) {
        const dt = typeOf.get(e.target_id), info = dt ? dinfo.get(dt) : null;
        const killer = res.ships.find((x) => x.id === e.actor_id);
        const cid = killer && killer.ship_id ? owner.get(killer.ship_id) : null;
        if (!info || !cid) continue;
        if (info.kill_quest) {
          const { error: qe } = await db.rpc('quest_step', { p_character: cid, p_quest: info.kill_quest, p_step: 'kill:' + dt });
          if (qe) console.error('quest_step (kill) failed', qe);
        }
        if (Number(info.xp_reward) > 0) {                       // every drone kill pays its XP to the pilot who destroyed it
          const { error: xe } = await db.rpc('combat_xp_add', { p_character: cid, p_xp: Number(info.xp_reward) });
          if (xe) console.error('combat_xp_add failed', xe);
        }
      }
    }
  }
  const loc = await getLocation(db, zone.location_id);
  const exitT = new Map();
  for (const e of res.events) if (e.kind === 'exit') exitT.set(e.actor_id, e.t);

  for (const s of res.ships) {
    if (s.alive && !s.left) {
      missilesOff(s);
      const { error: ue } = await db.from('combat_ships').update(rowPatch(s, nowMs)).eq('id', s.id);
      if (ue) throw ue;
      continue;
    }
    // the ship is out of the fight (destroyed, or beyond the exit radius)
    if (s.ship_id) {
      const characterId = owner.get(s.ship_id);
      const when = snapMs + (exitT.get(s.id) ?? elapsed) * 1000;
      const tNow = gameDaysAt(nowMs);
      if (s.retreated) {
        // RETREAT: combat stops, the ship stays docked at the place (the page shows the Fly screen and a message)
        if (characterId) await db.rpc('combat_endurance_set', { p_character: characterId, p_bar: s.endurance, p_t: tNow });
      } else if (s.alive && s.left && loc) {
        // flew out: it becomes a DRIFT with the speed and direction it had (positions in the body's frame, AU and AU/day)
        const a = placeXY(loc);
        // it reappears ON the place (the zone is a point at the place) and keeps the speed and direction it had
        const st = { x: a.x, y: a.y, vx: s.vx / KMS, vy: s.vy / KMS };
        const plan = coastPlan(st, gameDaysAt(when));
        plan.frame = bodyId(loc.anchor_body);
        plan.origin = loc.id;
        plan.xp_au = 0;
        const { data: ej, error: ee } = await db.rpc('combat_eject', { p_ship: s.ship_id, p_plan: plan });
        if (ee) throw ee;
        if (!ej || !ej.ok) { console.error('combat_eject failed', ej); continue; }   // keep the row; try again next time
        if (characterId) {
          await db.rpc('combat_endurance_set', { p_character: characterId, p_bar: s.endurance, p_t: tNow });
          const { error: fe } = await db.rpc('endurance_fly', { p_character: characterId, p_g: s.base.pilot.free_g, p_burn_days: 0, p_total_days: REST_DAYS, p_now_t: tNow });
          if (fe) console.error('endurance_fly after exit failed', fe);
        }
      } else if (characterId) {
        // INTERIM (step 4; step 5 replaces it with the pod and the insurance rules): a destroyed ship stays docked at the place
        await db.rpc('combat_endurance_set', { p_character: characterId, p_bar: s.endurance, p_t: tNow });
      }
    }
    const { error: de } = await db.from('combat_ships').delete().eq('id', s.id);
    if (de) throw de;
  }

  // END OF A FIGHT (test rules). In an NPC-only zone a player with no opponent left is released: the zone is CLEARED and the ship stays docked.
  // When no player ship is left in the zone, whatever NPCs remain are removed: the zone RESETS.
  const live = res.ships.filter((s) => s.alive && !s.left);
  let playersLeft = live.filter((s) => s.ship_id);
  if (loc && loc.pvp === false) {
    for (const p of playersLeft) {
      if (live.some((o) => o.side !== p.side)) continue;
      const characterId = owner.get(p.ship_id);
      if (characterId) await db.rpc('combat_endurance_set', { p_character: characterId, p_bar: p.endurance, p_t: gameDaysAt(nowMs) });
      await db.from('combat_events').insert({ zone_id: zone.location_id, instance, at: new Date(nowMs).toISOString(), kind: 'cleared', actor_id: p.id, target_id: null, amount: null, note: null });
      const { error: ce2 } = await db.from('combat_ships').delete().eq('id', p.id);
      if (ce2) throw ce2;
      playersLeft = playersLeft.filter((q) => q.id !== p.id);
    }
  }
  if (!playersLeft.length) {
    const { error: re } = await db.from('combat_ships').delete().eq('zone_id', zone.location_id).eq('instance', instance).is('ship_id', null);
    if (re) console.error('zone reset failed', re);
  }
}

// ---------- what the page gets ----------
async function nameMap(db, rows) {
  const names = new Map();
  const shipIds = rows.filter((r) => r.ship_id).map((r) => r.ship_id);
  if (shipIds.length) {
    const { data: sh } = await db.from('ships').select('id,character_id').in('id', shipIds);
    const cids = [...new Set((sh ?? []).map((r) => r.character_id))];
    const { data: cs } = cids.length ? await db.from('characters').select('id,name').in('id', cids) : { data: [] };
    const cname = new Map((cs ?? []).map((c) => [c.id, c.name]));
    const byShip = new Map((sh ?? []).map((r) => [r.id, cname.get(r.character_id) || 'Pilot']));
    for (const r of rows) if (r.ship_id) names.set(r.id, byShip.get(r.ship_id) || 'Pilot');
  }
  const dts = [...new Set(rows.filter((r) => r.drone_type).map((r) => r.drone_type))];
  if (dts.length) {
    const { data: d } = await db.from('drone_types').select('id,name').in('id', dts);
    const dn = new Map((d ?? []).map((x) => [x.id, x.name]));
    for (const r of rows) if (r.drone_type) names.set(r.id, dn.get(r.drone_type) || 'Drone');
  }
  return names;
}

async function buildView(db, ctx, myShipId) {
  const { zone, cfg, instance } = ctx;
  const { data: rows, error } = await db.from('combat_ships').select('*').eq('zone_id', zone.location_id).eq('instance', instance);
  if (error) throw error;
  const myRow = (rows ?? []).find((r) => r.ship_id === myShipId);
  if (!myRow) return null;
  const names = await nameMap(db, rows);
  const ships = rows.map(fromRow);
  const me = ships.find((s) => s.id === myRow.id);
  const tgt = me.targetId ? ships.find((s) => s.id === me.targetId) : null;
  const ss = statsOf(me, cfg);
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  const dps = tgt ? dpsAt(me, tgt, dist(me, tgt), cfg) : { total: 0, list: [] };
  const others = ships.filter((s) => s.id !== me.id).map((s) => {
    const st = statsOf(s, cfg);
    return {
      id: s.id, name: names.get(s.id) || 'Ship', side: s.side, hostile: s.side !== me.side, drone: s.drone_type || null,
      hull_id: s.base.hull.id, class: s.base.hull.class,
      x: Math.round(s.x), y: Math.round(s.y), vx: r3(s.vx), vy: r3(s.vy),
      dist_km: Math.round(dist(me, s)),
      shield: r3(st.shield_max > 0 ? s.shield / st.shield_max : 0), armor: r3(st.armor_max > 0 ? s.armor / st.armor_max : 0), hull: r3(st.hull_max > 0 ? s.hull / st.hull_max : 0),
      sh: Math.round(s.shield), ar: Math.round(s.armor), hu: Math.round(s.hull),
      weapons: st.weapons.map((w) => ({ fam: w.fam, opt_km: Math.round(w.optR), max_km: Math.round(w.maxR) })),
      mods: s.base.modules.map((m) => ({ n: m.name, k: m.kind, f: m.family || null })),
      tripped: s.tripped,
    };
  }).sort((a, b) => a.dist_km - b.dist_km);

  const { data: ev } = await db.from('combat_events').select('id,at,kind,actor_id,target_id,amount').eq('zone_id', zone.location_id).eq('instance', instance).order('id', { ascending: false }).limit(RECENT_EVENTS);
  return {
    ok: true, in_zone: true,
    zone: { id: zone.location_id, instanced: !!zone.instanced, entry_km: num(zone.entry_radius_km), exit_km: num(zone.exit_radius_km), retreat_pct: zone.retreat_hull_frac == null ? null : Math.round(num(zone.retreat_hull_frac) * 100) },
    now_ms: Date.now(), scale: CLOCK.scale, step_s: cfg.step_s,
    me: {
      id: me.id, side: me.side, x: Math.round(me.x), y: Math.round(me.y), vx: r3(me.vx), vy: r3(me.vy),
      shield: Math.round(me.shield), shield_max: Math.round(ss.shield_max), armor: Math.round(me.armor), armor_max: Math.round(ss.armor_max),
      hull: Math.round(me.hull), hull_max: Math.round(ss.hull_max),
      heat: r1(me.heat), heat_cap: r1(ss.heatCap), heat_cool: r1(ss.cooling), heat_warn: cfg.heat_eff_start, heat_resume: cfg.resume_frac,
      eng_k: r3(cfg.heat_g_per_power * ss.power), eng_thr: r1(Math.max(cfg.heat_thrust_g, ss.free_g)), tripped: me.tripped, shutdown_left: r1(me.shutdown_left),
      ammo: r1(me.ammo), endurance: r1(me.endurance), endurance_max: me.base.pilot.endurance_max, drained: me.drained,
      stance: me.stance, order: me.order, target_id: me.targetId, max_g: r1(ss.max_g), free_g: r1(ss.free_g),
      hps: r1(hpsOf(me, cfg)), dps: r1(dps.total), dps_list: dps.list.map((d) => ({ id: d.id, acc: r3(d.acc), dps: r1(d.dps) })),
      modules: me.base.modules.map((m, i) => ({ i, id: m.id, name: m.name, kind: m.kind, family: m.family || null, heat: m.heat, on: me.on[i] !== 0 })),
      weapons: ss.weapons.map((w) => ({ id: w.id, fam: w.fam, opt_km: Math.round(w.optR), max_km: Math.round(w.maxR) })),
    },
    ships: others,
    events: (ev ?? []).reverse(),
  };
}

// ---------- shared start of every action ----------
// the character, the flown ship and (if any) the fight row of that ship
async function begin(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return { err: json({ error: 'no_character' }, 400) };
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return { err: json({ error: 'no_ship' }, 400) };
  const { data: mine, error } = await db.from('combat_ships').select('*').eq('ship_id', ship.id).maybeSingle();
  if (error) throw error;
  return { ch, ship, mine };
}

// Is any ship of this pilot in a fight? (index.ts uses it to refuse travel, loading, rigging ... while in a zone)
export async function inCombat(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return false;
  const { data: ships } = await db.from('ships').select('id').eq('character_id', ch.id);
  const ids = (ships ?? []).map((s) => s.id);
  if (!ids.length) return false;
  const { data } = await db.from('combat_ships').select('id').in('ship_id', ids).limit(1);
  return !!(data && data.length);
}

// ---------- combat_zone ----------
export async function combatZone(db, user, body) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ch, ship, mine } = b;
  const nowMs = Date.now();
  if (mine) {
    const ctx = await workZone(db, mine.zone_id, mine.instance, nowMs);
    const v = ctx ? await buildView(db, ctx, ship.id) : null;
    if (v) return json(v);
    // the ship is gone from the fight (destroyed or flew out while we worked): fall through to the 'outside' answer
    const { data: again } = await db.from('ships').select('state').eq('id', ship.id).maybeSingle();
    let ended = null;                                                // the page sends the id it last saw for itself: how did that ship leave?
    const last = body && body.last && UUID_RE.test(String(body.last)) ? String(body.last) : null;
    if (last) {
      const { data: ev } = await db.from('combat_events').select('kind,actor_id,target_id').or('actor_id.eq.' + last + ',target_id.eq.' + last).in('kind', ['kill', 'cleared', 'exit', 'retreat']).order('id', { ascending: false }).limit(5);
      for (const e of ev ?? []) {
        if (e.kind === 'kill' && e.target_id === last) { ended = 'kill'; break; }
        if ((e.kind === 'cleared' || e.kind === 'exit' || e.kind === 'retreat') && e.actor_id === last) { ended = e.kind; break; }
      }
    }
    const message = ended === 'retreat' ? 'Combat stopped: your hull fell below the safe limit. Your ship is safe at the range.' : null;
    return json({ ok: true, in_zone: false, left: true, ship_state: again ? again.state : null, ended, message });
  }
  if (ship.state !== 'docked' || !ship.location_id) return json({ ok: true, in_zone: false, here: false });
  const { data: zone, error } = await db.from('combat_zones').select('*').eq('location_id', ship.location_id).maybeSingle();
  if (error) throw error;
  if (!zone) return json({ ok: true, in_zone: false, here: false });
  const loc = await getLocation(db, ship.location_id);
  const pod = ship.hull_id === 'life_pod';
  let drones = null;                                   // instanced range: the drones this pilot may ask for (a drone is open once its mission is accepted)
  if (zone.instanced) {
    const { data: dts } = await db.from('drone_types').select('id,name,kill_quest,sort_order,xp_reward').order('sort_order');
    const { data: cqs } = await db.from('character_quests').select('quest_id,status').eq('character_id', ch.id);
    const st = new Map((cqs ?? []).map((q) => [q.quest_id, q.status]));
    // unlocked = its mission is accepted (or done). startable = locked, but the mission BEFORE it in the list is done (ready or claimed): choosing it starts its mission.
    drones = (dts ?? []).map((d, i) => {
      const unlocked = !d.kill_quest || ['active', 'ready', 'claimed'].includes(st.get(d.kill_quest));
      const prev = i > 0 ? (dts[i - 1].kill_quest || null) : null;
      return { id: d.id, name: d.name, quest: d.kill_quest || null, prev_quest: prev, xp: Number(d.xp_reward) || 0, unlocked,
               startable: !unlocked && !!prev && ['ready', 'claimed'].includes(st.get(prev)) };
    });
  }
  return json({
    ok: true, in_zone: false, here: true, can_enter: !pod, drones,
    message: pod ? 'A life pod cannot enter a combat zone. Board a ship first.' : null,
    zone: { id: zone.location_id, name: loc ? loc.name : zone.location_id, info: loc ? loc.info : null, pvp: loc ? !!loc.pvp : true, entry_km: num(zone.entry_radius_km), exit_km: num(zone.exit_radius_km), instanced: !!zone.instanced, retreat_pct: zone.retreat_hull_frac == null ? null : Math.round(num(zone.retreat_hull_frac) * 100), default_drone: zone.default_drone || null },
  });
}

// ---------- combat_enter ----------
export async function combatEnter(db, user, body = {}) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ch, ship, mine } = b;
  if (mine) return await combatZone(db, user, {});                   // already inside: just show it
  if (ship.state !== 'docked' || !ship.location_id) return refuse('not_docked', 'Dock at a combat zone first.');
  if (ship.hull_id === 'life_pod') return refuse('pod_cannot_enter', 'A life pod cannot enter a combat zone. Board a ship first.');
  const nowMs = Date.now();
  const { data: zrow, error: zre } = await db.from('combat_zones').select('instanced').eq('location_id', ship.location_id).maybeSingle();
  if (zre) throw zre;
  const instance = zrow && zrow.instanced ? ch.id : '';             // one fight per pilot on an instanced range, else one shared fight
  const ctx = await workZone(db, ship.location_id, instance, nowMs);  // work the fight forward to now BEFORE adding a ship
  if (!ctx) return refuse('no_zone_here', 'There is no combat zone at this place.');
  const { zone, cfg, pilotCfg } = ctx;
  const loc = await getLocation(db, zone.location_id);
  const t = gameDaysAt(nowMs);

  // my ship's numbers, worked out once
  const { data: hull, error: he } = await db.from('hulls').select('*').eq('id', ship.hull_id).maybeSingle();
  if (he) throw he;
  if (!hull) return refuse('no_hull', 'The ship hull is unknown.', 500);
  const rigs = await loadRigs(db, await fittedRigIds(db, ship.id));
  const pilot = await pilotBlock(db, ch.id, pilotCfg, t);
  const base = resolveBase({ hull, rigs, skillFx: await skillEffects(db, ch.id), pilot });

  // where I appear
  const { data: existing, error: ee } = await db.from('combat_ships').select('x_km,y_km,side,ship_id').eq('zone_id', zone.location_id).eq('instance', instance);
  if (ee) throw ee;
  const R = num(zone.entry_radius_km);
  const players = (existing ?? []).filter((r) => r.ship_id).map((r) => ({ x: num(r.x_km), y: num(r.y_km) }));
  const ang = spawnAngle(R, players, ship.id);
  const id = crypto.randomUUID();
  const me = newShip({ id, side: 'players', base, x: R * Math.cos(ang), y: R * Math.sin(ang), endurance: pilot.bar, stance: 'full', order: { kind: 'stop' }, cfg });
  const nowIso = new Date(nowMs).toISOString();
  const toInsert = (s, extra) => ({
    id: s.id, zone_id: zone.location_id, instance, side: s.side, entered_at: nowIso, snap_at: nowIso,
    x_km: s.x, y_km: s.y, vx_kms: s.vx, vy_kms: s.vy, shield: s.shield, armor: s.armor, hull: s.hull, heat: 0, tripped: false,
    shutdown_until: null, ammo: s.ammo, target_id: null, order_kind: s.order.kind, order_at: nowIso, burn_stance: s.stance,
    modules: s.on, stats: s.base, endurance: s.endurance, drained: false, hold_km: null, ...extra,
  });
  const inserts = [toInsert(me, { ship_id: ship.id, drone_type: null })];

  // TEMPORARY (step 5 replaces it): an NPC-only fight with no drone in it gets ONE drone, at the CENTRE of the zone.
  // Which one: on an instanced range the pilot may ask for one (body.drone), otherwise the zone's default_drone.
  const hasDrone = (existing ?? []).some((r) => r.side === 'drones');
  let spawned = false;
  if (loc && loc.pvp === false && !hasDrone) {
    const want = zone.instanced && body && body.drone ? String(body.drone) : zone.default_drone;
    if (want) {
      const { data: dt, error: dte } = await db.from('drone_types').select('*').eq('id', want).maybeSingle();
      if (dte) throw dte;
      if (!dt) return refuse('bad_drone', 'That drone does not exist.');
      if (zone.instanced && body && body.drone && dt.kill_quest) {         // an asked-for drone needs its mission accepted (the default drone needs nothing)
        const { data: cq } = await db.from('character_quests').select('status').eq('character_id', ch.id).eq('quest_id', dt.kill_quest).maybeSingle();
        if (!cq || !['active', 'ready', 'claimed'].includes(cq.status)) return refuse('drone_locked', 'Accept its mission first (Missions screen).');
      }
      const { data: dh } = await db.from('hulls').select('*').eq('id', dt.hull_id).maybeSingle();
      if (dh) {
        const dpilot = await pilotBlock(db, null, pilotCfg, t);
        const dbase = resolveBase({ hull: dh, rigs: await loadRigs(db, dt.rig_ids || []), skillFx: [dt.effects || {}], pilot: dpilot });
        const order = { kind: dt.start_order || 'attack_opt' };
        const drone = newShip({ id: crypto.randomUUID(), side: 'drones', base: dbase, x: 0, y: 0, endurance: dpilot.bar, stance: 'economy', order, cfg });
        inserts.push(toInsert(drone, { ship_id: null, drone_type: dt.id }));
        spawned = true;
      }
    }
  }
  const { error: ie } = await db.from('combat_ships').insert(inserts);
  if (ie) throw ie;
  if (spawned) {
    // two pilots entering a SHARED zone at the same moment could both add a drone: keep the one with the smallest id
    const { data: ds } = await db.from('combat_ships').select('id').eq('zone_id', zone.location_id).eq('instance', instance).eq('side', 'drones').order('id');
    for (const d of (ds ?? []).slice(1)) await db.from('combat_ships').delete().eq('id', d.id);
  }
  await db.from('combat_events').insert({ zone_id: zone.location_id, instance, at: nowIso, kind: 'enter', actor_id: id, target_id: null, amount: null, note: null });
  return json(await buildView(db, ctx, ship.id));
}

// ---------- the three commands ----------
// Each works the fight forward to now FIRST, then changes my row, then answers with the new view.
async function command(db, user, apply) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ship, mine } = b;
  if (!mine) return refuse('not_in_zone', 'Your ship is not in a combat zone.');
  const ctx = await workZone(db, mine.zone_id, mine.instance, Date.now());
  const { data: row, error } = await db.from('combat_ships').select('*').eq('ship_id', ship.id).maybeSingle();
  if (error) throw error;
  if (!row) return json({ ok: true, in_zone: false, left: true });
  const res = await apply(row, ctx);
  if (res && res.err) return res.err;
  const v = await buildView(db, ctx, ship.id);
  return json(v ?? { ok: true, in_zone: false, left: true });
}

export async function combatOrder(db, user, body) {
  const kind = String(body.kind ?? '');
  if (!ORDER_KINDS.includes(kind)) return json({ error: 'bad_request' }, 400);
  let hold = null;
  if (body.hold_km !== undefined && body.hold_km !== null && body.hold_km !== '') {
    hold = Number(body.hold_km);
    if (!Number.isFinite(hold) || hold < 1) return json({ error: 'bad_request' }, 400);
  }
  let dir = null;
  if (kind === 'heading') {                                   // thrust on a heading in degrees (0 = right on the map, 90 = down, as drawn)
    dir = Number(body.dir_deg);
    if (!Number.isFinite(dir)) return json({ error: 'bad_request' }, 400);
    dir = ((dir % 360) + 360) % 360;
  }
  const target = body.target ? String(body.target) : null;
  if (target && !UUID_RE.test(target)) return json({ error: 'bad_request' }, 400);
  return await command(db, user, async (row, ctx) => {
    const own = kind === 'stop' || kind === 'flee' || kind === 'heading';
    const patch = { order_kind: kind, order_at: new Date().toISOString(), hold_km: own ? null : hold, order_dir: kind === 'heading' ? dir : null };
    if (hold != null && hold > num(ctx.zone.exit_radius_km)) return { err: refuse('bad_distance', 'That distance is larger than the zone.') };
    if (target && !own) {
      const { data: t, error } = await db.from('combat_ships').select('id,side,zone_id,instance').eq('id', target).maybeSingle();
      if (error) throw error;
      if (!t || t.zone_id !== row.zone_id || t.instance !== row.instance || t.id === row.id) return { err: refuse('bad_target', 'That ship is not here any more.') };
      if (kind === 'follow' && t.side !== row.side) return { err: refuse('bad_target', 'You can only follow a friendly ship.') };
      if (kind !== 'follow' && t.side === row.side) return { err: refuse('bad_target', 'You cannot attack a friendly ship.') };
      patch.target_id = t.id;
    }
    const { error } = await db.from('combat_ships').update(patch).eq('id', row.id);
    if (error) throw error;
  });
}

export async function combatStance(db, user, body) {
  const stance = String(body.stance ?? '');
  if (!STANCES.includes(stance)) return json({ error: 'bad_request' }, 400);
  return await command(db, user, async (row) => {
    const { error } = await db.from('combat_ships').update({ burn_stance: stance }).eq('id', row.id);
    if (error) throw error;
  });
}

export async function combatModule(db, user, body) {
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || typeof body.on !== 'boolean') return json({ error: 'bad_request' }, 400);
  return await command(db, user, async (row) => {
    const on = Array.isArray(row.modules) ? row.modules.slice() : [];
    const n = row.stats && Array.isArray(row.stats.modules) ? row.stats.modules.length : 0;
    if (index >= n) return { err: refuse('bad_module', 'No such module.') };
    if (body.on && row.stats.modules[index].family === 'missile' && num(row.ammo) < 0.01) return { err: refuse('no_ammo', 'No ammo.') };
    while (on.length < n) on.push(1);
    on[index] = body.on ? 1 : 0;
    const { error } = await db.from('combat_ships').update({ modules: on }).eq('id', row.id);
    if (error) throw error;
  });
}
