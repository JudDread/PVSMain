// Run with:  node tests/physics.test.js
import assert from 'node:assert/strict';
import * as P from '../shared/physics.js';
import * as C from '../shared/clock.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok -', name); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('bodyId lookup', () => {
  assert.equal(P.bodyId('Earth'), 3);
  assert.throws(() => P.bodyId('Krypton'));
});

test('Earth stays on its orbit radius', () => {
  const e = P.BODIES[P.bodyId('Earth')];
  for (const t of [0, 100, 5000, 9500]) {
    const [x, y] = P.bodyPos(e, t);
    near(Math.hypot(x, y), 1, 1e-9, 'radius');
  }
});

test('Earth completes an orbit in one period', () => {
  const e = P.BODIES[3];
  const [x0, y0] = P.bodyPos(e, 1000), [x1, y1] = P.bodyPos(e, 1000 + e.P);
  near(x0, x1, 1e-9, 'x'); near(y0, y1, 1e-9, 'y');
});

const t0 = C.gameDaysAt(C.CLOCK.epochRealMs);

test('Earth -> Mars plan arrives on Mars, matching its velocity', () => {
  const r = P.planTravel({ from: { body: 3 }, to: { body: 4 }, departT: t0, g: 3 });
  assert.ok(r.ok, r.reason);
  const end = P.stateAt(r.plan, r.arriveT), m = P.targetState({ body: 4 }, r.arriveT);
  near(end.x, m.x, 1e-6, 'x'); near(end.y, m.y, 1e-6, 'y');
  near(end.vx, m.vx, 1e-6, 'vx'); near(end.vy, m.vy, 1e-6, 'vy');
  assert.equal(r.arrival.body, 4);
  console.log(`   Earth->Mars @3g: ${r.durationDays.toFixed(2)} game days = ${(r.durationDays * 1440 / C.CLOCK.scale).toFixed(0)} real min`);
});

test('plan survives a JSON round trip (database safe)', () => {
  const r = P.planTravel({ from: { body: 3 }, to: { body: 4 }, departT: t0, g: 3 });
  const copy = JSON.parse(JSON.stringify(r.plan));
  const t = t0 + r.durationDays * 0.37;
  assert.deepEqual(P.stateAt(copy, t), P.stateAt(r.plan, t));
});

test('higher thrust is faster', () => {
  const a = P.planTravel({ from: { body: 3 }, to: { body: 4 }, departT: t0, g: 1 });
  const b = P.planTravel({ from: { body: 3 }, to: { body: 4 }, departT: t0, g: 6 });
  assert.ok(b.durationDays < a.durationDays);
});

test('bad requests are rejected', () => {
  const base = { from: { body: 3 }, departT: t0, g: 3 };
  assert.equal(P.planTravel({ ...base, to: { body: 3 } }).reason, 'same_location');
  assert.equal(P.planTravel({ ...base, to: { body: 99 } }).reason, 'bad_destination');
  assert.equal(P.planTravel({ ...base, to: { body: 0 } }).reason, 'bad_destination');
  assert.equal(P.planTravel({ ...base, to: { body: 4 }, g: 0 }).reason, 'bad_thrust');
  assert.equal(P.planTravel({ ...base, to: { body: 4 }, g: 50 }).reason, 'bad_thrust');
});

test('docked ship follows its planet', () => {
  const s1 = P.shipStateAt({ docked: 3 }, t0), s2 = P.shipStateAt({ docked: 3 }, t0 + 50);
  assert.notEqual(s1.x, s2.x);
});

test('clock round trip and rescale continuity', () => {
  const now = Date.UTC(2026, 9, 10, 8, 30);
  near(C.realMsAt(C.gameDaysAt(now)), now, 1, 'round trip');
  near(C.gameDaysAt(C.CLOCK.epochRealMs + 60000) - t0, 1 / 24, 1e-9, '1 real min = 1 game hour');
  const fast = C.rescale(C.CLOCK, now, 6000);
  near(C.gameDaysAt(now, fast), C.gameDaysAt(now), 1e-9, 'no jump on rescale');
  assert.ok(C.gameDaysAt(now + 1000, fast) > C.gameDaysAt(now + 1000));
});

console.log(`\n${n} tests passed`);
