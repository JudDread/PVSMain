// tour.js - the guided tours of the tutorial missions: a pointer (and, for tutorial 1, a welcome message) that walks the player through the screens.
// All the wording and the targets live in TOURS below. The SERVER keeps the progress (mission steps); this file only shows it.
// A step is finished by itself when its id equals the name of a screen opened or of a server action that succeeded (see missions.js).
// LOCKED: while a pointer is up only the highlighted thing (and the speech box buttons) can be tapped; `hole` = a list of selectors that stay tappable too ([] = nothing).
// A beat with fromMissions: true is also shown while the Missions screen is open (the first beat of a new mission points at a bottom tab).
// skipIf = a mission step; once it is done the beat is skipped (a page reload or a replay never shows the early teaching again after the player has already done the thing).
// A beat with no target shows only the message (no ring, no grey-out) and does not move the player's focus.
// needs = a mission step that must be done before the beat is shown (until then the pointer stays quiet); label = text of the Next button.
// A final with next + label 'OK' keeps the last instruction on screen until the player taps OK.
// The 'Skip tour' choice is one switch per pilot: it switches off the pointers of ALL tutorials.
import { S, LS, say, screenWatchers } from 'core';
import { missionList, missionWatchers, reportStep } from './missions.js';
import { pointAt, clearPointer, modal, closeModal } from './coach.js';
import { levelImages, markLevelSeen } from './levelup.js';

// A beat points at one thing. until = the mission step that finishes it (no Next button); next = shows a Next button;
// check = a function: the beat is finished when it returns true (looked at about every 0.7 s).
// finals = what the pointer does once the mission is READY, one after the other (default: just `final`); a final with screen is skipped when the player is elsewhere.
// tap = moves on when the player taps the highlighted thing; screen = only shown while that screen is open (a Next beat for a screen the player has left moves on).
// target = a css selector, {sel, text} or a list of those (see coach.js).
const earthPicked = () => { const n = document.querySelector('#mloc .lpname'); return !!n && n.textContent.includes('Earth'); };   /* the Market place box shows Earth */

const lunaPicked = () => { const n = document.querySelector('#mloc .lpname'); return !!n && n.textContent.includes('Luna'); };   /* the Market place box shows Luna */

const producedLuna = () => { const x = document.querySelector('#mbody .sech select'); return !!x && x.value === 'luna'; };   /* the place selector in the Produced Here heading shows Luna */

/* Collapse every Market section except Freight and make sure Freight is open, so the Freight section is on the screen without scrolling.
   Tapping a heading is safe to repeat (it sets open/shut from what it saw when it was drawn). Returns true once the Freight heading exists. */
function showOnlyFreight() {
  const heads = () => [...document.querySelectorAll('#mbody .sech')];
  if (!heads().some(h => /Freight/.test(h.textContent))) return false;
  heads().filter(h => !/Freight/.test(h.textContent) && h.textContent.trim().startsWith('\u25BE')).forEach(h => h.click());
  const f = heads().find(h => /Freight/.test(h.textContent));
  if (f && f.textContent.trim().startsWith('\u25B8')) f.click();
  return true;
}

const rowSelected = () => !!document.querySelector('#mbody .mrow.sel');   /* a good is selected in a Market list (its buy panel is open) */

