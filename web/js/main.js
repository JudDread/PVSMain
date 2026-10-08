// main.js - the app shell: login, the 15 s refresh, the 1 s clock tick, buttons outside the screens.
// Loads fly.js, market.js and assets.js (each registers its own screen).
import { J2000_MS } from 'physics';
import { S, $, say, li, call, fmt, curGd, locName, screens, openScreen, setShipLine } from 'core';
import { invalidateDeps, resetFly } from 'fly';
import { resetMarket } from 'market';
import { resetAssets } from 'assets';

const URL_ = 'https://krallhjvjjeeypdpnjha.supabase.co';
let timer = null, lastNudge = 0;
S.refresh = refresh;

function getKey() { try { return localStorage.getItem('pvs_key'); } catch (e) { return null; } }
function show(which) { ['cfg', 'auth', 'game'].forEach(id => $(id).hidden = id !== which); }

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
  try { S.last = await call('me'); render(); }
  catch (e) { say('Error: ' + e.message, 'err'); }
}
function render() {
  if (!S.last) return;
  const hasChar = !!S.last.character;
  $('speed').hidden = !(S.last.dev && hasChar);
  $('speed').textContent = 'Speed: ' + (Math.round((S.last.speed || 1) * 100) / 100) + 'x (tap to change)';
  $('nochar').hidden = hasChar; $('haschar').hidden = !hasChar;
  if (!hasChar) return;
  const ship = (S.last.ships || [])[0];
  setShipLine();
  if (!S.current) openScreen('travel');
  const s = screens[S.current]; if (s && s.update) s.update(ship);
  const evs = $('evs'); evs.replaceChildren();
  (S.last.events || []).forEach(e => evs.appendChild(li(new Date(e.created_at).toLocaleString() + ' - ' + e.message)));
  tick();
}
function tick() {
  if (!S.last) return;
  const gd = curGd();
  $('gtime').textContent = new Date(J2000_MS + gd * 864e5).toISOString().slice(0, 16).replace('T', ' ') + ' UTC (game) - speed ' + (Math.round((S.last.speed || 1) * 100) / 100) + 'x';
  const acts = $('acts'); acts.replaceChildren();
  (S.last.actions || []).forEach(a => {
    const left = (new Date(a.resolve_at) - Date.now()) / 1000;
    const p = a.payload || {};
    let t = 'trip ' + locName(p.from) + ' -> ' + locName(p.to_location || (p.to || '').toLowerCase()) + ' [' + a.status + ']';
    if (a.status === 'pending') {
      t += left > 0 ? ' arrives in ' + fmt(left) : ' arriving...';
      if (left <= 0 && Date.now() - lastNudge > 5000) { lastNudge = Date.now(); refresh(); }
    }
    acts.appendChild(li(t));
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
$('out').onclick = async () => { await S.sb.auth.signOut(); clearInterval(timer); S.last = null; resetFly(); resetMarket(); resetAssets(); show('auth'); };
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

setInterval(() => { if (S.last && S.sb) refresh(); }, 15000);
init();
