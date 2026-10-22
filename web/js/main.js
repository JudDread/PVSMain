// main.js - the app shell: login, the 15 s refresh, the 1 s clock tick, buttons outside the screens.
// Loads fly.js, market.js, assets.js, facilities.js and rigs.js (each registers its own screen).
import { J2000_MS } from 'physics';
import { S, $, say, li, call, fmt, curGd, nowMs, locName, screens, openScreen, setShipLine, enduranceNow } from 'core';
import { invalidateDeps, resetFly } from 'fly';
import { resetMarket } from 'market';
import { resetAssets } from 'assets';
import { resetFacilities } from 'facilities';
import { resetRigging } from 'rigs';
import { resetProfile } from 'profile';
import 'home';
import { resetMissions } from './missions.js';
import { resetTour } from './tour.js';
import { checkLevelUp } from './levelup.js';

const URL_ = 'https://krallhjvjjeeypdpnjha.supabase.co';
let timer = null, lastNudge = 0;
S.refresh = refresh;

function getKey() { try { return localStorage.getItem('pvs_key'); } catch (e) { return null; } }
function show(which) { ['cfg', 'auth', 'game'].forEach(id => $(id).hidden = id !== which); $('title').hidden = which === 'game'; }

async function init() {
  const k = getKey();
  if (!k) return show('cfg');
  S.sb = window.supabase.createClient(URL_, k);
  const { data } = await S.sb.auth.getSession();
  if (data.session) enterGame(data.session); else show('auth');
}
async function enterGame(session) {
  show('game');
  $('who').textContent = 'Logged in as ' + session.user.email;
  await refresh();
  clearInterval(timer);
  timer = setInterval(tick, 1000);
}
async function refresh() {
  try {
    const t0 = Date.now();
    const d = await call('me');
    const t1 = Date.now();
    /* Several refreshes can be in flight at once (timer, launch, speed button, arrival). An answer that was started
       earlier than the one already shown must never replace it, or the ship jumps back to an old state. */
    if (S.last && d && d.real_ms < S.last.real_ms) return;
    /* Clock check (the NTP way): the server stamped the answer when it started (real_ms) and when it left (sent_ms).
       Averaging the two differences cancels the travel time. Keep the sample with the shortest round trip. */
    if (d && d.sent_ms && (!S.skewAt || t1 - t0 <= S.skewRtt || t1 - S.skewAt > 120000)) {
      S.skew = ((d.real_ms - t0) + (d.sent_ms - t1)) / 2; S.skewRtt = t1 - t0; S.skewAt = t1;
    }
    S.last = d; render();
    checkLevelUp().catch(() => {});                   /* the level-up screen (levelup.js) */
  }
  catch (e) { say('Error: ' + e.message, 'err'); }
}
function render() {
  if (!S.last) return;
  const hasChar = !!S.last.character;
  $('speed').hidden = !(S.last.dev && hasChar);
  $('speed').textContent = String(Math.round((S.last.speed || 1) * 100) / 100);   /* just 1, 2 or 10 */
  $('nochar').hidden = hasChar; $('haschar').hidden = !hasChar; $('topbar').hidden = !hasChar;
  if (!hasChar) return;
  const ship = (S.last.ships || [])[0];
  setShipLine();
  if (!S.current) openScreen('travel');
  const s = screens[S.current]; if (s && s.update) s.update(ship);
  /* event line: the latest event on one line; the full list is under it (tap the line to open / fold) */
  const evl = (S.last.events || []).slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  $('evlast').textContent = evl.length ? new Date(evl[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + evl[0].message : 'No events yet';
  const evs = $('evs'); evs.replaceChildren();
  evl.forEach(e => evs.appendChild(li(new Date(e.created_at).toLocaleString() + ' - ' + e.message)));
  tick();
}
function tick() {
  if (!S.last) return;
  const gd = curGd();
  setShipLine();                                   /* thrust and endurance move every second */
  /* the bar reached 0 while draining: ask the server at once (it has switched to the slow 3 g refill) */
  if (S.last.pilot && S.last.pilot.endurance_rate_hour < 0 && enduranceNow() <= 0 && Date.now() - lastNudge > 3000) { lastNudge = Date.now(); refresh(); }
  $('gtime').textContent = new Date(J2000_MS + gd * 864e5).toISOString().slice(0, 16).replace('T', ' ') + ' UTC (game) - speed ' + (Math.round((S.last.speed || 1) * 100) / 100) + 'x';
  /* a trip is due: ask the server at once (it docks the ship) */
  (S.last.actions || []).forEach(a => {
    if (a.status === 'pending' && (new Date(a.resolve_at) - nowMs()) / 1000 <= 0 && Date.now() - lastNudge > 5000) { lastNudge = Date.now(); refresh(); }
  });
}

$('savekey').onclick = () => {
  const v = $('key').value.trim();
  if (v.length < 20) return say('That key looks too short.', 'err');
  try { localStorage.setItem('pvs_key', v); } catch (e) {}
  say(''); init();
};
$('signup').onclick = async () => {
  const { data, error } = await S.sb.auth.signUp({ email: $('email').value.trim(), password: $('pw').value });
  if (error) return say(error.message, 'err');
  if (data.session) enterGame(data.session);
  else say('Registered. Check your email to confirm, then log in.', 'ok');
};
$('login').onclick = async () => {
  const { data, error } = await S.sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  if (error) return say(error.message, 'err');
  say(''); enterGame(data.session);
};
const logout = async () => { await S.sb.auth.signOut(); clearInterval(timer); S.last = null; resetFly(); resetMarket(); resetAssets(); resetFacilities(); resetRigging(); resetProfile(); resetMissions(); resetTour(); S.current = null; show('auth'); };
$('out').onclick = logout; $('out2').onclick = logout;
$('mk').onclick = async () => {
  try { await call('create_character', { name: $('cname').value }); say('Character created.', 'ok'); await refresh(); }
  catch (e) { say('Error: ' + e.message, 'err'); }
};
$('speed').onclick = async () => {
  const b = $('speed'); b.disabled = true;
  try {
    const r = await call('cycle_speed');
    say('Game speed is now ' + r.speed + 'x.', 'ok');
    invalidateDeps();               /* ETAs change with speed: fetch them again */
    await refresh();
  } catch (e) { say('Error: ' + (e.message === 'not_allowed' ? 'this account is not on the developer list' : e.message), 'err'); }
  finally { b.disabled = false; }
};

$('vs').onclick = () => { if (S.last && S.last.character) openScreen('home'); };
$('pic').onclick = () => { if (S.last && S.last.character) openScreen('profile'); };
$('enitem').onclick = () => { S.enTimer = !S.enTimer; setShipLine(); };   /* tap the endurance bar: time until full on / off */
$('evline').onclick = () => { const l = $('evs'); l.hidden = !l.hidden; $('evcaret').textContent = l.hidden ? '+' : '-'; };   /* tap the event line: full list on / off */

setInterval(() => { if (S.last && S.sb) refresh(); }, 15000);
init();
