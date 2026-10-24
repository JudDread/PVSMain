// missions.js - the Missions screen (bottom tab). Makes its own div and its own styles: index.html has no missions markup.
// One CARD per mission chain (a chain is a group of // missions.js - the Missions screen (bottom tab). Makes its own div and its own styles: index.html has no missions markup.
// One CARD per mission chain (a chain is a group of missions: Pilot Training, Earth Space Command, ...). Only open chains are sent.
// Server actions: 'missions' (list), 'mission_step' {quest, step}, 'mission_accept' {quest}, 'mission_claim' {quest}, 'missions_seen'.
// Display only: the server decides everything (what is available, timers, rewards).
// STEP RULE (for now): a step is finished by itself when its id equals the NAME of a screen the player opens (tutorial_1: 'profile' = the Profile screen)
// or the name of a server action that succeeded (tutorial_2: 'queue_travel' = a trip was launched);
// a trade also finishes 'buy', 'sell', 'buy:<place id>' and 'sell:<place id>' (tutorial_3).
// TAB DOT: shows while a reward waits (me.missions_ready) or a mission has not been looked at yet (me.missions_new).
import { S, $, el, call, say, money, whole, nowMs, addScreen, screenWatchers, actionWatchers } from 'core';

const st = document.createElement('style');
st.textContent = [
  '#scr-missions .mch{display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;text-align:left;margin:0 0 6px;padding:10px 12px}',
  '#scr-missions .mch .ct{font-weight:700;font-size:16px;color:#e8b64a}',
  '#scr-missions .mch .cs{font-size:12px;font-weight:600;color:#8d98b2;text-align:right}',
  '#scr-missions .mch .cs.hot{color:#6be08f}',
  '#scr-missions .mcb{margin:0 0 14px}',
  '#scr-missions .mcd{margin:0 2px 8px;color:#8d98b2;font-size:13px}',
  '#scr-missions .mq{background:#131a2a;border:1px solid #222b40;border-radius:8px;padding:10px;margin-bottom:10px}',
  '#scr-missions .mq.ready{border-color:#6be08f}',
  '#scr-missions .mq.failed{opacity:.65}',
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
  '#scr-missions .mdue{margin-top:4px;font-size:13px;color:#e8b64a}',
  '#scr-missions .mq button{margin:8px 0 0}',
  '#scr-missions .mqfold{width:100%;margin:0 0 8px;text-align:left}',
].join('');
document.head.appendChild(st);

const div = el('div'); div.id = 'scr-missions'; div.hidden = true;
$('haschar').appendChild(div);

let data = null;        // latest answer of the server action 'missions'
let loading = false, busy = false, failed = '';
const openMap = {};     // chain id -> true / false once the player has toggled the card (until then: open when there is something to do)
const doneMap = {};     // chain id -> the 'Completed' fold is open

const list = () => ((data && data.quests) || []);
export const missionList = list;                 // for tour.js
export const loadMissions = () => load();         // for levelup.js
export const missionWatchers = [];               // functions run after every load of the list (tour.js adds one)

const rewardText = r => {
  r = r || {}; const p = [];
  if (Number(r.credits)) p.push('Cr ' + money(r.credits));
  if (Number(r.xp)) p.push(whole(r.xp) + ' XP');
  if (Number(r.cal)) p.push(whole(r.cal) + ' Cal');
  return p.length ? p.join('  \u00B7  ') : 'No reward';
};
const span = ms => {                              // 3725000 -> '1h 2m'
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + (s % 60) + 's' : (s % 60) + 's';
};
const leftText = q => { const ms = new Date(q.due_at).getTime() - nowMs(); return ms > 0 ? 'Time left: ' + span(ms) : 'Time is up'; };

