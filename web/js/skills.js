// skills.js - the Skills screen, opened from the Profile screen (no tab).
// Calibrations (Cal) at the top, then one collapsible section per group (closed at first). Each skill is a box: tap it to open a
// short explanation with a Spend button. Display + requests only: the server (skills.ts, SQL skill_buy) does the maths and the buying.
// Skills that cannot be bought yet are shown dimmed with a short note. This file makes its own div (id scr-skills), so index.html
// needs no change. Loaded by profile.js.
// 2026-11-07 phone layout: Available / Earned / Spent on one line, group bars like the other screens, compact skill rows with thin Grade segments,
// the opened skill shows the flavor text, what the next Grade gives and ONE line: its cost and the Spend button (opening the skill is the confirmation step).
import { S, addScreen, openScreen, el, call, whole } from 'core';

const box = el('div', '');
box.id = 'scr-skills'; box.hidden = true;
document.getElementById('scr-profile').parentNode.appendChild(box);
const css = document.createElement('style');
css.textContent = [
  '#scr-skills h2{font-size:18px;font-weight:500;color:#fff;margin:4px 4px 8px;display:flex;justify-content:space-between;align-items:center}',
  '#scr-skills .skg{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px 12px;padding:8px}',
  '#scr-skills .skk{font-size:11px;color:#8d98b2;font-weight:400}',
  '#scr-skills .skv{font-size:13px;color:#fff;font-weight:500}',
  '#scr-skills .skbar{display:flex;width:100%;align-items:center;gap:8px;margin:10px 0 0;padding:0 8px;min-height:34px;border-radius:0;text-align:left;background:rgba(120,160,210,.16);border:0;border-top:2px solid rgba(120,160,210,.55);border-bottom:1px solid rgba(120,160,210,.25);color:#fff;font-weight:500;font-size:13px}',
  '#scr-skills .skbar .gi{font-size:11px;font-weight:400;color:#8d98b2}',
  '#scr-skills .sk{padding:6px 8px;border-bottom:1px solid #2f3a58;color:#fff;font-weight:500;font-size:13px;cursor:pointer}',
  '#scr-skills .sk.sel{background:#2a3350;outline:2px solid #e8b64a;outline-offset:-2px}',
  '#scr-skills .sk.dim{opacity:.5;cursor:default}',
  '#scr-skills .skt{display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
  '#scr-skills .sks{font-size:11px;font-weight:400;color:#8d98b2}',
  '#scr-skills .skw{font-size:11px;font-weight:400;color:#fff}',
  '#scr-skills .skp{margin:0 0 6px;padding:8px;background:rgba(120,160,210,.10);border:1px solid rgba(120,160,210,.35);border-radius:8px;color:#fff;font-size:11px;font-weight:400}',
  '#scr-skills .skf{font-style:italic;color:#b9c3dc;margin-bottom:6px}',
  '#scr-skills .skp button{height:34px;min-height:0;margin:0;padding:0 12px;font-size:13px}',
].join('');
document.head.appendChild(css);

// One short grey line beside each group title (display text only).
const GROUP_INFO = { flight: 'Endurance and trip time', tactical: 'Weapons and maneuvering', eng: 'Ship hardware', market: 'Trading' };

