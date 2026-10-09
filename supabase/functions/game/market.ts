// @ts-nocheck
// ======================================================================
// "game" function: MARKET code (routes, cargo routes, storage, market, trade, quote).
// Moved out of index.ts in step 1.5(b); the code itself is unchanged.
// ======================================================================
import { CLOCK, gameDaysAt } from './physics_bundle.ts';
import { json, getCharacter, getLocation, resolveFor, getShip, loadCargo, storageAt, estimateTrip, LOC_RE, r2s } from './common.ts';

// "routes": body = { good: 'water_ice', location?: 'luna' }. If I bought this good at the ORIGIN and flew to each other
// place that trades it, what would I make? The origin is `location` when given (the market I am looking at), otherwise
// the place my ship is docked at. Trips are measured from the ORIGIN (where the goods are). When my ship is not docked at
// the origin, the buy price includes the remote fee (same price the Market screen shows). Read-only. Today's prices and ETA.
export async function routes(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const good = String(body.good ?? '');
  if (!/^[a-z0-9_]{1,64}$/.test(good)) return json({ error: 'unknown_good' }, 400);
  const explicit = body.location != null && body.location !== '';
  if (explicit && !LOC_RE.test(String(body.location))) return json({ error: 'unknown_location' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'no_ship' }, 400);
  const docked = ship.state === 'docked';
  const originId = explicit ? String(body.location) : (docked ? ship.location_id : null);
  if (!originId) return json({ ok: true, docked: false, rows: [] });
  const remote = !(docked && ship.location_id === originId);

  const { data: gd, error: ge } = await db.from('goods').select('id,name,unit,hold_per_unit').eq('id', good).maybeSingle();
  if (ge) throw ge;
  if (!gd) return json({ error: 'unknown_good' }, 400);
  const per = Number(gd.hold_per_unit);
  const { hold_used } = await loadCargo(db, ship);
  const r2 = n => Math.round(n * 100) / 100;
  // Most you could buy at the origin (market stock + credits): asked of the server (market_quote, quantity 0).
  const { data: q0, error: qe0 } = await db.rpc('market_quote', { p_character: ch.id, p_location: originId, p_kind: 'buy', p_good: good, p_quantity: 0, p_stack: 'storage' });
  if (qe0) throw qe0;
  if (!q0 || !q0.ok) return json({ error: (q0 && q0.error) || 'no_market' }, 400);
  const holdCap = Math.max(0, Math.floor((Number(ship.hold_size) - hold_used + 1e-9) / per));
  const maxLoad = Math.max(0, Math.min(Number(q0.max_quantity), holdCap));
  const qty = maxLoad > 0 ? maxLoad : 1; // nothing affordable: rank by a single unit and say so
  // What the WHOLE load costs to buy (price rises as you buy; remote fee included when the ship is not docked there).
  const { data: q1, error: qe1 } = await db.rpc('market_quote', { p_character: ch.id, p_location: originId, p_kind: 'buy', p_good: good, p_quantity: qty, p_stack: 'storage' });
  if (qe1) throw qe1;
  if (!q1 || !q1.ok || q1.total == null) return json({ error: (q1 && q1.error) || 'no_market' }, 400);
  const buyTotal = Number(q1.total), buyAvg = Number(q1.unit_price);

  const from = await getLocation(db, originId);
  if (!from) return json({ error: explicit ? 'unknown_location' : 'bad_origin' }, 400);
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  // What the WHOLE load would sell for at every other place (price falls as you sell; no remote fee at destinations).
  const { data: lots, error: le2 } = await db.rpc('market_sell_lots', { p_character: ch.id, p_good: good, p_quantity: qty, p_origin: originId });
  if (le2) throw le2;
  const departT = gameDaysAt(Date.now()), g = Number(ship.thrust_g), cache = {};
  const rows = [];
  for (const p of lots ?? []) {
    if (p.location_id === originId) continue;
    const to = (locs ?? []).find(l => l.id === p.location_id);
    if (!to) continue;
    const est = estimateTrip(from, to, departT, g, cache);
    if (!est.ok) continue;
    const etaMin = est.days * 1440 / CLOCK.scale;
    const total = r2(Number(p.total) - buyTotal);
    const unit = r2(Number(p.avg_price) - buyAvg);
    rows.push({
      location_id: p.location_id, name: p.location_name, anchor_body: to.anchor_body,
      sell_price: Number(p.avg_price), stock: r2(Number(p.stock)), target_stock: r2(Number(p.target_stock)),
      eta_real_minutes: etaMin, sun_danger: est.sun_danger,
      profit_each: unit, profit_load: total, ppm: etaMin > 0 ? r2(total / etaMin) : 0,
    });
  }
  rows.sort((a, b) => b.ppm - a.ppm);
  return json({
    ok: true, docked, origin_id: originId, remote, good_id: good, name: gd.name, unit: gd.unit,
    buy_here: buyAvg, buy_total: buyTotal, max_load: maxLoad, load_used: qty, hypothetical: maxLoad === 0, rows,
  });
}

