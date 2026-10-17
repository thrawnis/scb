// Keyboard, gamepad and touch input merged into one button state, sampled once per tick.
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  ArrowUp: 'up', KeyW: 'up',
  KeyZ: 'jump', Space: 'jump', KeyK: 'jump',
  KeyX: 'run', ShiftLeft: 'run', ShiftRight: 'run', KeyJ: 'run',
  Escape: 'pause', Enter: 'pause', KeyP: 'pause',
};
const BUTTONS = ['left', 'right', 'down', 'up', 'jump', 'run', 'pause'];

export class Input {
  constructor(onGesture) {
    this.keys = {};
    this.taps = {}; // presses since the last poll, so a quick tap is never missed
    this.touch = {};
    this.down = {};
    this.prev = {};
    this.enabled = true;
    this.onGesture = onGesture;
    addEventListener('keydown', (e) => {
      onGesture?.();
      const b = KEYMAP[e.code];
      if (!b || !this.enabled) return;
      if (!e.repeat) this.taps[b] = true;
      this.keys[b] = true;
      e.preventDefault();
    });
    addEventListener('keyup', (e) => { const b = KEYMAP[e.code]; if (b) this.keys[b] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }

  bindTouch(root) {
    for (const el of root.querySelectorAll('[data-btn]')) {
      const b = el.dataset.btn;
      const on = (e) => { e.preventDefault(); this.onGesture?.(); this.touch[b] = true; this.taps[b] = true; el.classList.add('on'); };
      const off = (e) => { e.preventDefault(); this.touch[b] = false; el.classList.remove('on'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    }
  }

  // Call once per fixed update tick.
  poll() {
    this.prev = this.down;
    const d = {};
    for (const b of BUTTONS) d[b] = !!(this.keys[b] || this.touch[b] || this.taps[b]);
    this.taps = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      const btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      d.left ||= ax < -0.4 || btn(14);
      d.right ||= ax > 0.4 || btn(15);
      d.down ||= ay > 0.5 || btn(13);
      d.up ||= ay < -0.5 || btn(12);
      d.jump ||= btn(0) || btn(1);
      d.run ||= btn(2) || btn(3) || btn(7);
      d.pause ||= btn(9);
    }
    if (!this.enabled) for (const b of BUTTONS) d[b] = false;
    this.down = d;
  }

  held(b) { return this.down[b]; }
  pressed(b) { return this.down[b] && !this.prev[b]; }
  clear() { this.keys = {}; this.taps = {}; this.touch = {}; this.down = {}; this.prev = {}; }
}
