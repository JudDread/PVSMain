// home.js - the Home screen, opened by the VS box at the top left (no tab).
// Its layout is in web/index.html (#scr-home): account, game time, ship, log out. The business side (information,
// in-game purchases) will be built here later.
import { $, addScreen } from 'core';
addScreen('home', 'Home', $('scr-home'), { noTab: true });