// Dropdown wording per skill (by name). rest = the words after the number; sign = replaces the sign; tot = what follows the number in "your total".
// A skill with no entry uses the effect text from the database as it is.
const WORDS = {
  'Healing Factor': { rest: 'faster endurance recovery' },
  'G-Tolerant': { rest: 'Thrust Threshold (no endurance used)', tot: ' Thrust Threshold' },
  'Cubic Discipline': { rest: 'cargo space' },
  'Heavy Burn': { rest: 'maximum thrust' },
  'Gigawatt Savant': { rest: 'ship power output' },
  'Spot Price': { rest: 'better sell price' },
  'Hard Bargain': { sign: '', rest: 'off buy prices', tot: ' off' },
  'Proxy Broker': { sign: '', rest: 'off the remote fee', tot: ' off' },
};
// The flavor text shown at the top of a skill's dropdown (from the skill design document, section 5).
const FLAVOR = {
  "Dense Frame": "They swapped the calcium for woven carbon and told you it would hold. Four g, six g, eight. The frame keeps its shape long after the meat would have quit.",
  "Healing Factor": "The blood substitute scrubs out the burn before you've unbuckled. By the time the couch lets go, the shaking has already stopped. You never got the hang of tiring, only of getting over it.",
  "G-Tolerant": "Medical charts list the limit in numbers. Yours keeps moving. The vision still narrows at the edges, but it narrows later, and the numbers on the chart are out of date.",
  "Thermal Bite": "A laser doesn't hit so much as it stays. Hold the beam on one point of the hull and the plating goes from grey to orange to open space. You learned to be patient with the trigger.",
  "Collimator": "A beam spreads the farther it travels, and a spread beam is just a warm spot. You trimmed the optics until the dot at forty thousand klicks was still a dot. The target felt it before it saw you.",
  "Hammerfall": "Twenty kilos of tungsten, a few seconds of capacitor charge, and the rails do the rest. You stopped asking what the slug does to a hull. You just count how many it takes to finish the job.",
  "Dead Reckoning": "A slug can't be steered once it leaves the rails. So you steer the target instead, in your head, with arithmetic. Velocity, bearing, a few minutes of patience. When the hit lands, it lands where you already decided it would.",
  "Brisance": "Anyone can build a bigger warhead. You learned how to make the blast arrive all at once, so the shock hits the hull before the hull knows to flex. The salvage crews call the results \"confetti.\"",
  "Fuel Margin": "Every missile is a tank with a warhead bolted on. You shaved the guidance package, trimmed the burn profile, and found another few seconds of thrust in the margin. Far enough that the target stopped worrying.",
  "Fourth State": "Not solid, not liquid, not gas. Plasma is what matter becomes when you stop asking it to behave. The bolt leaves the muzzle barely held together, and it spends everything it has on the first thing it touches.",
  "Gauss Cage": "The bolt wants to come apart the moment it leaves the muzzle. A good field holds it together a little longer. You tuned the cage until the plasma crossed the gap still angry, still whole, and still yours to aim.",
  "Twitch Vector": "The ship turns when you think about turning. Somewhere between the augmented nerves and the attitude thrusters, the delay disappeared. Other pilots call it luck. The gunners who missed you call it something worse.",
  "Aegis Weave": "A shield doesn't stop a hit so much as spread it out and bleed it off. You taught yours to knit itself closed between volleys. The gain is small, but it adds up over a long fight.",
  "Gigawatt Savant": "The reactor was rated for a number. You found the number was a suggestion. A little rerouting, a little nerve, and the whole ship hums a note the manufacturer never heard.",
  "Cubic Discipline": "Space is the one thing a ship never has enough of. You measure the hold twice and load it once. No loose crates, no wasted corners, no excuses. The manifest says the same ship carries more.",
  "Ceramic Applications": "Ceramic doesn't bend. It breaks, and that is its job. Each tile gives itself up to the round, then gets pried off and replaced by hand. Every scar is a hit that didn't reach you.",
  "Heavy Burn": "The engines will give you more if you stop asking politely. You open the throttle past the point where the couch starts to creak. The stars smear. Your frame holds, and the ship goes where you pointed it.",
  "Spot Price": "Prices move by the minute, and most traders are a minute late. You watch the ticker the way a pilot watches a gauge. When the number is right, you sell. When it isn't, you wait, and the cargo can wait longer than they can.",
  "Hard Bargain": "The seller names a price. You look at the cargo, look at the dock, and say nothing for a while. Silence is cheaper than credits. By the time they speak again, the number has dropped.",
  "Proxy Broker": "You can't be at every dock. So you built a network of agents who can. A message crosses the void, a stranger shakes hands in your name, and the deal closes before you've left your couch. Distance is just another fee, and you've learned how to pay less of it.",
};

let D = null;                         // the last 'skills' answer from the server
let busy = false;
let openGroups = new Set();           // group ids that are unfolded (all closed at first)
let openSkill = null;                 // the skill whose box is unfolded (one at a time)
let note = '', noteCls = 'muted';