// ---- cargo selling options (used by "cargo_routes" and "cargo_dest") ----
// For ONE carried good: every place that trades it, with what the whole stack would sell for there.
// Cost = what I paid (avg_cost) when known, so profit is real. If the cost is unknown (bought before
// migration 009) cost_known is false and the figures are INCOME (sell price x quantity), not profit.
// The place I am docked at is included (is_here, no travel time, ppm null). Uses today's prices and ETA.
async function cargoOptions(db, ch, ship, from, locs, c, cache, departT) {
  const qty = Math.floor(Number(c.quantity));
  if (!(qty >= 1)) return [];
  // price of the WHOLE stack at every place that trades it (the place where the goods are carries the remote fee if the ship is not docked there)
  const { data: prices, error: pe } = await db.rpc('market_sell_lots', { p_character: ch.id, p_good: c.good_id, p_quantity: qty, p_origin: from.id });
  if (pe) throw pe;
  const known = c.avg_cost != null, g = Number(ship.thrust_g);
  const rows = [];
  for (const p of prices ?? []) {
    const here = p.location_id === from.id; // the place the goods ARE (hold: where the ship is docked; storage: that location)
    const to = (locs ?? []).find(l => l.id === p.location_id);
    if (!to) continue;
    let etaMin = 0, sun = false;
    if (!here) {
      const est = estimateTrip(from, to, departT, g, cache);
      if (!est.ok) continue;
      etaMin = est.days * 1440 / CLOCK.scale; sun = est.sun_danger;
    }
    const sell = Number(p.avg_price); // average price per unit over the whole stack
    const total = r2s(Number(p.total) - (known ? c.avg_cost * qty : 0));
    const each = r2s(total / qty);
    rows.push({
      location_id: p.location_id, name: p.location_name, anchor_body: to.anchor_body, is_here: here,
      sell_price: sell, stock: r2s(Number(p.stock)), target_stock: r2s(Number(p.target_stock)),
      eta_real_minutes: etaMin, sun_danger: sun, profit_each: each, profit_total: total,
      ppm: here ? null : (etaMin > 0 ? r2s(total / etaMin) : 0),
    });
  }
  return rows;
}
// "Best": if HERE pays the highest price of all, here wins. Otherwise the other place with the best profit per minute.
function pickBest(rows) {
  const here = rows.find(r => r.is_here);
  const others = rows.filter(r => !r.is_here);
  let bestOther = null, topPrice = 0;
  for (const r of others) {
    if (!bestOther || r.ppm > bestOther.ppm) bestOther = r;
    if (r.sell_price > topPrice) topPrice = r.sell_price;
  }
  if (here && (!bestOther || here.sell_price >= topPrice)) return here;
  return bestOther;
}
// body.source: 'hold' (default: what the docked ship carries, measured from where it is docked)
//              'storage' + body.location: what I keep at that location, measured from THAT location (where the goods are).
async function cargoPrelude(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return { resp: json({ error: 'no_character' }, 400) };
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return { resp: json({ error: 'no_ship' }, 400) };
  const docked = ship.state === 'docked';
  const source = body && body.source === 'storage' ? 'storage' : 'hold';
  let originId, stacks;
  if (source === 'storage') {
    originId = String(body.location ?? '');
    if (!LOC_RE.test(originId)) return { resp: json({ error: 'unknown_location' }, 400) };
    stacks = await storageAt(db, ch.id, originId);
  } else {
    if (!docked) return { resp: json({ ok: true, docked: false, items: [], rows: [] }) };
    originId = ship.location_id;
    stacks = (await loadCargo(db, ship)).cargo;
  }
  const from = await getLocation(db, originId);
  if (!from) return { resp: json({ error: source === 'storage' ? 'unknown_location' : 'bad_origin' }, 400) };
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  const remote = !(docked && ship.location_id === originId);
  return { ch, ship, from, cargo: stacks, locs, departT: gameDaysAt(Date.now()), cache: {}, source, remote, docked };
}

