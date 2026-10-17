// Game state machine, world simulation, rendering and save-state (de)serialisation.
import { TILE, VIEW_W, VIEW_H, T, LEVELS, GEN_VERSION } from './config.js';
import { generateLevel } from './levelgen.js';
import { World, Player, Enemy, Item, PhaserShot, overlap, PHYS } from './entities.js';
import { drawText, drawTextCentered } from './font.js';

export const GAME_TITLE = 'SCB';
export const SAVE_VERSION = 1;
const START_LIVES = 3;
const levelCache = [];
const getLevel = (i) => levelCache[i] || (levelCache[i] = generateLevel(i));

export class Game {
  constructor(canvas, art, audio, input) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.art = art;
    this.audio = audio;
    this.input = input;
    this.frame = 0;
    this.paused = false;
    this.onStateChange = null;
    this.toTitle();
  }

  sfx(n) { this.audio.sfx(n); }

  setState(s) {
    this.state = s;
    this.stateTimer = 0;
    this.onStateChange?.(s);
  }

  // ---------------------------------------------------------------- flow

  toTitle() {
    this.loadLevel(0);
    this.titleCam = 0;
    this.audio.music(null);
    this.setState('title');
  }

  newGame() {
    this.score = 0;
    this.coins = 0;
    this.lives = START_LIVES;
    this.loadLevel(0);
    this.setState('intro');
  }

  loadLevel(i, size = 0) {
    this.level = getLevel(i);
    this.world = new World(this.level);
    this.player = new Player(this.level.start.x, this.level.start.y);
    this.player.setSize(size);
    this.enemies = this.level.entities.map((e) => new Enemy(e.type, e.x, e.y));
    this.items = [];
    this.shots = [];
    this.particles = [];
    this.time = this.level.time;
    this.timerFrames = 0;
    this.camX = 0;
    this.freeze = 0;
    this.chain = 0;
    this.hurried = false;
    const g = this.world.groundTopAt(this.level.flagX);
    this.flagY = 3 * TILE;
    this.flagBottom = (g - 2) * TILE;
    this.castleTop = this.world.groundTopAt(this.level.castleX + 2);
  }

  startPlay() {
    this.setState('play');
    this.audio.music(this.level.theme);
  }

  // ---------------------------------------------------------------- update

  update() {
    this.frame++;
    this.stateTimer++;
    if (this.paused) return;
    switch (this.state) {
      case 'title': this.titleCam += 0.4; break;
      case 'intro': if (this.stateTimer > 150) this.startPlay(); break;
      case 'play': this.updatePlay(); break;
      case 'dying': this.updateDying(); break;
      case 'flag': this.updateFlag(); break;
      case 'walk': this.updateWalk(); break;
      case 'tally': this.updateTally(); break;
      case 'gameover': if (this.stateTimer > 300) this.toTitle(); break;
      case 'win': break;
    }
  }

  updatePlay() {
    if (this.freeze > 0) { this.freeze--; return; }
    const p = this.player;
    const prevBottom = p.y + p.h;
    p.update(this, this.input);
    if (p.onGround) this.chain = 0;

    // Timer: one unit every 24 frames, like the original.
    if (++this.timerFrames >= 24) {
      this.timerFrames = 0;
      this.time--;
      if (this.time === 100 && !this.hurried) { this.hurried = true; this.sfx('hurry'); }
      if (this.time <= 0) { this.time = 0; this.die(); return; }
    }

    this.updateCamera();
    const near = (e) => e.x > this.camX - 96 && e.x < this.camX + VIEW_W + 32;

    for (const it of this.items) {
      if (!near(it)) continue;
      it.update(this);
      if (it.emerge <= 0 && overlap(p, it)) { it.remove = true; this.collect(it); }
    }
    for (const e of this.enemies) if (near(e) || e.state === 'dead') e.update(this);
    for (const f of this.shots) f.update(this);
    this.enemyInteractions();
    this.playerVsEnemies(prevBottom);

    for (const b of this.world.bumps) b.t++;
    this.world.bumps = this.world.bumps.filter((b) => b.t < 10);
    this.updateParticles();
    this.enemies = this.enemies.filter((e) => !e.remove);
    this.items = this.items.filter((i) => !i.remove);
    this.shots = this.shots.filter((f) => !f.remove);

    if (p.y > this.world.h * TILE + 8) { this.die(); return; }
    if (p.x + p.w >= this.level.flagX * TILE + 7) this.startFlag();
  }

  updateCamera() {
    const p = this.player;
    const cx = p.x + p.w / 2;
    if (cx - this.camX > VIEW_W * 0.55) this.camX = cx - VIEW_W * 0.55;
    if (cx - this.camX < VIEW_W * 0.4) this.camX = cx - VIEW_W * 0.4;
    this.camX = Math.max(0, Math.min(this.world.w * TILE - VIEW_W, this.camX));
  }

  enemyInteractions() {
    const live = this.enemies.filter((e) => e.state !== 'dead' && e.state !== 'flat');
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        if (!overlap(a, b)) continue;
        const slideA = a.state === 'slide', slideB = b.state === 'slide';
        if (slideA || slideB) {
          if (slideA && slideB) { a.flip(Math.sign(b.vx)); b.flip(Math.sign(a.vx)); continue; }
          const [s, o] = slideA ? [a, b] : [b, a];
          o.flip(Math.sign(s.vx));
          this.sfx('kick');
          this.award(200 * Math.min(8, 2 ** this.chainShell(s)), o.x, o.y);
          continue;
        }
        // Walking enemies bounce off each other.
        const [l, r] = a.x < b.x ? [a, b] : [b, a];
        if (l.state === 'walk') l.vx = -Math.abs(l.vx);
        if (r.state === 'walk') r.vx = Math.abs(r.vx);
      }
    }
    for (const f of this.shots) {
      for (const e of live) {
        if (!f.remove && e.state !== 'dead' && overlap(f, e)) {
          f.remove = true;
          e.flip(Math.sign(f.vx));
          this.sfx('kick');
          this.award(200, e.x, e.y);
        }
      }
    }
  }

  chainShell(s) { s.chain = (s.chain || 0) + 1; return s.chain - 1; }

  playerVsEnemies(prevBottom) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.state === 'dead' || e.state === 'flat' || !overlap(p, e)) continue;
      const stomp = p.vy > 0 && prevBottom <= e.y + 6;
      const bounce = () => {
        p.vy = -(this.input.held('jump') ? PHYS.stompBounceHeld : PHYS.stompBounce);
        p.jumping = true;
        p.y = e.y - p.h;
      };
      const chainScore = () => { const s = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000][Math.min(9, this.chain++)]; this.award(s, e.x, e.y - 8); };
      if (e.state === 'walk') {
        if (stomp) {
          if (e.kind === 'walker') { e.state = 'flat'; e.timer = 0; } else { e.state = 'shell'; e.vx = 0; e.timer = 0; }
          this.sfx('stomp');
          chainScore();
          bounce();
        } else this.hurt();
      } else if (e.state === 'shell') {
        const dir = p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1;
        e.state = 'slide';
        e.vx = dir * 4;
        e.kickGrace = 12;
        e.chain = 0;
        this.sfx('kick');
        this.award(400, e.x, e.y - 8);
        if (stomp) bounce();
        else p.inv = Math.max(p.inv, 8);
      } else if (e.state === 'slide') {
        if (stomp) {
          e.state = 'shell'; e.vx = 0; e.timer = 0;
          this.sfx('stomp');
          chainScore();
          bounce();
        } else if (e.kickGrace === 0) this.hurt();
      }
    }
  }

  hurt() {
    const p = this.player;
    if (p.inv > 0) return;
    if (p.size > 0) {
      p.setSize(0);
      p.inv = 120;
      this.freeze = 30;
      this.sfx('hurt');
    } else this.die();
  }

  die() {
    this.player.dead = true;
    this.audio.music(null);
    this.sfx('die');
    this.setState('dying');
  }

  updateDying() {
    const p = this.player;
    if (this.stateTimer === 30) p.vy = -5;
    if (this.stateTimer > 30) { p.vy += 0.25; p.y += p.vy; }
    if (this.stateTimer > 200) {
      this.lives--;
      if (this.lives <= 0) {
        this.setState('gameover');
        this.audio.music('gameover');
      } else {
        this.loadLevel(this.level.index);
        this.setState('intro');
      }
    }
  }

  collect(it) {
    const p = this.player;
    if (it.kind === 'tea') {
      this.lives++;
      this.sfx('life');
      this.popText('1UP', it.x, it.y);
      return;
    }
    this.sfx('power');
    this.award(1000, it.x, it.y);
    if (it.kind === 'badge' && p.size === 0) { p.setSize(1); this.freeze = 30; }
    else if (it.kind === 'phaser') { if (p.size < 2) { p.setSize(2); this.freeze = 30; } }
  }

  bumpBlock(tx, ty) {
    const w = this.world;
    const t = w.tile(tx, ty);
    const i = w.idx(tx, ty);
    const p = this.player;
    if (t !== T.QUESTION && t !== T.BRICK) { this.sfx('bump'); return; }
    let content = w.contents[i] || (t === T.QUESTION ? 'coin' : null);
    if (t === T.BRICK && !content && p.size > 0) {
      w.set(tx, ty, T.EMPTY);
      this.sfx('break');
      this.award(50);
      for (const [dx, dy, vx, vy] of [[0, 0, -1, -5], [8, 0, 1, -5], [0, 8, -1, -3], [8, 8, 1, -3]]) {
        this.particles.push({ kind: 'debris', x: tx * TILE + dx, y: ty * TILE + dy, vx, vy, t: 0 });
      }
      this.bumpAbove(tx, ty);
      return;
    }
    w.bumps.push({ tx, ty, t: 0 });
    this.bumpAbove(tx, ty);
    if (!content) { this.sfx('bump'); return; }
    if (content.startsWith('coins')) {
      // Multi-coin brick: several coins, then it's spent.
      const left = content === 'coins' ? 6 : Number(content.split(':')[1]);
      this.coinPop(tx, ty);
      if (left <= 1) { delete w.contents[i]; w.set(tx, ty, T.USED); } else w.contents[i] = 'coins:' + (left - 1);
      return;
    }
    delete w.contents[i];
    w.set(tx, ty, T.USED);
    if (content === 'coin') this.coinPop(tx, ty);
    else {
      const kind = content === 'life' ? 'tea' : p.size === 0 ? 'badge' : 'phaser';
      this.items.push(new Item(kind, tx, ty));
      this.sfx('sprout');
    }
  }

  // Anything standing on a bumped block gets knocked.
  bumpAbove(tx, ty) {
    const box = { x: tx * TILE, y: ty * TILE - 4, w: TILE, h: 4 };
    for (const e of this.enemies) {
      if (e.state !== 'dead' && e.state !== 'flat' && overlap(box, e)) {
        e.flip(e.x + e.w / 2 < tx * TILE + 8 ? -1 : 1);
        this.sfx('kick');
        this.award(100, e.x, e.y);
      }
    }
    for (const it of this.items) {
      if (it.emerge <= 0 && overlap(box, it)) { it.vy = -4; if (it.kind !== 'phaser') it.vx = it.x + it.w / 2 < tx * TILE + 8 ? -1 : 1; }
    }
    if (this.world.tile(tx, ty - 1) === T.COIN) { this.world.set(tx, ty - 1, T.EMPTY); this.coinPop(tx, ty - 1); }
  }

  coinPop(tx, ty) {
    this.addCoin();
    this.particles.push({ kind: 'coin', x: tx * TILE, y: ty * TILE - 16, vy: -5, t: 0 });
  }

  addCoin() {
    this.coins++;
    this.score += 200;
    this.sfx('coin');
    if (this.coins >= 100) { this.coins -= 100; this.lives++; this.sfx('life'); }
  }

  award(points, x, y) {
    this.score += points;
    if (x !== undefined) this.popText(String(points), x, y);
  }

  popText(text, x, y) { this.particles.push({ kind: 'text', text, x, y, t: 0 }); }
  puff(x, y) { this.particles.push({ kind: 'puff', x, y, t: 0 }); }
  countShots() { return this.shots.length; }
  spawnShot(x, y, dir) { this.shots.push(new PhaserShot(x, y, dir)); this.sfx('fire'); }

  updateParticles() {
    for (const q of this.particles) {
      q.t++;
      if (q.kind === 'debris') { q.vy += 0.3; q.x += q.vx; q.y += q.vy; }
      if (q.kind === 'coin') { q.vy += 0.35; q.y += q.vy; if (q.t === 28) this.popText('200', q.x, q.y); }
      if (q.kind === 'text') q.y -= 0.6;
    }
    this.particles = this.particles.filter((q) => q.t < (q.kind === 'debris' ? 80 : q.kind === 'coin' ? 28 : q.kind === 'puff' ? 12 : 50));
  }

  // ---------------------------------------------------------------- level end

  startFlag() {
    const p = this.player;
    p.vx = 0; p.vy = 0;
    p.crouch = false;
    if (p.size > 0) p.h = 28;
    p.x = this.level.flagX * TILE + 8 - p.w;
    // Higher grab = more points.
    const bottom = p.y + p.h;
    const pts = bottom < 5 * TILE ? 5000 : bottom < 7 * TILE ? 2000 : bottom < 9 * TILE ? 800 : bottom < 11 * TILE ? 400 : 100;
    this.award(pts, p.x + 12, p.y);
    this.audio.music(null);
    this.sfx('flag');
    this.setState('flag');
  }

  updateFlag() {
    const p = this.player;
    const base = (this.world.groundTopAt(this.level.flagX) - 1) * TILE;
    if (p.y + p.h < base) p.y = Math.min(base - p.h, p.y + 2);
    if (this.flagY < this.flagBottom) this.flagY = Math.min(this.flagBottom, this.flagY + 2);
    this.updateParticles();
    if (p.y + p.h >= base && this.flagY >= this.flagBottom && this.stateTimer > 30) {
      p.x += p.w + 4;
      p.facing = 1;
      this.audio.music('clear');
      this.setState('walk');
    }
  }

  updateWalk() {
    const p = this.player;
    const fake = { held: (b) => b === 'right', pressed: () => false };
    p.update(this, fake);
    p.vx = Math.min(p.vx, 1.2);
    this.updateCamera();
    this.updateParticles();
    if (p.x + p.w / 2 >= this.level.castleX * TILE + 40) { p.hidden = true; this.setState('tally'); }
  }

  updateTally() {
    if (this.time > 0) {
      const n = Math.min(this.time, 2);
      this.time -= n;
      this.score += 50 * n;
      if (this.stateTimer % 4 === 0) this.sfx('tick');
      this.stateTimer = 0;
      return;
    }
    if (this.stateTimer > 90) {
      const next = this.level.index + 1;
      if (next < LEVELS.length) {
        const size = this.player.size;
        this.loadLevel(next, size);
        this.setState('intro');
      } else {
        this.setState('win');
      }
    }
  }

  // ---------------------------------------------------------------- saving

  canSave() { return this.state === 'play' && this.freeze === 0; }

  serialize() {
    const diff = [];
    const orig = this.level.tiles;
    const cur = this.world.tiles;
    for (let i = 0; i < cur.length; i++) if (cur[i] !== orig[i]) diff.push([i, cur[i]]);
    return {
      v: SAVE_VERSION,
      gen: GEN_VERSION,
      fp: this.level.fingerprint,
      level: this.level.index,
      score: this.score, coins: this.coins, lives: this.lives,
      time: this.time, timerFrames: this.timerFrames, camX: this.camX, chain: this.chain,
      player: this.player.serialize(),
      tiles: diff,
      contents: this.world.contents,
      enemies: this.enemies.filter((e) => e.state !== 'dead').map((e) => e.serialize()),
      items: this.items.map((i) => i.serialize()),
      summary: { world: this.level.name, title: this.level.title, score: this.score, lives: this.lives, coins: this.coins },
    };
  }

  // Returns 'exact' when restored mid-level, 'restart' when only progress could be restored.
  restore(d) {
    if (!d || typeof d !== 'object' || d.v !== SAVE_VERSION) throw new Error('This save is from an incompatible version.');
    const li = d.level | 0;
    if (li < 0 || li >= LEVELS.length) throw new Error('This save refers to a level that does not exist.');
    const num = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : def);
    this.score = num(d.score, 0, 9999999, 0) | 0;
    this.coins = num(d.coins, 0, 99, 0) | 0;
    this.lives = num(d.lives, 1, 99, START_LIVES) | 0;
    const size = num(d.player?.size, 0, 2, 0) | 0;
    this.loadLevel(li, size);
    this.paused = false;
    if (d.fp !== this.level.fingerprint || d.gen !== GEN_VERSION) {
      this.setState('intro');
      return 'restart';
    }
    const w = this.world;
    for (const [i, t] of Array.isArray(d.tiles) ? d.tiles : []) {
      if (i >= 0 && i < w.tiles.length && t >= 0 && t <= T.POLE_TOP) w.tiles[i] = t;
    }
    w.contents = {};
    for (const [k, v] of Object.entries(d.contents || {})) if (typeof v === 'string' && v.length < 16) w.contents[k] = v;
    this.player = Player.restore(d.player || {});
    this.enemies = (d.enemies || []).slice(0, 200).map(Enemy.restore);
    this.items = (d.items || []).slice(0, 50).map(Item.restore);
    this.time = num(d.time, 1, 999, this.level.time) | 0;
    this.timerFrames = num(d.timerFrames, 0, 23, 0) | 0;
    this.chain = num(d.chain, 0, 20, 0) | 0;
    this.camX = num(d.camX, 0, w.w * TILE - VIEW_W, 0);
    this.hurried = this.time <= 100;
    this.startPlay();
    return 'exact';
  }

  // ---------------------------------------------------------------- render

  render() {
    const ctx = this.ctx;
    const s = this.state;
    if (s === 'intro' || s === 'gameover' || s === 'win') return this.renderCard();
    const camX = s === 'title' ? Math.floor(this.titleCam % (this.world.w * TILE - VIEW_W)) : Math.floor(this.camX);
    this.renderWorld(ctx, camX);
    if (s === 'title') this.renderTitle(ctx);
    else this.renderHUD(ctx);
  }

  renderCard() {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0818';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.renderHUD(ctx);
    if (this.state === 'intro') {
      drawTextCentered(ctx, 'MISSION ' + this.level.name, VIEW_W / 2, 84, '#ffffff');
      drawTextCentered(ctx, this.level.title.toUpperCase(), VIEW_W / 2, 100, '#ff9c3a');
      const hero = this.art.hero.small.stand.r;
      ctx.drawImage(hero, VIEW_W / 2 - 26, 122);
      drawText(ctx, 'x  ' + this.lives, VIEW_W / 2 - 2, 128, '#ffffff');
    } else if (this.state === 'gameover') {
      drawTextCentered(ctx, 'GAME OVER', VIEW_W / 2, 104, '#ff5a6e');
    } else {
      drawTextCentered(ctx, 'MISSION ACCOMPLISHED!', VIEW_W / 2, 80, '#ff9c3a');
      drawTextCentered(ctx, 'FINAL SCORE ' + String(this.score).padStart(6, '0'), VIEW_W / 2, 100, '#ffffff');
      drawTextCentered(ctx, 'THANKS FOR PLAYING. ENGAGE!', VIEW_W / 2, 124, '#9ab8ff');
      if (Math.floor(this.frame / 30) % 2) drawTextCentered(ctx, 'PRESS ENTER', VIEW_W / 2, 160, '#ffffff');
    }
  }

  renderWorld(ctx, camX) {
    const th = this.art.themes[this.level.theme];
    const w = this.world;
    const f = this.frame;
    ctx.drawImage(th.sky, 0, 0);
    const layer = (img, factor, y = 0, drift = 0) => {
      if (!img) return;
      const off = -Math.floor((camX * factor + drift) % img.width);
      for (let x = off; x < VIEW_W; x += img.width) ctx.drawImage(img, x, y);
    };
    layer(th.mountains, 0.15);
    layer(th.celestial, 0.05, 0, f * 0.02);
    layer(th.clouds, 0.3, 0, f * 0.08);
    layer(th.hills, 0.5);

    for (const d of this.level.decor) {
      const x = d.x * TILE - camX;
      if (x > VIEW_W || x + d.w * TILE < 0) continue;
      ctx.drawImage(this.art.decor(d.type, d.w), x, (d.y - 1) * TILE);
    }
    const cx = this.level.castleX * TILE - camX;
    if (cx < VIEW_W && cx > -80) ctx.drawImage(th.castle, cx, this.castleTop * TILE - 80);

    // Items still emerging are drawn behind the block they come out of.
    for (const it of this.items) if (it.emerge > 0) this.drawItem(ctx, it, camX);

    const x0 = Math.floor(camX / TILE), x1 = Math.min(w.w - 1, x0 + VIEW_W / TILE + 1);
    const qf = [0, 0, 0, 1, 2, 1][Math.floor(f / 8) % 6];
    const cf = Math.floor(f / 8) % 4;
    const bumped = new Set(w.bumps.map((b) => b.ty * w.w + b.tx));
    for (let ty = 0; ty < w.h; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * w.w + tx;
        const t = w.tiles[i];
        if (t === T.EMPTY || bumped.has(i)) continue;
        const img = this.tileImage(th, t, tx, ty, qf, cf);
        ctx.drawImage(img, tx * TILE - camX, ty * TILE);
      }
    }
    for (const b of w.bumps) {
      const t = w.tile(b.tx, b.ty);
      if (t === T.EMPTY) continue;
      const dy = -Math.round(Math.sin((b.t / 10) * Math.PI) * 5);
      ctx.drawImage(this.tileImage(th, t, b.tx, b.ty, qf, cf), b.tx * TILE - camX, b.ty * TILE + dy);
    }

    const fx = this.level.flagX * TILE - camX;
    if (fx > -32 && fx < VIEW_W + 16) ctx.drawImage(this.art.flag, fx - 9, this.flagY);

    for (const it of this.items) if (it.emerge <= 0) this.drawItem(ctx, it, camX);
    for (const e of this.enemies) this.drawEnemy(ctx, th, e, camX);
    if (this.state !== 'title') this.drawPlayer(ctx, camX);
    for (const fb of this.shots) ctx.drawImage(this.art.beam[Math.floor(fb.anim / 3) % 2], Math.floor(fb.x - camX), Math.floor(fb.y));
    for (const q of this.particles) {
      const x = Math.floor(q.x - camX), y = Math.floor(q.y);
      if (q.kind === 'debris') ctx.drawImage(th.debris, x, y);
      else if (q.kind === 'coin') ctx.drawImage(this.art.latinum[Math.floor(q.t / 3) % 4], x, y);
      else if (q.kind === 'text') drawText(ctx, q.text, x, y, '#ffffff');
      else if (q.kind === 'puff') {
        ctx.fillStyle = q.t < 6 ? '#fff8c0' : '#ff8a30';
        const r = 2 + q.t / 3;
        ctx.fillRect(x + 4 - r, y + 4 - r, r * 2, r * 2);
      }
    }
  }

  tileImage(th, t, tx, ty, qf, cf) {
    if (t === T.GROUND) {
      const above = this.world.tile(tx, ty - 1);
      return above === T.GROUND ? th.tiles[T.GROUND] : th.groundTop;
    }
    if (t === T.QUESTION) return th.question[qf];
    if (t === T.COIN) return this.art.latinum[cf];
    return th.tiles[t];
  }

  drawItem(ctx, it, camX) {
    const spr = it.kind === 'tea' ? this.art.tea : it.kind === 'phaser' ? this.art.phaser : this.art.badge;
    ctx.drawImage(spr.r, Math.floor(it.x - 1 - camX), Math.floor(it.y));
  }

  drawEnemy(ctx, th, e, camX) {
    let x = Math.floor(e.x - 1 - camX);
    const y = Math.floor(e.y + e.h - 16);
    if (e.state === 'shell' && e.timer > 330) x += Math.floor(e.timer / 4) % 2 ? 1 : -1; // shake before waking
    if (x < -16 || x > VIEW_W) return;
    let img;
    if (e.kind === 'walker') {
      img = e.state === 'flat' ? th.walkerFlat.r : th.walker[Math.floor(e.anim / 10) % 2][e.vx > 0 ? 'r' : 'l'];
    } else {
      img = e.state === 'walk' ? th.probe[Math.floor(e.anim / 8) % 2][e.vx > 0 ? 'r' : 'l'] : th.sphere.r;
    }
    if (e.state === 'dead') {
      ctx.save();
      ctx.translate(x, y + 16);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    } else ctx.drawImage(img, x, y);
  }

  drawPlayer(ctx, camX) {
    const p = this.player;
    if (p.hidden) return;
    if (p.inv > 0 && Math.floor(p.inv / 3) % 2) return;
    if (this.freeze > 0 && Math.floor(this.freeze / 4) % 2) return;
    const set = (p.size === 2 ? this.art.heroPhaser : this.art.hero)[p.size > 0 ? 'big' : 'small'];
    let fr = p.dead ? 'jump' : this.state === 'flag' ? 'jump' : p.frame();
    if (p.throwAnim > 0 && fr !== 'crouch') fr = 'walk3';
    const spr = set[fr][p.facing > 0 ? 'r' : 'l'];
    ctx.drawImage(spr, Math.floor(p.x - 2 - camX), Math.floor(p.y + p.h - spr.height));
  }

  renderHUD(ctx) {
    const w = '#ffffff';
    const band = this.art.themes[this.level.theme].hudBand;
    if (band && this.state !== 'intro') {
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, VIEW_W, 26);
    }
    drawText(ctx, 'SCORE', 12, 6, w);
    drawText(ctx, String(this.score ?? 0).padStart(6, '0'), 12, 15, w);
    ctx.drawImage(this.art.latinum[0], 2, 2, 12, 12, 84, 5, 8, 8);
    drawText(ctx, 'x' + String(this.coins ?? 0).padStart(2, '0'), 94, 6, w);
    ctx.drawImage(this.art.hero.small.stand.r, 84, 14, 8, 8);
    drawText(ctx, 'x' + (this.lives ?? 0), 94, 15, w);
    drawText(ctx, 'MISSION', 134, 6, w);
    drawText(ctx, this.level.name, 146, 15, w);
    drawText(ctx, 'TIME', 206, 6, w);
    if (this.state !== 'intro') drawText(ctx, String(Math.max(0, this.time)).padStart(3, '0'), 209, 15, this.time <= 100 ? '#ff8a8a' : w);
  }

  renderTitle(ctx) {
    ctx.fillStyle = 'rgba(10,8,24,0.35)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.scale(4, 4);
    drawTextCentered(ctx, GAME_TITLE, VIEW_W / 8, 8, '#ff9c3a', '#5a2a00');
    ctx.restore();
    drawTextCentered(ctx, 'A NEXT GENERATION ADVENTURE', VIEW_W / 2, 68, '#ffffff');
  }
}
