// Gameplay objects. Units are pixels and frames (fixed 60 Hz).
import { TILE, T, isSolidTile } from './config.js';

// Player physics. Max jump: ~3.5 tiles standing, ~4.5 tiles running; ~7 tiles long at full run.
export const PHYS = {
  walkMax: 1.5, runMax: 2.6, walkAccel: 0.05, runAccel: 0.07, airAccel: 0.8,
  friction: 0.06, skid: 0.18, overspeedDecel: 0.03,
  jump: 4.6, jumpSpeedBonus: 0.25, gravityHold: 0.19, gravity: 0.6, maxFall: 5,
  stompBounce: 4, stompBounceHeld: 5.5,
};

// ---------------------------------------------------------------- tile collision

export class World {
  constructor(level) {
    this.level = level;
    this.w = level.width;
    this.h = level.height;
    this.tiles = level.tiles.slice();
    this.contents = { ...level.contents };
    this.bumps = []; // block bump animations {tx, ty, t}
  }
  tile(tx, ty) {
    if (tx < 0 || tx >= this.w) return T.BLOCK; // level edges are walls
    if (ty < 0 || ty >= this.h) return T.EMPTY;
    return this.tiles[ty * this.w + tx];
  }
  solid(tx, ty) { return isSolidTile(this.tile(tx, ty)); }
  set(tx, ty, t) { if (tx >= 0 && tx < this.w && ty >= 0 && ty < this.h) this.tiles[ty * this.w + tx] = t; }
  idx(tx, ty) { return ty * this.w + tx; }
  groundTopAt(tx) {
    for (let y = 2; y < this.h; y++) if (this.solid(tx, y)) return y;
    return this.h;
  }
}

// Move along X and resolve against solid tiles. Returns -1/1 when a wall was hit.
export function moveX(world, e) {
  e.x += e.vx;
  const top = Math.floor(e.y / TILE), bot = Math.floor((e.y + e.h - 1) / TILE);
  if (e.vx > 0) {
    const tx = Math.floor((e.x + e.w - 1) / TILE);
    for (let ty = top; ty <= bot; ty++) if (world.solid(tx, ty)) { e.x = tx * TILE - e.w; return 1; }
  } else if (e.vx < 0) {
    const tx = Math.floor(e.x / TILE);
    for (let ty = top; ty <= bot; ty++) if (world.solid(tx, ty)) { e.x = (tx + 1) * TILE; return -1; }
  }
  return 0;
}

// Move along Y. Returns {down: bool, up: [tx...] tiles hit by the head, ty}.
export function moveY(world, e) {
  e.y += e.vy;
  const left = Math.floor(e.x / TILE), right = Math.floor((e.x + e.w - 1) / TILE);
  const res = { down: false, up: null, ty: 0 };
  if (e.vy > 0) {
    const ty = Math.floor((e.y + e.h - 1) / TILE);
    for (let tx = left; tx <= right; tx++) {
      if (world.solid(tx, ty)) { e.y = ty * TILE - e.h; res.down = true; break; }
    }
  } else if (e.vy < 0) {
    const ty = Math.floor(e.y / TILE);
    const hit = [];
    for (let tx = left; tx <= right; tx++) if (world.solid(tx, ty)) hit.push(tx);
    if (hit.length) { e.y = (ty + 1) * TILE; res.up = hit; res.ty = ty; }
  }
  return res;
}

export const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// ---------------------------------------------------------------- player

export class Player {
  constructor(x, y) {
    this.x = x + 2; this.y = y + 1; this.w = 12; this.h = 15;
    this.vx = 0; this.vy = 0;
    this.size = 0; // 0 small, 1 big, 2 fire
    this.facing = 1;
    this.onGround = false;
    this.jumping = false;
    this.crouch = false;
    this.inv = 0; // post-hit invulnerability frames
    this.anim = 0;
    this.airFrames = 0;
    this.jumpBuffer = 0;
    this.skidding = false;
    this.dead = false;
    this.fireCooldown = 0;
    this.throwAnim = 0;
  }

  setSize(s) {
    const wasBig = this.size > 0, big = s > 0;
    this.size = s;
    if (big && !wasBig) { this.y -= 13; this.h = 28; }
    if (!big && wasBig) { this.y += this.h - 15; this.h = 15; this.crouch = false; }
  }

