// HTML menus layered over the canvas: title, pause, save, load and controls.
import { readSlots, saveToSlot, loadSlot, deleteSlot, fetchByCode, importToSlot, formatCode } from './save.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'onclick') el.addEventListener('click', v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
};

function slotLabel(rec, i) {
  if (!rec) return [h('b', {}, `Slot ${i + 1}`), h('span', { class: 'dim' }, 'Empty')];
  const s = rec.summary || {};
  const when = new Date(rec.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return [
    h('b', {}, `Slot ${i + 1}`),
    h('span', {}, `World ${s.world ?? '?'} · Score ${String(s.score ?? 0).padStart(6, '0')} · Lives ${s.lives ?? '?'}`),
    h('span', { class: 'dim' }, when + (rec.code ? ` · Code ${formatCode(rec.code)}` : ' · Not synced')),
  ];
}

export class UI {
  constructor(root, game, input) {
    this.root = root;
    this.panel = root.querySelector('.panel');
    this.game = game;
    this.input = input;
    this.stack = [];
    this.busy = false;
    document.addEventListener('keydown', (e) => {
      if (this.root.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); this.back(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();
        this.navigate(e.key === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  get isOpen() { return !this.root.hidden; }

  open(screen, ...args) {
    this.stack = [[screen, args]];
    this.render();
  }

  push(screen, ...args) {
    this.stack.push([screen, args]);
    this.render();
  }

  back() {
    if (this.busy) return;
    if (this.stack.length > 1) { this.stack.pop(); this.render(); return; }
    const [screen] = this.stack[0] || [];
    if (screen === 'pause') this.resume();
  }

  close() {
    this.root.hidden = true;
    this.game.paused = false;
    this.stack = [];
    // Re-enable game input after this key event has finished dispatching,
    // so the key that closed the menu doesn't also reach the game.
    this.input.clear();
    setTimeout(() => { this.input.enabled = true; this.input.clear(); }, 0);
  }

  resume() { this.close(); }

  openPause() {
    this.game.sfx('pause');
    this.open('pause');
  }

  render() {
    const [screen, args] = this.stack[this.stack.length - 1];
    this.input.enabled = false;
    this.input.clear();
    // The game stands still behind any menu, except the animated title screen.
    if (this.game.state !== 'title') this.game.paused = true;
    this.root.hidden = false;
    this.panel.replaceChildren(...this[screen](...args));
    const first = this.panel.querySelector('[autofocus]') || this.panel.querySelector('button:not([disabled]), input');
    first?.focus();
  }

  navigate(dir) {
    const items = [...this.panel.querySelectorAll('button:not([disabled]), input')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    items[(i + dir + items.length) % items.length].focus();
  }

  activate() { document.activeElement?.click?.(); }

  // ---------------------------------------------------------------- screens

  title() {
    const any = readSlots().some(Boolean);
    return [
      h('div', { class: 'menu' },
        h('button', { onclick: () => { this.close(); this.game.newGame(); } }, 'New Game'),
        h('button', { onclick: () => this.push('load') }, any ? 'Load Game' : 'Load Game / Save Code'),
        h('button', { onclick: () => this.push('controls') }, 'Controls')),
    ];
  }

  pause() {
    return [
      h('h2', {}, 'Paused'),
      h('div', { class: 'menu' },
        h('button', { onclick: () => this.resume() }, 'Resume'),
        h('button', { disabled: !this.game.canSave(), onclick: () => this.push('save') }, 'Save Game'),
        h('button', { onclick: () => this.push('load') }, 'Load Game'),
        h('button', { onclick: () => this.push('controls') }, 'Controls'),
        h('button', { onclick: () => this.push('confirm', 'Quit to the title screen? Unsaved progress will be lost.', () => this.game.toTitle()) }, 'Quit to Title')),
    ];
  }

  save() {
    const slots = readSlots();
    const doSave = async (i) => {
      this.busy = true;
      this.panel.replaceChildren(h('p', {}, 'Saving…'));
      try {
        const { rec, syncError } = await saveToSlot(i, this.game.serialize());
        this.busy = false;
        this.stack.pop();
        if (syncError) {
          this.push('message', 'Saved on this device',
            `Saved to slot ${i + 1} in this browser. Couldn't reach the server (${syncError}), so there is no save code yet — saving again later will create one.`);
        } else {
          this.push('message', 'Game saved', `Saved to slot ${i + 1}.`, rec.code);
        }
      } catch (e) {
        this.busy = false;
        this.push('message', 'Save failed', e.message);
      }
    };
    return [
      h('h2', {}, 'Save Game'),
      h('div', { class: 'slots' }, slots.map((rec, i) => h('button', {
        class: 'slot',
        onclick: () => (rec ? this.push('confirm', `Overwrite slot ${i + 1}?`, () => doSave(i), true) : doSave(i)),
      }, slotLabel(rec, i)))),
      h('div', { class: 'menu' }, h('button', { onclick: () => this.back() }, 'Back')),
    ];
  }

  load() {
    const slots = readSlots();
    const input = h('input', { type: 'text', placeholder: 'ABCD-EFGH', maxlength: '12', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Save code' });
    const err = h('p', { class: 'error' });
    const byCode = async () => {
      this.busy = true;
      err.textContent = 'Looking up code…';
      try {
        const remote = await fetchByCode(input.value);
        this.busy = false;
        this.push('importSlot', remote);
      } catch (e) {
        this.busy = false;
        err.textContent = e.message;
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); byCode(); } });
    return [
      h('h2', {}, 'Load Game'),
      h('div', { class: 'slots' }, slots.map((rec, i) => h('div', { class: 'slotrow' },
        h('button', { class: 'slot', disabled: rec ? null : '', onclick: () => this.loadFromSlot(i) }, slotLabel(rec, i)),
        rec ? h('button', { class: 'small', title: `Delete slot ${i + 1}`, onclick: () => this.push('confirm', `Delete slot ${i + 1} from this browser?` + (rec.code ? ` Code ${formatCode(rec.code)} will still work on other devices.` : ''), () => { deleteSlot(i); }, true) }, 'Delete') : null,
      ))),
      h('div', { class: 'code' }, h('label', {}, 'Have a save code?'), h('div', { class: 'row' }, input, h('button', { onclick: byCode }, 'Load'))),
      err,
      h('div', { class: 'menu' }, h('button', { onclick: () => this.back() }, 'Back')),
    ];
  }

  async loadFromSlot(i) {
    this.busy = true;
    this.panel.replaceChildren(h('p', {}, 'Loading…'));
    try {
      const { data, source } = await loadSlot(i);
      this.busy = false;
      this.start(data, source === 'server' ? 'Loaded the newer copy saved on another device.' : null);
    } catch (e) {
      this.busy = false;
      this.push('message', 'Load failed', e.message);
    }
  }

  importSlot(remote) {
    const slots = readSlots();
    const pick = (i) => {
      importToSlot(i, remote);
      this.start(remote.data, null);
    };
    const s = remote.data?.summary || {};
    return [
      h('h2', {}, 'Save found'),
      h('p', {}, `World ${s.world ?? '?'} · Score ${String(s.score ?? 0).padStart(6, '0')} · Lives ${s.lives ?? '?'}`),
      h('p', { class: 'dim' }, 'Pick a slot to keep it in. Saving to that slot will update this code.'),
      h('div', { class: 'slots' }, slots.map((rec, i) => h('button', {
        class: 'slot',
        onclick: () => (rec ? this.push('confirm', `Replace slot ${i + 1} with this save?`, () => pick(i)) : pick(i)),
      }, slotLabel(rec, i)))),
      h('div', { class: 'menu' }, h('button', { onclick: () => this.back() }, 'Back')),
    ];
  }

  start(data, note) {
    let mode;
    try { mode = this.game.restore(data); } catch (e) {
      this.push('message', 'Load failed', e.message);
      return;
    }
    if (mode === 'restart') {
      this.open('message', 'Loaded', 'The levels have changed since this save was made, so you continue from the start of the saved level with your score and lives.', null, true);
      return;
    }
    if (note) { this.open('message', 'Loaded', note, null, true); return; }
    this.close();
  }

  controls() {
    const rows = [
      ['Move', '← → or A D'], ['Crouch', '↓ or S'], ['Jump', 'Z, Space, K or ↑ / W (hold for higher)'],
      ['Run / Fire', 'X, Shift or J'], ['Pause / Save / Load', 'Esc, Enter or P'], ['Mute', 'M'],
      ['Gamepad', 'D-pad/stick, A jump, X run, Start pause'],
    ];
    return [
      h('h2', {}, 'Controls'),
      h('table', {}, rows.map(([a, b]) => h('tr', {}, h('th', {}, a), h('td', {}, b)))),
      h('div', { class: 'menu' }, h('button', { onclick: () => this.back() }, 'Back')),
    ];
  }

  confirm(text, yes, popAfter) {
    return [
      h('p', {}, text),
      h('div', { class: 'menu row' },
        h('button', { onclick: () => { this.stack.pop(); yes(); if (popAfter && !this.busy && this.isOpen && this.stack.length) this.render(); } }, 'Yes'),
        h('button', { autofocus: '', onclick: () => this.back() }, 'No')),
    ];
  }

  message(title, text, code, closeOnOk) {
    return [
      h('h2', {}, title),
      h('p', {}, text),
      code ? h('div', { class: 'savecode' }, h('span', { class: 'dim' }, 'Save code'), h('strong', {}, formatCode(code)),
        h('span', { class: 'dim' }, 'Enter it under Load Game on any device to continue.')) : null,
      h('div', { class: 'menu' }, h('button', { onclick: () => (closeOnOk ? this.close() : this.back()) }, 'OK')),
    ];
  }
}

