// skills.js - the Skills screen, opened from the Profile screen (no tab).
// Lists all skills in their groups with your Grades and Cal. Display + requests only: the server (skills.ts, SQL skill_buy)
// does the maths and the buying. Skills that cannot be bought yet are shown greyed with a short note.
// This file makes its own div (id scr-skills), so index.html needs no change. Loaded by profile.js.
import { S, addScreen, openScreen, el, call, whole } from 'core';

const box = el('div', '');
box.id = 'scr-skills'; box.hidden = true;
document.getElementById('scr-profile').parentNode.appendChild(box);

let D = null;                 // the last 'skills' answer from the server
let busy = false, armed = null, armTimer = null;   // armed = the skill whose Buy button was tapped once (tap again to confirm)
let note = '', noteCls = 'muted';

// "+2% total endurance" at Grade 3 -> "+6% total endurance" (the first number is scaled by the Grade)
function scaled(effect, grade) {
  return effect.replace(/(\d+(?:\.\d+)?)/, m => String(Math.round(parseFloat(m) * grade * 100) / 100));
}
function pips(grade, max) {
  const row = el('div', '');
  row.style.margin = '4px 0';
  for (let i = 1; i <= max; i++) {
    const p = el('span', '');
    p.style.cssText = 'display:inline-block;width:16px;height:8px;margin-right:2px;border-radius:2px;background:' + (i <= grade ? '#e8b64a' : '#222b40');
    row.appendChild(p);
  }
  return row;
}
function card(dim) {
  const c = el('div', '');
  c.style.cssText = 'border:1px solid #222b40;border-radius:6px;padding:8px;margin:6px 0;' + (dim ? 'opacity:.6;' : '');
  return c;
}

function draw() {
  box.replaceChildren();
  const back = el('button', 'alt', '< Profile');
  back.onclick = () => openScreen('profile');
  box.appendChild(back);
  box.appendChild(el('h2', '', 'Skills'));
  if (note) box.appendChild(el('div', 'pad ' + noteCls, note));
  if (!D) { if (!note) box.appendChild(el('div', 'muted pad', 'Loading...')); return; }

  const cal = D.cal || {};
  const head = el('div', 'pad');
  const big = el('div', '', 'Cal available: ' + whole(cal.available || 0));
  big.style.fontWeight = '700';
  head.appendChild(big);
  head.appendChild(el('div', 'muted', 'Earned ' + whole(cal.earned || 0) + ', spent ' + whole(cal.spent || 0) + '. Cal comes from levelling up. Grade N costs N Cal.'));
  box.appendChild(head);

  let lastGroup = null, sec = null;
  for (const s of D.skills) {
    if (s.group_id !== lastGroup) {
      lastGroup = s.group_id;
      sec = el('section', '');
      sec.appendChild(el('h2', '', s.group_name));
      box.appendChild(sec);
    }
    if (!s.active) {                       // greyed: cannot be bought yet
      const c = card(true);
      const top = el('div', '');
      top.appendChild(el('strong', '', s.name));
      top.appendChild(el('span', 'muted', '  -  ' + (s.locked_note || 'Not available yet')));
      c.appendChild(top);
      c.appendChild(el('div', 'muted', s.effect + ' per Grade'));
      sec.appendChild(c);
      continue;
    }
    const c = card(false);
    const top = el('div', '');
    top.appendChild(el('strong', '', s.name));
    top.appendChild(el('span', 'muted', '  -  Grade ' + s.grade + ' / ' + D.max_grade));
    c.appendChild(top);
    c.appendChild(pips(s.grade, D.max_grade));
    c.appendChild(el('div', 'muted', s.effect + ' per Grade'));
    c.appendChild(el('div', '', s.grade > 0 ? 'Now: ' + scaled(s.effect, s.grade) : 'Now: no bonus'));
    const b = el('button', '');
    if (s.next_cost == null) { b.textContent = 'Maxed'; b.className = 'alt'; b.disabled = true; }
    else if (!s.can_buy) { b.textContent = 'Grade ' + (s.grade + 1) + ' needs ' + s.next_cost + ' Cal'; b.className = 'alt'; b.disabled = true; }
    else if (armed === s.id) { b.textContent = 'Tap again to confirm: Grade ' + (s.grade + 1) + ' for ' + s.next_cost + ' Cal'; }
    else { b.textContent = 'Raise to Grade ' + (s.grade + 1) + ' (' + s.next_cost + ' Cal)'; b.className = 'alt'; }
    if (busy) b.disabled = true;
    b.onclick = () => buy(s);
    c.appendChild(b);
    sec.appendChild(c);
  }
}

async function load() {
  try { D = await call('skills'); }
  catch (e) { note = 'Error: ' + e.message; noteCls = 'err'; }
  draw();
}

async function buy(s) {
  if (busy) return;
  if (armed !== s.id) {                    // first tap: ask to confirm (Cal spent cannot be taken back)
    armed = s.id; clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed = null; draw(); }, 4000);
    draw(); return;
  }
  busy = true; armed = null; clearTimeout(armTimer); note = ''; draw();
  try {
    const r = await call('skill_buy', { skill: s.id });
    D = r; note = s.name + ' is now Grade ' + r.grade + '.'; noteCls = 'ok';
    if (S.refresh) S.refresh();            // the top bars and the ship (endurance, hold) change with some skills
  } catch (e) {
    const code = e.data && e.data.error;
    note = 'Could not buy: ' + (code === 'not_enough_cal' ? 'not enough Cal.' : (code || e.message)); noteCls = 'err';
    try { D = await call('skills'); } catch (e2) {}
  }
  busy = false; draw();
}

addScreen('skills', 'Skills', box, { noTab: true, onShow() { armed = null; note = ''; draw(); load(); } });
export function resetSkills() { D = null; armed = null; busy = false; note = ''; box.replaceChildren(); }
