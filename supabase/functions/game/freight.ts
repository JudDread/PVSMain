// @ts-nocheck
// ======================================================================
// "game" function: FREIGHT code (post, cancel, board, accept, abandon, lists).
// Moved out of index.ts in step 1.5(b); the code itself is unchanged.
// ======================================================================
import { CLOCK, gameDaysAt } from './physics_bundle.ts';
import { json, getCharacter, getLocation, resolveFor, getShip, estimateTrip, LOC_RE, UUID_RE } from './common.ts';

// ---------- freight contracts (migrations 020/021) ----------
// All money and goods maths lives in the database (freight_* functions). The server: checks who is asking,
// works out game time and the delivery WINDOW per destination (trip time at the reference thrust x a factor),
// calls the SQL, and passes the answer on. Delivery and expiry are resolved LAZILY: freightResolve runs at the
// start of every freight action and in `me`.

async function freightSettings(db) {
  const { data, error } = await db.from('game_state').select('value').eq('key', 'freight').maybeSingle();
  if (error) throw error;
  const v = data?.value ?? {};
  const num = (x, d) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : d);
  return {
    window_factor: num(v.window_factor, 1.5),
    reference_thrust_g: num(v.reference_thrust_g, 1),
    min_window_days: num(v.min_window_days, 0.416667),
    bonus_full_fraction: num(v.bonus_full_fraction, 0.5),
  };
}

// Window (GAME days) for freight from `from` to `to`: trip time at the reference thrust x factor, never below the minimum.
// Returns null when no trip can be planned. The SQL enforces the minimum again.
function freightWindow(fs, from, to, nowT, cache) {
  const est = estimateTrip(from, to, nowT, fs.reference_thrust_g, cache);
  if (!est.ok) return null;
  return Math.max(fs.min_window_days, est.days * fs.window_factor);
}

// Settle freight that has arrived (delivered) or run out of time (failed). `strict` = throw on an SQL error.
export async function freightResolve(db, characterId, strict = true) {
  const { error } = await db.rpc('freight_resolve_due', { p_now_t: gameDaysAt(Date.now()), p_character: characterId });
  if (error) {
    if (strict) throw error;
    console.error('freight resolve failed', error);
  }
}

// Common start of every freight action: who is asking, settle trips, settle freight.
async function freightStart(db, user) {
  const ch = await getCharacter(db, user);
  if (!ch) return { resp: json({ error: 'no_character' }, 400) };
  await resolveFor(db, ch.id);
  await freightResolve(db, ch.id);
  return { ch };
}
const freightAnswer = (data) => json(data, data && data.ok ? 200 : 400);

