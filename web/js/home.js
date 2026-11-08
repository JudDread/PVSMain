// home.js - the Home screen, opened by the VS box at the top left (no tab). The business side of the game:
// who you are, game time, account, welcome message, Library, Discord / support, terms, membership (not connected yet), log out.
// Layout that is fixed lives in web/index.html (#scr-home: #who, #gtime, #ship, #out); the rest is built here in code.
// 2026-11-07 phone layout: #who and #gtime are MOVED (not copied) into small tiles at the top, so main.js keeps filling them; the help items are rows
// with a small button on the right; Log out is a small button at the bottom (#out keeps its click handler from main.js).
// The ship line (#ship) stays in the page, hidden (core.js still fills it); the ship is shown in Profile.
import { S, $, addScreen, openScreen, el } from 'core';
import './library.js';                                  /* the Library screen (its text is in library_pages.js) */

const DISCORD = 'https://discord.gg/4G8rWeF7AV';
const WELCOME = 'Thank you for playtesting Vacuum State, a hard sci-fi trading game. The NPC economy, buying and selling goods from NPC locations, needs to be tested. Please try to break it. The next additions will be Combat, Faction Reputation and full Mission Chains with global events. ';

const home = $('scr-home');

const st = document.createElement('style');
st.textContent = [
  '#scr-home > h2:first-child{font-size:18px;font-weight:500;color:#fff;margin:4px 4px 8px}',
  '#scr-home .hmgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;padding:8px}',
  '#scr-home .hk{font-size:11px;color:#8d98b2;font-weight:400;line-height:1.2}',
  '#scr-home .hv,#scr-home #who,#scr-home #gtime{font-size:13px;font-weight:500;color:#fff;line-height:1.2;overflow-wrap:anywhere}',
  '#scr-home .sech{min-height:34px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 8px;margin-top:10px;background:rgba(120,160,210,.16);border-top:2px solid rgba(120,160,210,.55);border-bottom:1px solid rgba(120,160,210,.25);border-radius:0;color:#fff;font-weight:500;font-size:13px;letter-spacing:.02em}',
  '#scr-home .hmtext{padding:6px 8px;font-size:11px;color:#8d98b2}',
  '#scr-home .hmrow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid #2f3a58;color:#fff;font-weight:500;font-size:13px}',
  '#scr-home .hmrow.dim{opacity:.5}',
  '#scr-home .hmrow .l{min-width:0;flex:1}',
  '#scr-home .hmrow .sub{font-size:11px;font-weight:400;color:#8d98b2;line-height:1.15}',
  '#scr-home .hmrow button{flex:none;height:30px;min-height:0;margin:0;padding:0 12px;font-size:13px}',
  '#scr-home #out{width:auto;height:34px;min-height:0;padding:0 14px;font-size:13px;margin:12px 8px 4px}',
].join('');
document.head.appendChild(st);

const shipLine = $('ship');
if (shipLine) {
  shipLine.hidden = true;
  const head = shipLine.previousElementSibling;       /* the "Ship" heading above it */
  if (head && head.tagName === 'H2') head.hidden = true;
}
/* the old grey placeholder line in index.html is replaced by the blocks below */
const old = [...home.children].find(c => c.classList.contains('muted') && c.classList.contains('pad'));
if (old) old.hidden = true;

function tile(label, node) { const d = el('div', ''); d.appendChild(el('div', 'hk', label)); d.appendChild(node); return d; }
function bar(title) { return el('div', 'sech', title); }
function item(name, sub, label, onClick, disabled) {
  const r = el('div', 'hmrow' + (disabled ? ' dim' : '')), l = el('div', 'l');
  l.appendChild(el('div', '', name));
  if (sub) l.appendChild(el('div', 'sub', sub));
  const b = el('button', 'alt', label); b.type = 'button'; b.disabled = !!disabled; b.addEventListener('click', onClick);
  r.append(l, b);
  return r;
}

/* top: pilot, game time, account (the page's own #gtime and #who are moved into the tiles) */
const who = $('who'), gt = $('gtime');
if (gt && gt.previousElementSibling && gt.previousElementSibling.tagName === 'H2') gt.previousElementSibling.hidden = true;   /* the old "Game time" heading */
const pilotName = el('div', 'hv', '');
const tiles = el('div', 'hmgrid');
tiles.appendChild(tile('Pilot', pilotName));
tiles.appendChild(tile('Game time', gt || el('div', 'hv', '')));
const acc = tile('Account', who || el('div', 'hv', '')); acc.style.gridColumn = 'span 2';
tiles.appendChild(acc);
const title = home.querySelector('h2');
if (title) title.after(tiles); else home.insertBefore(tiles, home.firstChild);

/* welcome, then help rows */
const welcome = el('section', ''); welcome.append(bar('Welcome'), el('div', 'hmtext', WELCOME));
const help = el('section', '');
help.appendChild(bar('Help'));
help.appendChild(item('Library', 'The game explained in plain words', 'Open', () => openScreen('library')));
help.appendChild(item('Discord', 'Questions, bugs, ideas, account trouble', 'Join', () => window.open(DISCORD, '_blank', 'noopener')));
help.appendChild(item('Terms and privacy', '', 'Open', () => window.open(new URL('terms.html', location.href).href, '_blank', 'noopener')));   /* web/terms.html, next to index.html */
help.appendChild(item('Membership', 'Not available yet', 'Soon', () => {}, true));                       /* payments are a later step */

/* the blocks go under the tiles and above Log out */
const out = $('out');
[welcome, help].forEach(b => { if (out) home.insertBefore(b, out); else home.appendChild(b); });

function draw() {
  const ch = S.last && S.last.character;
  pilotName.textContent = ch && ch.name ? ch.name : '';
}
addScreen('home', 'Home', home, { noTab: true, onShow: draw, update: draw });
