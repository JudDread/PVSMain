// missions.js - the JOBS screen (bottom tab; the files and server still say 'missions'). Makes its own div and its own styles: index.html has no missions markup.
// 2026-11-07 phone layout: chain bars like the section bars of the other screens, chains with a reward waiting or a job available sorted to the top, rewards abbreviated.
// One CARD per mission chain (a chain is a group of missions: Pilot Training, Earth Space Command, ...). Only open chains are sent.
// Server actions: 'missions' (list), 'mission_step' {quest, step}, 'mission_accept' {quest}, 'mission_claim' {quest}, 'missions_seen'.
// Display only: the server decides everything (what is available, timers, rewards).
// STEP RULE (for now): a step is finished by itself when its id equals the NAME of a screen the player opens (tutorial_1: 'profile' = the Profile screen)
// or the name of a server action that succeeded (tutorial_2: 'queue_travel' = a trip was launched);
// a trade also finishes 'buy', 'sell', 'buy:<place id>' and 'sell:<place id>' (tutorial_3).
// TAB DOT: shows while a reward waits (me.missions_ready) or a mission has not been looked at yet (me.missions_new).
import { S, $, el, call, say, short, whole, nowMs, addScreen, screenWatchers, actionWatchers } from 'core';

const st = document.createElement('style');
st.textContent = [
  '#scr-missions h2{font-size:18px;font-weight:500;color:#fff;margin:4px 4px 8px}',
  '#scr-missions .mch{display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;text-align:left;margin:8px 0 0;padding:0 8px;min-height:36px;border-radius:0;background:rgba(120,160,210,.16);border:0;border-top:2px solid rgba(120,160,210,.55);border-bottom:1px solid rgba(120,160,210,.25);color:#fff;font-weight:500;font-size:13px}',
  '#scr-missions .mch .ct{font-weight:500;font-size:13px;color:#fff}',
  '#scr-missions .mch .cs{font-size:11px;font-weight:500;color:#8d98b2;text-align:right}',
  '#scr-missions .mch .cs.hot{color:#6be08f}',
  '#scr-missions .mcb{margin:0 0 8px}',
  '#scr-missions .mcd{margin:6px 2px 0;color:#8d98b2;font-size:11px}',
  '#scr-missions .mq{background:#131a2a;border:1px solid #2a3350;border-radius:8px;padding:8px;margin:8px 0 0}',
  '#scr-missions .mq.ready{border-color:#6be08f}',
  '#scr-missions .mq.failed{opacity:.65}',
  '#scr-missions .mqh{display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
  '#scr-missions .mqt{font-weight:500;font-size:13px;color:#fff}',
  '#scr-missions .mqs{font-size:11px;font-weight:500;white-space:nowrap;color:#8d98b2}',
  '#scr-missions .mq.ready .mqs{color:#6be08f}',
  '#scr-missions .mqd{margin:3px 0 4px;color:#8d98b2;font-size:11px}',
  '#scr-missions .mst{display:flex;gap:8px;padding:4px 0;border-top:1px solid #2f3a58;font-size:12px;font-weight:500;color:#fff}',
  '#scr-missions .mst .ck{flex:none;width:16px;text-align:center;color:#8d98b2}',
  '#scr-missions .mst.done .ck{color:#6be08f}',
  '#scr-missions .mst.done .tx{color:#8d98b2;font-weight:400}',
  '#scr-missions .mdue{margin-top:4px;font-size:11px;color:#e8b64a}',
  '#scr-missions .mhist{margin-top:4px;font-size:11px;color:#8d98b2}',
  '#scr-missions .mft{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid #2f3a58}',
  '#scr-missions .mqr{font-size:12px;font-weight:500;color:#6be08f}',
  '#scr-missions .mq button{margin:0;height:34px;min-height:0;padding:0 12px;font-size:13px;flex:none}',
  '#scr-missions .mfold{height:30px;display:flex;align-items:center;padding:0 8px;margin-top:8px;border-bottom:1px solid #2f3a58;font-size:12px;color:#c7d0e6;cursor:pointer}',
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

const rewardText = (r, q) => {      /* q (optional): also lists the standing the job gives, e.g. 'Earth +1' */
  r = r || {}; const p = [];
  if (Number(r.credits)) p.push('Cr ' + short(r.credits, true));
  if (Number(r.xp)) p.push(whole(r.xp) + ' XP');
  if (Number(r.cal)) p.push(whole(r.cal) + ' Cal');
  if (q) (q.rep_reward || []).forEach(x => { if (Number(x.claim) > 0) p.push(x.name + ' +' + whole(x.claim)); });
  return p.length ? p.join('  \u00B7  ') : 'No reward';
};
const span = ms => {                              // 3725000 -> '1h 2m'
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + (s % 60) + 's' : (s % 60) + 's';
};
const clock = ms => {                              // 1450000 -> '24:10' ; 3725000 -> '1:02:05'
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
};
const words = min => {                            // 30 -> '30 minutes' ; 60 -> '1 hour' ; 90 -> '1 hour 30 minutes'
  const h = Math.floor(min / 60), m = Math.round(min % 60), p = [];
  if (h) p.push(h + (h === 1 ? ' hour' : ' hours'));
  if (m || !h) p.push(m + (m === 1 ? ' minute' : ' minutes'));
  return p.join(' ');
};
const leftText = q => { const ms = new Date(q.due_at).getTime() - nowMs(); return ms > 0 ? 'Time left ' + clock(ms) : 'Time is up'; };

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
    const res = await call(action, { quest: q.id });
    if (okText) say(typeof okText === 'function' ? okText(res) : okText, 'ok');
    if (action === 'mission_accept' && q.id === 'mars_1') marsStartPopup();   /* 102 */
    if (S.refresh) await S.refresh();   /* credits, XP and the tab dot */
  } catch (e) {
    if (/needs a weapon|no[ _]weapon/i.test(e.message || '')) {   /* no weapon fitted: explain in a message box with an OK button (the red bar if the box cannot open) */
      try {
        let co; try { co = await import('coach'); } catch (x) { co = await import('./coach.js'); }   /* the import-map name first, then the file next to this one */
        co.modal({ kicker: 'Job', title: 'Weapon needed', paras: [
          'This job is a combat job, and your ship has no weapon fitted.',
          'Fit one in a weapon slot on the Rigging screen, then come back and accept the job.'
        ], buttons: [{ label: 'OK', onClick: co.closeModal }] });
        return;
      } catch (e2) { /* fall through to the red bar */ }
    }
    say(e.message === 'not_ready' ? 'That job is not finished yet.' : e.message === 'not_offered' ? 'That job is not waiting for you any more.' : 'Error: ' + e.message, 'err');
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
  if (q.rep_reward && q.rep_reward.some(x => Number(x.fail) < 0)) c.appendChild(el('div', 'mqd', 'Standing: ' + q.rep_reward.map(x => x.name + ' +' + x.claim + ' on success, ' + x.fail + ' on failure (at most +/-' + x.cap + ' from this job)').join('; ') + '.'));   /* 101 */
  if (q.id === 'mars_1' && q.status === 'offered') c.appendChild(el('div', 'mqd', 'Accept it docked at Mars, with 10 CU of free hold. The passengers and their gear travel as one package to Earth Orbit. No timer, and no freight pay.'));   /* 102 */
  if (q.emergency && q.status === 'active' && q.emergency.dest_name) {   /* 099: Emergency Delivery: where to and what it pays */
    c.appendChild(el('div', 'mdue', 'Deliver to ' + q.emergency.dest_name + '. Freight pay Cr ' + short(q.emergency.pay_total, true) + ' + bonus for a fast run.'));
  }
  if (q.id === 'emergency_delivery' && q.status === 'offered') c.appendChild(el('div', 'mqd', 'You get your destination and timer when you accept. You must be docked, with 20 CU of free hold.'));
  if (q.status === 'active' && q.due_at) { const d = el('div', 'mdue', leftText(q)); d.dataset.due = q.due_at; c.appendChild(d); }
  if (q.status === 'offered' && q.time_limit_minutes && !q.wave) c.appendChild(el('div', 'mdue', 'Timed: you have ' + words(Number(q.time_limit_minutes)) + ' from the moment you accept.'));
  if (q.wave) {                                                          /* 090: the wave clock of a wave job */
    let wl = null;
    if (q.status === 'offered') wl = q.wave.open ? ['Available for ', q.wave.ends_at] : ['Not available. Next wave in ', q.wave.next_at];
    else if (q.status === 'failed' || q.status === 'claimed') wl = ['Not available. Next wave in ', q.wave.next_at];
    if (wl) { const w = el('div', 'mdue'); w.dataset.until = new Date(wl[1]).getTime(); w.dataset.pre = wl[0]; w.textContent = wl[0] + clock(w.dataset.until - nowMs()); c.appendChild(w); }
  }
  if (q.repeats && (Number(q.claims) > 0 || Number(q.fails) > 0)) {      /* 090: the history of a repeatable job */
    const p = [];
    if (Number(q.claims) > 0) p.push('Completed ' + q.claims + (Number(q.claims) === 1 ? ' time' : ' times'));
    if (Number(q.fails) > 0) p.push('Failed ' + q.fails + (Number(q.fails) === 1 ? ' time' : ' times'));
    c.appendChild(el('div', 'mhist', p.join(' \u00b7 ')));
  }
  if (q.status === 'failed' && !q.wave) c.appendChild(el('div', 'mdue', q.emergency && q.emergency.result === 'failed_lost' ? 'The shipment was lost.' : 'The time ran out.'));
  if (q.daily && (q.status === 'failed' || q.status === 'claimed')) {      /* 099: the next emergency call (the daily reset) */
    const w = el('div', 'mdue'); w.dataset.until = new Date(q.daily.next_at).getTime(); w.dataset.pre = 'Next emergency call in ';
    w.textContent = w.dataset.pre + clock(w.dataset.until - nowMs()); c.appendChild(w);
  }
  // footer: the reward (green) on the left, the button on the right
  const f = el('div', 'mft');
  f.appendChild(el('span', 'mqr', rewardText(q.reward, q)));
  if (q.story && q.story.pending) { const db2 = el('button', '', 'Decide'); db2.onclick = () => marsAsk(true); f.appendChild(db2); }   /* 102: the choice is still open */
  if (q.status === 'ready') { const b = el('button', '', 'Claim reward'); b.onclick = () => act('mission_claim', q, b, res => 'Reward claimed: ' + rewardText(q.reward) + ((res && res.rep && res.rep.length) ? '  \u00B7  ' + res.rep.map(x => x.name + ' ' + (x.applied > 0 ? '+' : '') + x.applied).join(', ') : '')); f.appendChild(b); }
  if (q.status === 'offered') { const b = el('button', '', 'Accept job'); b.onclick = () => act('mission_accept', q, b, 'Job accepted: ' + q.title); if (q.wave && !q.wave.open) b.disabled = true; f.appendChild(b); }
  c.appendChild(f);
  return c;
}