// "freight_post": body = { good, pickup, dest, units, price }. price = credits per unit paid to the hauler.
export async function freightPost(db, user, body) {
  const good = String(body.good ?? ''), pickup = String(body.pickup ?? ''), dest = String(body.dest ?? '');
  const units = Number(body.units), price = Number(body.price);
  if (!LOC_RE.test(good)) return json({ error: 'unknown_good' }, 400);
  if (!LOC_RE.test(pickup) || !LOC_RE.test(dest)) return json({ error: 'unknown_location' }, 400);
  if (!Number.isInteger(units) || units < 1 || units > 1000000) return json({ error: 'bad_quantity' }, 400);
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) return json({ error: 'bad_price' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc('freight_post', { p_character: x.ch.id, p_good: good, p_pickup: pickup, p_dest: dest, p_units: units, p_price: price });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_cancel": body = { contract }.
export async function freightCancel(db, user, body) {
  const contract = String(body.contract ?? '');
  if (!UUID_RE.test(contract)) return json({ error: 'contract_not_found' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc('freight_cancel', { p_character: x.ch.id, p_contract: contract });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_board": body = { location? }. The hauler's list at a pickup (default: where my ship is docked).
// The server sends the window for every destination, measured from the pickup.
export async function freightBoard(db, user, body) {
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  let locId = body && body.location != null && body.location !== '' ? String(body.location) : null;
  if (!locId) {
    const ship = await getShip(db, x.ch.id);
    if (!ship) return json({ error: 'no_ship' }, 400);
    if (ship.state !== 'docked') return json({ ok: true, docked: false, location_id: null, items: [] });
    locId = ship.location_id;
  }
  if (!LOC_RE.test(locId)) return json({ error: 'unknown_location' }, 400);
  const from = await getLocation(db, locId);
  if (!from) return json({ error: 'unknown_location' }, 400);
  const fs = await freightSettings(db);
  const { data: locs, error: le } = await db.from('locations').select('*');
  if (le) throw le;
  const nowT = gameDaysAt(Date.now()), cache = {}, windows = {};
  for (const to of locs ?? []) {
    if (to.id === from.id) continue;
    const w = freightWindow(fs, from, to, nowT, cache);
    if (w != null) windows[to.id] = w;
  }
  const { data, error } = await db.rpc('freight_board', { p_character: x.ch.id, p_location: locId, p_windows: windows });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_accept": body = { contract, units }. My ship (docked at the pickup) takes `units` of that contract.
export async function freightAccept(db, user, body) {
  const contract = String(body.contract ?? ''), units = Number(body.units);
  if (!UUID_RE.test(contract)) return json({ error: 'contract_not_found' }, 400);
  if (!Number.isInteger(units) || units < 1 || units > 1000000) return json({ error: 'bad_quantity' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  // Find the route (pickup -> dest) to work out the window. The hauler cannot read contracts, the server can.
  const { data: c, error: ce } = await db.from('freight_contracts').select('pickup_location,dest_location').eq('id', contract).maybeSingle();
  if (ce) throw ce;
  if (!c) return json({ error: 'contract_not_found' }, 400);
  const [from, to] = await Promise.all([getLocation(db, c.pickup_location), getLocation(db, c.dest_location)]);
  if (!from || !to) return json({ error: 'contract_not_found' }, 400);
  const fs = await freightSettings(db);
  const nowT = gameDaysAt(Date.now());
  const windowDays = freightWindow(fs, from, to, nowT, {});
  if (windowDays == null) return json({ error: 'no_route' }, 400);
  const { data, error } = await db.rpc('freight_accept', { p_character: x.ch.id, p_contract: contract, p_units: units, p_now_t: nowT, p_window_days: windowDays });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_abandon": body = { batch }.
export async function freightAbandon(db, user, body) {
  const batch = String(body.batch ?? '');
  if (!UUID_RE.test(batch)) return json({ error: 'batch_not_found' }, 400);
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc('freight_abandon', { p_character: x.ch.id, p_batch: batch });
  if (error) throw error;
  return freightAnswer(data);
}

// "freight_mine": my contracts (as owner). "freight_hauling": my loads (as hauler) + market rep + freight room.
// Hauling also gets game_days so the page can count down deadlines.
export async function freightList(db, user, kind) {
  const x = await freightStart(db, user);
  if (x.resp) return x.resp;
  const { data, error } = await db.rpc(kind === 'mine' ? 'freight_mine' : 'freight_hauling', { p_character: x.ch.id });
  if (error) throw error;
  if (data && data.ok) {
    const nowT = gameDaysAt(Date.now());
    data.game_days = nowT; data.scale = CLOCK.scale;
    if (kind === 'mine') await freightAddLoads(db, data);
    else await freightAddBonusNow(db, data, nowT);
  }
  return freightAnswer(data);
}

// OWNER view: one line per active load (batch) of my contracts, with its deadline (game days). The hauler is NOT named.
// Read-only, uses the server's own access to freight_batches (no migration needed).
async function freightAddLoads(db, data) {
  const ids = (data.items || []).map(i => i.contract_id);
  data.loads = [];
  if (!ids.length) return;
  const { data: rows, error } = await db.from('freight_batches')
    .select('id,contract_id,units,dest_location,accepted_t,deadline_t')
    .in('contract_id', ids).eq('status', 'active').order('deadline_t', { ascending: true });
  if (error) throw error;
  data.loads = (rows ?? []).map(b => ({ batch_id: b.id, contract_id: b.contract_id, units: b.units,
    dest_location: b.dest_location, accepted_t: b.accepted_t, deadline_t: b.deadline_t }));
}

// HAULER view: what the delivery bonus is worth RIGHT NOW (same line as the SQL: falls straight to 0 at
// `bonus_full_fraction` of the window). Display only; the SQL works out the real bonus at delivery.
async function freightAddBonusNow(db, data, nowT) {
  const fs = await freightSettings(db);
  for (const it of data.items || []) {
    if (it.status !== 'active') continue;
    const span = Number(it.window_days) * fs.bonus_full_fraction;
    const f = span > 0 ? Math.max(0, Math.min(1, 1 - (nowT - Number(it.accepted_t)) / span)) : 0;
    it.bonus_now_per_cu = Math.round(Number(it.bonus_max_per_cu) * f * 100) / 100;
    it.bonus_now_total = Math.round(Number(it.bonus_max_per_cu) * f * Number(it.units) * 100) / 100;
  }
}
