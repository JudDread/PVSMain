// library_art.js - the small PICTURES used in Library pages (screen sketches). Each one is drawn in code as SVG (nothing from the network, nothing
// from a player), so a page only says  ![name|caption]  and library.js calls ART[name]().
// To add a picture: add a function to ART that returns an SVG element made with the helpers below.
const NS = 'http://www.w3.org/2000/svg';
const C = { bg: '#0b0f1a', panel: '#131a2a', line: '#3a4666', sep: '#2f3a58', amber: '#e8b64a', grey: '#8d98b2', green: '#6be08f', red: '#ff7b6b', white: '#ffffff', blue: '#6f8fd0', box: '#2a3f6e' };

function svg(w, h) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  s.setAttribute('role', 'img');
  s.style.cssText = 'display:block;width:100%;height:auto;max-width:' + w + 'px;margin:0 auto;';
  return s;
}
function add(parent, tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k]));
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}
const rect = (p, x, y, w, h, fill, stroke, r) => add(p, 'rect', { x, y, width: w, height: h, rx: r == null ? 4 : r, fill: fill || 'none', stroke: stroke || 'none', 'stroke-width': 1 });
const text = (p, x, y, str, size, fill, anchor, weight) => add(p, 'text', { x, y, 'font-size': size || 11, fill: fill || C.white, 'text-anchor': anchor || 'start', 'font-weight': weight || 400, 'font-family': 'inherit' }, str);
const line = (p, x1, y1, x2, y2, stroke, dash) => add(p, 'line', { x1, y1, x2, y2, stroke: stroke || C.grey, 'stroke-width': 1, 'stroke-dasharray': dash || '' });
const circle = (p, x, y, r, fill, stroke) => add(p, 'circle', { cx: x, cy: y, r, fill: fill || 'none', stroke: stroke || 'none', 'stroke-width': 1 });
// a small numbered ball (1, 2, 3 ...) used to point at part of a picture
function ball(p, x, y, n) { circle(p, x, y, 8, C.amber); text(p, x, y + 4, String(n), 11, '#14100a', 'middle', 700); }
// a label with a thin leader line to a point
function note(p, tx, ty, anchor, lines, px, py) {
  lines.forEach((t, i) => text(p, tx, ty + i * 12, t, 10, C.white, anchor));
  const lx = anchor === 'end' ? tx + 4 : tx - 4;
  line(p, lx, ty - 4, px, py, C.grey, '2 2');
}