const TOURS = [
  {
    quest: 'tutorial_1',
    welcome: name => ({
      kicker: 'NEW MISSION STARTED: WELCOME ABOARD',
      title: 'Luna Sovereignty - Pilot Registry',
      paras: [
        'Welcome to Luna, ' + name + '. Your papers are stamped and your slot in the registry is open.',
        'You are Homo Sapiens Astroalis, a pilot bred for the darkness of space and the rigours of the G-Drive. It burns no fuel: instead creating a  gravity well in front of your hull, that pulls your ship forward, and it asks your body to pay for it. Earthers call your kind Black-Eyes. Out here you are simply the people who can fly.',
        'Luna is neutral ground: shipyards, banks and brokers, where Earth Space Command, the Jovian Compact and the Martian Core all trade and mostly keep their guns quiet. Out in the Belt, Ceres and Vesta fight over every tonne of ice. On the dark side of Luna, the Black Tryst takes a cut of everything else.',
        'Everything in the sky is moving, and nobody waits for you. Your first assignment is short: learn your cockpit.',
      ],
      start: 'Start the tour', skip: "Skip - I'll find my own way",
    }),
    beats: [
      { target: '.bars > .bitem:first-child', next: true, text: 'Your LEVEL and XP. You earn XP by flying, fighting, and completing missions. Every level-up gives you Calibrations (Cal) to spend on skills.' },
      { target: '#enitem', next: true, text: 'Your ENDURANCE. The G-Drive\'s high acceleration is hard on the body: burning above your thrust threshold (3 g at the start) drains this bar, and it refills when you move at 3 g or dock. Tap the bar for a countdown.' },
      { target: '#money', next: true, text: 'Your CREDITS. Everything in the system is bought and sold with them.' },
      { target: '#pic', until: 'profile', text: 'Tap your portrait circle to open your pilot profile.' },
      { target: '#scr-profile', screen: 'profile', next: true, text: 'Your pilot file: level, Cals, credits, net worth, career, ship and reputation. Most of it is public, other pilots can read it. Tap Next when you are done looking.' },
      { target: '#vs', until: 'home', text: 'Tap the Vacuum State button to open the Home page: help, the Discord link and Log Out can be found here.' },
    ],
    finals: [
      { target: '#scr-home', screen: 'home', next: true, label: 'OK', hole: [], text: 'This is the Home page: help, the Discord link and Log Out can be found here. Tap OK when you are ready.' },
      { target: '#nav button[data-screen="missions"]', text: 'Mission complete! Open the Missions tab and claim your reward.' },
    ],
  },
  {
    quest: 'tutorial_2',
    welcome: name => ({
      kicker: 'NEW MISSION STARTED: FIRST FLIGHT',
      title: 'Luna Flight Control',
      paras: [
        'Flight Control clears you for departure, ' + name + '. Your courier carries no fuel at all: the G-Drive bends gravity in front of the hull and the ship falls into it.',
        'There are no brakes in space. A ship keeps its momentum, so every trip is an acceleration to the halfway point, a flip, and an equal deceleration to stop. More thrust gets you there sooner, but anything above your base threshold (3 g), drains your Endurance. The default trip will use 50% of your bar, wait for it to refill, then drain it again.',
        'The planets will not hold still while you travel. Distances are constantly changing: the same trip can be short today and long next week.',
        'Your first run is to EARTH ORBIT. Earth Space Command keeps its fleet there, and they notice who arrives. Get there, and they will have work for you.',
      ],
      start: 'Show me the controls', skip: "Skip - I'll work it out",
    }),
    beats: [
      { target: '#nav button[data-screen="travel"]', fromMissions: true, until: 'travel', text: 'Time to fly. Tap the Fly tab.' },
      { target: '#map', screen: 'travel', next: true, text: 'The live map of the solar systemm. The planets orbit the Sun in real time (at 60x normal). Your ship is on the map, and so is every location that you can fly to.' },
      { target: '.zb', screen: 'travel', next: true, text: 'ZOOM. Inner shows the inner planets, System shows everything, Ship centres on your own ship, very close. You can also pan and zoom the map by touch.' },
      { target: '.thr', screen: 'travel', next: true, text: 'THRUST, in g is shown in the bar on the right side of the map. Drag the slider: more g is a faster trip, but above your threshold (3 g at the start) it drains Endurance.' },
      { target: '#depshead', screen: 'travel', tap: true, hole: ['#depshead', '#deps'], text: 'DESTINATIONS. Tap here to open the list of places you can fly to.' },
      { target: { sel: '#deps .row', text: 'Earth Orbit' }, screen: 'travel', tap: true, hole: ['#depshead', '#deps'], text: 'Your first trip is to EARTH ORBIT. Tap it. Every line shows how long the trip takes at your current thrust.' },
      { target: ['#deps .lbtn', '#go'], screen: 'travel', hole: ['#depshead', '#deps', '#go', '.thr'], until: 'queue_travel', text: 'Press LAUNCH. The ship accelerates to the halfway point, flips, and brakes to arrive. Launch gets you under way; the trip time is shown in real minutes.' },
    ],
    finals: [
      { target: '#map', screen: 'travel', next: true, label: 'OK', hole: [], text: 'LAUNCHED! The ship accelerates to the halfway point, flips, and brakes to arrive. The trip time is shown in real minutes. Tap OK to continue.' },
      { target: '#nav button[data-screen="missions"]', text: 'You are under way! Open the Missions tab and claim your reward.' },
    ],
  },
  {
    quest: 'tutorial_3',
    welcome: name => ({
      kicker: 'NEW MISSION STARTED: FIRST TRADE',
      title: 'Luna Exchange',
      paras: [
        'Credits do not create themselves, ' + name + '. The Exchange runs on one rule: carry goods from where they are cheap to where they are wanted.',
        'Every place either makes a good, which increases the supply over time, or consumes it, which makes it valuable. Prices follow supply and demand, and the house takes a cutt on every trade, both ways.',
        'Your job: learn the Market Board, buy something at Earth Orbit, bring it home and sell it at Luna. Then the Exchange will show you the Freight Section.',
      ],
      start: 'Show me the Market Board', skip: "Skip - I know how to trade",
    }),
    beats: [
      { target: '#nav button[data-screen="market"]', fromMissions: true, until: 'market', text: 'Tap the Market tab.' },
      { skipIf: 'buy:earth', target: '#mloc', screen: 'market', next: true, text: 'LOCATION. This is the market of the location you have selected. It opens on your ship\'s own location (tagged with the ship icon). "All locations" lists every location. You can trade at any location from here.' },
      { skipIf: 'buy:earth', target: '#mbody', screen: 'market', next: true, text: 'THE SECTIONS. The market screen is divided into sections. "Cargo" is your ship\'s hold. "Stored Here" is what you keep at this location. "Produced Here" lists goods this location makes: cheaper when goods are plentiful, so buy from it when the percentage under the stock is high. "Consumed Here" lists goods that the location will use up: it pays well when the percentage under stock is low, so check it before you sell. Tap a section heading to fold it.' },
      { skipIf: 'buy:earth', target: '#mbody .mhead', screen: 'market', next: true, text: 'THE COLUMNS. "Buy for" is what you will pay, "Sell at" is what they pay you, and "Stock" is how many are on the shelf, the % shows how much of the full supply amount that is. A location will produce up to 150% of full supply, and that would be a great time to buy. Touch the top of any column to re-order the rows. Touch it again to flip the order.' },
      { skipIf: 'buy:earth', target: [{ sel: '#mloc .lprow', text: 'Earth' }, '#mloc .locsel'], screen: 'market', hole: ['#mloc', '#mloc .lprow'], check: earthPicked, text: 'Now change the Location Selector to EARTH ORBIT: tap the box, then choose Earth Orbit.' },
      { skipIf: 'buy:earth', target: ['#mbody .hint', '#mloc'], screen: 'market', next: true, text: 'REMOTE FEE. You can trade at any location, even one your ship is not docked at, but it costs an extra fee (10% at the start; the Proxy Broker skill lowers it). The prices on screen already include it. Once your ship is docked at Earth Orbit there is no fee.' },
      { skipIf: 'buy:earth', target: '#mbody .sech select', screen: 'market', hole: ['#mbody'], next: true, check: producedLuna, text: 'CHECK WHERE IT SELLS. You will sell at LUNA, but not every place buys every good. In the "Produced Here" heading there is a small selector on the right (it says All). Tap it and choose LUNA. The list then shows only goods Luna trades, and the Best column shows Luna\'s price with its stock and %. A LOW % at Luna means it is running short, so it pays well. Tap Next when you have chosen Luna.' },
      { skipIf: 'buy:earth', target: '#mbody', screen: 'market', hole: ['#mbody'], check: rowSelected, text: 'Time to BUY. Choose ONE good from this list and tap its row to select it. Because you filtered by Luna, every good here can be sold there. Pick one with a high % under Stock here (cheap to buy) and a low % in the Best column (Luna wants it). Any of them will do for this mission, and the best time to buy is once your ship has docked at Earth Orbit.' },
      { screen: 'market', hole: ['#mbody'], dock: 'top', until: 'buy:earth', text: 'Buy just 1 for now: the box starts at the MAXIMUM you can afford, so change it to 1 and read the "in total" line. The price rises with every unit, so small lots are cheaper. When docked, "To: Hold" puts the good in your ship\'s hold, "Storage" keeps it at this location. After you have changed the quantity to 1, press BUY.' },
      { target: '#mbody .row', screen: 'market', next: true, text: 'Bought! Next, fly back to LUNA and SELL what you bought. Not every place buys every good. You checked Luna with the selector, and you can also press and HOLD a row for half a second to open its destinations list and make sure Luna is on it. Goods bought from afar wait in storage, you would need to dock there, and Load them into your hold. Sell from Cargo: tap the row, then Sell. ' },
      { needs: 'sell:luna', target: [{ sel: '#mloc .lprow', text: 'Luna' }, '#mloc .locsel'], screen: 'market', hole: ['#mloc', '#mloc .lprow'], check: lunaPicked, text: 'Sold! Now the FREIGHT job: it was posted at LUNA. Set the Location Selector to LUNA: tap the box, then choose Luna.' },
      { needs: 'sell:luna', target: [{ sel: '#mbody .msec', text: 'Freight (' }, '#mbody'], screen: 'market', hole: ['#mbody'], until: 'freight_take', enter: showOnlyFreight, text: 'FREIGHT. Contracts that start at this place show here. This one was posted for you: 5 CU to EARTH ORBIT, 500 credits for each CU. Tap it, choose 5 units and press Accept (your ship must be docked at Luna). Deliver early for a bonus. If you give up the load, or it is late, it goes back on the board here and you can try again. If you do not see Freight yet, wait a few seconds.' },
      { needs: 'freight_take', target: '#nav button[data-screen="travel"]', next: true, label: 'OK', hole: [], text: 'Loaded! Now fly to EARTH ORBIT, the same way as on your first flight. When your ship docks there, the freight is delivered by itself and you are paid. Tap OK, then open the Fly tab.' },
    ],
    finals: [
      { target: '#nav button[data-screen="missions"]', text: 'Freight delivered! Mission complete! Open the Missions tab and claim your reward.' },
    ],
  },
  {
    quest: 'tutorial_4',
    welcome: name => ({
      kicker: 'NEW MISSION STARTED: REFIT',
      title: 'Luna Registry, Yard Office',
      paras: [
        'A hull is only a hull, ' + name + '. The rigs you install decide what she can do: haul, fight or scout. Pick them for the job at hand.',
        'Let us upgrade your Courier.',
      ],
      start: 'Show me', skip: 'Skip - I know my way around',
    }),
    beats: [
      { fromMissions: true, next: true, label: 'OK', until: 'arrive:luna', text: 'The Registry yard is at LUNA. Fly your Courier home. Take your time: trade, haul freight, whatever you like. I will pick this up when you dock.' },
      { needs: 'arrive:luna', fromMissions: true, target: '#nav button[data-screen="assets"]', until: 'assets', text: 'Welcome home. Open ASSETS: every ship, cargo hold and rig you own, listed by port.' },
      { target: '.ascope .scard', screen: 'assets', until: 'rigging', text: 'This is your Courier. Touch her to go below decks.' },
      { target: { sel: '#scr-rigging .msec', text: 'Fitted (' }, screen: 'rigging', next: true, text: 'BELOW DECKS. FITTED shows what is installed, and the empty slots too. The power bar is your reactor budget. Every rig takes a slot and power, so choose for the job.' },
      { target: { sel: '#scr-rigging .sech button', text: 'Shipyard' }, screen: 'rigging', until: 'facilities', text: 'No rigs installed, and your ledger is hard vacuum. The yard can help. Touch SHIPYARD.' },
      { screen: 'facilities', next: true, dock: 'top', text: 'The Luna shipyard. These sections list the hulls and rigs you can buy or sell, with prices. A new rig is beyond your reach for now, so the Registry has left you a starter kit in storage here: a railgun and armor plating. They are yours. Fit them before you sell them, or the refit cannot be finished.' },
      { target: { sel: 'button.alt', text: 'Back to rigging' }, screen: 'facilities', check: () => S.current === 'rigging', text: 'Now back to your Courier. Touch Back to rigging.' },
      { target: { sel: '#scr-rigging .rside button', text: 'Fit' }, screen: 'rigging', until: 'rig_fit', text: 'Under "Rigs and weapons here" your kit is waiting in storage. Touch Fit.' },
    ],
    finals: [
      { screen: 'rigging', next: true, label: 'OK', hole: [], text: 'Installed. Fit the other one too, if you like. Rigs come off again, free and instant, while docked, so refit her for whatever job comes next.' },
      { target: '#nav button[data-screen="missions"]', text: 'Refit complete. Open the Missions tab and claim your reward.' },
    ],
  },
  {
    quest: 'tutorial_5',
    welcome: name => ({
      kicker: 'LEVEL UP',
      images: levelImages((S.last && S.last.pilot && S.last.pilot.level) || 2),
      title: 'LEVEL ' + ((S.last && S.last.pilot && S.last.pilot.level) || 2),
      paras: [
        'The Registry has raised your pilot rating, ' + name + '. With it come Cal: calibrations, the skill points of a pilot.',
        'Skills are how a pilot grows. Let us spend yours.',
      ],
      start: 'Show me the Skills', skip: 'Later',
    }),
    beats: [
      { fromMissions: true, target: '#nav button[data-screen="skills"]', until: 'skills', text: 'Open the SKILLS tab.' },
      { screen: 'skills', dock: 'top', until: 'skill_buy', text: 'SKILLS. Each skill makes you better at something. Look through them and spend your Cal on one of them.' },
    ],
    finals: [
      { target: '#nav button[data-screen="missions"]', text: 'Cal spent. Skills are how a pilot grows. Open the Missions tab and claim your reward.' },
    ],
  },
];