async function load() {
  if (loading) return;
  loading = true;
  try { data = await call('missions'); failed = ''; }
  catch (e) { failed = e.message; }
  finally { loading = false; }
  if (S.current === 'missions') {
    paint();
    if (data && Number(data.new) > 0) {            /* the player is looking at the list: the 'new' dot can go out */
      data.new = 0;
      call('missions_seen').then(() => { if (S.refresh) S.refresh(); }).catch(() => {});
    }
  }
  missionWatchers.forEach(f => { try { f(); } catch (e) {} });
}

// Report a step by name (throws when the server refuses). Used by tour.js; the screen-name rule below uses the same action.
export async function reportStep(quest, step) {
  const r = await call('mission_step', { quest, step });
  if (r && r.ok === false) throw new Error(r.error || 'refused');
  await load();
  if (S.refresh) S.refresh();
}

async function act(action, q, btn, okText) {
  if (busy) return;
  busy = true; btn.disabled = true;
  try {
    await call(action, { quest: q.id });
    if (okText) say(okText, 'ok');
    if (S.refresh) await S.refresh();   /* credits, XP and the tab dot */
  } catch (e) {
    if (/needs a weapon/i.test(e.message || '')) {   /* no weapon fitted: explain in a message box with an OK button (the red bar if the box cannot open) */
      try {
        const co = await import('coach');
        co.modal({ kicker: 'Mission', title: 'Weapon needed', paras: [
          'This mission is a combat mission, and your ship has no weapon fitted.',
          'Fit one in a weapon slot on the Rigging screen, then come back and accept the mission.'
        ], buttons: [{ label: 'OK', onClick: co.closeModal }] });
        return;
      } catch (e2) { /* fall through to the red bar */ }
    }
    say(e.message === 'not_ready' ? 'That mission is not finished yet.' : e.message === 'not_offered' ? 'That mission is not waiting for you any more.' : 'Error: ' + e.message, 'err');
  } finally { busy = false; await load(); }
}

const STATUS = { offered: 'Available', active: 'In progress', ready: 'Ready to claim', claimed: 'Done', failed: 'Failed' };

function card(q) {
  const c = el('div', 'mq ' + q.status);
  const h = el('div', 'mqh');
  h.append(el('span', 'mqt', q.title), el('span', 'mqs', STATUS[q.status] || q.status));
  c.appendChild(h);
  if (q.description) c.appendChild(el('div', 'mqd', q.description));
  (q.steps || []).forEach(s => {
    const done = s.done || q.status === 'claimed';
    const r = el('div', 'mst' + (done ? ' done' : ''));
    r.append(el('span', 'ck', done ? '\u2713' : '\u25CB'), el('span', 'tx', s.label));
    c.appendChild(r);
  });
  c.appendChild(el('div', 'mqr', (q.status === 'claimed' ? 'Reward paid: ' : 'Reward: ') + rewardText(q.reward)));
  if (q.status === 'active' && q.due_at) { const d = el('div', 'mdue', leftText(q)); d.dataset.due = q.due_at; c.appendChild(d); }
  if (q.status === 'offered' && q.time_limit_minutes) c.appendChild(el('div', 'mdue', 'Time limit once accepted: ' + span(q.time_limit_minutes * 60000)));
  if (q.status === 'failed') c.appendChild(el('div', 'mdue', 'The time ran out.'));
  if (q.status === 'ready') { const b = el('button', '', 'Claim reward'); b.onclick = () => act('mission_claim', q, b, 'Reward claimed: ' + rewardText(q.reward)); c.appendChild(b); }
  if (q.status === 'offered') { const b = el('button', '', 'Accept mission'); b.onclick = () => act('mission_accept', q, b, 'Mission accepted: ' + q.title); c.appendChild(b); }
  return c;
}

