// library.js - the in-game Library: a list of help topics, and the page of one topic. No tab: opened from the Home page.
// The TEXT is in library_pages.js (plain data); this file only shows it. It makes its own div (id scr-library) and its own
// styles, so web/index.html needs no change. Loaded by home.js.
// The page text is a small piece of markdown: paragraphs, "## " bars, ![name|caption] pictures, "- " bullets, "1. " numbered lists, **bold** and *italic*.
// 2026-11-07 phone layout: topics are rows (white title, grey blurb, a caret), a page is cut into parts by bars, bold terms are white, the X is 34 px,
// and the pictures are drawn by library_art.js (SVG made in code).
// Nothing is put in the page as HTML: every piece is made as text, so a stray < or & in a page is shown as it is.
import { $, el, addScreen, openScreen } from 'core';
import { PAGES } from './library_pages.js';
import { ART } from './library_art.js';

const st = document.createElement('style');
st.textContent = [
  '#scr-library .lhead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 4px 6px}',
  '#scr-library .lhead h2{margin:0;font-size:18px;font-weight:500;color:#fff}',
  '#scr-library .lx{width:34px;height:34px;padding:0;margin:0;flex:none;min-height:0;font-size:13px}',
  '#scr-library .lintro{margin:2px 8px 8px;color:#8d98b2;font-size:12px}',
  '#scr-library .ltopic{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;margin:0;padding:8px;border:0;border-bottom:1px solid #2f3a58;border-radius:0;background:none}',
  '#scr-library .ltopic .lt{display:block;font-weight:500;font-size:14px;color:#fff;line-height:1.2}',
  '#scr-library .ltopic .lb{display:block;font-size:11px;font-weight:400;color:#8d98b2;margin-top:2px;line-height:1.2}',
  '#scr-library .ltopic .lc{font-size:20px;color:#8d98b2;flex:none}',
  '#scr-library .lpage{margin:6px 0 14px;color:#e3e9f7;font-size:14px;line-height:1.5}',
  '#scr-library .lpage p{margin:0 8px 12px}',
  '#scr-library .lpage ul,#scr-library .lpage ol{margin:0 8px 12px;padding-left:20px}',
  '#scr-library .lpage li{margin:0 0 6px}',
  '#scr-library .lpage strong{color:#fff;font-weight:600}',
  '#scr-library .lbar{margin:16px 0 8px;min-height:32px;display:flex;align-items:center;padding:0 8px;background:rgba(120,160,210,.16);border-top:2px solid rgba(120,160,210,.55);border-bottom:1px solid rgba(120,160,210,.25);font-size:13px;font-weight:500;color:#fff;line-height:1.2;letter-spacing:.02em}',
  '#scr-library .lfig{margin:4px 0 14px;padding:8px;background:#0b0f1a;border:1px solid #2a3350;border-radius:10px}',
  '#scr-library .lcap{margin:6px 2px 0;font-size:11px;color:#8d98b2;line-height:1.3;text-align:center}',
  '#scr-library .lback{display:inline-flex;align-items:center;width:auto;height:34px;min-height:0;margin:6px 8px 14px;padding:0 14px;font-size:13px}',
].join('');
document.head.appendChild(st);

const box = el('div', '');
box.id = 'scr-library'; box.hidden = true;
$('scr-home').parentNode.appendChild(box);

let page = null;                 // id of the topic being read; null = the list of topics

/* **bold** and *italic* inside one line, made as text pieces (never as HTML) */
function inline(parent, text) {
  text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).forEach(p => {
    if (!p) return;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) parent.appendChild(el('strong', '', p.slice(2, -2)));
    else if (p.startsWith('*') && p.endsWith('*') && p.length > 2) parent.appendChild(el('em', '', p.slice(1, -1)));
    else parent.appendChild(document.createTextNode(p));
  });
}

/* the body text -> a div with paragraphs and lists */
function render(body) {
  const w = el('div', 'lpage');
  String(body).trim().split(/\n\s*\n/).forEach(blk => {
    const lines = blk.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const fig = lines.length === 1 && lines[0].match(/^!\[([a-z_]+)(?:\|(.*))?\]$/);
    if (fig && ART[fig[1]]) {                                  // ![name|caption]: a picture drawn in code
      const f = el('div', 'lfig');
      f.appendChild(ART[fig[1]]());
      if (fig[2]) f.appendChild(el('div', 'lcap', fig[2]));
      w.appendChild(f);
    } else if (lines.length === 1 && /^## /.test(lines[0])) {  // a bar that starts a new part
      w.appendChild(el('div', 'lbar', lines[0].slice(3)));
    } else if (lines.every(l => /^- /.test(l))) {
      const ul = el('ul', '');
      lines.forEach(l => { const li = el('li', ''); inline(li, l.slice(2)); ul.appendChild(li); });
      w.appendChild(ul);
    } else if (lines.every(l => /^\d+\.\s/.test(l))) {
      const ol = el('ol', '');
      lines.forEach(l => { const li = el('li', ''); inline(li, l.replace(/^\d+\.\s/, '')); ol.appendChild(li); });
      w.appendChild(ol);
    } else {
      const p = el('p', ''); inline(p, lines.join(' ')); w.appendChild(p);
    }
  });
  return w;
}

function toTop() { try { window.scrollTo(0, 0); } catch (e) {} }
function open(id) { page = id; draw(); toTop(); }

function draw() {
  box.replaceChildren();
  const cur = PAGES.find(p => p.id === page);
  const head = el('div', 'lhead');
  head.appendChild(el('h2', '', cur ? cur.title : 'Library'));
  const x = el('button', 'alt lx', 'X');                 // square, top right: from a page back to the list, from the list back to Home
  x.title = cur ? 'Back to the topics' : 'Back to Home'; x.setAttribute('aria-label', x.title);
  x.onclick = () => { if (cur) open(null); else openScreen('home'); };
  head.appendChild(x);
  box.appendChild(head);
  if (!cur) {
    box.appendChild(el('div', 'lintro', 'Pick a topic to read.'));
    PAGES.forEach(p => {
      const b = el('button', 'ltopic');
      const tx = el('span', ''); tx.append(el('span', 'lt', p.title), el('span', 'lb', p.blurb || ''));
      b.append(tx, el('span', 'lc', '\u203A'));
      b.onclick = () => open(p.id);
      box.appendChild(b);
    });
    return;
  }
  box.appendChild(render(cur.body));
  const back = el('button', 'alt lback', 'Back to the topics');
  back.onclick = () => open(null);
  box.appendChild(back);
}

addScreen('library', 'Library', box, { noTab: true, onShow() { page = null; draw(); } });
