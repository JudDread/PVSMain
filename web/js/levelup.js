// levelup.js - the level-up screen: a big square picture and a message, shown once when the pilot's level goes up.
// The page remembers the last level it showed on this device (localStorage 'pvs_lvl:<pilot>'), so it works for any XP source,
// and a pilot who levels up while away sees the screen at the next login. The first time on a device it only remembers the level.
// The picture is img/levels/<level>.webp; if that file does not exist it falls back to img/levels/2.webp (the base picture); if that is missing too, no picture.
// ONE pop-up only: when tutorial 5 (Skills) is waiting for its welcome box, that box IS the level-up screen (tour.js) and this file stays quiet.
import { S, LS, openScreen, screens } from 'core';
import { missionList, loadMissions } from './missions.js';
import { modal, closeModal } from './coach.js';

export const canInterrupt = () => true;           // combat will answer false here: never interrupt a fight
let busy = false;
const nm = () => S.last && S.last.character && S.last.character.name;
const level = () => (S.last && S.last.pilot && Number(S.last.pilot.level)) || 0;
const lvKey = () => 'pvs_lvl:' + nm();

export const levelImages = L => ['img/levels/' + L + '.webp', 'img/levels/2.webp'];
export function markLevelSeen() { const L = level(); if (L && nm()) LS.set(lvKey(), String(L)); }

function show(L) {
  modal({
    kicker: 'LEVEL UP', images: levelImages(L), title: 'LEVEL ' + L,
    paras: ['The Registry has raised your pilot rating. You have new Cal to spend: Cal are the skill points of a pilot.'],
    buttons: [
      { label: 'Skills', onClick: () => { closeModal(); if (screens.skills) openScreen('skills'); } },
      { label: 'Later', alt: true, onClick: closeModal },
    ],
  });
}

// Called by main.js after every refresh.
export async function checkLevelUp() {
  const L = level();
  if (!L || !nm() || busy) return;
  const stored = Number(LS.get(lvKey()));
  if (!stored) { LS.set(lvKey(), String(L)); return; }          // first time on this device: no screen
  if (L <= stored) { if (L < stored) LS.set(lvKey(), String(L)); return; }
  if (!canInterrupt() || document.getElementById('coachmodal')) return;   // try again at the next refresh
  busy = true;
  try {
    await loadMissions();                                       // is tutorial 5 waiting for its welcome box?
    const t5 = missionList().find(q => q.id === 'tutorial_5' && q.status === 'active' && (q.steps || []).some(s => s.id === 'welcome' && !s.done));
    LS.set(lvKey(), String(L));
    if (!t5) show(L);                                           // otherwise tour.js shows the one box
  } catch (e) { /* try again at the next refresh */ }
  finally { busy = false; }
}
