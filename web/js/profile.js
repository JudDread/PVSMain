// profile.js - the Profile screen, opened by the circle at the top right (no tab).
// Name, level + XP bar, skill points, credits, and the ship status. Display only; numbers come from the latest `me` answer (S.last).
// Not shown yet (the server does not count them): distance flown, trades made. The picture comes later.
import { S, $, addScreen, openScreen, el, money, whole, hullName, locName } from 'core';
import { resetSkills } from './skills.js';   // the Skills screen makes its own div and registers itself

const box = $('scr-profile');
function row(label, value) { const r = el('div', 'pad'); r.appendChild(el('span', 'muted', label + ': ')); r.appendChild(el('span', '', value)); return r; }
function block(title) { const b = el('section', ''); b.appendChild(el('h2', '', title)); return b; }

function xpBar(p) {
  const wrap = el('div', 'bar xp'), fill = el('div', 'fill');
  const pct = p.xp_next ? Math.max(0, Math.min(100, 100 * p.xp / p.xp_next)) : 100;
  fill.style.width = pct + '%';
  wrap.style.margin = '2px 8px 6px';
  wrap.appendChild(fill);
  return wrap;
}
// where the ship is going, if the pending flight says so (a place id); otherwise nothing
function destination() {
  const a = ((S.last && S.last.actions) || []).find(x => x.status === 'pending');
  const to = a && a.payload && a.payload.to;
  return typeof to === 'string' ? locName(to) : null;
}
function draw() {
  box.replaceChildren(el('h2', '', 'Profile'));
  const ch = S.last && S.last.character, p = S.last && S.last.pilot, ship = S.last && (S.last.ships || [])[0];
  if (!ch) return;

  const pilot = block('Pilot');
  pilot.appendChild(row('Name', ch.name || '?'));
  if (p) {
    pilot.appendChild(row('Level', String(p.level)));
    pilot.appendChild(row('XP', p.xp_next == null ? whole(p.xp) + ' (top level)' : whole(p.xp) + ' / ' + whole(p.xp_next)));
    pilot.appendChild(xpBar(p));
    pilot.appendChild(row('Cal (skill points)', p.skill_points == null ? '0' : whole(p.skill_points)));
  }
  const sk = el('button', 'alt', 'Skills'); sk.onclick = () => openScreen('skills');
  pilot.appendChild(sk);
  pilot.appendChild(row('Credits', money(ch.credits)));
  box.appendChild(pilot);

  const sh = block('Ship');
  if (!ship) sh.appendChild(el('div', 'muted pad', 'No ship.'));
  else {
    sh.appendChild(row('Hull', hullName(ship.hull_id)));
    if (ship.state === 'docked') sh.appendChild(row('Status', 'Docked at ' + locName(ship.location_id)));
    else { const to = destination(); sh.appendChild(row('Status', 'Flying' + (to ? ' to ' + to : ''))); }
    if (ship.hold_size != null) sh.appendChild(row('Hold size', whole(ship.hold_size)));
    if (ship.thrust_g != null) sh.appendChild(row('Thrust', Number(ship.thrust_g) + ' g'));
  }
  box.appendChild(sh);
  box.appendChild(el('div', 'muted pad', 'Your picture and lifetime numbers (distance flown, trades made) will come here later.'));
}
addScreen('profile', 'Profile', box, { noTab: true, onShow: draw, update: draw });
export function resetProfile() { box.replaceChildren(); resetSkills(); }