// Splits an effect text like "+2% total endurance" into sign, number, unit and the rest, so we can scale it by a Grade.
function parts(effect) {
  const m = String(effect).match(/^([+-]?)(\d+(?:\.\d+)?)(\s?(?:%|g))?\s*(.*)$/);
  return m ? { sign: m[1], num: parseFloat(m[2]), unit: m[3] || '', rest: m[4] } : null;
}
function sparts(s) {                  // parts() of a skill's effect, with our own wording on top
  const p = parts(s.effect), w = WORDS[s.name];
  return p && w ? Object.assign({}, p, w) : p;
}
const val = (p, grade) => p.sign + String(Math.round(p.num * grade * 100) / 100) + p.unit;   // "+6%"
function bonusText(s, grade) {        // the bonus at a Grade, e.g. "+6% total endurance"; null at Grade 0
  const p = sparts(s);
  if (grade <= 0) return null;
  return p ? val(p, grade) + ' ' + p.rest : s.effect;
}
const cals = n => n + ' Calibration' + (n === 1 ? '' : 's');

function bars(grade, max) {           // thin bars, one per Grade, filling the width of the row
  const row = el('div', '');
  row.style.cssText = 'display:flex;gap:3px;margin:5px 0 4px;';
  for (let i = 1; i <= max; i++) {
    const p = el('div', '');
    p.style.cssText = 'flex:1;height:6px;border-radius:2px;background:' + (i <= grade ? '#e8b64a' : '#0c1220') + ';border:1px solid ' + (i <= grade ? '#e8b64a' : '#2c3652') + ';';
    row.appendChild(p);
  }
  return row;
}

// The unfolded part under a skill row: the flavor text, what the next Grade gives, then ONE line: the cost and the Spend button.
function panel(s) {
  const p = el('div', 'skp');
  p.onclick = e => e.stopPropagation();
  const fl = FLAVOR[s.name];
  if (fl) p.appendChild(el('div', 'skf', fl));
  if (s.next_cost == null) { p.appendChild(el('div', '', s.name + ' is at its top Grade.')); return p; }
  const next = s.grade + 1, cal = D.cal || {}, have = Number(cal.available || 0);
  const pp = sparts(s);
  const per = pp ? val(pp, 1) + ' ' + pp.rest : s.effect;
  if (!s.can_buy) {
    p.appendChild(el('div', '', 'Grade ' + next + ' of ' + s.name + ' needs ' + cals(s.next_cost) + ', and you have ' + whole(have) + '.'));
    return p;
  }
  const gives = s.grade === 0
    ? 'Grade 1 of ' + s.name + ' gives you ' + per + '.'
    : 'Grade ' + next + ' of ' + s.name + ' gives you another ' + per + (pp ? ', bringing your total to ' + val(pp, next) + (pp.tot || '') + '.' : '.');
  const g = el('div', '', gives); g.style.marginBottom = '8px'; p.appendChild(g);
  const row = el('div', 'skt'); row.style.alignItems = 'center';
  row.appendChild(el('span', 'sks', 'Cost ' + cals(s.next_cost)));
  const btn = el('button', '', 'Spend ' + s.next_cost + ' Cal');
  btn.disabled = busy;
  btn.onclick = () => buy(s);
  row.appendChild(btn);
  p.appendChild(row);
  return p;
}

