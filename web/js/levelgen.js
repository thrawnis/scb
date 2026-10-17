// Procedural level generator. Pure and deterministic: no DOM, no Math.random,
// so the same seed produces the same level everywhere (and it runs under Node for tests).
//
// The generator builds the level left to right out of "chunks" (block rows, pits, pipes,
// stairs...). Each chunk is constrained so it is always beatable with the player physics
// in entities.js: pits are at most 4 tiles wide, steps are at most 2 tiles high, pipes at
// most 3 tiles tall, and nothing solid hangs over a pit edge to block a jump.
import { RNG, hash32 } from './rng.js';
import { ROWS, T, LEVELS, GEN_VERSION } from './config.js';

class Builder {
  constructor(def) {
    this.def = def;
    this.underground = def.theme === 'borg'; // enclosed level: ceiling, flat floor
    this.w = def.width + 60; // room for the ending section
    this.h = ROWS;
    this.tiles = new Uint8Array(this.w * this.h);
    this.contents = {}; // tile index -> 'coin' | 'coins' | 'power' | 'life'
    this.entities = [];
    this.decor = [];
    this.g = 12; // current ground top row
    this.groundTop = new Int16Array(this.w).fill(-1); // -1 = pit
  }
  idx(x, y) { return y * this.w + x; }
  set(x, y, t) { if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.tiles[this.idx(x, y)] = t; }
  get(x, y) { return this.tiles[this.idx(x, y)]; }
  ground(x, top = this.g) {
    for (let y = top; y < this.h; y++) this.set(x, y, T.GROUND);
    this.groundTop[x] = top;
  }
  flat(x, len) { for (let i = 0; i < len; i++) this.ground(x + i); return len; }
  enemy(type, col, row) { this.entities.push({ type, x: col * 16, y: row * 16 }); }
  block(x, y, t, content) {
    this.set(x, y, t);
    if (content) this.contents[this.idx(x, y)] = content;
  }
}