export const ART = {
  // a pressed Cargo row and its one-line pop-up
  market_pop() {
    const s = svg(340, 215);
    rect(s, 0, 0, 340, 44, C.panel, C.sep, 6);
    text(s, 10, 18, '8 x Hydrogen', 13, C.white, 'start', 500); text(s, 10, 34, 'paid 2.1K each', 10, C.grey);
    text(s, 215, 18, 'Jupiter', 13, C.white, 'end', 500); text(s, 215, 34, '2.6K (71%)', 10, C.grey, 'end');
    text(s, 330, 18, '2.3K', 13, C.green, 'end', 500); text(s, 330, 34, '+200', 10, C.green, 'end');
    rect(s, 0, 52, 340, 52, '#1a2740', '#3a5a8a', 8);
    text(s, 10, 70, '$ each (avg)', 9.5, C.grey); text(s, 10, 92, '~2.3K', 15, C.white, 'start', 500);
    rect(s, 100, 64, 54, 32, C.box, C.blue, 6); text(s, 146, 86, '6', 15, C.white, 'end');
    rect(s, 160, 66, 32, 28, '#192033', C.line, 6); text(s, 176, 84, 'All', 12, C.white, 'middle');
    rect(s, 196, 66, 36, 28, C.amber, C.amber, 6); text(s, 214, 84, 'Sell', 12, '#14100a', 'middle', 700);
    rect(s, 236, 66, 52, 28, '#192033', C.line, 6); text(s, 262, 84, 'Unload', 12, C.white, 'middle');
    ball(s, 36, 124, 1); ball(s, 127, 124, 2); ball(s, 176, 124, 3); ball(s, 214, 124, 4); ball(s, 262, 124, 5);
    [[36, 100], [127, 98], [176, 96], [214, 96], [262, 96]].forEach(p => line(s, p[0], 116, p[0], p[1], C.grey, '2 2'));
    text(s, 10, 152, '1  the estimated price for each unit', 11, C.white);
    text(s, 10, 168, '2  the number of units (touch it to select it)', 11, C.white);
    text(s, 10, 184, '3  All: the most you can do    4  Sell', 11, C.white);
    text(s, 10, 200, '5  Unload: move the goods to Storage here', 11, C.white);
    return s;
  },

  // the Fly screen
  fly_screen() {
    const s = svg(360, 262);
    const x = 105, w = 150;
    rect(s, x, 4, w, 254, C.bg, C.line, 12);
    [30, 55, 80, 105].forEach(r => circle(s, x + 75, 120, r * 1.1, 'none', '#1c2438'));
    circle(s, x + 75, 120, 6, C.amber); circle(s, x + 120, 78, 4, '#6f8fd0'); circle(s, x + 40, 150, 3, '#8d98b2');
    // zoom buttons and a timer chip, top left
    [['Inner', 0], ['System', 1], ['Ship', 2]].forEach(a => { const bx = x + 6 + a[1] * 31; rect(s, bx, 11, 29, 14, '#192033', C.line, 4); text(s, bx + 14.5, 21, a[0], 7.5, C.white, 'middle'); });
    rect(s, x + 6, 29, 52, 14, '#192033', C.amber, 4); text(s, x + 32, 39, '9:40 job', 7.5, C.amber, 'middle');
    // ship chip, top right
    rect(s, x + 94, 11, 50, 28, '#192033', C.line, 5);
    rect(s, x + 100, 17, 38, 4, '#4cd37a', 'none', 2); rect(s, x + 100, 24, 30, 4, '#6f8fd0', 'none', 2); rect(s, x + 100, 31, 34, 4, '#e8b64a', 'none', 2);
    // the proposed course (blue) to a destination
    line(s, x + 75, 120, x + 120, 78, '#4aa3ff', '4 3');
    // arrival chip and the two buttons at the bottom
    rect(s, x + 8, 208, 74, 14, '#192033', C.line, 7); text(s, x + 45, 218, 'Arrives in 4:12', 8, '#9fd4ff', 'middle');
    rect(s, x + 8, 228, 62, 22, '#192033', C.line, 6); text(s, x + 39, 243, 'Destinations', 8.5, C.white, 'middle');
    rect(s, x + 76, 228, 66, 22, C.amber, C.amber, 6); text(s, x + 109, 240, 'Launch', 9.5, '#14100a', 'middle', 700); text(s, x + 109, 248, '4:12', 7, '#14100a', 'middle');
    // labels
    note(s, 4, 20, 'start', ['Zoom: Inner,', 'System, Ship'], x + 6, 18);
    note(s, 4, 56, 'start', ['Timers of timed', 'jobs'], x + 6, 36);
    note(s, 4, 160, 'start', ['The course you', 'are proposing'], x + 62, 110);
    note(s, 4, 212, 'start', ['Arrives in (only', 'while flying)'], x + 8, 214);
    note(s, 356, 18, 'end', ['Your ship chip:', 'shield, armor,', 'hull. Touch it for', 'the ship menu'], x + 144, 24);
    note(s, 356, 236, 'end', ['Launch (or', 'Confirm in flight)'], x + 142, 238);
    return s;
  },

  // the combat zone screen
  zone_screen() {
    const s = svg(360, 282);
    const x = 105, w = 150;
    rect(s, x, 4, w, 274, C.bg, C.line, 12);
    circle(s, x + 75, 120, 52, 'none', '#1c2438');
    // gear, top left
    circle(s, x + 15, 20, 8, '#192033', C.line); text(s, x + 15, 24, '*', 11, C.white, 'middle');
    // your three bars, left edge, low
    [['#6f8fd0', 70], ['#e8b64a', 54], ['#4cd37a', 62]].forEach((b, i) => rect(s, x + 7 + i * 6, 200 - b[1], 4, b[1], b[0], 'none', 2));
    // other ships, top right (square chips with small bars)
    [0, 1, 2].forEach(i => { const cx = x + 98 + i * 18; rect(s, cx, 11, 15, 15, '#2a1a1a', C.red, 3); rect(s, cx + 1, 28, 13, 2, C.red, 'none', 1); });
    // your ship (green triangle) and an enemy (red square with a dashed range ring)
    add(s, 'polygon', { points: (x + 62) + ',148 ' + (x + 74) + ',148 ' + (x + 68) + ',134', fill: C.green });
    rect(s, x + 100, 82, 10, 10, C.red, 'none', 2);
    circle(s, x + 105, 87, 24, 'none', C.red).setAttribute('stroke-dasharray', '3 3');
    line(s, x + 68, 140, x + 105, 90, '#ffd36a', '2 3');
    // heat, END and zoom chips, bottom right
    rect(s, x + 56, 214, 30, 14, '#192033', C.line, 4); text(s, x + 71, 224, 'heat', 7.5, C.white, 'middle');
    rect(s, x + 90, 214, 24, 14, '#192033', C.green, 4); text(s, x + 102, 224, 'END', 7.5, C.green, 'middle');
    rect(s, x + 118, 214, 26, 14, '#192033', C.line, 4); text(s, x + 131, 224, 'zoom', 7.5, C.white, 'middle');
    // your modules, bottom row
    for (let i = 0; i < 5; i++) { rect(s, x + 24 + i * 24, 236, 20, 20, i === 3 ? '#1b2a22' : '#192033', i === 3 ? C.green : C.line, 4); }
    text(s, x + 24 + 3 * 24 + 10, 249, 'x2', 8, C.green, 'middle');
    // labels
    note(s, 4, 22, 'start', ['Gear: settings,', 'ranges, log'], x + 7, 20);
    note(s, 4, 128, 'start', ['Your ship:', 'touch for', 'its menu'], x + 62, 142);
    note(s, 4, 176, 'start', ['Your shield,', 'armor, hull'], x + 8, 170);
    note(s, 4, 246, 'start', ['Your weapons', 'and rigs'], x + 24, 246);
    note(s, 356, 22, 'end', ['Other ships:', 'nearest at', 'the right edge'], x + 140, 18);
    note(s, 356, 100, 'end', ['A ship: touch it', 'for orders'], x + 112, 88);
    note(s, 356, 222, 'end', ['Heat, endurance', 'and zoom'], x + 146, 222);
    return s;
  },

  // the Rigging screen: a changed row and the bottom bar
  rig_bar() {
    const s = svg(340, 134);
    rect(s, 0, 4, 340, 44, C.panel, C.sep, 6);
    rect(s, 0, 4, 3, 44, C.amber, 'none', 1);
    text(s, 12, 22, 'Pulse Laser II', 13, C.white, 'start', 500); text(s, 12, 38, '+15% thermal damage', 10, C.grey);
    text(s, 252, 30, '15', 10, C.grey, 'end'); rect(s, 262, 14, 68, 28, '#192033', C.line, 6); text(s, 296, 32, 'Take off', 12, C.white, 'middle');
    rect(s, 0, 70, 340, 40, C.panel, C.line, 10);
    text(s, 12, 94, '2 changes', 13, C.white, 'start', 500);
    rect(s, 196, 76, 56, 28, '#192033', C.line, 6); text(s, 224, 94, 'Reset', 12, C.white, 'middle');
    rect(s, 260, 76, 70, 28, C.amber, C.amber, 6); text(s, 295, 94, 'Apply', 12, '#14100a', 'middle', 700);
    text(s, 10, 126, 'The amber line on the side marks a changed row.', 10.5, C.white);
    return s;
  },
};
