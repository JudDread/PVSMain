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
//   2. Leftover cargo (a failed trip) -> sell it here.
//   3. Empty hold -> ask SQL bot_candidates for the best trade to every other place, pick the one
//      with the most profit per game day of flight, BUY (trade_market), write the bot_trips row,
//      launch the flight (a scheduled_actions row + the ship's plan, the same as queue_travel).
// Arrival (docking) is done by the existing resolver (pg_cron, every minute).
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
  const sum = { at: new Date(t0).toISOString(), game_days: nowT, ready: 0, ran: 0, bought: 0, sold: 0, dumped: 0, idle: 0, failed_trips: 0, errors: [] };
  const note = (e) => { if (sum.errors.length < 8) sum.errors.push(String((e && e.message) || e)); };

  // Dock any ship whose trip is due (the cron does this every minute; doing it here keeps bots timely).
  const rr = await db.rpc('resolve_due_actions', {});
  if (rr.error) note('resolve: ' + rr.error.message);

  const { data: bots, error: be } = await db.from('characters').select('id,credits,active_ship_id').eq('is_bot', true);
  if (be) throw be;
  const shipIds = (bots ?? []).map(b => b.active_ship_id).filter(Boolean);
  if (shipIds.length) {
    const [rs, rt, rl] = await Promise.all([
      db.from('ships').select('id,character_id,state,location_id,hold_size').in('id', shipIds),
      db.from('bot_trips').select('*').eq('status', 'flying'),
      db.from('locations').select('*'),
    ]);
    if (rs.error) throw rs.error;
    if (rt.error) throw rt.error;
    if (rl.error) throw rl.error;
    const shipOf = {}; for (const s of rs.data ?? []) shipOf[s.id] = s;
    const tripOf = {}; for (const t of rt.data ?? []) tripOf[t.character_id] = t;
    const locById = {}; for (const l of rl.data ?? []) locById[l.id] = l;

    // Bots with a docked ship; those that can SELL come first.
    const ready = [];
    for (const b of bots ?? []) {
      const ship = shipOf[b.active_ship_id];
      if (ship && ship.state === 'docked') ready.push({ bot: b, ship, trip: tripOf[b.id] ?? null });
    }
    ready.sort((a, b) => (b.trip ? 1 : 0) - (a.trip ? 1 : 0));
    sum.ready = ready.length;

    const memo = {}; // flight plans shared by every bot in this turn
    for (const r of ready.slice(0, maxN)) {
      if (Date.now() - t0 > 90000) break; // stay well inside the function's time limit
      sum.ran++;
      try {
        await runBot(db, r.bot, r.ship, r.trip, locById, memo, nowT, g, sum);
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
  const { data, error } = await db.from('ship_cargo').select('good_id,quantity').eq('ship_id', shipId);
  if (error) throw error;
  return data ?? [];
}

async function runBot(db, bot, ship, trip, locById, memo, nowT, g, sum) {
  const here = locById[ship.location_id];
  if (!here) return;

  // 1. an open trip whose goods are at the sell place: sell and close the trip
  if (trip) {
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
    const r = await trade(db, bot.id, here.id, 'sell', c.good_id, c.quantity);
    if (r && r.ok) sum.dumped++;
  }
  if (left.length) left = await cargoOf(db, ship.id);
  if (left.length) { sum.idle++; return; } // cannot sell it here: try again next turn

  // 3. plan, buy, launch
  const { data: cands, error: cerr } = await db.rpc('bot_candidates', { p_character: bot.id, p_location: here.id });
  if (cerr) throw cerr;
  let pick = null, pickTrip = null, pickDest = null, best = 0;
  for (const c of cands ?? []) {
    const dest = locById[c.o_dest];
    if (!dest) continue;
    const t = tripFor(memo, here, dest, nowT, g);
    if (!t || !t.ok || !(t.days > 0)) continue;
    const score = Number(c.o_profit) / t.days; // profit per game day of flight
    if (score > best) { best = score; pick = c; pickTrip = t; pickDest = dest; }
  }
  if (!pick) { sum.idle++; return; }

  const buy = await trade(db, bot.id, here.id, 'buy', pick.o_good, Number(pick.o_qty));
  if (!buy || !buy.ok) { sum.idle++; note0(sum, 'buy ' + pick.o_good + ': ' + (buy && buy.error)); return; }
  sum.bought++;

  const r = pickTrip.r;
  const { data: row, error: te } = await db.from('bot_trips').insert({
    character_id: bot.id, ship_id: ship.id, good_id: pick.o_good, buy_location: here.id, sell_location: pickDest.id,
    quantity: Number(buy.quantity ?? pick.o_qty), cost: Number(buy.total), started_t: nowT, arrive_t: r.arriveT, status: 'flying',
    note: { expected_revenue: Number(pick.o_revenue), expected_profit: Number(pick.o_profit), g },
  }).select('id').single();
  if (te) throw te; // goods stay in the hold; the next turn sells them here

  const { data: action, error: ae } = await db.from('scheduled_actions').insert({
    character_id: bot.id, ship_id: ship.id, action_type: pickTrip.hop ? 'hop' : 'travel',
    payload: { from: here.id, to: pickDest.anchor_body, to_location: pickDest.id, departT: nowT, arriveT: r.arriveT, g, distance_au: r.distanceAU, pulse: null, xp_paid: true, bot: true },
    resolve_at: new Date(realMsAt(r.arriveT)).toISOString(),
  }).select('id').single();
  if (ae) {
    await db.from('bot_trips').update({ status: 'failed', finished_t: nowT, note: { problem: 'launch_failed' } }).eq('id', row.id).eq('status', 'flying');
    throw ae;
  }
  const { error: se } = await db.from('ships')
    .update({ state: pickTrip.hop ? 'hopping' : 'traveling', plan: r.plan, location_id: null })
    .eq('id', ship.id).eq('state', 'docked');
  if (se) {
    await db.from('scheduled_actions').update({ status: 'failed' }).eq('id', action.id);
    await db.from('bot_trips').update({ status: 'failed', finished_t: nowT, note: { problem: 'launch_failed' } }).eq('id', row.id).eq('status', 'flying');
    throw se;
  }
}

function note0(sum, text) { if (sum.errors.length < 8) sum.errors.push(text); }
