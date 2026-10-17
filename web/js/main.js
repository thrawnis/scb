import { VIEW_W, VIEW_H, FPS } from './config.js';
import { buildArt } from './art.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { UI } from './ui.js';

const canvas = document.getElementById('screen');
const stage = document.getElementById('stage');
const audio = new Audio();
const input = new Input(() => audio.unlock());
addEventListener('pointerdown', () => audio.unlock());
input.bindTouch(document.getElementById('touch'));

const game = new Game(canvas, buildArt(), audio, input);
const ui = new UI(document.getElementById('overlay'), game, input);
game.onStateChange = (s) => { if (s === 'title') ui.open('title'); };
ui.open('title');

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && document.activeElement?.tagName !== 'INPUT') {
    const muted = audio.toggleMute();
    document.getElementById('mute').textContent = muted ? '🔇' : '🔊';
  }
});
document.getElementById('mute').addEventListener('click', (e) => {
  audio.unlock();
  e.currentTarget.textContent = audio.toggleMute() ? '🔇' : '🔊';
  e.currentTarget.blur();
});
document.getElementById('mute').textContent = audio.muted ? '🔇' : '🔊';
document.getElementById('pausebtn').addEventListener('click', (e) => {
  e.currentTarget.blur();
  if (game.state === 'play' && !ui.isOpen) ui.openPause();
});

// Integer scaling keeps pixels crisp; fall back to fractional on tiny screens.
function resize() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const availH = innerHeight - (touch ? 150 : 0);
  let s = Math.min(innerWidth / VIEW_W, availH / VIEW_H);
  if (s >= 1) s = Math.floor(s);
  stage.style.width = `${Math.floor(VIEW_W * s)}px`;
  stage.style.height = `${Math.floor(VIEW_H * s)}px`;
  document.documentElement.style.setProperty('--scale', s);
}
addEventListener('resize', resize);
resize();

// Gamepad navigation for the HTML menus.
let padPrev = {};
function pollMenuPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const now = {};
  for (const p of pads) {
    if (!p) continue;
    const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    now.up ||= b(12) || p.axes[1] < -0.5;
    now.down ||= b(13) || p.axes[1] > 0.5;
    now.ok ||= b(0) || b(9);
    now.back ||= b(1);
  }
  const edge = (k) => now[k] && !padPrev[k];
  if (edge('up')) ui.navigate(-1);
  if (edge('down')) ui.navigate(1);
  if (edge('ok')) ui.activate();
  if (edge('back')) ui.back();
  padPrev = now;
}

// Fixed-timestep loop: simulation always runs at 60 Hz regardless of display refresh rate.
const STEP = 1000 / FPS;
let last = performance.now();
let acc = 0;
function loop(now) {
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    if (ui.isOpen) pollMenuPad();
    input.poll();
    if (!ui.isOpen) {
      if (input.pressed('pause') && game.state === 'play') ui.openPause();
      else if (game.state === 'win' && (input.pressed('pause') || input.pressed('jump'))) game.toTitle();
    }
    game.update();
  }
  game.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Handle for automated tests and debugging (open the page with #debug).
if (location.hash === '#debug') window.scb = { game, ui, input };

addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === 'play' && !ui.isOpen) ui.openPause();
});
