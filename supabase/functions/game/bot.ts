// @ts-nocheck
// ======================================================================
// "game" function: the BOT DRIVER (ALPHA PLAN step 2c).
// Invisible trading bots. Each bot is a real character (characters.is_bot) with one ship.
// A bot trades through the SAME SQL functions players use (trade_market, the same flight plans),
// so what it earns says something about what a player can earn.
//
// WHEN IT RUNS: lazily. index.ts calls kickBots() on every `me` request (any player's page asks
// `me` every 15 seconds). SQL bot_claim_tick says "yes" at most once per min_gap_s seconds and only
// while game_state 'bots'.paused is false; the work then runs in the background after the reply.
// So bots only move while somebody has the game open. No timer, no secret key.
//
// ONE TURN, for each bot whose ship is docked (at most max_per_tick bots per turn):
//   1. Open trip and the ship is at its sell place -> SELL the cargo (trade_market), close the trip
//      in bot_trips (revenue, profit, finished_t).
//   2. Leftover cargo (a failed trip) -> sell it here. 2026-11-10 (093 idea, no migration): if it
//      CANNOT be sold here, RESCUE: fly the cargo to a place that consumes it (see rescueCargo).
//   3. Empty hold -> ask SQL bot_balance for the trade, BUY (trade_market), write the bot_trips rows,
//      launch the flight (a scheduled_actions row + the ship's plan, the same as queue_travel).
// Arrival (docking) is done by the existing resolver (pg_cron, every minute).
// 2026-11-02 (092) BALANCING: step 3 no longer asks for the best profit. SQL bot_balance(place, floor, gap) takes the producer good HERE with the highest
// percent in stock (stock / target_stock), finds the place that consumes it with the LOWEST percent (goods that bots already have in flight to a place count as
// stock there, so bots do not herd), and lists every other producer good here that the same place also consumes. The bot loads them in that order until the hold
// is full, never taking a producer below `balance_floor` (0.5) of its target, and flies to that place. One bot_trips row per good, all for the same flight.
// Nothing to ship from here: the bot hops EMPTY to a random other market place. Settings (game_state 'bots'): balance_floor (default 0.5), balance_gap (default 0.1:
// the destination must be at least 10 percentage points lower than the source).
// Turn guard (042): SQL bot_claim_tick will not start a turn while the last one runs (busy mark, released in
// botTick's finally). Every change to a bot_trips row also says status = 'flying', so a late turn can never
// overwrite a trip another turn has already closed.
// Bots fly at the default 3 g (no endurance used): they measure a player who never pushes the thrust.
// Money rule: this file never changes credits itself; only trade_market does (and it logs them).
// Imports only physics_bundle.ts and common.ts (no circular imports).
// ======================================================================
import { gameDaysAt, realMsAt } from './physics_bundle.ts';
import { planTrip } from './common.ts';

// Pilot numbers for planTrip. At 3 g (the free thrust) the flight never pulses, so only freeG matters.
const BOT_P = { bar: 100, max: 100, freeG: 3, refill: 20, perG: 50, share: 0.5 };

// Called by index.ts on `me`. Never throws, never waits for the work when the runtime allows.
export function kickBots(db) {
  const p = botTick(db).catch((e) => console.error('bot tick failed', e));
  try {
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
  } catch (_) { /* best effort */ }
  return p;
}

// One bot turn for everybody. Returns the summary (null when it was not this turn's time or the bots are paused).
export async function botTick(db) {
  const t0 = Date.now();
  const { data: cfg, error: ce } = await db.rpc('bot_claim_tick', { p_now_ms: t0 });
  if (ce) throw ce;
  if (!cfg) return null;
  try {
    return await botTurn(db, cfg, t0);
  } finally {
    // lets the next turn start (SQL also frees the mark by itself after busy_max_s seconds)
    const rel = await db.rpc('bot_release_tick', {});
    if (rel.error) console.error('bot release failed', rel.error);
  }
}

