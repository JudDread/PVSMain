// coach.js - the pointer (a gold ring + a speech box) and the message box used by the guided tours. Display only.
// The ring itself never blocks a tap (pointer-events none). LOCK: pointAt({lock:true}) puts four invisible panels around the tappable box, so everything else on
// the page is dead while the pointer is up. The tappable box = the target, or the union of the elements named in `hole` (a list of css selectors;
// an EMPTY list = nothing is tappable except the speech box). If no tappable element can be found, nothing is locked (the player is never trapped).
// A target is a css selector, or {sel, text} (the first VISIBLE match whose text contains `text`), or a list of those (the first one that is visible wins).
// onTarget (optional): called once, shortly after the player taps the target.
import { el } from 'core';

const css = document.createElement('style');
css.textContent = [
  '#coachring{position:fixed;z-index:90;pointer-events:none;border:3px solid #e8b64a;border-radius:10px;box-sizing:border-box;box-shadow:0 0 0 9999px rgba(5,8,15,.5),0 0 12px 2px rgba(232,182,74,.7)}',
  '#coachtip{position:fixed;z-index:95;background:#131a2a;border:2px solid #e8b64a;border-radius:10px;padding:10px 12px;box-sizing:border-box;font-size:15px;line-height:1.35;box-shadow:0 4px 18px rgba(0,0,0,.6)}',
  '#coachtip .cbtns{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:8px}',
  '#coachtip button{margin:0;padding:6px 14px;font-size:14px}',
  '.coachblk{position:fixed;z-index:89;background:transparent;touch-action:none}',
  '#coachmodal{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100;background:rgba(5,8,15,.85);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box}',
  '#coachmodal .card{background:#131a2a;border:2px solid #e8b64a;border-radius:12px;padding:14px;max-width:440px;width:100%;max-height:100%;overflow-y:auto;box-sizing:border-box}',
  '#coachmodal .kick{font-size:12px;font-weight:700;letter-spacing:1px;color:#6be08f;margin-bottom:4px}',
  '#coachmodal h2{font-size:19px;margin:0 0 8px}',
  '#coachmodal p{margin:0 0 10px;color:#d3dbee;font-size:15px;line-height:1.4}',
  '#coachmodal .cmb{display:flex;flex-direction:column;gap:6px;margin-top:6px}',
  '#coachmodal .cmb button{width:100%;margin:0;padding:10px}',
].join('');
document.head.appendChild(css);

let ring = null, tip = null, cfg = null, timer = null, modalEl = null;
const blk = [];                                  // the four lock panels: top, bottom, left, right

function findTarget(t) {
  for (const x of (Array.isArray(t) ? t : [t])) {
    if (!x) continue;
    const sel = typeof x === 'string' ? x : x.sel;
    for (const e of document.querySelectorAll(sel)) {
      if (x.text && !e.textContent.includes(x.text)) continue;
      const r = e.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2) return e;          /* hidden elements have no size */
    }
  }
  return null;
}

function ensure() {
  if (ring) return;
  ring = el('div'); ring.id = 'coachring'; tip = el('div'); tip.id = 'coachtip';
  ring.hidden = tip.hidden = true;
  document.body.append(ring, tip);
  for (let k = 0; k < 4; k++) { const b = el('div', 'coachblk'); b.hidden = true; document.body.appendChild(b); blk.push(b); }
  window.addEventListener('resize', () => place());
  window.addEventListener('scroll', () => place(), true);
  document.addEventListener('click', ev => {                /* capture phase: runs before the page's own tap handler */
    if (!cfg || !cfg.onTarget) return;
    const t = findTarget(cfg.target);
    if (t && t.contains(ev.target)) { const f = cfg.onTarget; cfg.onTarget = null; setTimeout(f, 80); }   /* after the page has reacted */
  }, true);
}