function chainCard(ch) {
  const mine = list().filter(q => q.chain === ch.id);
  const rank = { ready: 0, offered: 1, active: 2, failed: 3 };
  const open = mine.filter(q => q.status !== 'claimed').sort((a, b) => rank[a.status] - rank[b.status]);
  const done = mine.filter(q => q.status === 'claimed');
  const n = s => open.filter(q => q.status === s).length;
  const live = open.filter(q => q.status !== 'failed').length;
  const sum = n('ready') ? n('ready') + ' ready to claim' : n('offered') ? n('offered') + ' available' : n('active') ? 'In progress' : 'No missions available';
  const isOpen = openMap[ch.id] !== undefined ? openMap[ch.id] : live > 0;
  const wrap = el('div');
  const hd = el('button', 'alt mch');
  hd.append(el('span', 'ct', (isOpen ? '\u25BE ' : '\u25B8 ') + ch.title), el('span', 'cs' + (n('ready') || n('offered') ? ' hot' : ''), sum));
  hd.onclick = () => { openMap[ch.id] = !isOpen; paint(); };
  wrap.appendChild(hd);
  if (!isOpen) return wrap;
  const body = el('div', 'mcb');
  if (ch.description) body.appendChild(el('div', 'mcd', ch.description));
  if (!open.length) body.appendChild(el('div', 'muted pad', 'No missions available at this time.'));
  open.forEach(q => body.appendChild(card(q)));
  if (done.length) {
    const f = el('button', 'alt mqfold', (doneMap[ch.id] ? '- ' : '+ ') + 'Completed (' + done.length + ')');
    f.onclick = () => { doneMap[ch.id] = !doneMap[ch.id]; paint(); };
    body.appendChild(f);
    if (doneMap[ch.id]) done.forEach(q => body.appendChild(card(q)));
  }
  wrap.appendChild(body);
  return wrap;
}

function paint() {
  div.replaceChildren();
  div.appendChild(el('h2', '', 'Missions'));
  if (failed) { div.appendChild(el('div', 'err pad', 'Could not load the missions: ' + failed)); return; }
  if (!data) { div.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const chains = data.chains || [];
  if (!chains.length) div.appendChild(el('div', 'muted pad', 'No missions yet.'));
  chains.forEach(ch => div.appendChild(chainCard(ch)));
}

setInterval(() => {                                   /* waiting for the tutorial freight delivery (the server records it): look again every 20 s */
  if (document.hidden || !S.last || !S.last.character) return;
  if (list().some(q => q.status === 'active' && (q.steps || []).some(s => s.id === 'freight_take' && s.done) && (q.steps || []).some(s => s.id === 'freight_deliver' && !s.done))) load();
}, 20000);

setInterval(() => {                                   /* countdowns of timed missions (none exist yet) */
  if (S.current !== 'missions') return;
  div.querySelectorAll('.mdue[data-due]').forEach(d => { d.textContent = leftText({ due_at: d.dataset.due }); });
}, 1000);

/* A screen was opened or a server action succeeded: if an open mission has an undone step named like it, report it.
   A trade ('trade_at') also finishes steps named after what was done and where: 'buy', 'sell', 'buy:earth', 'sell:luna'. */
async function noteStep(name, extra) {
  if (/^missions?(_|$)/.test(name) || !S.last || !S.last.character) return;
  const names = [name];
  if (name === 'trade_at' && extra && extra.kind) names.push(extra.kind, extra.kind + ':' + extra.location);
  if (name === 'freight_accept') await load();     /* the server has just recorded the step 'freight_take' of the tutorial job */
  if (!data) await load();
  let sent = false;
  for (const q of list().filter(x => x.status === 'active')) {
    for (const nm of names) {
      if (!(q.steps || []).some(s => s.id === nm && !s.done)) continue;
      try { await call('mission_step', { quest: q.id, step: nm }); sent = true; } catch (e) { /* a refused step is not worth a message */ }
    }
  }
  if (sent) { await load(); if (S.refresh) S.refresh(); }
}
screenWatchers.push(noteStep);
actionWatchers.push(noteStep);

export function resetMissions() { data = null; failed = ''; loading = false; busy = false; for (const k in openMap) delete openMap[k]; for (const k in doneMap) delete doneMap[k]; div.replaceChildren(); }

addScreen('missions', 'Missions', div, {
  onShow() { paint(); load(); },
  dot: () => !!S.last && (Number(S.last.missions_ready) > 0 || Number(S.last.missions_new) > 0),
});
: Pilot Training, Earth Space Command, ...). Only open chains are sent.
// Server actions: 'missions' (list), 'mission_step' {quest, step}, 'mission_accept' {quest}, 'mission_claim' {quest}, 'missions_seen'.
// Display only: the server decides everything (what is available, timers, rewards).
// STEP RULE (for now): a step is finished by itself when its id equals the NAME of a screen the player opens (tutorial_1: 'profile' = the Profile screen)
// or the name of a server action that succeeded (tutorial_2: 'queue_travel' = a trip was launched);
// a trade also finishes 'buy', 'sell', 'buy:<place id>' and 'sell:<place id>' (tutorial_3).
// TAB DOT: shows while a reward waits (me.missions_ready) or a mission has not been looked at yet (me.missions_new).
import { S, $, el, call, say, money, whole, nowMs, addScreen, screenWatchers, actionWatchers } from 'core';