// "cargo_routes": for each good in my hold (or in storage at body.location), the best place to sell the whole stack.
export async function cargoRoutes(db, user, body) {
  const x = await cargoPrelude(db, user, body || {});
  if (x.resp) return x.resp;
  const items = [];
  for (const c of x.cargo) {
    const rows = await cargoOptions(db, x.ch, x.ship, x.from, x.locs, c, x.cache, x.departT);
    items.push({ good_id: c.good_id, name: c.name, unit: c.unit, quantity: c.quantity, avg_cost: c.avg_cost,
      cost_known: c.avg_cost != null, best: pickBest(rows) });
  }
  return json({ ok: true, docked: x.docked, source: x.source, location_id: x.from.id, remote: x.remote, items });
}

// "cargo_dest": body = { good, source?, location? }. The destinations list for ONE stack: every place that trades it,
// the place where the goods are first (is_here), then the others by profit per minute (best first).
export async function cargoDest(db, user, body) {
  const good = String(body.good ?? '');
  if (!/^[a-z0-9_]{1,64}$/.test(good)) return json({ error: 'unknown_good' }, 400);
  const x = await cargoPrelude(db, user, body);
  if (x.resp) return x.resp;
  const c = x.cargo.find(k => k.good_id === good);
  if (!c) return json({ error: x.source === 'storage' ? 'not_in_storage' : 'not_in_cargo' }, 400);
  const rows = await cargoOptions(db, x.ch, x.ship, x.from, x.locs, c, x.cache, x.departT);
  rows.sort((p, q) => (p.is_here ? -1 : q.is_here ? 1 : q.ppm - p.ppm));
  return json({ ok: true, docked: x.docked, source: x.source, location_id: x.from.id, remote: x.remote, good_id: good, name: c.name, unit: c.unit,
    quantity: c.quantity, avg_cost: c.avg_cost, cost_known: c.avg_cost != null, rows });
}

// ---------- storage (Module 5 step 1; migration 010) ----------
// Goods a character keeps AT A LOCATION, separate from the ship's hold. The maths lives in the database
// (storage_load / storage_unload); the server only checks who is asking and passes the result on.

