// tour.js - the guided tours of the tutorial missions: a pointer (and, for tutorial 1, a welcome message) that walks the player through the screens.
// All the wording and the targets live in TOURS below. The SERVER keeps the progress (mission steps); this file only shows it.
// A step is finished by itself when its id equals the name of a screen opened or of a server action that succeeded (see missions.js).
// FREE MODE: the player can tap anything while a pointer is up; the pointer follows what they have done.
// The 'Skip tour' choice is one switch per pilot: it switches off the pointers of ALL tutorials.
import { S, LS, say, screenWatchers } from 'core';
import { missionList, missionWatchers, reportStep } from './missions.js';
import { pointAt, clearPointer, modal, closeModal } from './coach.js';

// A beat points at one thing. until = the mission step that finishes it (no Next button); next = shows a Next button;
// screen = only shown while that screen is open (a Next beat for a screen the player has left moves on).
const TOURS = [
  {
    quest: 'tutorial_1',
    welcome: name => ({
      kicker: 'NEW MISSION STARTED: WELCOME ABOARD',
      title: 'Luna Sovereignty - Pilot Registry',
      paras: [
        'Welcome to Luna, ' + name + '. Your papers are stamped and your slot in the register is open.',
        'You are Homo sapiens astroalis, a pilot bred for the G-Drive. It burns no fuel: it bends gravity around your hull, and it asks your body to pay for it. Earthers call your kind Black-Eyes. Out here you are simply the people who can fly.',
        'Luna is neutral ground: shipyards, banks and brokers, where Earth Space Command, the Jovian Compact and the Martian Core all trade and mostly keep their guns quiet. Out in the Belt, Ceres and Pallas fight over every tonne of ice. On the dark side of Luna, the Black Tryst takes a cut of everything else.',
        'Everything in the sky is moving, and nobody waits for you. Your first assignment is short: learn your cockpit.',
      ],
      start: 'Start the tour', skip: "Skip - I'll find my own way",
    }),
    beats: [
      { target: '.bars > .bitem:first-child', next: true, text: 'Your LEVEL and XP. You earn XP by flying distance. Every level-up gives you Calibrations (Cal) to spend on skills.' },
      { target: '#enitem', next: true, text: 'Your ENDURANCE. The G-Drive is hard on the body: burning above your free thrust (3 g at the start) drains this bar, and it refills when you coast or dock. Tap the bar for a countdown.' },
      { target: '#money', next: true, text: 'Your CREDITS. Everything in the system is bought and sold with them.' },
      { target: '#pic', until: 'profile', text: 'Tap your portrait circle to open your pilot profile.' },
      { target: '#scr-profile', screen: 'profile', next: true, text: 'Your pilot file: level, Calibrations, credits, net worth, career, ship and reputation. Most of it is public, other pilots can read it. Tap Next when you are done looking.' },
      { target: '#vs', until: 'home', text: 'Tap VS to open Home: help, the Discord link and Log out.' },
    ],
    final: { target: '#nav button[data-screen="missions"]', text: 'Mission complete! Open the Missions tab and claim your reward.' },
  },
  {
    quest: 'tutorial_2',
    beats: [
      { target: '#nav button[data-screen="travel"]', until: 'travel', text: 'Time to fly. Tap the Fly tab.' },
      { target: '#map', screen: 'travel', next: true, text: 'The live map of the system. The planets orbit the Sun in real time, so distances change by the hour: a trip that is short today can be longer next week.' },
      { target: '#depshead', screen: 'travel', next: true, text: 'DESTINATIONS. Tap here to open the list of places you can fly to, then pick one.' },
      { target: '#go', screen: 'travel', until: 'queue_travel', text: 'Pick a destination, then press LAUNCH. Your ship accelerates to the halfway point, flips, and brakes to arrive. Burning above 3 g drains your Endurance.' },
    ],
    final: { target: '#nav button[data-screen="missions"]', text: 'Your first trip is under way! Open the Missions tab and claim your reward.' },
  },
];

const idxOf = {};                         // quest id -> position in its beats
let key = '', busy = false;
const name = () => (S.last && S.last.character && S.last.character.name) || 'pilot';
const offKey = () => 'pvs_tour_off:' + name();

function stop() { if (key) { key = ''; clearPointer(); closeModal(); } }
function set(k, show) { if (key === k) return; key = k; closeModal(); clearPointer(); show(); }

async function answer(T, on) {
  if (busy) return; busy = true;
  LS.set(offKey(), on ? '0' : '1');
  try { idxOf[T.quest] = 0; await reportStep(T.quest, 'welcome'); }
  catch (e) { say('Error: ' + e.message, 'err'); }
  finally { busy = false; }
}
function skipTour() { LS.set(offKey(), '1'); stop(); say('Tour switched off. Your missions are still under Missions.', 'ok'); }

function run(T, q) {
  const steps = q.steps || [];
  const done = id => steps.some(s => s.id === id && s.done);
  if (T.welcome) {
    if (!steps.some(s => s.id === 'welcome')) return stop();   /* no welcome step on the server yet: stay quiet */
    if (!done('welcome')) {
      return set('welcome:' + T.quest, () => {
        const w = T.welcome(name());
        modal({ kicker: w.kicker, title: w.title, paras: w.paras, buttons: [{ label: w.start, onClick: () => answer(T, true) }, { label: w.skip, alt: true, onClick: () => answer(T, false) }] });
      });
    }
  }
  if (LS.get(offKey()) === '1' || S.current === 'missions') return stop();
  if (q.status === 'ready') return set('final:' + T.quest, () => pointAt({ target: T.final.target, text: T.final.text }));
  let i = idxOf[T.quest] || 0;
  while (i < T.beats.length && T.beats[i].until && done(T.beats[i].until)) i++;
  idxOf[T.quest] = i;
  if (i >= T.beats.length) return stop();
  const b = T.beats[i];
  if (b.screen && S.current !== b.screen) {
    if (b.seen && !b.until) { idxOf[T.quest] = i + 1; return run(T, q); }
    return stop();
  }
  set('beat:' + T.quest + ':' + i, () => {
    b.seen = true;
    pointAt({ target: b.target, text: b.text, onNext: b.next ? () => { idxOf[T.quest] = i + 1; evaluate(); } : null, onSkip: skipTour });
  });
}

function evaluate() {
  if (!S.last || !S.last.character) return stop();
  const qs = missionList();
  for (const T of TOURS) {
    const q = qs.find(x => x.id === T.quest);
    if (!q || q.status === 'claimed' || q.status === 'failed' || q.status === 'offered') continue;
    return run(T, q);                                  /* the first tutorial that is still open */
  }
  stop();
}

missionWatchers.push(evaluate);
screenWatchers.push(evaluate);

export function resetTour() { for (const k in idxOf) delete idxOf[k]; key = ''; busy = false; TOURS.forEach(T => T.beats.forEach(b => { b.seen = false; })); clearPointer(); closeModal(); }