// The box that stays tappable while locked (null = none found).
function holeRect(t) {
  const els = [];
  if (Array.isArray(cfg.hole)) cfg.hole.forEach(s => document.querySelectorAll(s).forEach(e => els.push(e)));
  else if (t) els.push(t);
  let u = null;
  for (const e of els) {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    u = u ? { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) }
          : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return u;
}
function lockPlace(t) {
  if (!cfg || !cfg.lock) { blk.forEach(b => { b.hidden = true; }); return; }
  const vw = window.innerWidth, vh = window.innerHeight, none = Array.isArray(cfg.hole) && cfg.hole.length === 0;
  let u = none ? { left: 0, top: 0, right: 0, bottom: 0 } : holeRect(t);
  if (!u) { blk.forEach(b => { b.hidden = true; }); return; }
  if (!none) u = { left: Math.max(0, u.left - 4), top: Math.max(0, u.top - 4), right: Math.min(vw, u.right + 4), bottom: Math.min(vh, u.bottom + 4) };
  const h = Math.max(0, u.bottom - u.top);
  const boxes = [[0, 0, vw, u.top], [0, u.bottom, vw, vh - u.bottom], [0, u.top, u.left, h], [u.right, u.top, vw - u.right, h]];
  blk.forEach((b, k) => {
    const x = boxes[k]; b.hidden = false;
    b.style.left = x[0] + 'px'; b.style.top = x[1] + 'px'; b.style.width = Math.max(0, x[2]) + 'px'; b.style.height = Math.max(0, x[3]) + 'px';
  });
}

// Where do the ring and the speech box go? Worked out from the real position of the target on screen, so it fits any tablet or phone.
function place(first) {
  if (!cfg) return;
  const t = cfg.target ? findTarget(cfg.target) : null;
  let r = t ? t.getBoundingClientRect() : null;                           /* no visible target: the speech box is shown docked, without a ring */
  const vw = window.innerWidth, vh = window.innerHeight, low = vh - 90;    /* 90 = room for the bottom tab bar */
  if (r && first === true && r.height < vh * 0.6 && (r.top < 0 || r.bottom > vh)) { t.scrollIntoView({ block: 'nearest' }); r = t.getBoundingClientRect(); }
  const w = Math.min(320, vw - 24);
  tip.style.width = w + 'px';
  const th = tip.offsetHeight, big = r && r.height > vh * 0.45;           /* a big target (a whole screen) gets no ring */
  ring.hidden = !r || big;
  let top = null, left = (vw - w) / 2;
  if (r && !big) {
    ring.style.left = (r.left - 4) + 'px'; ring.style.top = (r.top - 4) + 'px';
    ring.style.width = (r.width + 8) + 'px'; ring.style.height = (r.height + 8) + 'px';
    left = Math.max(12, Math.min(vw - w - 12, r.left + r.width / 2 - w / 2));
    if (r.bottom + 14 + th <= low) top = r.bottom + 14;
    else if (r.top - 14 - th >= 8) top = r.top - 14 - th;
  }
  tip.style.left = left + 'px';
  if (top == null) { tip.style.top = 'auto'; tip.style.bottom = '90px'; }  /* docked above the tab bar */
  else { tip.style.bottom = 'auto'; tip.style.top = top + 'px'; }
  lockPlace(t);
}

// pointAt({target, text, next: label, onNext, onTarget, skipLabel, onSkip, lock, hole}) - Next and Skip buttons only appear when their function is given.
export function pointAt(c) {
  ensure(); cfg = c;
  tip.replaceChildren(el('div', '', c.text));
  const row = el('div', 'cbtns');
  if (c.onSkip) { const s = el('button', 'alt', c.skipLabel || 'Skip tour'); s.onclick = c.onSkip; row.appendChild(s); }
  if (c.onNext) { const n = el('button', '', c.next || 'Next'); n.onclick = c.onNext; row.appendChild(n); }
  if (row.children.length) tip.appendChild(row);
  tip.hidden = false;
  place(true);
  clearInterval(timer); timer = setInterval(() => place(), 500);          /* the layout can move (a list opens, a screen redraws) */
}
export function clearPointer() {
  cfg = null; clearInterval(timer); timer = null;
  if (ring) ring.hidden = tip.hidden = true;
  blk.forEach(b => { b.hidden = true; });
}

// modal({kicker, title, paras: [text, ...], buttons: [{label, alt, onClick}, ...]}) - a full-screen message the player must answer.
export function modal(m) {
  closeModal();
  modalEl = el('div'); modalEl.id = 'coachmodal';
  const c = el('div', 'card');
  if (m.kicker) c.appendChild(el('div', 'kick', m.kicker));
  c.appendChild(el('h2', '', m.title));
  (m.paras || []).forEach(p => c.appendChild(el('p', '', p)));
  const row = el('div', 'cmb');
  (m.buttons || []).forEach(b => { const x = el('button', b.alt ? 'alt' : '', b.label); x.onclick = b.onClick; row.appendChild(x); });
  c.appendChild(row); modalEl.appendChild(c); document.body.appendChild(modalEl);
}
export function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }
