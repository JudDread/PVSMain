// backdrop.js - the picture behind a place selector (Market, Assets). Drawn in code as a small SVG: no picture files, free.
// A starfield (always the same stars for the same place) plus the body the place belongs to, in its own colour.
// A moon shows its planet large and dim with the moon in front; a place at a small body (Vesta, Ceres) shows a small rocky disc;
// 'All locations' shows a few small bodies.
// If the place has its own picture (web/img/places/<place id>_label.webp, e.g. earth_label.webp, luna_label.webp) that is shown
// instead; until that file exists the drawn picture shows. 'All locations' uses web/img/places/all_label.webp. Display only.
import { BODIES } from 'physics';
import { S } from 'core';

const GAS = ['Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const SMALL = ['Vesta', 'Ceres'];
const IMG_DIR = './img/places/';   /* the place pictures, next to index.html */
const cache = new Map();

function rng(seed) {                       /* tiny seeded random numbers: the same place always gets the same stars */
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  h = h || 1;
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
/* one lit sphere: colour, soft light from the top left, shadow at the bottom right; optional cloud bands / craters */
function disc(n, cx, cy, r, color, o) {
  o = o || {};
  const id = 'd' + n;
  let s = `<clipPath id="c${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`
    + `<radialGradient id="g${id}" cx="32%" cy="30%" r="85%"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".8"/></radialGradient>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${o.dim || 1}"/>`;
  if (o.bands) for (let i = 0; i < 5; i++) {
    s += `<rect x="${cx - r}" y="${cy - r + (i + 0.7) * r * 2 / 5.4}" width="${2 * r}" height="${r * 0.16}" fill="${i % 2 ? '#000' : '#fff'}" opacity=".13" clip-path="url(#c${id})"/>`;
  }
  if (o.craters) [[-.3, -.2, .22], [.25, .1, .16], [-.05, .45, .13], [.35, -.4, .1]].forEach(([dx, dy, k]) => {
    s += `<circle cx="${cx + dx * r}" cy="${cy + dy * r}" r="${k * r}" fill="#000" opacity=".22" clip-path="url(#c${id})"/>`;
  });
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#g${id})" opacity="${o.dim || 1}"/>`;
  if (o.ring) s += `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.75}" ry="${r * 0.34}" fill="none" stroke="#d9c79a" stroke-width="${Math.max(3, r * 0.07)}" opacity=".75" transform="rotate(-16 ${cx} ${cy})"/>`;
  return s;
}

// The CSS 'background' value for a place id (or 'ALL' / nothing).
export function placeBackdrop(id) {
  const key = String(id || '');
  const loc = ((S.last && S.last.locations) || []).find(l => l.id === key);
  const ck = key + '|' + (loc ? loc.anchor_body + '|' + loc.kind : '');
  if (cache.has(ck)) return cache.get(ck);
  const b = loc ? BODIES.find(x => x.n === loc.anchor_body) : null;
  const color = (b && b.c) || '#8d98b2', gas = loc && GAS.includes(loc.anchor_body), ring = loc && loc.anchor_body === 'Saturn';
  const rnd = rng(ck);
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 100" preserveAspectRatio="xMidYMid slice">'
    + '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#18213d"/></linearGradient>'
    + '<linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#070a12" stop-opacity=".6"/><stop offset=".65" stop-color="#070a12" stop-opacity="0"/></linearGradient></defs>'
    + '<rect width="500" height="100" fill="url(#bg)"/>';
  for (let i = 0; i < 40; i++) svg += `<circle cx="${(rnd() * 500).toFixed(1)}" cy="${(rnd() * 100).toFixed(1)}" r="${(0.4 + rnd() * 0.9).toFixed(2)}" fill="#dfe8ff" opacity="${(0.3 + rnd() * 0.6).toFixed(2)}"/>`;
  if (!loc) {                                                           /* All locations */
    svg += disc(1, 330, 55, 26, '#c9a27a') + disc(2, 410, 28, 15, '#6aa9f0') + disc(3, 455, 72, 34, '#d86a4a', { bands: true }) + disc(4, 255, 78, 10, '#9fb0d4', { craters: true });
  } else if (loc.kind === 'moon') {                                     /* the planet, large and dim, with the moon in front */
    svg += disc(1, 405, 98, 96, color, { dim: .55, bands: gas, ring }) + disc(2, 300, 36, 17, '#b9bfce', { craters: true });
  } else if (SMALL.includes(loc.anchor_body)) {
    svg += disc(1, 400, 55, 34, '#9a9a96', { craters: true });
  } else {
    svg += disc(1, 395, 72, 74, color, { bands: gas, ring });
  }
  svg += '<rect width="500" height="100" fill="url(#fade)"/></svg>';
  const drawn = `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / cover no-repeat #0b1020`;
  /* layers, top to bottom: a soft dark fade on the left (so the name stays readable), the place's own picture, the drawn picture.
     A picture file that does not exist paints nothing, so the drawn one shows through. */
  const own = loc && /^[a-z0-9_]+$/.test(key) ? key : (!loc && (key === '' || key.toUpperCase() === 'ALL') ? 'all' : null);
  const css = own
    ? `linear-gradient(90deg, rgba(7,10,18,.55), rgba(7,10,18,0) 65%), url("${IMG_DIR}${own}_label.webp") center / cover no-repeat, ${drawn}`
    : drawn;
  cache.set(ck, css);
  return css;
}
// Put the picture of place `id` behind selector `sel` (only touches the page when it changed).
export function applyBackdrop(sel, id) {
  const bg = placeBackdrop(id);
  if (sel._bd !== bg) { sel._bd = bg; sel.style.background = bg; }
}