  update(game, input) {
    const world = game.world;
    const left = input.held('left'), right = input.held('right');
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    const run = input.held('run');

    // Crouch (big only, on the ground).
    const wantCrouch = this.size > 0 && this.onGround && input.held('down');
    if (wantCrouch !== this.crouch && this.size > 0) {
      if (wantCrouch) { this.crouch = true; this.y += 13; this.h = 15; }
      else {
        // Only stand up when there is head room.
        const probe = { x: this.x, y: this.y - 13, w: this.w, h: 28 };
        const lt = Math.floor(probe.x / TILE), rt = Math.floor((probe.x + probe.w - 1) / TILE);
        const ty = Math.floor(probe.y / TILE);
        let blocked = false;
        for (let tx = lt; tx <= rt; tx++) if (world.solid(tx, ty)) blocked = true;
        if (!blocked || !this.onGround) { this.crouch = false; this.y -= 13; this.h = 28; }
      }
    }

    const max = run ? PHYS.runMax : PHYS.walkMax;
    this.skidding = false;
    if (dir !== 0 && !this.crouch) {
      if (this.vx * dir < 0 && this.onGround) {
        this.vx += dir * PHYS.skid;
        this.skidding = true;
      } else {
        const a = (run ? PHYS.runAccel : PHYS.walkAccel) * (this.onGround ? 1 : PHYS.airAccel);
        if (Math.abs(this.vx) < max) this.vx = dir > 0 ? Math.min(max, this.vx + a) : Math.max(-max, this.vx - a);
        else if (this.onGround) this.vx -= Math.sign(this.vx) * PHYS.overspeedDecel;
      }
      if (this.onGround) this.facing = dir;
    } else if (this.onGround) {
      const f = PHYS.friction;
      this.vx = Math.abs(this.vx) <= f ? 0 : this.vx - Math.sign(this.vx) * f;
    }

    // Jump with a small input buffer and coyote time so it feels responsive.
    if (input.pressed('jump')) this.jumpBuffer = 6;
    else if (this.jumpBuffer > 0) this.jumpBuffer--;
    if (this.jumpBuffer > 0 && (this.onGround || this.airFrames < 5) && !this.jumping) {
      this.vy = -(PHYS.jump + Math.min(Math.abs(this.vx), PHYS.runMax) * PHYS.jumpSpeedBonus);
      this.jumping = true;
      this.jumpBuffer = 0;
      this.onGround = false;
      this.airFrames = 99;
      game.sfx(this.size ? 'bigjump' : 'jump');
    }
    const g = this.jumping && this.vy < 0 && input.held('jump') ? PHYS.gravityHold : PHYS.gravity;
    this.vy = Math.min(PHYS.maxFall, this.vy + g);

    // Fireballs.
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (this.throwAnim > 0) this.throwAnim--;
    if (this.size === 2 && input.pressed('run') && !this.crouch && this.fireCooldown === 0 && game.countShots() < 2) {
      game.spawnShot(this.facing > 0 ? this.x + this.w : this.x - 12, this.y + this.h - 12, this.facing);
      this.fireCooldown = 10;
      this.throwAnim = 8;
    }

    if (moveX(world, this)) this.vx = 0;
    const res = moveY(world, this);
    if (res.down) {
      this.vy = 0;
      this.onGround = true;
      this.jumping = false;
      this.airFrames = 0;
    } else {
      if (this.onGround) this.airFrames = 0;
      this.onGround = false;
      this.airFrames++;
    }
    if (res.up) {
      this.vy = 1;
      // Bump the block nearest the player's centre.
      const cx = this.x + this.w / 2;
      let best = res.up[0];
      for (const tx of res.up) if (Math.abs(tx * TILE + 8 - cx) < Math.abs(best * TILE + 8 - cx)) best = tx;
      game.bumpBlock(best, res.ty);
    }

    // Collect coin tiles the player overlaps.
    const l = Math.floor(this.x / TILE), r = Math.floor((this.x + this.w - 1) / TILE);
    const t = Math.floor(this.y / TILE), b = Math.floor((this.y + this.h - 1) / TILE);
    for (let ty = t; ty <= b; ty++) for (let tx = l; tx <= r; tx++) {
      if (world.tile(tx, ty) === T.COIN) { world.set(tx, ty, T.EMPTY); game.addCoin(); }
    }

    if (this.inv > 0) this.inv--;
    this.anim += Math.abs(this.vx) * 0.12 + (Math.abs(this.vx) > 0 ? 0.05 : 0);
  }

  frame() {
    if (this.crouch) return 'crouch';
    if (!this.onGround) return 'jump';
    if (this.skidding) return 'walk2';
    if (Math.abs(this.vx) < 0.1) return 'stand';
    return ['walk1', 'walk2', 'walk3', 'walk2'][Math.floor(this.anim) % 4];
  }

  serialize() {
    return { x: this.x, y: this.y, vx: this.vx, vy: this.vy, size: this.size, facing: this.facing, inv: this.inv, crouch: this.crouch, jumping: this.jumping };
  }

