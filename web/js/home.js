// home.js - the Home screen, opened by the VS box at the top left (no tab).
// Its layout is in web/index.html (#scr-home): account, game time, log out. The ship line (#ship) is hidden here
// (the ship is shown in Profile); core.js still fills it, so the element stays in the page. The Discord button is made
// here in code and put just above Log out. The business side (information, in-game purchases) will be built here later.
import { $, addScreen, el } from 'core';
const home = $('scr-home');
addScreen('home', 'Home', home, { noTab: true });

const shipLine = $('ship');
if (shipLine) {
  shipLine.hidden = true;
  const head = shipLine.previousElementSibling;       /* the "Ship" heading above it */
  if (head && head.tagName === 'H2') head.hidden = true;
}

const DISCORD = 'https://discord.gg/4G8rWeF7AV';
const dc = el('button', '', 'Join our Discord');
dc.addEventListener('click', () => window.open(DISCORD, '_blank', 'noopener'));
const out = $('out');
if (out) home.insertBefore(dc, out); else home.appendChild(dc);