export function generateLevel(index) {
  const def = LEVELS[index];
  const rng = new RNG(def.seed);
  const b = new Builder(def);
  const minRow = b.underground ? 3 : 2; // highest row a block may sit in
  let powers = 0;
  let lifeBlock = false;

  const contentFor = (isQuestion, progress) => {
    if (isQuestion) {
      // Roughly one power-up per 50 tiles, never two back to back.
      if (rng.chance(powers === 0 ? 0.9 : powers >= 3 ? 0 : 0.28 - progress * 0.1)) { powers++; return 'power'; }
      return 'coin';
    }
    if (!lifeBlock && progress > 0.4 && rng.chance(0.15)) { lifeBlock = true; return 'life'; }
    return rng.chance(0.08) ? 'coins' : null;
  };

  const chunks = {
    blocks(x, d, p) {
      const len = rng.int(9, 13);
      b.flat(x, len);
      const pl = rng.int(3, 5);
      const s = rng.int(2, len - pl - 1);
      const r = b.g - 4;
      const qAt = rng.int(0, pl - 1);
      for (let i = 0; i < pl; i++) {
        const q = i === qAt || rng.chance(0.4);
        b.block(x + s + i, r, q ? T.QUESTION : T.BRICK, contentFor(q, p));
      }
      if (r - 4 >= minRow && rng.chance(0.4)) {
        const ul = rng.int(2, Math.min(4, pl));
        const us = s + rng.int(0, pl - ul);
        for (let i = 0; i < ul; i++) {
          const q = rng.chance(0.35);
          b.block(x + us + i, r - 4, q ? T.QUESTION : T.BRICK, contentFor(q, p));
        }
      }
      const ne = rng.chance(0.55 + d * 0.4) ? (rng.chance(d * 0.6) ? 2 : 1) : 0;
      for (let i = 0; i < ne; i++) b.enemy(rng.chance(d * 0.5) ? 'shell' : 'walker', x + s + i * 2 + rng.int(0, 1), b.g - 1);
      return len;
    },
    pit(x, d) {
      let n = b.flat(x, 2);
      const w = Math.min(4, rng.int(2, 2 + Math.round(d * 2.5)));
      if (w >= 3 && rng.chance(0.5)) {
        for (let i = 1; i < w - 1; i++) b.set(x + n + i, b.g - 4, T.COIN);
      }
      n += w;
      if (!b.underground && w <= 3 && rng.chance(0.4)) b.g = clampG(b.g + rng.pick([-1, 1]));
      const post = rng.int(3, 5);
      b.flat(x + n, post);
      if (post >= 4 && rng.chance(d * 0.6)) b.enemy('walker', x + n + post - 1, b.g - 1);
      n += post;
      return n;
    },
    pipes(x, d) {
      let n = b.flat(x, 2);
      const count = rng.int(1, 2);
      for (let c = 0; c < count; c++) {
        const h = rng.int(2, 3);
        b.flat(x + n, 2);
        b.set(x + n, b.g - h, T.PIPE_TL);
        b.set(x + n + 1, b.g - h, T.PIPE_TR);
        for (let y = b.g - h + 1; y < b.g; y++) { b.set(x + n, y, T.PIPE_L); b.set(x + n + 1, y, T.PIPE_R); }
        n += 2;
        const gap = rng.int(3, 6);
        b.flat(x + n, gap);
        if (rng.chance(0.65 + d * 0.3)) b.enemy(rng.chance(d * 0.3) ? 'shell' : 'walker', x + n + Math.floor(gap / 2), b.g - 1);
        n += gap;
      }
      return n;
    },
    stairs(x, d) {
      let n = b.flat(x, 2);
      const h = rng.int(3, 4);
      for (let i = 0; i < h; i++, n++) {
        b.ground(x + n);
        for (let y = b.g - 1 - i; y < b.g; y++) b.set(x + n, y, T.BLOCK);
      }
      const gap = rng.chance(0.5 + d * 0.3) ? rng.int(1, 2) : 0;
      if (gap === 0) {
        b.ground(x + n);
        for (let y = b.g - h; y < b.g; y++) b.set(x + n, y, T.BLOCK);
        n++;
      }
      n += gap; // pit between the two stair halves
      for (let i = h - 1; i >= 0; i--, n++) {
        b.ground(x + n);
        for (let y = b.g - 1 - i; y < b.g; y++) b.set(x + n, y, T.BLOCK);
      }
      n += b.flat(x + n, 3);
      return n;
    },
    raise(x) {
      const opts = [-2, -1, 1, 2].filter((v) => clampG(b.g + v) === b.g + v);
      b.g += rng.pick(opts);
      return b.flat(x, rng.int(4, 6));
    },
    platform(x, d) {
      let n = b.flat(x, 2);
      const r = b.g - 2;
      for (let i = 2; i <= 4; i++) {
        const q = i === 3 && rng.chance(0.4);
        b.block(x + n + i, r, q ? T.QUESTION : T.BRICK, q ? contentFor(true, d) : null);
      }
      for (let i = 2; i <= 4; i++) b.set(x + n + i, r - 3, T.COIN);
      n += 7;
      n += b.flat(x + n, 3);
      return n;
    },
    enemies(x, d) {
      const len = rng.int(8, 11);
      b.flat(x, len);
      const count = rng.int(2, 2 + Math.round(d));
      let col = x + 2;
      for (let i = 0; i < count && col < x + len - 1; i++) {
        b.enemy(rng.chance(d * 0.4) ? 'shell' : 'walker', col, b.g - 1);
        col += rng.int(2, 3);
      }
      return len;
    },
    coins(x) {
      const len = rng.int(6, 9);
      b.flat(x, len);
      const cl = rng.int(3, len - 2);
      const s = rng.int(1, len - cl - 1);
      const r = b.g - rng.int(3, 4);
      for (let i = 0; i < cl; i++) b.set(x + s + i, r, T.COIN);
      return len;
    },
  };

  function clampG(g) { return Math.max(10, Math.min(12, g)); }

  if (b.underground) {
    for (let x = 0; x < b.w; x++) { b.set(x, 0, T.BRICK); b.set(x, 1, T.BRICK); }
  }

  // Safe start, then a guaranteed block chunk with a power-up.
  let x = b.flat(0, 12);
  x += chunks.blocks(x, 0, 0);

  const end = def.width - 30;
  let last = 'blocks';
  while (x < end) {
    const p = x / end;
    const d = Math.min(1, def.difficulty + p * 0.35);
    const choices = [
      ['blocks', 3], ['pit', 2 + d * 2], ['pipes', 2], ['stairs', 1.2], ['enemies', 1.5 + d * 2.5],
      ['coins', 1], ['platform', d > 0.45 ? 1.2 : 0], ['raise', b.underground ? 0 : 1.2],
    ].filter(([k]) => k !== last);
    const kind = rng.weighted(choices);
    x += chunks[kind](x, d, p);
    last = kind;
  }

  // Ending: big staircase, flagpole, castle.
  x += b.flat(x, 4);
  const sh = 7;
  for (let i = 0; i < sh + 1; i++, x++) {
    b.ground(x);
    const hh = Math.min(i + 1, sh);
    for (let y = b.g - hh; y < b.g; y++) b.set(x, y, T.BLOCK);
  }
  x += b.flat(x, 4);
  const flagX = x;
  b.ground(x);
  b.set(x, 2, T.POLE_TOP);
  for (let y = 3; y < b.g - 1; y++) b.set(x, y, T.POLE);
  b.set(x, b.g - 1, T.BLOCK);
  x += 1;
  x += b.flat(x, 4);
  const castleX = x;
  x += b.flat(x, 12);
  const width = x;

  // Decorations sit on flat ground with nothing above (purely cosmetic).
  for (let cx = 14; cx < flagX - 12; cx++) {
    const gt = b.groundTop[cx];
    if (gt < 0) continue;
    let ok = true;
    const w = rng.int(2, 4);
    for (let i = 0; i < w; i++) {
      if (b.groundTop[cx + i] !== gt || b.get(cx + i, gt - 1) !== T.EMPTY || b.get(cx + i, gt - 2) !== T.EMPTY) ok = false;
    }
    if (ok && rng.chance(0.14)) {
      b.decor.push({ type: b.underground ? 'conduit' : rng.pick(['rocks', 'rocks', 'flora', 'sensor']), x: cx, y: gt, w });
      cx += w + 3;
    }
  }

  // Trim to final width (tiles array is row-major with stride b.w).
  const tiles = new Uint8Array(width * b.h);
  const contents = {};
  for (let y = 0; y < b.h; y++) {
    for (let cx = 0; cx < width; cx++) {
      const oi = y * b.w + cx;
      tiles[y * width + cx] = b.tiles[oi];
      if (b.contents[oi]) contents[y * width + cx] = b.contents[oi];
    }
  }

  return {
    index,
    name: def.name,
    title: def.title,
    theme: def.theme,
    time: def.time,
    width,
    height: b.h,
    tiles,
    contents,
    entities: b.entities.filter((e) => e.x < (flagX - 10) * 16),
    decor: b.decor,
    start: { x: 3 * 16, y: (12 - 1) * 16 },
    flagX,
    castleX,
    fingerprint: (hash32(tiles) ^ GEN_VERSION) >>> 0,
  };
}