async function botTurn(db, cfg, t0) {
  const nowT = gameDaysAt(t0);
  const maxN = Math.max(1, Math.floor(Number(cfg.max_per_tick) || 10));
  const g = Number(cfg.g) || 3;
  const sum = { at: new Date(t0).toISOString(), game_days: nowT, ready: 0, ran: 0, bought: 0, sold: 0, dumped: 0, rescued: 0, idle: 0, failed_trips: 0, errors: [] };
  const note = (e) => { if (sum.errors.length < 8) sum.errors.push(String((e && e.message) || e)); };

  // Dock any ship whose trip is due (the cron does this every minute; doing it here keeps bots timely).
  const rr = await db.rpc('resolve_due_actions', {});
  if (rr.error) note('resolve: ' + rr.error.message);

  const { data: bots, error: be } = await db.from('characters').select('id,credits,active_ship_id').eq('is_bot', true);
  if (be) throw be;
  const shipIds = (bots ?? []).map(b => b.active_ship_id).filter(Boolean);
  if (shipIds.length) {
    const [rs, rt, rl, rm] = await Promise.all([
      db.from('ships').select('id,character_id,state,location_id,hold_size').in('id', shipIds),
      db.from('bot_trips').select('*').eq('status', 'flying'),
      db.from('locations').select('*').eq('hidden', false),   // 059: bots never see hidden places
      db.from('markets').select('location_id'),
    ]);
    if (rs.error) throw rs.error;
    if (rt.error) throw rt.error;
    if (rl.error) throw rl.error;
    if (rm.error) throw rm.error;
    const shipOf = {}; for (const s of rs.data ?? []) shipOf[s.id] = s;
    const tripsOf = {}; for (const t of rt.data ?? []) { if (!tripsOf[t.character_id]) tripsOf[t.character_id] = []; tripsOf[t.character_id].push(t); }   // 092: one row per good
    const locById = {}; for (const l of rl.data ?? []) locById[l.id] = l;
    const marketIds = [...new Set((rm.data ?? []).map((x) => x.location_id))].filter((id) => locById[id]);   // places with a market that bots may see

    // Bots with a docked ship; those that can SELL come first.
    const ready = [];
    for (const b of bots ?? []) {
      const ship = shipOf[b.active_ship_id];
      if (ship && ship.state === 'docked') ready.push({ bot: b, ship, trips: tripsOf[b.id] ?? [] });
    }
    ready.sort((a, b) => (b.trips.length ? 1 : 0) - (a.trips.length ? 1 : 0));
    sum.ready = ready.length;

    const memo = {}; // flight plans shared by every bot in this turn
    for (const r of ready.slice(0, maxN)) {
      if (Date.now() - t0 > 90000) break; // stay well inside the function's time limit
      sum.ran++;
      try {
        await runBot(db, r.bot, r.ship, r.trips, locById, memo, nowT, g, sum, cfg, marketIds);
      } catch (e) {
        console.error('bot failed', r.bot.id, e);
        note(e);
      }
    }
  }

  sum.ms = Date.now() - t0;
  await db.from('game_state').upsert({ key: 'bots_last', value: sum }); // what the last turn did (read it with SQL)
  return sum;
}

// A flight plan between two places, planned ONCE per turn and shared by every bot (same departure time).
function tripFor(memo, from, to, nowT, g) {
  const key = from.anchor_body === to.anchor_body ? 'hop|' + from.id + '|' + to.id : 'b|' + from.anchor_body + '|' + to.anchor_body;
  if (!(key in memo)) memo[key] = planTrip(from, to, nowT, g, BOT_P, {});
  return memo[key];
}

async function trade(db, botId, loc, kind, good, qty) {
  const { data, error } = await db.rpc('trade_market', { p_character: botId, p_location: loc, p_kind: kind, p_good: good, p_quantity: qty, p_stack: 'cargo' });
  if (error) throw error;
  return data;
}

async function cargoOf(db, shipId) {
  const { data, error } = await db.from('ship_cargo').select('good_id,quantity,avg_cost').eq('ship_id', shipId);
  if (error) throw error;
  return data ?? [];
}

