// home.js - the Home screen, opened by the VS box at the top left (no tab).
// Its layout is in web/index.html (#scr-home): account, game time, ship, log out. The Discord button is made here in code
// and put just above Log out. The business side (information, in-game purchases) will be built here later.
import { $, addScreen, el } from 'core';
const home = $('scr-home');
addScreen('home', 'Home', home, { noTab: true });

const DISCORD = 'https://discord.gg/4G8rWeF7AV';
const dc = el('button', '', 'Join our Discord');
dc.addEventListener('click', () => window.open(DISCORD, '_blank', 'noopener'));
const out = $('out');
if (out) home.insertBefore(dc, out); else home.appendChild(dc);
