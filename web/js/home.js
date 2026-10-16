// home.js - the Home screen, opened by the VS box at the top left (no tab). The business side of the game:
// welcome message, Discord / support, membership button (not connected yet), account, game time, log out.
// Layout that is fixed lives in web/index.html (#scr-home: #who, #gtime, #ship, #out); the rest is built here in code.
// The ship line (#ship) stays in the page, hidden (core.js still fills it); the ship is shown in Profile.
import { S, $, addScreen, el } from 'core';

const DISCORD = 'https://discord.gg/4G8rWeF7AV';
const WELCOME = 'Welcome to Vacuum State, an early test of a hard sci-fi trading game. Things will change, break and be reset while we test. Thank you for helping.';   // the welcome text: edit here

const home = $('scr-home');

const shipLine = $('ship');
if (shipLine) {
  shipLine.hidden = true;
  const head = shipLine.previousElementSibling;       /* the "Ship" heading above it */
  if (head && head.tagName === 'H2') head.hidden = true;
}
/* the old grey placeholder line in index.html is replaced by the blocks below */
const old = [...home.children].find(c => c.classList.contains('muted') && c.classList.contains('pad'));
if (old) old.hidden = true;

function block(title) {
  const b = el('section', ''); b.appendChild(el('h2', '', title)); return b;
}

/* welcome */
const welcome = block('Welcome');
const welcomeName = el('div', 'pad', '');
welcome.append(welcomeName, el('div', 'muted pad', WELCOME));

/* support + Discord (Discord is the support channel for now) */
const help = block('Help and feedback');
help.appendChild(el('div', 'muted pad', 'Questions, bugs, ideas or account trouble: message us on our Discord server. It is also where testers talk to each other.'));
const dc = el('button', '', 'Join our Discord');
dc.addEventListener('click', () => window.open(DISCORD, '_blank', 'noopener'));
help.appendChild(dc);

/* membership (not connected yet: payments are a later step) */
const member = block('Membership');
member.appendChild(el('div', 'muted pad', 'Membership is not available yet. It will be explained here before it opens.'));
const mb = el('button', 'alt', 'Get membership (coming soon)'); mb.disabled = true;
member.appendChild(mb);

/* the blocks go under the page's own account / game time lines and above Log out */
const out = $('out');
[welcome, help, member].forEach(b => { if (out) home.insertBefore(b, out); else home.appendChild(b); });

function draw() {
  const ch = S.last && S.last.character;
  welcomeName.textContent = ch && ch.name ? 'Pilot ' + ch.name + ', welcome aboard.' : '';
}
addScreen('home', 'Home', home, { noTab: true, onShow: draw, update: draw });