async function runBot(db, bot, ship, trips, locById, memo, nowT, g, sum, cfg, marketIds) {
  const here = locById[ship.location_id];
  if (!here) return;

  // 1. open trips (one row per good, all for the same flight): at the sell place sell each good and close its row
  for (const trip of trips) {
    if (ship.location_id === trip.sell_location) {
      const c = (await cargoOf(db, ship.id)).find(x => x.good_id === trip.good_id);
      if (c && c.quantity > 0) {
        const r = await trade(db, bot.id, here.id, 'sell', trip.good_id, c.quantity);
        if (r && r.ok) {
          const revenue = Number(r.total);
          const { error } = await db.from('bot_trips').update({ revenue, profit: Math.round((revenue - Number(trip.cost)) * 100) / 100, finished_t: nowT, status: 'sold' }).eq('id', trip.id).eq('status', 'flying');
          if (error) throw error;
          sum.sold++;
        } else {
          await db.from('bot_trips').update({ status: 'failed', finished_t: nowT, note: { ...(trip.note ?? {}), sell_failed: r && r.error } }).eq('id', trip.id).eq('status', 'flying');
          sum.failed_trips++;
        }
      } else {
        await db.from('bot_trips').update({ status: 'failed', finished_t: nowT, note: { ...(trip.note ?? {}), problem: 'no_cargo' } }).eq('id', trip.id).eq('status', 'flying');
        sum.failed_trips++;
      }
    } else {
      // docked somewhere else than planned (should not happen): close the trip, the goods are dumped below
      await db.from('bot_trips').update({ status: 'failed', finished_t: nowT, note: { ...(trip.note ?? {}), problem: 'docked_elsewhere' } }).eq('id', trip.id).eq('status', 'flying');
      sum.failed_trips++;
    }
  }

  // 2. leftover cargo (a failed trip): sell it here so the hold is empty
  let left = await cargoOf(db, ship.id);
  for (const c of left) {
    try {
      const r = await trade(db, bot.id, here.id, 'sell', c.good_id, c.quantity);
      if (r && r.ok) sum.dumped++;
    } catch (e) { note0(sum, 'dump ' + c.good_id + ': ' + ((e && e.message) || e)); }   // one bad good must not freeze the bot
  }
  if (left.length) left = await cargoOf(db, ship.id);
  if (left.length) {
    // 2b. cannot sell it here: do not wait, MOVE (fly the cargo to a place that buys it)
    await rescueCargo(db, bot, ship, here, left, locById, memo, nowT, g, sum, marketIds);
    return;
  }

  // 3. BALANCE (092): the producer good here with the highest percent in stock goes to the place with the lowest percent
  const floor = Number(cfg.balance_floor ?? 0.5), gap = Number(cfg.balance_gap ?? 0.1);
  const { data: plan, error: perr } = await db.rpc('bot_balance', { p_location: here.id, p_floor: floor, p_gap: gap });
  if (perr) throw perr;
  const list = plan ?? [];
  const dest = list.length ? locById[list[0].o_dest] : null;
  const tp = dest ? tripFor(memo, here, dest, nowT, g) : null;
  if (!dest || !tp || !tp.ok || !(tp.days > 0)) {
    // nothing to ship from here (or no flight to that place): hop EMPTY to a random other market place
    const others = (marketIds ?? []).filter((id) => id !== here.id);
    if (!others.length) { sum.idle++; return; }
    const w = locById[others[Math.floor(Math.random() * others.length)]];
    const wt = w ? tripFor(memo, here, w, nowT, g) : null;
    if (!wt || !wt.ok || !(wt.days > 0)) { sum.idle++; return; }
    await launch(db, bot, ship, here, w, wt, nowT, g, []);
    sum.hopped = (sum.hopped || 0) + 1;
    return;
  }

  // load the goods in order (highest percent first) while the hold and the credits allow; the floor limits each good
  const bought = [];
  for (const c of list) {
    const { data: q, error: qe } = await db.rpc('market_quote', { p_character: bot.id, p_location: here.id, p_kind: 'buy', p_good: c.o_good, p_quantity: null, p_stack: 'cargo' });
    if (qe) throw qe;
    const maxq = Math.floor(Number(q && q.max_quantity) || 0);
    if (maxq < 1) break;                                           // the hold (or the credits) are full
    const take = Math.min(maxq, Math.floor(Number(c.o_avail)));
    if (take < 1) continue;
    const buy = await trade(db, bot.id, here.id, 'buy', c.o_good, take);
    if (!buy || !buy.ok) { note0(sum, 'buy ' + c.o_good + ': ' + (buy && buy.error)); continue; }
    sum.bought++;
    bought.push({ c, buy, qty: Number(buy.quantity ?? take) });
  }
  if (!bought.length) { sum.idle++; return; }

  const r = tp.r, ids = [];
  for (const b of bought) {
    const { data: row, error: te } = await db.from('bot_trips').insert({
      character_id: bot.id, ship_id: ship.id, good_id: b.c.o_good, buy_location: here.id, sell_location: dest.id,
      quantity: b.qty, cost: Number(b.buy.total), started_t: nowT, arrive_t: r.arriveT, status: 'flying',
      note: { balance: true, src_pct: Number(b.c.o_pct), dest_pct: Number(b.c.o_dest_pct), g },
    }).select('id').single();
    if (te) throw te; // goods stay in the hold; the next turn sells them here
    ids.push(row.id);
  }
  await launch(db, bot, ship, here, dest, tp, nowT, g, ids);
}