const idxOf = {};                         // quest id -> position in its beats
const finalOf = {};                       // quest id -> position in its finals
let key = '', busy = false;
const name = () => (S.last && S.last.character && S.last.character.name) || 'pilot';
const offKey = () => 'pvs_tour_off:' + name();

function stop() { if (key) { key = ''; clearPointer(); closeModal(); } }
function set(k, show) { if (key === k) return; key = k; closeModal(); clearPointer(); show(); }

async function answer(T, on) {
  if (busy) return; busy = true;
  LS.set(offKey(), on ? '0' : '1');
  try { idxOf[T.quest] = 0; markLevelSeen(); await reportStep(T.quest, 'welcome'); }
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
        modal({ kicker: w.kicker, images: w.images, title: w.title, paras: w.paras, buttons: [{ label: w.start, onClick: () => answer(T, true) }, { label: w.skip, alt: true, onClick: () => answer(T, false) }] });
      });
    }
  }
  if (LS.get(offKey()) === '1') return stop();
  const onMis = S.current === 'missions';             /* on the Missions screen only a 'fromMissions' beat is shown (the pointer to the next tab) */
  if (q.status === 'ready') {
    if (onMis) return stop();                         /* the player is there to press Claim */
    const fins = T.finals || [T.final];
    let f = finalOf[T.quest] || 0;
    while (f < fins.length - 1 && fins[f].screen && S.current !== fins[f].screen) f++;
    finalOf[T.quest] = f;
    const fb = fins[f];
    return set('final:' + T.quest + ':' + f, () => pointAt({
      target: fb.target, text: fb.text, next: fb.label, lock: true, hole: fb.hole,
      onNext: fb.next ? () => { finalOf[T.quest] = f + 1; evaluate(); } : null, onSkip: skipTour }));
  }
  let i = idxOf[T.quest] || 0;
  while (i < T.beats.length && ((T.beats[i].until && done(T.beats[i].until)) || (T.beats[i].skipIf && done(T.beats[i].skipIf)) || (T.beats[i].check && T.beats[i].check()))) i++;
  idxOf[T.quest] = i;
  if (i >= T.beats.length) return stop();
  const b = T.beats[i];
  if (onMis && !b.fromMissions) return stop();
  if (b.needs && !done(b.needs)) return stop();            /* its turn has not come yet */
  if (b.screen && S.current !== b.screen) {
    if (b.seen && b.next) { idxOf[T.quest] = i + 1; return run(T, q); }
    return stop();
  }
  if (b.enter && !b.entered && b.enter()) b.entered = true;   /* e.g. fold the other sections once the thing to look at exists */
  set('beat:' + T.quest + ':' + i, () => {
    b.seen = true;
    pointAt({ target: b.target, text: b.text, next: b.label, lock: true, hole: b.hole, dock: b.dock, onNext: b.next ? () => { idxOf[T.quest] = i + 1; evaluate(); } : null,
      onTarget: b.tap ? () => { idxOf[T.quest] = i + 1; evaluate(); } : null, onSkip: skipTour });
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
setInterval(() => { if (key.startsWith('beat:') || key.startsWith('final:')) evaluate(); }, 700);   /* beats with a check, and beats whose screen the player has left */

export function resetTour() { for (const k in idxOf) delete idxOf[k]; for (const k in finalOf) delete finalOf[k]; key = ''; busy = false; TOURS.forEach(T => T.beats.forEach(b => { b.seen = false; b.entered = false; })); clearPointer(); closeModal(); }
