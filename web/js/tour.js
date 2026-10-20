// tour.js - the guided tours of the tutorial missions: a pointer (and, for tutorial 1, a welcome message) that walks the player through the screens.
// All the wording and the targets live in TOURS below. The SERVER keeps the progress (mission steps); this file only shows it.
// A step is finished by itself when its id equals the name of a screen opened or of a server action that succeeded (see missions.js).
// FREE MODE: the player can tap anything while a pointer is up; the pointer follows what they have done.
// The 'Skip tour' choice is one switch per pilot: it switches off the pointers of ALL tutorials.
import { S, LS, say, screenWatchers } from 'core';
import { missionList, missionWatchers, reportStep } from './missions.js';
import { pointAt, clearPointer, modal, closeModal } from './coach.js';

// A beat points at one thing. until = the mission step that finishes it (no Next button); next = shows a Next button;
// check = a function: the beat is finished when it returns true (looked at about every 0.7 s).
// finals = what the pointer does once the mission is READY, one after the other (default: just `final`); a final with screen is skipped when the player is elsewhere.
// tap = moves on when the player taps the highlighted thing; screen = only shown while that screen is open (a Next beat for a screen the player has left moves on).
// target = a css selector, {sel, text} or a list of those (see coach.js).
const earthPicked = () => { const n = document.querySelector('#mloc .lpname'); return !!n && n.textContent.includes('Earth'); };   /* the Market place box shows Earth */

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
    final: { target: '#nav button[data-screen="missions"]', text: 'Mission complete! Open the Missions tab and claim your reward.' },
  },
  {
    quest: 'tutorial_2',
    welcome: name => ({
      kicker: 'NEW MISSION STARTED: FIRST FLIGHT',
      title: 'Luna Flight Control',
      paras: [
        'Flight Control clears you for departure, ' + name + '. Your courier carries no fuel at all: the G-Drive bends gravity in front of the hull and the ship falls into it.',
        'There are no brakes in space. A ship keeps its momentum, so every trip is an acceleration to the halfway point, a flip, and an equal deceleration to stop. More thrust gets you there sooner, but anything above your base threshold (3 g), drains your Endurance. The default trip will use 50% of your bar, wait for it to refill, then drain it again.',
        'The planets will hold still while you travel. Distances are constantly changing: the same trip can be short today and long next week.',
        'Your first run is to EARTHH ORBIT. Earth Space Command keeps its fleet there, and they notice who arrives. Get there, and they will have work for you.',
      ],
      start: 'Show me the controls', skip: "Skip - I'll work it out",
    }),
    beats: [
      { target: '#nav button[data-screen="travel"]', until: 'travel', text: 'Time to fly. Tap the Fly tab.' },
      { target: '#map', screen: 'travel', next: true, text: 'The live map of the solar systemm. The planets orbit the Sun in real time (at 60x normal). Your ship is on the map, and so is every location that you can fly to.' },
      { target: '.zb', screen: 'travel', next: true, text: 'ZOOM. Inner shows the inner planets, System shows everything, Ship centres on your own ship, very close. You can also pan and zoom the map by touch.' },
      { target: '.thr', screen: 'travel', next: true, text: 'THRUST, in g is shown in the bar on the right side of the map. Drag the slider: more g is a faster trip, but above your threshold (3 g at the start) it drains Endurance.' },
      { target: '#depshead', screen: 'travel', tap: true, text: 'DESTINATIONS. Tap here to open the list of places you can fly to.' },
      { target: { sel: '#deps .row', text: 'Earth Orbit' }, screen: 'travel', tap: true, text: 'Your first trip is to EARTH ORBIT. Tap it. Every line shows how long the trip takes at your current thrust.' },
      { target: ['#deps .lbtn', '#go'], screen: 'travel', until: 'queue_travel', text: 'Press LAUNCH. The ship accelerates to the halfway point, flips, and brakes to arrive. Launch gets you under way; the trip time is shown in real minutes.' },
    ],
    final: { target: '#nav button[data-screen="missions"]', text: 'You are under way! Open the Missions tab and claim your reward.' },
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
      { target: '#nav button[data-screen="market"]', until: 'market', text: 'Tap the Market tab.' },
      { target: '#mloc', screen: 'market', next: true, text: 'LOCATION. This is the market of the location you have selected. It opens on your ship\'s own location (tagged with the ship icon). "All locations" lists every location. You can trade at any location from here.' },
      { target: '#mbody', screen: 'market', next: true, text: 'THE SECTIONS. The market screen is divided into sections. "Cargo" is your ship\'s hold. "Stored Here" is what you keep at this location. "Produced Here" lists goods this location makes: cheaper when goods are plentiful, so buy from it when the percentage under the stock is high. "Consumed Here" lists goods that the location will use up: it pays well when the percentage under stock is low, so check it before you sell. Tap a section heading to fold it.' },
      { target: '#mbody .mhead', screen: 'market', next: true, text: 'THE COLUMNS. "Buy for" is what you will pay, "Sell at" is what they pay you, and "Stock" is how many are on the shelf, the % shows how much of the full supply amount that is. A location will produce up to 150% of full supply, and that would be a great time to buy. Touch the top of any column to re-order the rows. Touch it again to flip the order.' },
      { target: [{ sel: '#mloc .lprow', text: 'Earth' }, '#mloc .locsel'], screen: 'market', check: earthPicked, text: 'Now change the Location Selector to EARTH ORBIT: tap the box, then choose Earth Orbit.' },
      { target: ['#mbody .hint', '#mloc'], screen: 'market', next: true, text: 'REMOTE FEE. You can trade at any location, even one your ship is not docked at, but it costs an extra fee (10% at the start; the Proxy Broker skill lowers it). The prices on screen already include it. Once your ship is docked at Earth Orbit there is no fee.' },
      { target: '#mbody .mrow', screen: 'market', check: rowSelected, text: 'Time to BUY. The best way is to wait until your ship has docked at Earth Orbit. Then look at the Stock column of the Produced Here section, and pick the good with the highest % under its quantity: it is the most plentiful, therefore the best bargin. Tap its row to select it.' },
      { target: ['.pop', '#mbody .mrow'], screen: 'market', until: 'buy:earth', text: 'Start SMALL: press 1 and read the "in total" line. The price rises with every unit you buy, so small lots let you purchase at a better price: compare 1 with 10. When docked, "To: Hold" puts the goods in your ship\'s hold, "Storage" places the goods into storage at that location. (You can move goods from hold to storage and back, on the market screen). Then press BUY.' },
      { target: '#mbody .row', screen: 'market', next: true, text: 'Bought! To finish this mission, fly back to LUNA and SELL what you bought. Not every place buys every good, so check first: press and HOLD a row for half a second to open its destinations list, and make sure Luna is on it. Goods bought from afar wait in storage, you would need to dock there, and Load them into your hold. Sell from Cargo: tap the row, then Sell. ' },
    ],
    finals: [
      { target: { sel: '#mbody .sech', text: 'Freight' }, screen: 'market', next: true, text: 'FREIGHT. Contracts that start at this place show here (when there are none, there is no Freight heading). Each names a destination, the pay per unit of hold space (CU) and a time window. Tap one, choose how many units, and accept: it uses your hold. Deliver early for a bonus; late and the load fails.' },
      { target: '#nav button[data-screen="missions"]', text: 'Mission complete! Open the Missions tab and claim your reward.' },
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
  if (q.status === 'ready') {
    const fins = T.finals || [T.final];
    let f = finalOf[T.quest] || 0;
    while (f < fins.length - 1 && fins[f].screen && S.current !== fins[f].screen) f++;
    finalOf[T.quest] = f;
    const fb = fins[f];
    return set('final:' + T.quest + ':' + f, () => pointAt({
      target: fb.target, text: fb.text,
      onNext: fb.next ? () => { finalOf[T.quest] = f + 1; evaluate(); } : null, onSkip: fb.next ? skipTour : null }));
  }
  let i = idxOf[T.quest] || 0;
  while (i < T.beats.length && ((T.beats[i].until && done(T.beats[i].until)) || (T.beats[i].check && T.beats[i].check()))) i++;
  idxOf[T.quest] = i;
  if (i >= T.beats.length) return stop();
  const b = T.beats[i];
  if (b.screen && S.current !== b.screen) {
    if (b.seen && b.next) { idxOf[T.quest] = i + 1; return run(T, q); }
    return stop();
  }
  set('beat:' + T.quest + ':' + i, () => {
    b.seen = true;
    pointAt({ target: b.target, text: b.text, onNext: b.next ? () => { idxOf[T.quest] = i + 1; evaluate(); } : null,
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

export function resetTour() { for (const k in idxOf) delete idxOf[k]; for (const k in finalOf) delete finalOf[k]; key = ''; busy = false; TOURS.forEach(T => T.beats.forEach(b => { b.seen = false; })); clearPointer(); closeModal(); }
