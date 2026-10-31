// library.js - the in-game Library: a list of help topics, and the page of one topic. No tab: opened from the Home page.
// The TEXT is in library_pages.js (plain data); this file only shows it. It makes its own div (id scr-library) and its own
// styles, so web/index.html needs no change. Loaded by home.js.
// The page text is a small piece of markdown: paragraphs, "- " bullets, "1. " numbered lists, **bold** and *italic*.
// Nothing is put in the page as HTML: every piece is made as text, so a stray < or & in a page is shown as it is.
import { $, el, addScreen, openScreen } from 'core';
import { PAGES } from './library_pages.js';

const st = document.createElement('style');
st.textContent = [
  '#scr-library .lhead{display:flex;justify-content:space-between;align-items:center;gap:8px}',
  '#scr-library .lhead h2{margin:0}',
  '#scr-library .lx{width:40px;height:40px;padding:0;margin:0;flex:none}',
  '#scr-library .lintro{margin:8px 2px 10px;color:#8d98b2;font-size:13px}',
  '#scr-library .ltopic{display:block;width:100%;text-align:left;margin:0 0 6px;padding:10px 12px}',
  '#scr-library .ltopic .lt{display:block;font-weight:700;font-size:16px;color:#e8b64a}',
  '#scr-library .ltopic .lb{display:block;font-size:12px;font-weight:600;color:#8d98b2;margin-top:2px}',
  '#scr-library .lpage{margin:10px 2px 14px;color:#c6cfe4;font-size:15px;line-height:1.5}',
  '#scr-library .lpage p{margin:0 0 12px}',
  '#scr-library .lpage ul,#scr-library .lpage ol{margin:0 0 12px;padding-left:22px}',
  '#scr-library .lpage li{margin:0 0 6px}',
  '#scr-library .lpage strong{color:#e8b64a}',
  '#scr-library .lback{display:block;width:100%;margin:6px 0 14px}',
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
    if (lines.every(l => /^- /.test(l))) {
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
      const b = el('button', 'alt ltopic');
      b.append(el('span', 'lt', p.title), el('span', 'lb', p.blurb || ''));
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