// "storage": everything I keep, at every location, plus my hold and where my ship is. Read-only.
export async function storageView(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'no_ship' }, 400);
  const { cargo, hold_used } = await loadCargo(db, ship);
  const docked = ship.state === 'docked';
  const out = {
    ok: true, docked, location_id: docked ? ship.location_id : null, location_name: null,
    hold_size: Number(ship.hold_size), hold_used, cargo, items: [],
  };
  if (docked) { const loc = await getLocation(db, ship.location_id); out.location_name = loc ? loc.name : ship.location_id; }
  const { data: rows, error } = await db.from('storage').select('location_id,good_id,quantity,avg_cost').eq('character_id', ch.id);
  if (error) throw error;
  if (!rows || !rows.length) return json(out);
  const gIds = [...new Set(rows.map(r => r.good_id))], lIds = [...new Set(rows.map(r => r.location_id))];
  const [gr, lr] = await Promise.all([
    db.from('goods').select('id,name,unit,hold_per_unit').in('id', gIds),
    db.from('locations').select('id,name').in('id', lIds),
  ]);
  if (gr.error) throw gr.error;
  if (lr.error) throw lr.error;
  out.items = rows.map(r => {
    const g = (gr.data ?? []).find(x => x.id === r.good_id) || {};
    const l = (lr.data ?? []).find(x => x.id === r.location_id) || {};
    return {
      location_id: r.location_id, location_name: l.name ?? r.location_id, is_here: docked && r.location_id === ship.location_id,
      good_id: r.good_id, name: g.name ?? r.good_id, unit: g.unit ?? 'unit', hold_per_unit: Number(g.hold_per_unit ?? 1),
      quantity: r.quantity, avg_cost: r.avg_cost == null ? null : Number(r.avg_cost),
    };
  });
  out.items.sort((a, b) => (b.is_here - a.is_here) || a.location_name.localeCompare(b.location_name) || a.name.localeCompare(b.name));
  return json(out);
}

// "load" / "unload": body = { good: 'water_ice', quantity: 10 }. Whole units only. Needs the ship docked.
export async function storageMove(db, user, body, kind) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const good = String(body.good ?? '');
  const qty = Number(body.quantity);
  if (!/^[a-z0-9_]{1,64}$/.test(good)) return json({ error: 'unknown_good' }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) return json({ error: 'bad_quantity' }, 400);
  await resolveFor(db, ch.id); // a ship that has just arrived can load at once
  const { data, error } = await db.rpc(kind === 'load' ? 'storage_load' : 'storage_unload', { p_character: ch.id, p_good: good, p_quantity: qty });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}

// "market_at": body = { location: 'luna' }. Everything the Market screen needs for ONE location:
// that market's goods (prices include the remote fee when my ship is not docked there), my storage there,
// and my cargo (only when my ship is docked there). Read-only.
export async function marketAt(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const locId = String(body.location ?? '');
  if (!LOC_RE.test(locId)) return json({ error: 'unknown_location' }, 400);
  const loc = await getLocation(db, locId);
  if (!loc) return json({ error: 'unknown_location' }, 400);
  await resolveFor(db, ch.id);
  const ship = await getShip(db, ch.id);
  if (!ship) return json({ error: 'no_ship' }, 400);
  const { cargo, hold_used } = await loadCargo(db, ship);
  const docked = ship.state === 'docked';
  const here = docked && ship.location_id === locId;

  const { data: mv, error: mvErr } = await db.rpc('market_view_at', { p_character: ch.id, p_location: locId });
  if (mvErr) throw mvErr;
  const goods = ((mv && mv.goods) || []).map(g => ({
    good_id: g.good_id, name: g.name, category: g.category, unit: g.unit,
    hold_per_unit: Number(g.hold_per_unit), target_stock: r2s(Number(g.target_stock)), stock: r2s(Number(g.stock)),
    mid_price: r2s(Number(g.mid_price)), buy_price: Number(g.buy_price), sell_price: Number(g.sell_price),
  }));

  // my storage at this location
  const storage = await storageAt(db, ch.id, locId);

  // what each of my stacks would sell for here, and the profit against what I paid
  const r2 = n => Math.round(n * 100) / 100;
  const myCargo = here ? cargo : [];
  // each stack: what the WHOLE stack would sell for here (server quote, remote fee included), average price per unit, profit
  for (const [list, stackName] of [[myCargo, 'cargo'], [storage, 'storage']]) {
    for (const c of list) {
      c.sell_here = null; c.profit_each = null; c.profit_total = null;
      const q = Math.floor(Number(c.quantity));
      if (!(q >= 1)) continue;
      const { data: qs, error: qerr } = await db.rpc('market_quote', { p_character: ch.id, p_location: locId, p_kind: 'sell', p_good: c.good_id, p_quantity: q, p_stack: stackName });
      if (qerr) throw qerr;
      if (!qs || !qs.ok || qs.total == null) continue;
      c.sell_here = Number(qs.unit_price);
      if (c.avg_cost != null) {
        c.profit_total = r2(Number(qs.total) - c.avg_cost * c.quantity);
        c.profit_each = r2(c.profit_total / c.quantity);
      }
    }
  }

  // which locations have a market at all (for the location box)
  const { data: mk, error: me2 } = await db.from('markets').select('location_id');
  if (me2) throw me2;
  const market_ids = [...new Set((mk ?? []).map(r => r.location_id))];

  return json({
    ok: true, location_id: locId, location_name: loc.name, docked, here,
    ship_location_id: docked ? ship.location_id : null,
    remote_fee: Number((mv && mv.remote_fee) ?? 0), credits: Number(ch.credits),
    hold_size: Number(ship.hold_size), hold_used, cargo: myCargo, storage, goods, market_ids,
  });
}