const st = document.createElement('style');
st.textContent = [
  '#scr-missions .mch{display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;text-align:left;margin:0 0 6px;padding:10px 12px}',
  '#scr-missions .mch .ct{font-weight:700;font-size:16px;color:#e8b64a}',
  '#scr-missions .mch .cs{font-size:12px;font-weight:600;color:#8d98b2;text-align:right}',
  '#scr-missions .mch .cs.hot{color:#6be08f}',
  '#scr-missions .mcb{margin:0 0 14px}',
  '#scr-missions .mcd{margin:0 2px 8px;color:#8d98b2;font-size:13px}',
  '#scr-missions .mq{background:#131a2a;border:1px solid #222b40;border-radius:8px;padding:10px;margin-bottom:10px}',
  '#scr-missions .mq.ready{border-color:#6be08f}',
  '#scr-missions .mq.failed{opacity:.65}',
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
  '#scr-missions .mdue{margin-top:4px;font-size:13px;color:#e8b64a}',
  '#scr-missions .mq button{margin:8px 0 0}',
  '#scr-missions .mqfold{width:100%;margin:0 0 8px;text-align:left}',
].join('');
document.head.appendChild(st);

const div = el('div'); div.id = 'scr-missions'; div.hidden = true;
$('haschar').appendChild(div);

let data = null;        // latest answer of the server action 'missions'
let loading = false, busy = false, failed = '';
const openMap = {};     // chain id -> true / false once the player has toggled the card (until then: open when there is something to do)
const doneMap = {};     // chain id -> the 'Completed' fold is open

const list = () => ((data && data.quests) || []);
export const missionList = list;                 // for tour.js
export const loadMissions = () => load();         // for levelup.js
export const missionWatchers = [];               // functions run after every load of the list (tour.js adds one)

const rewardText = r => {
  r = r || {}; const p = [];
  if (Number(r.credits)) p.push('Cr ' + money(r.credits));
  if (Number(r.xp)) p.push(whole(r.xp) + ' XP');
  if (Number(r.cal)) p.push(whole(r.cal) + ' Cal');
  return p.length ? p.join('  \u00B7  ') : 'No reward';
};
const span = ms => {                              // 3725000 -> '1h 2m'
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + (s % 60) + 's' : (s % 60) + 's';
};
const leftText = q => { const ms = new Date(q.due_at).getTime() - nowMs(); return ms > 0 ? 'Time left: ' + span(ms) : 'Time is up'; };

async function load() {
  if (loading) return;
  loading = true;
  try { data = await call('missions'); failed = ''; }
  catch (e) { failed = e.message; }
  finally { loading = false; }
  if (S.current === 'missions') {
    paint();
    if (data && Number(data.new) > 0) {            /* the player is looking at the list: the 'new' dot can go out */
      data.new = 0;
      call('missions_seen').then(() => { if (S.refresh) S.refresh(); }).catch(() => {});
    }
  }
  missionWatchers.forEach(f => { try { f(); } catch (e) {} });
}

