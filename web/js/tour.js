// tour.js - the guided tour of the first mission (tutorial_1): a welcome message, then a pointer that walks the player through the screens.
// All the wording and the targets live in TOUR below. The SERVER keeps the progress (mission steps); this file only shows it.
// Steps of tutorial_1 on the server: 'welcome' (answered in the message box), 'profile' and 'home' (reported by missions.js when that screen opens).
// FREE MODE: the player can tap anything while a pointer is up; the pointer follows what they have done.
import { S, LS, say, screenWatchers } from 'core';
import { missionList, missionWatchers, reportStep } from './missions.js';
import { pointAt, clearPointer, modal, closeModal } from './coach.js';

const TOUR = {
  quest: 'tutorial_1',
  welcome: name => ({
    kicker: 'NEW MISSION STARTED: WELCOME ABOARD',
    title: 'Luna Sovereignty - Pilot Registry',
    paras: [
      'Welcome to Luna, ' + name + '. Your papers are stamped and your slot in the register is open.',
      'You are Homo Sapiens Astroalis, a pilot bred for the darkness of deep space amd the punishing demamds of the G-Drive. It burns no fuel: it creates a gravity well in front of your hull, amd lets the ship fall into it. Your bodynhas been engineered to survive this extreme acceleration, but not without cost. Earthers call your kind Black-Eyes. Out here you are simply the people who can fly.',
      'Luna is neutral ground: shipyards, banks and brokers, where Earth Space Command, the Jovian Compact and the Martian Core all trade and mostly keep their guns quiet. Out in the Belt, Ceres and Pallas fight over every tonne of ice. On the dark side of Luna, the Black Tryst takes a cut of everything else.',
      'Everything in the sky is moving, and nobody waits for you. Your first assignment is short: learn your cockpit.',
    ],
    start: 'Start the tour', skip: "Skip - I'll find my own way",
  }),
  // A beat points at one thing. until = the mission step that finishes it (no Next button); next = shows a Next button;
  // screen = only shown while that screen is open (a pointer for a screen the player has left moves on).
  beats: [
    { target: '.bars > .bitem:first-child', next: true, text: 'Your LEVEL and XP. You earn XP by flying distance. Every level-up gives you Calibrations (Cal) to spend on skills.' },
    { target: '#enitem', next: true, text: 'Your ENDURANCE. The G-Drive is hard on the body: burning above your free thrust (3 g at the start) drains this bar, and it refills when you coast or dock. Tap the bar for a countdown.' },
    { target: '#money', next: true, text: 'Your CREDITS. Everything in the system is bought and sold with them.' },
    { target: '#pic', until: 'profile', text: 'Tap your portrait circle to open your pilot profile.' },
    { target: '#scr-profile', screen: 'profile', next: true, text: 'Your pilot file: level, Calibrations, credits, net worth, career, ship and reputation. Most of it is public, other pilots can read it. Tap Next when you are done looking.' },
    { target: '#vs', until: 'home', text: 'Tap VS to open Home: help, the Discord link and Log out.' },
  ],
  final: { target: '#nav button[data-screen="missions"]', text: 'Mission complete! Open the Missions tab and claim your reward.' },
};

let idx = 0, key = '', busy = false;
const name = () => (S.last && S.last.character && S.last.character.name) || 'pilot';
const offKey = () => 'pvs_tour_off:' + name();

function stop() { if (key) { key = ''; clearPointer(); closeModal(); } }
function set(k, show) { if (key === k) return; key = k; closeModal(); clearPointer(); show(); }

async function answer(on) {
  if (busy) return; busy = true;
  LS.set(offKey(), on ? '0' : '1');
  try { idx = 0; await reportStep(TOUR.quest, 'welcome'); }
  catch (e) { say('Error: ' + e.message, 'err'); }
  finally { busy = false; }
}
function skipTour() { LS.set(offKey(), '1'); stop(); say('Tour switched off. Your mission is still under Missions.', 'ok'); }

function evaluate() {
  if (!S.last || !S.last.character) return stop();
  const q = missionList().find(x => x.id === TOUR.quest);
  const steps = (q && q.steps) || [];
  const done = id => steps.some(s => s.id === id && s.done);
  if (!q || q.status === 'claimed' || !steps.some(s => s.id === 'welcome')) return stop();   /* no welcome step on the server yet: stay quiet */
  if (!done('welcome')) {
    return set('welcome', () => {
      const w = TOUR.welcome(name());
      modal({ kicker: w.kicker, title: w.title, paras: w.paras, buttons: [{ label: w.start, onClick: () => answer(true) }, { label: w.skip, alt: true, onClick: () => answer(false) }] });
    });
  }
  if (LS.get(offKey()) === '1' || S.current === 'missions') return stop();
  if (q.status === 'ready') return set('final', () => pointAt({ target: TOUR.final.target, text: TOUR.final.text }));
  while (idx < TOUR.beats.length && TOUR.beats[idx].until && done(TOUR.beats[idx].until)) idx++;
  if (idx >= TOUR.beats.length) return stop();
  const b = TOUR.beats[idx];
  if (b.screen && S.current !== b.screen) { if (b.seen) { idx++; return evaluate(); } return stop(); }
  set('beat:' + idx, () => {
    b.seen = true;
    pointAt({ target: b.target, text: b.text, onNext: b.next ? () => { idx++; evaluate(); } : null, onSkip: skipTour });
  });
}

missionWatchers.push(evaluate);
screenWatchers.push(evaluate);

export function resetTour() { idx = 0; key = ''; busy = false; TOUR.beats.forEach(b => { b.seen = false; }); clearPointer(); closeModal(); }