function chainCard(ch) {
  const mine = list().filter(q => q.chain === ch.id);
  const rank = { ready: 0, offered: 1, active: 2, failed: 3 };
  const open = mine.filter(q => q.status !== 'claimed').sort((a, b) => rank[a.status] - rank[b.status]);
  const done = mine.filter(q => q.status === 'claimed');
  const n = s => open.filter(q => q.status === s).length;
  const live = open.filter(q => q.status !== 'failed').length;
  const sum = n('ready') ? n('ready') + ' ready to claim' : n('offered') ? n('offered') + ' available' : n('active') ? 'In progress' : 'No jobs available';
  const isOpen = openMap[ch.id] !== undefined ? openMap[ch.id] : live > 0;
  const wrap = el('div');
  const hd = el('button', 'mch');
  hd.append(el('span', 'ct', (isOpen ? '\u25BE ' : '\u25B8 ') + ch.title), el('span', 'cs' + (n('ready') || n('offered') ? ' hot' : ''), sum));
  hd.onclick = () => { openMap[ch.id] = !isOpen; paint(); };
  wrap.appendChild(hd);
  if (!isOpen) return wrap;
  const body = el('div', 'mcb');
  if (ch.description) body.appendChild(el('div', 'mcd', ch.description));
  if (!open.length) body.appendChild(el('div', 'muted pad', 'No jobs available at this time.'));
  open.forEach(q => body.appendChild(card(q)));
  if (done.length) {
    const f = el('div', 'mfold', (doneMap[ch.id] ? '- ' : '+ ') + 'Completed (' + done.length + ')');
    f.onclick = () => { doneMap[ch.id] = !doneMap[ch.id]; paint(); };
    body.appendChild(f);
    if (doneMap[ch.id]) done.forEach(q => body.appendChild(card(q)));
  }
  wrap.appendChild(body);
  return wrap;
}