// Report a step by name (throws when the server refuses). Used by tour.js; the screen-name rule below uses the same action.
export async function reportStep(quest, step) {
  const r = await call('mission_step', { quest, step });
  if (r && r.ok === false) throw new Error(r.error || 'refused');
  await load();
  if (S.refresh) S.refresh();
}

async function act(action, q, btn, okText) {
  if (busy) return;
  busy = true; btn.disabled = true;
  try {
    await call(action, { quest: q.id });
    if (okText) say(okText, 'ok');
    if (S.refresh) await S.refresh();   /* credits, XP and the tab dot */
  } catch (e) {
    if (/needs a weapon/i.test(e.message || '')) {   /* no weapon fitted: explain in a message box with an OK button (the red bar if the box cannot open) */
      try {
        const co = await import('coach');
        co.modal({ kicker: 'Mission', title: 'Weapon needed', paras: [
          'This mission is a combat mission, and your ship has no weapon fitted.',
          'Fit one in a weapon slot on the Rigging screen, then come back and accept the mission.'
        ], buttons: [{ label: 'OK', onClick: co.closeModal }] });
        return;
      } catch (e2) { /* fall through to the red bar */ }
    }
    say(e.message === 'not_ready' ? 'That mission is not finished yet.' : e.message === 'not_offered' ? 'That mission is not waiting for you any more.' : 'Error: ' + e.message, 'err');
  } finally { busy = false; await load(); }
}

const STATUS = { offered: 'Available', active: 'In progress', ready: 'Ready to claim', claimed: 'Done', failed: 'Failed' };

function card(q) {
  const c = el('div', 'mq ' + q.status);
  const h = el('div', 'mqh');
  h.append(el('span', 'mqt', q.title), el('span', 'mqs', STATUS[q.status] || q.status));
  c.appendChild(h);
  if (q.description) c.appendChild(el('div', 'mqd', q.description));
  (q.steps || []).forEach(s => {
    const done = s.done || q.status === 'claimed';
    const r = el('div', 'mst' + (done ? ' done' : ''));
    r.append(el('span', 'ck', done ? '\u2713' : '\u25CB'), el('span', 'tx', s.label));
    c.appendChild(r);
  });
  c.appendChild(el('div', 'mqr', (q.status === 'claimed' ? 'Reward paid: ' : 'Reward: ') + rewardText(q.reward)));
  if (q.status === 'active' && q.due_at) { const d = el('div', 'mdue', leftText(q)); d.dataset.due = q.due_at; c.appendChild(d); }
  if (q.status === 'offered' && q.time_limit_minutes) c.appendChild(el('div', 'mdue', 'Time limit once accepted: ' + span(q.time_limit_minutes * 60000)));
  if (q.status === 'failed') c.appendChild(el('div', 'mdue', 'The time ran out.'));
  if (q.status === 'ready') { const b = el('button', '', 'Claim reward'); b.onclick = () => act('mission_claim', q, b, 'Reward claimed: ' + rewardText(q.reward)); c.appendChild(b); }
  if (q.status === 'offered') { const b = el('button', '', 'Accept mission'); b.onclick = () => act('mission_accept', q, b, 'Mission accepted: ' + q.title); c.appendChild(b); }
  return c;
}

