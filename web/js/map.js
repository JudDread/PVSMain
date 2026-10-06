// map.js - the solar-system map (display only, TRUE scale). createMap(canvas, hooks) -> { preset, need, resize }
import { BODIES, bodyPos, stateAt } from 'physics';
import { curGd } from 'core';

/* ---------- MAP component (display only, TRUE scale: pixels per AU) ---------- */
export function createMap(cv, hooks) {
  const ctx = cv.getContext('2d');
  let w = 0, h = 0, dpr = 1, raf = 0, inited = false, moved = 0, t0 = 0, hits = [];
  const view = { cx: 0, cy: 0, s: 100, follow: false };
  const MIN_S = () => Math.min(w, h) / 2 / 40;      /* whole system plus margin */
  const MAX_S = () => Math.min(w, h) / 0.002;       /* ~0.002 AU across */
  const clamp = s => Math.max(MIN_S(), Math.min(MAX_S(), s));
  const need = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  function preset(kind) {
    if (!w) return;
    const m = Math.min(w, h);
    if (kind === 'inner') { view.cx = 0; view.cy = 0; view.s = m / 2 / 1.8; view.follow = false; }
    else if (kind === 'sys') { view.cx = 0; view.cy = 0; view.s = m / 2 / 32; view.follow = false; }
    else { const p = hooks.ship(); if (!p) return; view.follow = true; view.s = m / 0.04; }
    need();
  }
  function resize() {
    const r = cv.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    if (!inited) { inited = true; preset('inner'); }
    need();
  }
  new ResizeObserver(resize).observe(cv);

  function zoomAt(p, f) {
    if (view.follow) p = { x: w / 2, y: h / 2 };
    const wx = view.cx + (p.x - w / 2) / view.s, wy = view.cy - (p.y - h / 2) / view.s;
    view.s = clamp(view.s * f);
    view.cx = wx - (p.x - w / 2) / view.s; view.cy = wy + (p.y - h / 2) / view.s;
  }
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const ptrs = new Map();
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, pos(e));
    if (ptrs.size === 1) { moved = 0; t0 = Date.now(); } else moved = 99;
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const p = pos(e), o = ptrs.get(e.pointerId);
    if (ptrs.size === 1) {
      const dx = p.x - o.x, dy = p.y - o.y; moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 8) { view.follow = false; view.cx -= dx / view.s; view.cy += dy / view.s; }
    } else if (ptrs.size === 2) {
      const q = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
      const d0 = Math.hypot(o.x - q.x, o.y - q.y), d1 = Math.hypot(p.x - q.x, p.y - q.y);
      const mo = { x: (o.x + q.x) / 2, y: (o.y + q.y) / 2 }, mn = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (!view.follow) { view.cx -= (mn.x - mo.x) / view.s; view.cy += (mn.y - mo.y) / view.s; }
      if (d0 > 0) zoomAt(mn, d1 / d0);
    }
    ptrs.set(e.pointerId, p); need();
  });
  const up = e => {
    if (ptrs.size === 1 && e.type === 'pointerup' && moved < 8 && Date.now() - t0 < 600) tap(pos(e));
    ptrs.delete(e.pointerId);
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(pos(e), Math.exp(-e.deltaY * 0.0015)); need(); }, { passive: false });

  function tap(p) {
    let best = null, bd = 26;
    hits.forEach(k => { const d = Math.hypot(k.x - p.x, k.y - p.y); if (d < bd) { bd = d; best = k; } });
    if (best) hooks.pick(best.name);
  }

  function draw() {
    const gd = curGd(); if (gd == null || !w) return;
    const sp = hooks.ship();
    if (view.follow && sp) { view.cx = sp.x; view.cy = sp.y; }
    const X = x => w / 2 + (x - view.cx) * view.s, Y = y => h / 2 - (y - view.cy) * view.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070a12'; ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1; ctx.strokeStyle = '#1d2740';
    BODIES.forEach(b => {
      if (!b.a) return; const r = b.a * view.s; if (r > 2e5) return;
      ctx.beginPath(); ctx.arc(X(0), Y(0), r, 0, 7); ctx.stroke();
    });
    hits = []; const selB = hooks.selectedBody();
    ctx.font = '12px system-ui,sans-serif'; ctx.textBaseline = 'middle';
    BODIES.forEach(b => {
      const p = b.a ? bodyPos(b, gd) : [0, 0], x = X(p[0]), y = Y(p[1]);
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return;
      const rad = Math.max(2.5, b.r * 0.7);
      ctx.fillStyle = b.c; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
      if (b.a) hits.push({ x, y, name: b.n });
      if (b.n === selB) { ctx.strokeStyle = '#e8b64a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, rad + 6, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
      if (b.n === selB || b.a * view.s > 18) { ctx.fillStyle = '#9fb0d4'; ctx.fillText(b.n, x + rad + 5, y); }
    });
    /* course lines: blue = preview while choosing, green = launched */
    const path = (plan, ta, tb, col, lw) => {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.setLineDash([6, 5]); ctx.beginPath();
      for (let k = 0; k <= 80; k++) {
        const s = stateAt(plan, ta + (tb - ta) * k / 80);
        k ? ctx.lineTo(X(s.x), Y(s.y)) : ctx.moveTo(X(s.x), Y(s.y));
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    const ring = (plan, col) => {   /* where the ship will MEET the target, not where it is now */
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(plan.end.x), Y(plan.end.y), 7, 0, 7); ctx.stroke();
    };
    const pv = hooks.preview();
    if (pv) { path(pv, pv.t0, pv.tEnd, '#4aa8ff', 2); ring(pv, '#4aa8ff'); }
    if (sp && sp.plan) {
      const ta = Math.max(gd, sp.plan.t0);
      if (ta < sp.plan.tEnd) {
        if (ta > sp.plan.t0) path(sp.plan, sp.plan.t0, ta, '#6b7590', 2);   /* grey trail: already travelled */
        path(sp.plan, ta, sp.plan.tEnd, '#3dff6a', 2.5); ring(sp.plan, '#3dff6a');
        const d = stateAt(sp.plan, ta + (sp.plan.tEnd - ta) * ((Date.now() % 4000) / 4000));
        ctx.fillStyle = '#ffd23d'; ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), 4, 0, 7); ctx.fill();
      }
    }
    if (sp) {
      const x = X(sp.x), y = Y(sp.y);
      let ang = -Math.PI / 2;                                   /* docked: point up */
      if (sp.vx != null && Math.hypot(sp.vx, sp.vy) > 1e-9) ang = Math.atan2(-sp.vy, sp.vx);   /* point along travel */
      if (sp.a > 0) {                                           /* red exhaust line: opposite to acceleration */
        ctx.strokeStyle = '#ff4a3d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x + 24 * Math.cos(Math.atan2(sp.ay, -sp.ax)), y + 24 * Math.sin(Math.atan2(sp.ay, -sp.ax))); ctx.stroke();
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.strokeStyle = '#e8b64a'; ctx.fillStyle = '#f2f5ff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -5.5); ctx.lineTo(-6, 5.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    /* scale bar */
    const want = 110 / view.s, nice = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]
      .filter(v => v <= want).pop() || 0.001;
    const px = nice * view.s;
    ctx.strokeStyle = '#8d98b2'; ctx.fillStyle = '#8d98b2'; ctx.lineWidth = 2; ctx.textBaseline = 'alphabetic';
    ctx.beginPath(); ctx.moveTo(10, h - 18); ctx.lineTo(10 + px, h - 18); ctx.stroke();
    ctx.fillText(nice >= 1 ? nice + ' AU' : (nice * 149.598).toPrecision(2) + ' million km', 10, h - 24);
  }
  let lastDraw = 0;   /* redraw fast (10/s) only while a launched course is animating, else every 0.4 s */
  const _draw = draw;
  setInterval(() => {
    if (!cv.offsetParent) return;
    const sp = hooks.ship();
    if ((sp && sp.plan) || Date.now() - lastDraw > 400) { lastDraw = Date.now(); _draw(); }
  }, 100);
  return { preset, need, resize };
}