function skillBox(s) {
  const w = el('div', '');
  const c = el('div', 'sk' + (openSkill === s.id && s.active ? ' sel' : ''));
  const top = el('div', 'skt');
  top.appendChild(el('span', '', s.name));
  const sp = sparts(s);
  const per = (sp ? val(sp, 1) + ' ' + sp.rest : s.effect) + ' per Grade';
  if (!s.active) {                                  // cannot be bought yet: dimmed, not tappable
    c.classList.add('dim');
    c.appendChild(top);
    c.appendChild(el('div', 'sks', s.locked_note || 'Not available yet'));
    w.appendChild(c);
    return w;
  }
  top.appendChild(el('span', 'sks', s.next_cost == null ? 'Max Grade' : 'Grade ' + s.grade + ' / ' + D.max_grade));
  c.appendChild(top);
  c.appendChild(bars(s.grade, D.max_grade));
  const info = el('div', 'skt');
  const bt = bonusText(s, s.grade);
  info.appendChild(el('span', bt ? 'skw' : 'sks', bt || 'No bonus yet'));
  info.appendChild(el('span', 'sks', per));
  c.appendChild(info);
  c.setAttribute('role', 'button'); c.tabIndex = 0;   // the row itself is the button (also at the top Grade, to read the flavor text)
  c.onclick = () => { openSkill = openSkill === s.id ? null : s.id; draw(); };
  w.appendChild(c);
  if (openSkill === s.id) w.appendChild(panel(s));
  return w;
}

function draw() {
  box.replaceChildren();
  const h = el('h2', '', 'Skills');
  const x = el('button', 'alt', 'X');               // back to Profile: square, top right
  x.style.cssText = 'width:34px;height:34px;padding:0;margin:0;flex:none;min-height:0;';
  x.title = 'Back to Profile'; x.setAttribute('aria-label', 'Back to Profile');
  x.onclick = () => openScreen('profile');
  h.appendChild(x);
  box.appendChild(h);
  const cal = D && D.cal ? D.cal : null;
  const g = el('div', 'skg');
  [['Available', cal ? whole(cal.available) : '...'], ['Earned', cal ? whole(cal.earned) : ''], ['Spent', cal ? whole(cal.spent) : '']].forEach(([k, v]) => {
    const d = el('div', ''); d.append(el('div', 'skk', k), el('div', 'skv', v)); g.appendChild(d);
  });
  box.appendChild(g);

  if (note) box.appendChild(el('div', 'pad ' + noteCls, note));
  if (!D) { if (!note) box.appendChild(el('div', 'muted pad', 'Loading...')); return; }

  const groups = [];                                // keep the server's order
  for (const s of D.skills) {
    let gr = groups.find(y => y.id === s.group_id);
    if (!gr) { gr = { id: s.group_id, name: s.group_name, skills: [] }; groups.push(gr); }
    gr.skills.push(s);
  }
  for (const gr of groups) {
    const sec = el('section', '');
    const isOpen = openGroups.has(gr.id);
    const hb = el('button', 'skbar');               // the whole bar is a button: tap to fold / unfold
    hb.type = 'button';
    hb.append(el('span', '', (isOpen ? '\u25BE ' : '\u25B8 ') + gr.name), el('span', 'gi', GROUP_INFO[gr.id] || ''));
    hb.onclick = () => { if (isOpen) openGroups.delete(gr.id); else openGroups.add(gr.id); draw(); };
    sec.appendChild(hb);
    if (isOpen) gr.skills.forEach(s => sec.appendChild(skillBox(s)));
    box.appendChild(sec);
  }
}

async function load() {
  try { D = await call('skills'); }
  catch (e) { note = 'Error: ' + e.message; noteCls = 'err'; }
  draw();
}

async function buy(s) {
  if (busy) return;
  busy = true; note = ''; draw();
  try {
    const r = await call('skill_buy', { skill: s.id });
    D = r; openSkill = null; note = s.name + ' is now Grade ' + r.grade + '.'; noteCls = 'ok';
    if (S.refresh) S.refresh();                     // the top bars and the ship (endurance, hold) change with some skills
  } catch (e) {
    const code = e.data && e.data.error;
    note = 'Could not buy: ' + (code === 'not_enough_cal' ? 'not enough Calibrations.' : (code || e.message)); noteCls = 'err';
    try { D = await call('skills'); } catch (e2) {}
  }
  busy = false; draw();
}

addScreen('skills', 'Skills', box, { noTab: true, onShow() { openGroups = new Set(); openSkill = null; note = ''; draw(); load(); } });
export function resetSkills() { D = null; busy = false; openGroups = new Set(); openSkill = null; note = ''; box.replaceChildren(); }