// RESCUE (2026-11-10): the bot sits at a place with goods it cannot sell there. It flies to the OTHER place that
// consumes the most of those goods (ties: the shortest flight), with one bot_trips row per good that place
// consumes (cost = what the bot paid, or 0 when unknown; note.rescue = true), so the normal step 1 sells them on arrival.
// A good that no reachable place consumes still rides along. When no place fits at all, the bot hops to a random market place.
async function rescueCargo(db, bot, ship, here, left, locById, memo, nowT, g, sum, marketIds) {
  const { data: mk, error: me } = await db.from('markets').select('location_id,good_id').eq('role', 'consumer').in('good_id', left.map((c) => c.good_id));
  if (me) throw me;
  const takes = {};   // place id -> set of leftover goods that place consumes
  for (const m of mk ?? []) {
    if (m.location_id === here.id || !locById[m.location_id]) continue;
    if (!takes[m.location_id]) takes[m.location_id] = new Set();
    takes[m.location_id].add(m.good_id);
  }
  let best = null;
  for (const id of Object.keys(takes)) {
    const tp = tripFor(memo, here, locById[id], nowT, g);
    if (!tp || !tp.ok || !(tp.days > 0)) continue;
    const n = takes[id].size;
    if (!best || n > best.n || (n === best.n && tp.days < best.tp.days)) best = { id, n, tp };
  }
  if (!best) {
    // no place buys these goods (or no flight): hop to a random market place with the cargo and try again there
    const others = (marketIds ?? []).filter((id) => id !== here.id);
    if (!others.length) { sum.idle++; return; }
    const w = locById[others[Math.floor(Math.random() * others.length)]];
    const wt = w ? tripFor(memo, here, w, nowT, g) : null;
    if (!wt || !wt.ok || !(wt.days > 0)) { sum.idle++; return; }
    await launch(db, bot, ship, here, w, wt, nowT, g, []);
    sum.rescued++;
    return;
  }
  const dest = locById[best.id], r = best.tp.r, ids = [];
  for (const c of left) {
    if (!takes[best.id].has(c.good_id)) continue;
    const cost = c.avg_cost != null ? Math.round(Number(c.avg_cost) * Number(c.quantity) * 100) / 100 : 0;
    const { data: row, error: te } = await db.from('bot_trips').insert({
      character_id: bot.id, ship_id: ship.id, good_id: c.good_id, buy_location: here.id, sell_location: dest.id,
      quantity: c.quantity, cost, started_t: nowT, arrive_t: r.arriveT, status: 'flying',
      note: { rescue: true, g },
    }).select('id').single();
    if (te) throw te;
    ids.push(row.id);
  }
  await launch(db, bot, ship, here, dest, best.tp, nowT, g, ids);
  sum.rescued++;
}

// Start the flight: a scheduled action (the existing resolver docks the ship) and the ship's plan. tripIds = the bot_trips rows to mark failed if the launch fails.
async function launch(db, bot, ship, here, dest, tp, nowT, g, tripIds) {
  const r = tp.r;
  const failTrips = async () => {
    if (tripIds.length) await db.from('bot_trips').update({ status: 'failed', finished_t: nowT, note: { problem: 'launch_failed' } }).in('id', tripIds).eq('status', 'flying');
  };
  const { data: action, error: ae } = await db.from('scheduled_actions').insert({
    character_id: bot.id, ship_id: ship.id, action_type: tp.hop ? 'hop' : 'travel',
    payload: { from: here.id, to: dest.anchor_body, to_location: dest.id, departT: nowT, arriveT: r.arriveT, g, distance_au: r.distanceAU, pulse: null, xp_paid: true, bot: true },
    resolve_at: new Date(realMsAt(r.arriveT)).toISOString(),
  }).select('id').single();
  if (ae) { await failTrips(); throw ae; }
  const { error: se } = await db.from('ships')
    .update({ state: tp.hop ? 'hopping' : 'traveling', plan: r.plan, location_id: null })
    .eq('id', ship.id).eq('state', 'docked');
  if (se) {
    await db.from('scheduled_actions').update({ status: 'failed' }).eq('id', action.id);
    await failTrips();
    throw se;
  }
}

function note0(sum, text) { if (sum.errors.length < 8) sum.errors.push(text); }
