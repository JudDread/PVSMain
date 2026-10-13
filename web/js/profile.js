// profile.js - the Profile screen, opened by the circle at the top right (no tab). A first version: name, level, XP, ship, credits.
// The picture and more details come later.
import { S, $, addScreen, el, money, whole, hullName, locName } from 'core';

const box = $('scr-profile');
function row(label, value) { const r = el('div', 'pad'); r.appendChild(el('span', 'muted', label + ': ')); r.appendChild(el('span', '', value)); return r; }
function draw() {
  box.replaceChildren(el('h2', '', 'Profile'));
  const ch = S.last && S.last.character, p = S.last && S.last.pilot, ship = S.last && (S.last.ships || [])[0];
  if (!ch) return;
  box.appendChild(row('Name', ch.name || '?'));
  if (p) {
    box.appendChild(row('Level', String(p.level)));
    box.appendChild(row('XP', p.xp_next == null ? whole(p.xp) + ' (top level)' : whole(p.xp) + ' / ' + whole(p.xp_next)));
  }
  if (ship) box.appendChild(row('Ship', hullName(ship.hull_id) + (ship.state === 'docked' ? ' at ' + locName(ship.location_id) : ' (flying)')));
  box.appendChild(row('Credits', money(ch.credits)));
  box.appendChild(el('div', 'muted pad', 'Picture and more details will come here later.'));
}
addScreen('profile', 'Profile', box, { noTab: true, onShow: draw, update: draw });
export function resetProfile() { box.replaceChildren(); }
