// missions.js - the Missions screen (bottom tab). Makes its own div and its own styles: index.html has no missions markup.
// Server actions used: 'missions' (list), 'mission_step' {quest, step}, 'mission_claim' {quest}. Display only: the server decides everything.
// STEP RULE (for now): opening a screen reports a step whose id is the screen's name (tutorial_1's step 'profile' = the Profile screen opened).
import { S, $, el, call, say, money, whole, addScreen, screenWatchers } from 'core';

const st = document.createElement('style');
st.textContent = [
  '#scr-missions .mq{background:#131a2a;border:1px solid #222b40;border-radius:8px;padding:10px;margin-bottom:10px}',
  '#scr-missions .mq.ready{border-color:#6be08f}',
  '#scr-missions .mqh{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}',
  '#scr-missions .mqt{font-weight:700;font-size:16px;color:#e8b64a}',
  '#scr-missions .mqs{font-size:12px;font-weight:600;white-space:nowrap;color:#8d98b2}',
  '#scr-missions .mq.ready .mqs{color:#6be08f}',
  '#scr-missions .mqd{margin:4px 0 6px;color:#c6cfe4;font-size:14px}',
  '#scr-missions .mst{display:flex;gap:8px;padding:5px 0;border-top:1px solid #1c2438;font-size:14px}',
  '#scr-missions .mst .ck{flex:none;width:18px;text-align:center;color:#8d98b2}',
  '#scr-missions .mst.done .ck{color:#6be08f}',
  '#scr-missions .mst.done .tx{color:#8d98b2}',
  '#scr-missions .mqr{margin-top:6px;font-size:14px;color:#6be08f}',
  '#scr-missions .mq button{margin:8px 0 0}',
  '#scr-missions .mqfold{width:100%;margin:0 0 8px;text-align:left}',
].join('');
document.head.appendChild(st);

const div = el('div'); div.id = 'scr-missions'; div.hidden = true;
$('haschar').appendChild(div);

let data = null;        // latest answer of the server action 'missions'
let loading = false, busy = false, failed = '', doneOpen = false;

const list = () => ((data && data.quests) || []);
const rewardText = r => {
  r = r || {}; const p = [];
  if (Number(r.credits)) p.push('Cr ' + money(r.credits));
  if (Number(r.xp)) p.push(whole(r.xp) + ' XP');
  if (Number(r.cal)) p.push(whole(r.cal) + ' Cal');
  return p.length ? p.join('  \u00B7  ') : 'No reward';
};

async function load() {
  if (loading) return;
  loading = true;
  try { data = await call('missions'); failed = ''; }
  catch (e) { failed = e.message; }
  finally { loading = false; }
  if (S.current === 'missions') paint();
}

async function claim(q, btn) {
  if (busy) return;
  busy = true; btn.disabled = true;
  try {
    await call('mission_claim', { quest: q.id });
    say('Reward claimed: ' + rewardText(q.reward), 'ok');
    if (S.refresh) await S.refresh();   /* credits, XP and the tab dot */
  } catch (e) {
    say(e.message === 'not_ready' ? 'That mission is not finished yet.' : 'Error: ' + e.message, 'err');
  } finally { busy = false; await load(); }
}

function card(q) {
  const ready = q.status === 'ready', done = q.status === 'claimed';
  const c = el('div', 'mq' + (ready ? ' ready' : ''));
  const h = el('div', 'mqh');
  h.append(el('span', 'mqt', q.title), el('span', 'mqs', ready ? 'Ready to claim' : done ? 'Done' : 'In progress'));
  c.appendChild(h);
  if (q.description) c.appendChild(el('div', 'mqd', q.description));
  (q.steps || []).forEach(s => {
    const r = el('div', 'mst' + (s.done || done ? ' done' : ''));
    r.append(el('span', 'ck', s.done || done ? '\u2713' : '\u25CB'), el('span', 'tx', s.label));
    c.appendChild(r);
  });
  c.appendChild(el('div', 'mqr', (done ? 'Reward paid: ' : 'Reward: ') + rewardText(q.reward)));
  if (ready) { const b = el('button', '', 'Claim reward'); b.onclick = () => claim(q, b); c.appendChild(b); }
  return c;
}

function paint() {
  div.replaceChildren();
  div.appendChild(el('h2', '', 'Missions'));
  if (failed) { div.appendChild(el('div', 'err pad', 'Could not load the missions: ' + failed)); return; }
  if (!data) { div.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const all = list();
  const open = all.filter(q => q.status !== 'claimed').sort((a, b) => (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1));
  const done = all.filter(q => q.status === 'claimed');
  if (!open.length) div.appendChild(el('div', 'muted pad', done.length ? 'No open missions right now. More will come.' : 'No missions yet.'));
  open.forEach(q => div.appendChild(card(q)));
  if (done.length) {
    const f = el('button', 'alt mqfold', (doneOpen ? '- ' : '+ ') + 'Completed (' + done.length + ')');
    f.onclick = () => { doneOpen = !doneOpen; paint(); };
    div.appendChild(f);
    if (doneOpen) done.forEach(q => div.appendChild(card(q)));
  }
}

/* A screen was opened: if an open mission has an undone step named like that screen, report it. */
async function noteScreen(name) {
  if (name === 'missions' || !S.last || !S.last.character) return;
  if (!data) await load();
  const q = list().find(x => x.status === 'active' && (x.steps || []).some(s => s.id === name && !s.done));
  if (!q) return;
  try { await call('mission_step', { quest: q.id, step: name }); await load(); if (S.refresh) S.refresh(); }
  catch (e) { /* a refused step is not worth a message */ }
}
screenWatchers.push(noteScreen);

export function resetMissions() { data = null; failed = ''; doneOpen = false; loading = false; busy = false; div.replaceChildren(); }

addScreen('missions', 'Missions', div, {
  onShow() { paint(); load(); },
  dot: () => Number(S.last && S.last.missions_ready) > 0,   /* a reward is waiting */
});
