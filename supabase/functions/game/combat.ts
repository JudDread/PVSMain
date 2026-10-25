// @ts-nocheck
// ======================================================================
// Combat actions (COMBAT MVP step 4a). The fight maths is shared/combat.js (bundled as ./combat_bundle.ts);
// this file only loads and stores the fight and checks who is asking.
//   combat_zone    {}                          where am I: outside a zone (can I enter?) or inside (works the fight forward, returns it)
//   combat_enter   {}                          enter the zone of the place where the flown ship is docked
//   combat_order   {kind, target?, hold_km?}   attack_max | attack_opt | follow | stop | flee; hold_km = own station-keeping distance
//   combat_stance  {stance}                    free | economy | full  (the burn switch)
//   combat_module  {index, on}                 switch one weapon / rig on or off
// There is no 'leave' action: a ship leaves by flying beyond the exit radius (then it drifts on the Fly screen).
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
    order: { kind: r.order_kind || 'stop', hold_km: r.hold_km == null ? null : num(r.hold_km) },
    alive: true, left: false, ship_id: r.ship_id || null, drone_type: r.drone_type || null,
  };
}
function rowPatch(s, snapMs) {
  return {
    x_km: s.x, y_km: s.y, vx_kms: s.vx, vy_kms: s.vy,
    shield: s.shield, armor: s.armor, hull: s.hull, heat: s.heat,
    tripped: s.tripped, shutdown_until: s.tripped ? new Date(snapMs + s.shutdown_left * 1000).toISOString() : null,
    ammo: s.ammo, target_id: s.targetId, order_kind: s.order.kind, hold_km: s.order.hold_km ?? null,
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

// ---------- working a zone forward ----------
// Claims the zone (SQL combat_zone_claim), works every ship forward to now, stores the result, handles ships that
// died or left. Returns {zone, cfg, pilotCfg}; null when the place has no zone.
async function workZone(db, zoneId, nowMs) {
  const { data: zone, error: ze } = await db.from('combat_zones').select('*').eq('location_id', zoneId).maybeSingle();
  if (ze) throw ze;
  if (!zone) return null;
  const { cfg, pilotCfg } = await loadSettings(db);
  const { data: claim, error: ce } = await db.rpc('combat_zone_claim', { p_zone: zoneId, p_now: new Date(nowMs).toISOString() });
  if (ce) throw ce;
  const ctx = { zone, cfg, pilotCfg };
  if (claim && claim.work) await advanceZone(db, ctx, nowMs);
  return ctx;
}

async function advanceZone(db, ctx, nowMs) {
  const { zone, cfg } = ctx;
  const { data: rows, error } = await db.from('combat_ships').select('*').eq('zone_id', zone.location_id);
  if (error) throw error;
  if (!rows || !rows.length) return;
  const snapMs = Math.min(...rows.map((r) => Date.parse(r.snap_at)));
  const elapsed = (nowMs - snapMs) / 1000;
  if (!(elapsed > 0.5)) return;
  const res = advance(rows.map(fromRow), elapsed, { scale: CLOCK.scale, cfg, zone: { exit_km: num(zone.exit_radius_km) } });

  // events: damage rows are summed per attacker / target pair for the whole catch-up (saves database space)
  const evRows = [];
  const dmg = new Map();
  for (const e of res.events) {
    const at = new Date(Math.min(nowMs, snapMs + e.t * 1000)).toISOString();
    if (e.kind === 'damage') {
      const k = e.actor_id + '|' + e.target_id;
      const d = dmg.get(k) || { zone_id: zone.location_id, at, kind: 'damage', actor_id: e.actor_id, target_id: e.target_id, amount: 0, note: null };
      d.amount += e.amount; d.at = at; dmg.set(k, d);
    } else {
      evRows.push({ zone_id: zone.location_id, at, kind: e.kind, actor_id: e.actor_id ?? null, target_id: e.target_id ?? null, amount: e.amount ?? null, note: e.note ?? null });
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
  const loc = await getLocation(db, zone.location_id);
  const exitT = new Map();
  for (const e of res.events) if (e.kind === 'exit') exitT.set(e.actor_id, e.t);

  for (const s of res.ships) {
    if (s.alive && !s.left) {
      const { error: ue } = await db.from('combat_ships').update(rowPatch(s, nowMs)).eq('id', s.id);
      if (ue) throw ue;
      continue;
    }
    // the ship is out of the fight (destroyed, or beyond the exit radius)
    if (s.ship_id) {
      const characterId = owner.get(s.ship_id);
      const when = snapMs + (exitT.get(s.id) ?? elapsed) * 1000;
      const tNow = gameDaysAt(nowMs);
      if (s.alive && s.left && loc) {
        // flew out: it becomes a DRIFT with the speed and direction it had (positions in the body's frame, AU and AU/day)
        const a = placeXY(loc);
        const st = { x: a.x + s.x / KM_PER_AU, y: a.y + s.y / KM_PER_AU, vx: s.vx / KMS, vy: s.vy / KMS };
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
  const { zone, cfg } = ctx;
  const { data: rows, error } = await db.from('combat_ships').select('*').eq('zone_id', zone.location_id);
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
      id: s.id, name: names.get(s.id) || 'Ship', side: s.side, hostile: s.side !== me.side,
      hull_id: s.base.hull.id, class: s.base.hull.class,
      x: Math.round(s.x), y: Math.round(s.y), vx: r3(s.vx), vy: r3(s.vy),
      dist_km: Math.round(dist(me, s)),
      shield: r3(st.shield_max > 0 ? s.shield / st.shield_max : 0), armor: r3(st.armor_max > 0 ? s.armor / st.armor_max : 0), hull: r3(st.hull_max > 0 ? s.hull / st.hull_max : 0),
      tripped: s.tripped,
    };
  }).sort((a, b) => a.dist_km - b.dist_km);

  const { data: ev } = await db.from('combat_events').select('id,at,kind,actor_id,target_id,amount').eq('zone_id', zone.location_id).order('id', { ascending: false }).limit(RECENT_EVENTS);
  return {
    ok: true, in_zone: true,
    zone: { id: zone.location_id, entry_km: num(zone.entry_radius_km), exit_km: num(zone.exit_radius_km) },
    now_ms: Date.now(), scale: CLOCK.scale, step_s: cfg.step_s,
    me: {
      id: me.id, x: Math.round(me.x), y: Math.round(me.y), vx: r3(me.vx), vy: r3(me.vy),
      shield: Math.round(me.shield), shield_max: Math.round(ss.shield_max), armor: Math.round(me.armor), armor_max: Math.round(ss.armor_max),
      hull: Math.round(me.hull), hull_max: Math.round(ss.hull_max),
      heat: r1(me.heat), heat_cap: r1(ss.heatCap), tripped: me.tripped, shutdown_left: r1(me.shutdown_left),
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
export async function combatZone(db, user) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ship, mine } = b;
  const nowMs = Date.now();
  if (mine) {
    const ctx = await workZone(db, mine.zone_id, nowMs);
    const v = ctx ? await buildView(db, ctx, ship.id) : null;
    if (v) return json(v);
    // the ship is gone from the fight (destroyed or flew out while we worked): fall through to the 'outside' answer
    const { data: again } = await db.from('ships').select('state').eq('id', ship.id).maybeSingle();
    return json({ ok: true, in_zone: false, left: true, ship_state: again ? again.state : null });
  }
  if (ship.state !== 'docked' || !ship.location_id) return json({ ok: true, in_zone: false, here: false });
  const { data: zone, error } = await db.from('combat_zones').select('*').eq('location_id', ship.location_id).maybeSingle();
  if (error) throw error;
  if (!zone) return json({ ok: true, in_zone: false, here: false });
  const loc = await getLocation(db, ship.location_id);
  const pod = ship.hull_id === 'life_pod';
  return json({
    ok: true, in_zone: false, here: true, can_enter: !pod,
    message: pod ? 'A life pod cannot enter a combat zone. Board a ship first.' : null,
    zone: { id: zone.location_id, name: loc ? loc.name : zone.location_id, info: loc ? loc.info : null, pvp: loc ? !!loc.pvp : true, entry_km: num(zone.entry_radius_km), exit_km: num(zone.exit_radius_km) },
  });
}

// ---------- combat_enter ----------
export async function combatEnter(db, user) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ch, ship, mine } = b;
  if (mine) return await combatZone(db, user);                       // already inside: just show it
  if (ship.state !== 'docked' || !ship.location_id) return refuse('not_docked', 'Dock at a combat zone first.');
  if (ship.hull_id === 'life_pod') return refuse('pod_cannot_enter', 'A life pod cannot enter a combat zone. Board a ship first.');
  const nowMs = Date.now();
  const ctx = await workZone(db, ship.location_id, nowMs);           // work the fight forward to now BEFORE adding a ship
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
  const { data: existing, error: ee } = await db.from('combat_ships').select('x_km,y_km,side,ship_id').eq('zone_id', zone.location_id);
  if (ee) throw ee;
  const R = num(zone.entry_radius_km);
  const players = (existing ?? []).filter((r) => r.ship_id).map((r) => ({ x: num(r.x_km), y: num(r.y_km) }));
  const ang = spawnAngle(R, players, ship.id);
  const id = crypto.randomUUID();
  const me = newShip({ id, side: 'players', base, x: R * Math.cos(ang), y: R * Math.sin(ang), endurance: pilot.bar, stance: 'economy', order: { kind: 'stop' }, cfg });
  const nowIso = new Date(nowMs).toISOString();
  const toInsert = (s, extra) => ({
    id: s.id, zone_id: zone.location_id, side: s.side, entered_at: nowIso, snap_at: nowIso,
    x_km: s.x, y_km: s.y, vx_kms: s.vx, vy_kms: s.vy, shield: s.shield, armor: s.armor, hull: s.hull, heat: 0, tripped: false,
    shutdown_until: null, ammo: s.ammo, target_id: null, order_kind: s.order.kind, order_at: nowIso, burn_stance: s.stance,
    modules: s.on, stats: s.base, endurance: s.endurance, drained: false, hold_km: null, ...extra,
  });
  const inserts = [toInsert(me, { ship_id: ship.id, drone_type: null })];

  // TEMPORARY (step 5 replaces it): an NPC-only zone with no drone in it gets ONE practice drone, opposite to me
  const hasDrone = (existing ?? []).some((r) => r.side === 'drones');
  if (loc && loc.pvp === false && !hasDrone) {
    const { data: dt } = await db.from('drone_types').select('*').eq('id', 'practice_drone').maybeSingle();
    if (dt) {
      const { data: dh } = await db.from('hulls').select('*').eq('id', dt.hull_id).maybeSingle();
      if (dh) {
        const dpilot = await pilotBlock(db, null, pilotCfg, t);
        const dbase = resolveBase({ hull: dh, rigs: await loadRigs(db, dt.rig_ids || []), skillFx: [], pilot: dpilot });
        const da = ang + Math.PI;
        const drone = newShip({ id: crypto.randomUUID(), side: 'drones', base: dbase, x: R * Math.cos(da), y: R * Math.sin(da), endurance: dpilot.bar, stance: 'economy', order: { kind: 'attack_opt' }, cfg });
        inserts.push(toInsert(drone, { ship_id: null, drone_type: dt.id }));
      }
    }
  }
  const { error: ie } = await db.from('combat_ships').insert(inserts);
  if (ie) throw ie;
  await db.from('combat_events').insert({ zone_id: zone.location_id, at: nowIso, kind: 'enter', actor_id: id, target_id: null, amount: null, note: null });
  return json(await buildView(db, ctx, ship.id));
}

// ---------- the three commands ----------
// Each works the fight forward to now FIRST, then changes my row, then answers with the new view.
async function command(db, user, apply) {
  const b = await begin(db, user); if (b.err) return b.err;
  const { ship, mine } = b;
  if (!mine) return refuse('not_in_zone', 'Your ship is not in a combat zone.');
  const ctx = await workZone(db, mine.zone_id, Date.now());
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
  const target = body.target ? String(body.target) : null;
  if (target && !UUID_RE.test(target)) return json({ error: 'bad_request' }, 400);
  return await command(db, user, async (row, ctx) => {
    const patch = { order_kind: kind, order_at: new Date().toISOString(), hold_km: kind === 'stop' || kind === 'flee' ? null : hold };
    if (hold != null && hold > num(ctx.zone.exit_radius_km)) return { err: refuse('bad_distance', 'That distance is larger than the zone.') };
    if (target) {
      const { data: t, error } = await db.from('combat_ships').select('id,side,zone_id').eq('id', target).maybeSingle();
      if (error) throw error;
      if (!t || t.zone_id !== row.zone_id || t.id === row.id) return { err: refuse('bad_target', 'That ship is not here any more.') };
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
    while (on.length < n) on.push(1);
    on[index] = body.on ? 1 : 0;
    const { error } = await db.from('combat_ships').update({ modules: on }).eq('id', row.id);
    if (error) throw error;
  });
}