// "trade_at": body = { location, kind: 'buy'|'sell', good, quantity, stack: 'storage'|'cargo' }.
// buy: stack = where the goods go. sell: stack = where they come from. 'cargo' needs the ship docked at that location.
export async function tradeAt(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const loc = String(body.location ?? ''), good = String(body.good ?? '');
  const kind = body.kind, stack = body.stack, qty = Number(body.quantity);
  if (!LOC_RE.test(loc)) return json({ error: 'unknown_location' }, 400);
  if (!LOC_RE.test(good)) return json({ error: 'unknown_good' }, 400);
  if (kind !== 'buy' && kind !== 'sell') return json({ error: 'bad_request' }, 400);
  if (stack !== 'storage' && stack !== 'cargo') return json({ error: 'bad_request' }, 400);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) return json({ error: 'bad_quantity' }, 400);
  await resolveFor(db, ch.id);
  const { data, error } = await db.rpc('trade_market', { p_character: ch.id, p_location: loc, p_kind: kind, p_good: good, p_quantity: qty, p_stack: stack });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}

// "quote": body = { location, kind: 'buy'|'sell', good, quantity (0 = just the maximum), stack: 'storage'|'cargo' }.
// Read-only. Asks SQL market_quote: the exact total and average price for that quantity (same maths as trade_at),
// plus the most you can buy / sell (max_quantity) and what limits it. Nothing is traded.
export async function quote(db, user, body) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  const loc = String(body.location ?? ''), good = String(body.good ?? '');
  const kind = body.kind, stack = body.stack, qty = Number(body.quantity ?? 0);
  if (!LOC_RE.test(loc)) return json({ error: 'unknown_location' }, 400);
  if (!LOC_RE.test(good)) return json({ error: 'unknown_good' }, 400);
  if (kind !== 'buy' && kind !== 'sell') return json({ error: 'bad_request' }, 400);
  if (stack !== 'storage' && stack !== 'cargo') return json({ error: 'bad_request' }, 400);
  if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) return json({ error: 'bad_quantity' }, 400);
  await resolveFor(db, ch.id);
  const { data, error } = await db.rpc('market_quote', { p_character: ch.id, p_location: loc, p_kind: kind, p_good: good, p_quantity: qty, p_stack: stack });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}

// "unload_all": move everything in the hold into storage where the ship is docked.
export async function unloadAll(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return json({ error: 'no_character' }, 400);
  await resolveFor(db, ch.id);
  const { data, error } = await db.rpc('storage_unload_all', { p_character: ch.id });
  if (error) throw error;
  return json(data, data && data.ok ? 200 : 400);
}