function chainCard(ch) {
  const mine = list().filter(q => q.chain === ch.id);
  const rank = { ready: 0, offered: 1, active: 2, failed: 3 };
  const open = mine.filter(q => q.status !== 'claimed').sort((a, b) => rank[a.status] - rank[b.status]);
  const done = mine.filter(q => q.status === 'claimed');
  const n = s => open.filter(q => q.status === s).length;
  const live = open.filter(q => q.status !== 'failed').length;
  const sum = n('ready') ? n('ready') + ' ready to claim' : n('offered') ? n('offered') + ' available' : n('active') ? 'In progress' : 'No missions available';
  const isOpen = openMap[ch.id] !== undefined ? openMap[ch.id] : live > 0;
  const wrap = el('div');
  const hd = el('button', 'alt mch');
  hd.append(el('span', 'ct', (isOpen ? '\u25BE ' : '\u25B8 ') + ch.title), el('span', 'cs' + (n('ready') || n('offered') ? ' hot' : ''), sum));
  hd.onclick = () => { openMap[ch.id] = !isOpen; paint(); };
  wrap.appendChild(hd);
  if (!isOpen) return wrap;
  const body = el('div', 'mcb');
  if (ch.description) body.appendChild(el('div', 'mcd', ch.description));
  if (!open.length) body.appendChild(el('div', 'muted pad', 'No missions available at this time.'));
  open.forEach(q => body.appendChild(card(q)));
  if (done.length) {
    const f = el('button', 'alt mqfold', (doneMap[ch.id] ? '- ' : '+ ') + 'Completed (' + done.length + ')');
    f.onclick = () => { doneMap[ch.id] = !doneMap[ch.id]; paint(); };
    body.appendChild(f);
    if (doneMap[ch.id]) done.forEach(q => body.appendChild(card(q)));
  }
  wrap.appendChild(body);
  return wrap;
}

function paint() {
  div.replaceChildren();
  div.appendChild(el('h2', '', 'Missions'));
  if (failed) { div.appendChild(el('div', 'err pad', 'Could not load the missions: ' + failed)); return; }
  if (!data) { div.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const chains = data.chains || [];
  if (!chains.length) div.appendChild(el('div', 'muted pad', 'No missions yet.'));
  chains.forEach(ch => div.appendChild(chainCard(ch)));
}

setInterval(() => {                                   /* waiting for the tutorial freight delivery (the server records it): look again every 20 s */
  if (document.hidden || !S.last || !S.last.character) return;
  if (list().some(q => q.status === 'active' && (q.steps || []).some(s => s.id === 'freight_take' && s.done) && (q.steps || []).some(s => s.id === 'freight_deliver' && !s.done))) load();
}, 20000);

setInterval(() => {                                   /* countdowns of timed missions (none exist yet) */
  if (S.current !== 'missions') return;
  div.querySelectorAll('.mdue[data-due]').forEach(d => { d.textContent = leftText({ due_at: d.dataset.due }); });
}, 1000);

/* A screen was opened or a server action succeeded: if an open mission has an undone step named like it, report it.
   A trade ('trade_at') also finishes steps named after what was done and where: 'buy', 'sell', 'buy:earth', 'sell:luna'. */
async function noteStep(name, extra) {
  if (/^missions?(_|$)/.test(name) || !S.last || !S.last.character) return;
  const names = [name];
  if (name === 'trade_at' && extra && extra.kind) names.push(extra.kind, extra.kind + ':' + extra.location);
  if (name === 'freight_accept') await load();     /* the server has just recorded the step 'freight_take' of the tutorial job */
  if (!data) await load();
  let sent = false;
  for (const q of list().filter(x => x.status === 'active')) {
    for (const nm of names) {
      if (!(q.steps || []).some(s => s.id === nm && !s.done)) continue;
      try { await call('mission_step', { quest: q.id, step: nm }); sent = true; } catch (e) { /* a refused step is not worth a message */ }
    }
  }
  if (sent) { await load(); if (S.refresh) S.refresh(); }
}
screenWatchers.push(noteStep);
actionWatchers.push(noteStep);

export function resetMissions() { data = null; failed = ''; loading = false; busy = false; for (const k in openMap) delete openMap[k]; for (const k in doneMap) delete doneMap[k]; div.replaceChildren(); }

addScreen('missions', 'Missions', div, {
  onShow() { paint(); load(); },
  dot: () => !!S.last && (Number(S.last.missions_ready) > 0 || Number(S.last.missions_new) > 0),
});