  static restore(s) {
    const p = new Player(0, 0);
    p.setSize(s.size | 0);
    Object.assign(p, { x: +s.x, y: +s.y, vx: +s.vx || 0, vy: +s.vy || 0, facing: s.facing < 0 ? -1 : 1, inv: s.inv | 0, jumping: !!s.jumping });
    if (s.crouch && p.size > 0) { p.crouch = true; p.h = 15; }
    return p;
  }
}

// ---------------------------------------------------------------- enemies

export class Enemy {
  constructor(kind, x, y) {
    this.kind = kind; // 'walker' | 'shell'
    this.w = 14; this.h = 14;
    this.x = x + 1; this.y = y + 16 - this.h;
    this.vx = -0.5; this.vy = 0;
    this.state = 'walk'; // walk | flat | shell | slide | dead
    this.timer = 0;
    this.remove = false;
    this.anim = 0;
    this.kickGrace = 0;
  }

  update(game) {
    this.anim++;
    if (this.state === 'dead') {
      this.vy += 0.3; this.x += this.vx; this.y += this.vy;
      if (this.y > game.world.h * TILE + 32) this.remove = true;
      return;
    }
    if (this.state === 'flat') { if (++this.timer > 30) this.remove = true; return; }
    if (this.kickGrace > 0) this.kickGrace--;
    if (this.state === 'shell') {
      this.vx = 0;
      if (++this.timer > 420) { this.state = 'walk'; this.vx = game.player.x < this.x ? -0.5 : 0.5; this.timer = 0; }
    }
    this.vy = Math.min(5, this.vy + 0.35);
    if (moveX(game.world, this)) {
      this.vx = -this.vx;
      if (this.state === 'slide') game.sfx('bump');
    }
    const res = moveY(game.world, this);
    if (res.down) this.vy = 0;
    if (this.y > game.world.h * TILE) this.remove = true;
  }

  // Knocked out by a fireball, a sliding shell, or a bumped block.
  flip(dir) {
    this.state = 'dead';
    this.vy = -4;
    this.vx = dir * 0.8;
  }

  serialize() {
    return { k: this.kind, x: this.x, y: this.y, vx: this.vx, vy: this.vy, s: this.state, t: this.timer };
  }

  static restore(s) {
    const e = new Enemy(s.k === 'shell' ? 'shell' : 'walker', 0, 0);
    Object.assign(e, { x: +s.x, y: +s.y, vx: +s.vx || 0, vy: +s.vy || 0, timer: s.t | 0 });
    e.state = ['walk', 'shell', 'slide', 'flat'].includes(s.s) ? s.s : 'walk';
    return e;
  }
}

// ---------------------------------------------------------------- items

export class Item {
  constructor(kind, tx, ty) {
    this.kind = kind; // 'badge' (grow) | 'tea' (extra life) | 'phaser'
    this.x = tx * TILE + 1; this.y = ty * TILE; this.w = 14; this.h = 16;
    this.vx = 0; this.vy = 0;
    this.emerge = 16; // pixels still to rise out of the block
    this.remove = false;
  }

  update(game) {
    if (this.emerge > 0) {
      this.y -= 0.5;
      this.emerge -= 0.5;
      if (this.emerge <= 0 && this.kind !== 'phaser') this.vx = 1;
      return;
    }
    if (this.kind === 'phaser') return;
    this.vy = Math.min(5, this.vy + 0.35);
    if (moveX(game.world, this)) this.vx = -this.vx;
    if (moveY(game.world, this).down) this.vy = 0;
    if (this.y > game.world.h * TILE) this.remove = true;
  }

  serialize() { return { k: this.kind, x: this.x, y: this.y, vx: this.vx, vy: this.vy, e: this.emerge }; }

  static restore(s) {
    // Older saves used fruit names for the same three items.
    const legacy = { berry: 'badge', life: 'tea', bloom: 'phaser' };
    const k = legacy[s.k] || s.k;
    const it = new Item(['badge', 'tea', 'phaser'].includes(k) ? k : 'badge', 0, 0);
    Object.assign(it, { x: +s.x, y: +s.y, vx: +s.vx || 0, vy: +s.vy || 0, emerge: +s.e || 0 });
    return it;
  }
}

// Phaser bolt: flies straight until it hits a wall or leaves the screen.
export class PhaserShot {
  constructor(x, y, dir) {
    this.x = x; this.y = y; this.w = 12; this.h = 4;
    this.vx = dir * 5; this.vy = 0;
    this.remove = false;
    this.anim = 0;
  }
  update(game) {
    this.anim++;
    if (moveX(game.world, this)) { this.remove = true; game.puff(this.x + (this.vx > 0 ? 8 : -2), this.y - 2); return; }
    const cam = game.camX;
    if (this.x < cam - 16 || this.x > cam + 272 || this.y > game.world.h * TILE) this.remove = true;
  }
}
