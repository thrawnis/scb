// Tiny chiptune synth: square/triangle/noise voices via WebAudio, no audio files.
const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function freq(n) {
  const m = /^([A-G])(#?)(\d)$/.exec(n);
  if (!m) return 0;
  const semi = NOTE[m[1]] + (m[2] ? 1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semi / 12);
}

// Original tunes. One token per step; '-' holds the previous note, '.' is a rest.
const TUNES = {
  planet: {
    step: 0.125,
    lead: 'E5 G5 C6 - B5 A5 G5 - E5 G5 A5 G5 E5 - D5 - C5 E5 G5 - A5 G5 E5 - F5 E5 D5 - C5 - . . ' +
      'G5 - E5 G5 A5 - G5 E5 F5 - D5 F5 G5 - F5 D5 E5 C5 D5 E5 F5 E5 D5 C5 B4 C5 D5 B4 C5 - . .',
    bass: 'C3 . G3 . C3 . G3 . A2 . E3 . A2 . E3 . F2 . C3 . F2 . C3 . G2 . D3 . G2 . B2 . ' +
      'C3 . G3 . C3 . E3 . D3 . A3 . D3 . F3 . F2 . C3 . G2 . D3 . G2 . G2 . C3 . . .',
  },
  borg: {
    step: 0.15,
    lead: 'A4 . C5 . E5 . D5 C5 . . A4 . G4 . A4 . . . C5 D5 E5 . G5 . F5 E5 D5 . E5 - - . ' +
      'A4 . C5 . E5 . A5 . G5 F5 E5 . D5 . E5 . F5 . E5 . D5 . C5 . B4 . G#4 . A4 - - .',
    bass: 'A2 . A2 . E3 . A2 . F2 . F2 . C3 . F2 . G2 . G2 . D3 . G2 . E2 . E2 . B2 . E2 . ' +
      'A2 . A2 . E3 . A2 . D2 . D2 . A2 . D2 . F2 . F2 . E2 . E2 . A2 . E2 . A2 . . .',
  },
  clear: {
    step: 0.11, once: true,
    lead: 'C5 E5 G5 C6 E6 G6 - - E6 - - - G#5 C6 D#6 G#6 - - D#6 - - - A#5 D6 F6 A#6 - - A#6 A#6 A#6 C7 - - - - . .',
    bass: 'C3 . . . . . . . C3 . . . G#2 . . . . . G#2 . . . A#2 . . . . . A#2 A#2 A#2 C3 - - - - . .',
  },
  gameover: {
    step: 0.16, once: true,
    lead: 'C5 . . G4 . . E4 . A4 - B4 - A4 - G#4 - A#4 - G#4 - G4 - - - - - . .',
    bass: 'E3 . . C3 . . G2 . F2 - - - F2 - - - F2 - - - C2 - - - - - . .',
  },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('scb.muted') === '1'; } catch { /* storage unavailable */ }
    this.tune = null;
    this.timer = null;
  }

  // Browsers only allow audio after a user gesture; call this from input handlers.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.35;
    this.musicGain.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.pending) { const p = this.pending; this.pending = null; this.music(p); }
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('scb.muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  tone(type, f0, f1, dur, vol = 0.25, when = 0, dest = this.master) {
    if (!this.ctx || !f0) return;
    const t = (when || this.ctx.currentTime);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hiss(dur, vol = 0.3, hp = 800) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur);
  }

  seq(notes, step, type = 'square', vol = 0.2) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    notes.forEach((n, i) => this.tone(type, freq(n), 0, step * 1.4, vol, t + i * step));
  }

  sfx(name) {
    if (!this.ctx) return;
    switch (name) {
      case 'jump': this.tone('square', 260, 640, 0.16, 0.15); break;
      case 'bigjump': this.tone('square', 200, 480, 0.2, 0.15); break;
      case 'coin': this.seq(['B5', 'E6'], 0.07, 'square', 0.15); break;
      case 'stomp': this.tone('square', 500, 120, 0.12, 0.2); break;
      case 'bump': this.tone('triangle', 160, 90, 0.1, 0.4); break;
      case 'break': this.hiss(0.25, 0.35, 400); this.tone('square', 220, 60, 0.15, 0.15); break;
      case 'sprout': this.seq(['C4', 'G4', 'C5', 'G5'], 0.05, 'triangle', 0.3); break;
      case 'power': this.seq(['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], 0.05, 'square', 0.14); break;
      case 'life': this.seq(['E6', 'G6', 'E7', 'C7', 'D7', 'G7'], 0.08, 'square', 0.12); break;
      case 'fire': this.tone('sawtooth', 1400, 500, 0.14, 0.08); this.tone('sine', 1800, 900, 0.14, 0.12); break;
      case 'kick': this.tone('square', 700, 300, 0.08, 0.2); break;
      case 'hurt': this.seq(['A4', 'E4', 'A3', 'E3'], 0.06, 'square', 0.18); break;
      case 'die': this.seq(['B4', 'F5', '.', 'F5', 'F5', 'E5', 'D5', 'C5'], 0.12, 'square', 0.18); break;
      case 'flag': this.hiss(1.2, 0.12, 4000); this.seq(['C6', 'E6', 'G6', 'C7', 'E7', 'G7', 'C7', 'E7', 'G7'], 0.1, 'sine', 0.1); break;
      case 'pause': this.seq(['E5', 'C5', 'E5', 'C5'], 0.06, 'square', 0.12); break;
      case 'tick': this.tone('square', 1500, 0, 0.03, 0.06); break;
      case 'hurry': this.seq(['C6', 'C6', 'C6'], 0.09, 'square', 0.12); break;
    }
  }

  music(name) {
    this.stopMusic();
    if (!name) return;
    if (!this.ctx) { this.pending = name; return; }
    const tune = TUNES[name];
    const lead = tune.lead.trim().split(/\s+/);
    const bass = tune.bass.trim().split(/\s+/);
    const len = Math.max(lead.length, bass.length);
    let i = 0;
    let next = this.ctx.currentTime + 0.05;
    const run = () => {
      while (next < this.ctx.currentTime + 0.2) {
        if (i >= len) {
          if (tune.once) { this.stopMusic(); return; }
          i = 0;
        }
        for (const [part, type, vol] of [[lead, 'square', 0.16], [bass, 'triangle', 0.4]]) {
          const n = part[i];
          if (!n || n === '-' || n === '.') continue;
          let hold = 1;
          while (part[i + hold] === '-') hold++;
          this.tone(type, freq(n), 0, tune.step * hold * 0.95, vol, next, this.musicGain);
        }
        i++;
        next += tune.step;
      }
    };
    run();
    this.timer = setInterval(run, 50);
  }

  stopMusic() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = null;
  }
}