// chains with a reward waiting come first, then chains with a job available, then chains in progress, then the rest (the server's order is kept inside each group)
function chainRank(ch) {
  const m = list().filter(q => q.chain === ch.id);
  return m.some(q => q.status === 'ready') ? 0 : m.some(q => q.status === 'offered') ? 1 : m.some(q => q.status === 'active') ? 2 : 3;
}

function paint() {
  div.replaceChildren();
  div.appendChild(el('h2', '', 'Jobs'));
  if (failed) { div.appendChild(el('div', 'err pad', 'Could not load the jobs: ' + failed)); return; }
  if (!data) { div.appendChild(el('div', 'muted pad', 'Loading...')); return; }
  const chains = (data.chains || []).map((ch, i) => ({ ch, i, r: chainRank(ch) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.ch);
  if (!chains.length) div.appendChild(el('div', 'muted pad', 'No jobs yet.'));
  chains.forEach(ch => div.appendChild(chainCard(ch)));
}

setInterval(() => {                                   /* waiting for the tutorial freight delivery (the server records it): look again every 20 s */
  if (document.hidden || !S.last || !S.last.character) return;
  if (list().some(q => q.status === 'active' && (q.steps || []).some(s => s.id === 'freight_take' && s.done) && (q.steps || []).some(s => s.id === 'freight_deliver' && !s.done))) load();
  else if (list().some(q => (q.id === 'emergency_delivery' || q.id === 'mars_1') && q.status === 'active')) load();   /* 099: an emergency run is on: look again every 20 s (delivery, loss or a timeout) */
}, 20000);

setInterval(() => {                                   /* countdowns of timed missions (none exist yet) */
  if (S.current !== 'missions') return;
  div.querySelectorAll('.mdue[data-due]').forEach(d => { d.textContent = leftText({ due_at: d.dataset.due }); });
  div.querySelectorAll('.mdue[data-until]').forEach(d => {              /* 090: wave clocks; at zero ask the server what the new state is (at most every 5 s) */
    const ms = Number(d.dataset.until) - nowMs();
    if (ms > 0) d.textContent = d.dataset.pre + clock(ms);
    else if (Date.now() - waveLoadAt > 5000) { waveLoadAt = Date.now(); load(); }
  });
}, 1000);
let waveLoadAt = 0;

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

/* 099: the Emergency Delivery pop-ups (success / failure), once per run. The server keeps the outcome and its time (q.emergency.result, .ended_at). */
const EMG_KEY = 'pvs_emg_seen';
async function emergencyPopup() {
  const q = list().find(x => x.id === 'emergency_delivery'), e = q && q.emergency;
  if (!e || !e.result || !e.ended_at) return;
  let seen = null; try { seen = localStorage.getItem(EMG_KEY); } catch (x) { /* no storage */ }
  if (seen === String(e.ended_at)) return;
  const place = e.dest_name || 'its destination';
  let title, paras;
  if (e.result === 'success') {
    title = 'DELIVERY COMPLETE';
    paras = ['The supplies reached ' + place + ' with time to spare. The crew is already unsealing the crates, and the Registry has logged your run.',
             'Freight pay has been credited. Your ' + whole((q.reward || {}).xp || 0) + ' XP is waiting on the Jobs screen.'];
  } else if (e.result === 'failed_lost') {
    title = 'DELIVERY FAILED';
    paras = ['The shipment never reached ' + place + '. It was lost, and the Registry has written it off.', 'A new emergency call will come after the next daily reset.'];
  } else {
    title = 'DELIVERY FAILED';
    paras = ['The clock ran out before the supplies reached ' + place + '. The shipment has been written off and removed from your hold.', 'The Registry will post a new emergency call after the next daily reset.'];
  }
  try {
    let co; try { co = await import('coach'); } catch (x) { co = await import('./coach.js'); }
    co.modal({ kicker: 'Emergency Delivery', title, paras, buttons: [{ label: 'OK', onClick: co.closeModal }] });
    try { localStorage.setItem(EMG_KEY, String(e.ended_at)); } catch (x) { /* no storage */ }
  } catch (x) { /* the pop-up could not open: it is tried again after the next load */ }
}
missionWatchers.push(emergencyPopup);

/* 102: MARS CORE 1 'Quiet Passage': the story pop-ups (start, arrival with the choice, outcome, lost). The server says what to show (q.story). */
async function coachMod() { try { return await import('coach'); } catch (x) { return await import('./coach.js'); } }
async function marsStartPopup() {
  try {
    const co = await coachMod();
    co.modal({ kicker: 'Mars Core', title: 'PASSENGERS ABOARD', paras: [
      'Five passengers come aboard in silence, followed by four sealed crates that two of them will not let out of reach. The woman gives you a nod and says only: "Earth Orbit. Straight there."'
    ], buttons: [{ label: 'OK', onClick: co.closeModal }] });
  } catch (x) { /* no box: the job card shows the same job */ }
}
let marsOpenAt = 0;
async function marsAsk(force) {
  if (!force && marsOpenAt && Date.now() - marsOpenAt < 600000) return;     /* already shown: the Decide button on the card opens it again */
  marsOpenAt = Date.now();
  let co; try { co = await coachMod(); } catch (x) { marsOpenAt = 0; return; }
  let chosen = false;
  const choose = async (choice) => {
    if (chosen) return; chosen = true;
    let res;
    try { res = await call('mission_choice', { quest: 'mars_1', choice }); }
    catch (e) { marsOpenAt = 0; co.closeModal(); say('Error: ' + e.message, 'err'); load(); return; }
    marsOpenAt = 0;
    const rep = (res.rep || []).map(x => x.name + ' standing ' + (x.applied > 0 ? '+' : '') + x.applied).join('  \u00B7  ');
    const paras = choice === 'report'
      ? ['You walk to the nearest Space Command desk and describe five passengers who walked in step. The officer thanks you and writes it all down very slowly. Whatever was in those crates, it is not yours to wonder about any more.']
      : ['You say nothing. When the patrol finally turns your way, the concourse has already swallowed them, and the half million waiting for you is the only proof they ever existed.'];
    if (rep) paras.push(rep);
    co.closeModal();
    co.modal({ kicker: 'Mars Core', title: choice === 'report' ? 'REPORTED' : 'KEPT QUIET', paras, buttons: [{ label: 'OK', onClick: co.closeModal }] });
    if (S.refresh) S.refresh();
    load();
  };
  co.modal({ kicker: 'Mars Core', title: 'EARTH ORBIT', paras: [
    'The five of them step off your ship in a tight little knot and try to melt into the crowd at the station. They do not quite manage it. They walk in step, and none of them looks at the departures board.',
    'The woman is the last to leave. "You didn\'t ask," she says. "You didn\'t tell me," you answer. She almost smiles. "Then we understand each other," she says, and the crowd closes around her.',
    'Two Space Command officers are working the concourse by the lifts. Half a million credits are waiting for you on the Jobs screen. So is a decision. Will you report what you saw to the authorities?'
  ], buttons: [{ label: 'Report them', onClick: () => choose('report') }, { label: 'Keep quiet', onClick: () => choose('quiet') }] });
}
const MARS_KEY = 'pvs_mars1_seen';
async function marsWatch() {
  const q = list().find(x => x.id === 'mars_1'), s = q && q.story;
  if (!s) return;
  if (s.pending) { marsAsk(false); return; }
  if (s.result === 'failed_lost' && s.ended_at) {
    let seen = null; try { seen = localStorage.getItem(MARS_KEY); } catch (x) { /* no storage */ }
    if (seen === String(s.ended_at)) return;
    try {
      const co = await coachMod();
      co.modal({ kicker: 'Mars Core', title: 'DELIVERY FAILED', paras: [
        'The passengers and their gear are gone. Whatever they were carrying, and whoever was waiting for them on Earth, they will not be coming now. Word will reach Mars.'
      ], buttons: [{ label: 'OK', onClick: co.closeModal }] });
      try { localStorage.setItem(MARS_KEY, String(s.ended_at)); } catch (x) { /* no storage */ }
    } catch (x) { /* tried again after the next load */ }
  }
}
missionWatchers.push(marsWatch);

export function resetMissions() { data = null; failed = ''; loading = false; busy = false; for (const k in openMap) delete openMap[k]; for (const k in doneMap) delete doneMap[k]; div.replaceChildren(); }

let liveKey = null;                                   /* 2026-11-02: when the server reports a change (a new offer, a ready mission, a timer) the screen reloads by itself */
addScreen('missions', 'Jobs', div, {
  onShow() { paint(); load(); },
  update() {
    if (!S.last || !S.last.character) return;
    const k = [S.last.missions_ready, S.last.missions_new, (S.last.mission_timers || []).map(t => t.id).join(',')].join('|');
    if (liveKey !== null && k !== liveKey) load();
    liveKey = k;
  },
  dot: () => !!S.last && (Number(S.last.missions_ready) > 0 || Number(S.last.missions_new) > 0),
});
