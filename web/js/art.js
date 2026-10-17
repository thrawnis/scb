// All graphics are generated at startup: sprites from text pixel-art with palettes,
// tiles and backgrounds from small procedural routines. Everything is drawn once into
// offscreen canvases, so each frame is just a handful of drawImage calls.
// Theme: a Star Trek: The Next Generation tribute (away missions, Borg cubes, Ferengi).
import { TILE, VIEW_W, VIEW_H, T } from './config.js';
import { RNG } from './rng.js';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// Per-pixel painter: fn(x, y) returns a hex colour or null for transparent.
function paint(w, h, fn) {
  const c = mk(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const cache = {};
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      if (!col) continue;
      const v = cache[col] || (cache[col] = rgb(col));
      const i = (y * w + x) * 4;
      img.data[i] = v[0]; img.data[i + 1] = v[1]; img.data[i + 2] = v[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Deterministic per-pixel noise for textures.
const noise = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function flip(c) {
  const f = mk(c.width, c.height);
  const ctx = f.getContext('2d');
  ctx.translate(c.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(c, 0, 0);
  return f;
}

function fromRows(rows, pal) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  return paint(w, h, (x, y) => pal[rows[y][x]] || null);
}

// Sprite with left/right facing versions. Art is drawn facing right unless noted.
const sprite = (rows, pal) => { const r = fromRows(rows, pal); return { r, l: flip(r) }; };


// ---------------------------------------------------------------- hero: Starfleet officer

// Command red by default; the phaser power-up switches to security gold.
const HERO = {
  k: '#120c18', K: '#26262e', h: '#5a3418', s: '#f0c09a', S: '#c88a64', e: '#101018',
  g: '#f8d040', r: '#cc2a3c', R: '#8a1426', p: '#1c1c24', d: '#3a3a44',
};
const HERO_PHASER = { ...HERO, r: '#e8b020', R: '#a87810' };

const HERO_TOP = [
  '.....kkkkkk.....',
  '....khhhhhhk....',
  '...khhhhhhhhk...',
  '...khhsssssssk..',
  '...khssssssesk..',
  '...ksssssssssk..',
  '...kSsssssssSk..',
  '....kkSSSSSkk...',
  '...kKKKKKKKKk...',
  '..kKKKKKKKgKKk..',
  '..kKrrrrrrrrKk..',
  '..ksrrrrrrrrsk..',
  '...kRRRRRRRRk...',
];
const LEGS = {
  stand: ['...kppk..kppk...', '..kddddk.kdddk..', '..kkkkk..kkkkk..'],
  walk1: ['..kppk...kppk...', '.kdddk....kdddk.', '.kkkk......kkkk.'],
  walk2: ['.....kppppk.....', '.....kddddk.....', '.....kkkkkk.....'],
  walk3: ['...kppkkppk.....', '..kdddkkdddk....', '..kkkkk.kkkk....'],
  jump: ['..kppk....kppk..', '.kddk......kddk.', '.kkk........kkk.'],
};
const JUMP_ARMS = ['..kKKKKKKKgKKks.', '..krrrrrrrrrrks.', '..krRrrrrrRrrk..'];

// Big form: same head on a broader uniform, with legs drawn procedurally per pose.
const BIG_TORSO = [
  '...kKKKKKKKKk...', '..kKKKKKKKKKKk..', '.kKKKKKKKKKgKKk.', '.kKKKKKKKKKKKKk.', 'krrrrrrrrrrrrrrk',
  'krrRrrrrrrrrRrrk', 'krrRrrrrrrrrRrrk', 'ksRRrrrrrrrrRRsk', 'kssRrrrrrrrrRssk', '.kkRRRRRRRRRRkk.',
  '..kppppppppppk..', '..kppppkkppppk..',
];
const BIG_JUMP_TORSO = [
  '...kKKKKKKKKk.k.', '..kKKKKKKKKKKksk', '.kKKKKKKKKKgKKkk', '.kKKKKKKKKKKKKk.', 'krrrrrrrrrrrrrrk',
  ...BIG_TORSO.slice(5),
];
// [hipX, footX] for the back leg then the front leg; legs are 5px wide, 12 rows incl. boots.
const BIG_POSES = {
  stand: [[2, 2], [9, 9]], walk1: [[3, 0], [8, 10]], walk2: [[5, 5], [6, 6]], walk3: [[8, 4], [3, 7]], jump: [[3, 1], [8, 10]],
};

function bigLegs([[h1, f1], [h2, f2]], rows = 12) {
  const grid = Array.from({ length: rows }, () => Array(16).fill('.'));
  const legRows = rows - 3;
  for (const [hip, foot] of [[h1, f1], [h2, f2]]) {
    for (let r = 0; r < legRows; r++) {
      const x = Math.round(hip + (foot - hip) * (r / (legRows - 1)));
      for (let i = 0; i < 5; i++) grid[r][x + i] = i === 0 || i === 4 ? 'k' : 'p';
    }
    for (let r = legRows; r < rows; r++) {
      for (let i = 0; i < 6 && foot + i < 16; i++) {
        grid[r][foot + i] = r === rows - 1 || i === 0 || i === 5 || foot + i === 15 ? 'k' : 'd';
      }
    }
  }
  return grid.map((r) => r.join(''));
}

function heroFrames(pal) {
  const small = {};
  const big = {};
  for (const [name, legs] of Object.entries(LEGS)) {
    let top = HERO_TOP.slice();
    if (name === 'jump') top = [...top.slice(0, 9), ...JUMP_ARMS, top[12]];
    small[name] = sprite([...top, ...legs], pal);
    const torso = name === 'jump' ? BIG_JUMP_TORSO : BIG_TORSO;
    big[name] = sprite([...HERO_TOP.slice(0, 8), ...torso, ...bigLegs(BIG_POSES[name])], pal);
  }
  const crouch = [...HERO_TOP.slice(0, 8), BIG_TORSO[0], BIG_TORSO[2], BIG_TORSO[4], BIG_TORSO[7], BIG_TORSO[9], BIG_TORSO[10], ...bigLegs([[1, 0], [10, 10]], 5)];
  big.crouch = sprite([...Array(32 - crouch.length).fill(''), ...crouch], pal);
  return { small, big };
}

// ---------------------------------------------------------------- enemies

// Ferengi: the stompable walker on planet surfaces.
const FERENGI = [
  '................', '................', '.....kkkkkk.....', '....kOOOOOOk....',
  'kk..kooooook..kk', 'kokkooooooookkok', 'koookweooewkoook', 'kkooooooooooookk',
  '.kkoooTTTToookk.', '...kkoooooookk..', '...kjjjjjjjjk...', '..kjJjjjjjjJjk..',
  '..kjJjjjjjjJjk..', '...kjjjjjjjjk...', '...kddk..kddk...', '...kkkk..kkkk...',
];
const FERENGI2 = [...FERENGI.slice(0, 14), '....kddkkddk....', '....kkkkkkkk....'];
const FERENGI_FLAT = [
  ...Array(10).fill('................'),
  'kk..kkkkkkkk..kk', 'kokkooooooookkok', 'kooooxooooxooook', '.kkjjjjjjjjjjkk.', '..kjjjjjjjjjjk..', '..kkkkkkkkkkkk..',
];
const FERENGI_PAL = { k: '#2a1408', O: '#ffc890', o: '#f0985a', w: '#ffffff', e: '#201010', T: '#fff8e0', j: '#6a4aa8', J: '#4a2e80', d: '#3a2a1a', x: '#201010' };

// Borg drone: the walker inside the cube.
const DRONE = [
  '................', '................', '.....kkkkkk.....', '....kGGGGggk....',
  '....kGGRGggk....', '....kmmmGggk....', '....kmmGGggk....', '.....kkggkk.....',
  '...kbbbbbbbbk...', '..kbtbbbbbbtbk..', '..kbbmmbbmmbbk..', '..kmbbbbbbbbmk..',
  '...kbbbbbbbbk...', '...kbbk..kbbk...', '...kmmk..kmmk...', '...kkkk..kkkk...',
];
const DRONE2 = [...DRONE.slice(0, 13), '....kbbkkbbk....', '....kmmkkmmk....', '....kkkkkkkk....'];
const DRONE_FLAT = [
  ...Array(10).fill('................'),
  '....kkkkkkkk....', '...kGGRGggmmk...', '..kbbbbbbbbbbk..', '.kbtbmmbbmmbtbk.', '.kbbbbbbbbbbbbk.', '..kkkkkkkkkkkk..',
];
const DRONE_PAL = { k: '#0a0e0a', G: '#c8d0c8', g: '#8a948a', R: '#ff2020', m: '#6a7070', b: '#2a302c', t: '#40ff60' };

// Borg probe: a little sphere on legs. Stomp it and it curls into a sphere you can kick.
const SPHERE = [
  '.....kkkkkk.....', '....kmMmmMmk....', '...kmgmmgmmgk...', '...kMmmMmmMmk...',
  '...kmmgmmgmmk...', '...kmMmmMmmMk...', '....kmmgmmmk....', '.....kkkkkk.....',
];
const PROBE = ['................', '................', '................', '................', ...SPHERE,
  '....k.k..k.k....', '...k..k..k..k...', '..k...k..k...k..', '..kk..kk.kk..kk.'];
const PROBE2 = ['................', '................', '................', '................', ...SPHERE,
  '....kk....kk....', '....k.k..k.k....', '...k..k..k..k...', '...kk.kk.kk.kk..'];
const SPHERE_ONLY = [...Array(8).fill('................'), ...SPHERE];
const PROBE_PAL = { k: '#0a0e0a', m: '#4a5450', M: '#8a9894', g: '#40ff60' };
const PROBE_PAL_PLANET = { ...PROBE_PAL, g: '#ff5a3a' };

// ---------------------------------------------------------------- items

// Combadge: grows the officer.
function badgeSprite() {
  const inOval = (x, y) => ((x - 7.5) / 7.5) ** 2 + ((y - 10) / 3.6) ** 2 <= 1;
  const inDelta = (x, y) => y >= 1 && y <= 14 && Math.abs(x - 7.5) <= (y - 0.5) * 0.42 && !(y > 9 && Math.abs(x - 7.5) < (y - 9) * 0.95);
  const c = paint(16, 16, (x, y) => {
    if (inDelta(x, y)) {
      const edge = !inDelta(x - 1, y) || !inDelta(x + 1, y) || !inDelta(x, y - 1);
      if (edge) return '#6a4a08';
      return x < 7.5 ? '#fff0a0' : x < 9 ? '#f8d040' : '#c8961c';
    }
    if (inOval(x, y)) {
      if (!inOval(x - 1, y) || !inOval(x + 1, y) || !inOval(x, y - 1) || !inOval(x, y + 1)) return '#283040';
      return y < 9 ? '#eef2fa' : '#9aa4bc';
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inDelta(x + dx, y + dy) || inOval(x + dx, y + dy)) return '#283040';
    return null;
  });
  return { r: c, l: flip(c) };
}

// Earl Grey, hot: an extra life.
function teaSprite() {
  const c = paint(16, 16, (x, y) => {
    if (y >= 1 && y <= 5 && ((x === 6 && y % 2 === 1) || (x === 7 && y % 2 === 0) || (x === 9 && y % 2 === 0) || (x === 10 && y % 2 === 1))) return '#e8eeff';
    if (y === 14 && x >= 1 && x <= 14) return x === 1 || x === 14 ? '#3a3a4a' : '#d8dce8';
    if (y === 15 && x >= 2 && x <= 13) return '#3a3a4a';
    if (y >= 7 && y <= 13) {
      const hw = 5.5 - (y - 7) * 0.35;
      const dx = x - 7;
      if (Math.abs(dx) <= hw) {
        if (Math.abs(dx) > hw - 1 || y === 13) return '#3a3a4a';
        if (y === 7) return '#3a3a4a';
        if (y === 8) return '#a0522d';
        return dx > hw - 3 ? '#c8ccd8' : '#f4f4f8';
      }
      if (x >= 12 && x <= 14 && y >= 8 && y <= 11) return (x === 14 || y === 8 || y === 11) ? '#3a3a4a' : null;
    }
    return null;
  });
  return { r: c, l: flip(c) };
}

// Type-2 phaser: lets the officer fire.
const PHASER = [
  '................', '................', '................', '................', '................', '................',
  '.kkkkkkkkkkk....', 'kMMMMMMMMMMMkk..', 'kmmmgmmmmmmmmok.', 'kmmmmmmmmmmmmok.',
  '.kkkkmmmmkkkkk..', '....kmmmmk......', '....kmmmmk......', '...kmmmmk.......', '...kmmmmk.......', '...kkkkkk.......',
];
const PHASER_PAL = { k: '#101418', M: '#b8c0cc', m: '#6a7484', o: '#ff9c3a', g: '#40ff60' };

// ---------------------------------------------------------------- tiles

const THEMES = {
  planet: {
    sky: ['#1a1048', '#3a1a6a', '#7a2a7a', '#c8506a', '#ff9a6a', '#ffd0a0'],
    stars: true,
    grass: ['#aafff0', '#40e0c0', '#1a9a88', '#0e5a58'],
    dirt: ['#f0a070', '#c8643c', '#a04a2c', '#6a2a1c'],
    hull: { body: '#b8c0cc', hi: '#eef2f8', lo: '#7a8496', seam: '#2a3040', accent: '#ff9c3a' },
    block: { hi: '#d8e0ee', mid: '#8a94a8', lo: '#4a5268', edge: '#1a1e2a', stripe: '#ff9c3a' },
    q: { bodies: ['#ff9c3a', '#ffb860', '#ff8a20', '#ff9c3a'], edge: '#000000', bar: '#cc99cc', glyph: '#000000', glyphs: null },
    used: { body: '#4a4458', hi: '#6a6480', lo: '#2a2636', edge: '#000000' },
    pipe: { dark: '#20242c', hi: '#e8eef6', light: '#b8c2d0', mid: '#8a94a8', shade: '#5a6474', deep: '#3a4252', band: '#ff9c3a', bandHi: '#ffd0a0' },
    pole: { light: '#e8eef6', mid: '#9aa4b8', dark: '#2a3040', beacon: '#ff4a3a' },
    hud: null,
  },
  borg: {
    sky: ['#020604', '#04100a', '#061a0e', '#0a2414', '#0c2c18'],
    stars: false,
    hull: { body: '#2e3834', hi: '#4a5a52', lo: '#1a2220', seam: '#060a08', accent: '#2aff6a' },
    block: { hi: '#4a5a50', mid: '#26302a', lo: '#141a16', edge: '#050806', stripe: '#2aff6a' },
    q: { bodies: ['#0e1a12', '#0e1a12', '#0e1a12', '#0e1a12'], edge: '#3a4a40', bar: '#1a2a20', glyph: null, glyphs: ['#2aff6a', '#8affb0', '#18a040', '#2aff6a'] },
    used: { body: '#1a201c', hi: '#2a322c', lo: '#0e120e', edge: '#050806' },
    pipe: { dark: '#050806', hi: '#7a8a80', light: '#5a6a60', mid: '#3a4840', shade: '#26302a', deep: '#141a16', band: '#2aff6a', bandHi: '#b0ffc8' },
    pole: { light: '#7a8a80', mid: '#3a4840', dark: '#050806', beacon: '#2aff6a' },
    hud: 'rgba(2,8,4,0.75)',
  },
};

function planetGround(th, top) {
  return paint(TILE, TILE, (x, y) => {
    const n = noise(x, y, 7);
    if (top) {
      // Alien turf with tufts hanging over the edge.
      const edge = 3 + ((x * 5 + 3) % 7 < 2 ? 1 : 0) + (x % 4 === 1 ? 1 : 0);
      if (y === 0) return x % 3 === 0 ? th.grass[0] : th.grass[1];
      if (y < edge - 1) return n < 0.15 ? th.grass[0] : th.grass[1];
      if (y < edge) return th.grass[2];
      if (y === edge) return th.grass[3];
    }
    // Rusty soil with rock strata.
    if (y % 6 === 5 && noise(Math.floor(x / 5), Math.floor(y / 6), 4) < 0.5) return th.dirt[2];
    if (n > 0.93) return th.dirt[0];
    if (n < 0.07) return th.dirt[3];
    return th.dirt[1];
  });
}

function borgGround(top) {
  return paint(TILE, TILE, (x, y) => {
    if (top && y === 0) return '#40ff70';
    if (top && y === 1) return '#1a7a3a';
    if (x % 8 === 7 || y % 8 === 7) return '#141c18';
    if (x % 8 === 0 || y % 8 === 0) return '#7a8a80';
    if (x % 8 === 3 && y % 8 === 3) return '#2aff6a';
    if ((x + y * 3) % 11 === 0 && noise(x, y, 2) < 0.4) return '#3e4c44';
    return '#4a5850';
  });
}

// Starfleet hull plating (breakable).
function hullTile(c) {
  return paint(TILE, TILE, (x, y) => {
    if (x === 15 || y === 15 || y === 7) return c.seam;
    if (y === 0 || y === 8 || x === 0) return c.hi;
    if ((x === 2 || x === 13) && (y === 2 || y === 10)) return c.lo;
    if (y === 12 && x >= 3 && x <= 7) return c.accent;
    if (y === 6 || y === 14 || x === 14) return c.lo;
    return noise(x, y, 3) < 0.05 ? c.lo : c.body;
  });
}

// Borg mesh plating (breakable).
function borgPanel(c) {
  return paint(TILE, TILE, (x, y) => {
    if (x === 15 || y === 15) return c.seam;
    if (x === 0 || y === 0) return c.hi;
    if ((x === 11 && y === 4) || (x === 4 && y === 11)) return c.accent;
    if ((x + y) % 5 === 0) return c.lo;
    if ((x - y + 16) % 5 === 0) return c.lo;
    return c.body;
  });
}

// Cargo container (solid stair block).
function containerTile(c) {
  return paint(TILE, TILE, (x, y) => {
    if (x === 15 || y === 15) return c.edge;
    if (x === 0 || y === 0) return c.hi;
    if (x === 14 || y === 14) return c.lo;
    if ((y === 6 || y === 7) && x > 1 && x < 14) return (x % 2 === 0 || c.stripe !== '#2aff6a') ? c.stripe : c.mid;
    if ((x === 3 || x === 12) && y > 1 && y < 14) return c.lo;
    if (x === 1 || y === 1) return c.hi;
    return c.mid;
  });
}

const Q_GLYPH = ['..####..', '.##..##.', '.....##.', '....##..', '...##...', '........', '...##...'];

// LCARS panel on planets, glowing Borg node inside the cube.
function questionTile(q, f) {
  const body = q.bodies[f];
  const glyph = q.glyph || q.glyphs[f];
  return paint(TILE, TILE, (x, y) => {
    const corner = (x === 0 || x === 15) && (y === 0 || y === 15);
    if (corner) return null;
    if (x === 0 || y === 0 || x === 15 || y === 15) return q.edge;
    if ((x === 1 || x === 14) && (y === 1 || y === 14)) return q.edge;
    if (x >= 1 && x <= 3) return q.bar;
    const gx = x - 6, gy = y - 4;
    if (gx >= 0 && gx < 8 && gy >= 0 && gy < 7 && Q_GLYPH[gy][gx] === '#') return glyph;
    if (x === 4) return q.edge;
    return body;
  });
}

function usedTile(c) {
  return paint(TILE, TILE, (x, y) => {
    if ((x === 0 || x === 15) && (y === 0 || y === 15)) return null;
    if (x === 0 || y === 0 || x === 15 || y === 15) return c.edge;
    if (x === 1 || y === 1) return c.hi;
    if (x === 14 || y === 14) return c.lo;
    if (y === 8 && x > 3 && x < 12) return c.lo;
    return c.body;
  });
}

// EPS conduit colour across its 32px width, giving a rounded, lit look.
function pipeShade(p, x, w) {
  const t = x / (w - 1);
  if (x === 0 || x === w - 1) return p.dark;
  if (t < 0.12) return p.mid;
  if (t < 0.3) return p.hi;
  if (t < 0.38) return p.light;
  if (t < 0.7) return p.mid;
  if (t < 0.85) return p.shade;
  return p.deep;
}

function pipeTiles(p) {
  const top = (half) => paint(TILE, TILE, (x, y) => {
    const gx = x + half * 16;
    if (y === 0 || y === 13) return p.dark;
    if (y > 13) {
      const bx = gx - 2;
      if (bx < 0 || bx > 27) return null;
      return y === 14 ? p.dark : pipeShade(p, bx, 28);
    }
    if (y >= 5 && y <= 8 && gx > 0 && gx < 31) return y === 5 ? p.bandHi : p.band; // glowing coupling band
    if (y === 1) return gx === 0 || gx === 31 ? p.dark : p.hi;
    return pipeShade(p, gx, 32);
  });
  const body = (half) => paint(TILE, TILE, (x, y) => {
    const bx = x + half * 16 - 2;
    if (bx < 0 || bx > 27) return null;
    if (y === 15 && bx > 0 && bx < 27) return p.deep; // segment seam
    return pipeShade(p, bx, 28);
  });
  return [top(0), top(1), body(0), body(1)];
}

// Gold-pressed latinum: the currency (coins).
function latinumFrames() {
  const widths = [5, 3, 1, 3];
  return widths.map((hw) => paint(TILE, TILE, (x, y) => {
    const dx = Math.abs(x - 7.5);
    if (dx > hw + 0.5 || y < 2 || y > 13) return null;
    if (dx > hw - 0.5 || y === 2 || y === 13) return '#6a4a08';
    if (hw > 1 && x < 7.5 - hw * 0.3 && y < 8) return '#fff4b0';
    if (hw > 2 && (y === 5 || y === 10)) return '#b08a20';
    return '#f8d050';
  }));
}

// Transporter beacon: the end-of-level pole.
function poleTile(c, topBall) {
  return paint(TILE, TILE, (x, y) => {
    if (topBall) {
      const d = (x - 7.5) ** 2 + (y - 9.5) ** 2;
      if (d < 4) return '#ffffff';
      if (d < 13) return c.beacon;
      if (d < 20) return c.dark;
      return null;
    }
    if (x === 7) return c.light;
    if (x === 8) return c.mid;
    if (x === 6 || x === 9) return c.dark;
    if (y % 8 === 0 && (x === 5 || x === 10)) return c.dark;
    return null;
  });
}

// ---------------------------------------------------------------- backgrounds

function skyCanvas(cols, stars) {
  // Banded gradient with 2x2 ordered dithering between bands: the classic 16-bit sky.
  const bands = cols.length - 1;
  const bayer = [[0, 2], [3, 1]];
  return paint(VIEW_W, VIEW_H, (x, y) => {
    if (stars && y < 90) {
      const n = noise(x, y, 11);
      if (n > 0.996) return '#ffffff';
      if (n > 0.992 && y < 60) return '#b8b0ff';
    }
    const t = (y / VIEW_H) * bands;
    const i = Math.min(bands - 1, Math.floor(t));
    const f = t - i;
    return f * 4 > bayer[y & 1][x & 1] + 0.5 ? cols[i + 1] : cols[i];
  });
}

// Periodic height function (period = width) so layers tile seamlessly.
function ridge(seed, w, amps) {
  const rng = new RNG(seed);
  const parts = amps.map(([k, a]) => ({ k, a, ph: rng.next() * Math.PI * 2 }));
  return (x) => parts.reduce((s, p) => s + p.a * Math.sin((x / w) * Math.PI * 2 * p.k + p.ph), 0);
}

// Far sky objects: a ringed gas giant, a moon, and a starship in orbit.
function celestial() {
  const W = 512;
  const inShip = (x, y) => {
    // A tiny side-on silhouette: saucer, neck, engineering hull, two nacelles.
    const sx = x - 230, sy = y - 62;
    if (((sx - 8) / 8.5) ** 2 + ((sy - 3) / 2.2) ** 2 <= 1) return '#d8dce8';
    if (sx >= 10 && sx <= 14 && sy >= 4 && sy <= 6 && sy >= 4 + (sx - 10) * 0.5) return '#9aa0b8';
    if (((sx - 18) / 5.5) ** 2 + ((sy - 6.5) / 1.6) ** 2 <= 1) return '#b8bed0';
    if (sx >= 14 && sx <= 27 && sy >= 1 && sy <= 2) return sx >= 26 ? '#ff4a3a' : sy === 1 ? '#e8ecf8' : '#6ad0ff';
    if (sx >= 18 && sx <= 19 && sy >= 3 && sy <= 5) return '#9aa0b8';
    return null;
  };
  return paint(W, 120, (x, y) => {
    const s = inShip(x, y);
    if (s) return s;
    // Gas giant with bands and a ring.
    const px = x - 380, py = y - 44;
    const ringD = (px / 46) ** 2 + (py / 7) ** 2;
    const front = py > 0;
    const pd = px * px + py * py;
    if (ringD <= 1 && ringD >= 0.62 && (front || pd > 26 * 26)) return ringD > 0.85 ? '#c8a0d8' : '#a07ab8';
    if (pd < 26 * 26) {
      const band = Math.max(0, Math.floor((py + 28 + Math.sin(px / 6) * 1.5) / 5)) % 3;
      const shade = px + py > 18 ? 1 : 0;
      return [['#f0b878', '#c87a58'], ['#d89060', '#a05a40'], ['#ffd8a0', '#d8a070']][band][shade];
    }
    // Moon.
    const md = (x - 110) ** 2 + (y - 28) ** 2;
    if (md < 64) return (x - 110) + (y - 28) > 3 ? '#8a90b0' : noise(x, y, 5) < 0.15 ? '#a8aec8' : '#d8dcf0';
    return null;
  });
}

function mountains(theme) {
  const W = 512;
  if (theme === 'borg') {
    // Distant cube structure hanging from above and rising from below.
    const rng = new RNG(31);
    const blocks = Array.from({ length: W / 16 }, () => ({ top: rng.int(30, 80), bot: rng.int(110, 160) }));
    return paint(W, VIEW_H, (x, y) => {
      const b = blocks[Math.floor(x / 16)];
      const inside = y < b.top || y > b.bot;
      if (!inside) return null;
      if (noise(x, y, 8) > 0.988 && y % 8 === 4) return '#14803a';
      if (x % 16 === 0 || y % 8 === 0) return '#0e1c12';
      return '#08120c';
    });
  }
  const h = ridge(3, W, [[3, 18], [7, 10], [13, 5]]);
  return paint(W, VIEW_H, (x, y) => {
    // Sharp alien spires.
    const top = 118 - Math.abs(h(x)) * 1.6;
    if (y < top) return null;
    const lit = Math.abs(h(x + 1)) > Math.abs(h(x));
    if (y < top + 2) return '#a888d8';
    return lit ? '#6a4a9a' : '#4e3478';
  });
}

function hills(theme) {
  const W = 512;
  if (theme === 'borg') {
    const h = ridge(21, W, [[4, 10], [9, 5]]);
    return paint(W, VIEW_H, (x, y) => {
      const pipe = (x + 7) % 64;
      if (pipe < 7 && y > 24) {
        if (y % 24 === 0) return '#0a100c';
        return ['#0e1610', '#1c2620', '#26322a', '#1c2620', '#141c16', '#0e1610', '#060a08'][pipe];
      }
      if (y >= 140 && y <= 146) return y === 140 ? '#26322a' : y === 146 ? '#060a08' : (x % 20 === 3 ? '#1a8a40' : '#141c16');
      const top = 180 - h(x);
      if (y < top) return null;
      if (y < top + 1) return '#1c2620';
      if (noise(x, y, 9) > 0.985) return '#1a8a40';
      return (x % 12 === 0 || y % 6 === 0) ? '#080e0a' : '#0e1610';
    });
  }
  const h = ridge(8, W, [[3, 18], [6, 9], [13, 3]]);
  return paint(W, VIEW_H, (x, y) => {
    // Flat-topped rock mesas with strata.
    const top = 158 - Math.round(h(x) / 6) * 6;
    if (y < top) return null;
    if (y < top + 2) return '#ffc090';
    const d = y - top;
    if (d % 9 < 2) return '#a04a34';
    if (noise(x, y, 6) < 0.04) return '#e88a5a';
    return h(x + 2) > h(x) ? '#d0704a' : '#b85a3e';
  });
}

function nebulaCanvas() {
  const W = 512;
  const rng = new RNG(42);
  const puffs = [];
  for (let i = 0; i < 5; i++) {
    const cx = i * 102 + rng.int(0, 40), cy = rng.int(70, 100), n = rng.int(4, 6);
    for (let j = 0; j < n; j++) puffs.push({ x: cx + j * 13 - n * 6, y: cy - (j % 2) * 3, r: rng.int(6, 10) });
  }
  const inside = (x, y) => {
    for (const p of puffs) {
      for (const ox of [-W, 0, W]) {
        const dx = x - p.x - ox, dy = (y - p.y) * 2;
        if (dx * dx + dy * dy < p.r * p.r) return p;
      }
    }
    return null;
  };
  return paint(W, 120, (x, y) => {
    if (!inside(x, y)) return null;
    // Wispy, dithered: only some pixels filled for a translucent look.
    const lower = inside(x, y - 2) == null;
    if (lower) return '#ffd8b8';
    return (x + y) % 2 === 0 ? '#ff9ab0' : null;
  });
}

// ---------------------------------------------------------------- decorations & set pieces

// The classic away-mission boulders.
function rocks(w) {
  const pw = w * 16;
  const rng = new RNG(w * 13);
  const balls = [];
  for (let i = 0; i < w + 1; i++) balls.push({ x: 5 + i * ((pw - 10) / Math.max(1, w)), y: 11 - rng.int(0, 3), r: rng.int(5, 7) });
  return paint(pw, 16, (x, y) => {
    let hit = null;
    for (const b of balls) if (Math.abs(x - b.x) + Math.abs(y - b.y) * 1.2 < b.r + 1.5) hit = b;
    if (!hit) return null;
    const dx = x - hit.x, dy = y - hit.y;
    if (Math.abs(dx) + Math.abs(dy) * 1.2 > hit.r + 0.5) return '#4a3a2e';
    if (dx < 0 && dy < -1) return '#efe0c8';
    return dy > 1 || dx > 2 ? '#9a8670' : '#c8b498';
  });
}

function flora(w) {
  const rng = new RNG(w * 7 + 1);
  const fl = Array.from({ length: w * 3 }, (_, i) => ({ x: 3 + i * 5 + rng.int(0, 2), h: rng.int(6, 12), c: rng.pick(['#ff5ad8', '#5affe8', '#ffe05a', '#b07aff']) }));
  return paint(w * 16, 16, (x, y) => {
    for (const f of fl) {
      const top = 16 - f.h;
      const d = (x - f.x) ** 2 + (y - top) ** 2;
      if (d <= 1) return '#ffffff';
      if (d <= 4) return f.c;
      if (x === f.x + (y < 12 ? 0 : 0) && y > top) return '#1a9a88';
      if (y > 12 && Math.abs(x - f.x) === 1 && y === 13) return '#1a9a88';
    }
    return null;
  });
}

// Field sensor posts left by the away team.
function sensor(w) {
  return paint(w * 16, 16, (x, y) => {
    const px = x % 16;
    if (px >= 6 && px <= 9 && y >= 4 && y <= 6) return y === 4 ? '#e8eef6' : '#8a94a8';
    if (px === 7 && y === 5) return Math.floor(x / 16) % 2 ? '#40ff60' : '#ff4a3a';
    if ((px === 7 || px === 8) && y > 6) return px === 7 ? '#b8c2d0' : '#5a6474';
    if (y === 15 && px >= 4 && px <= 11) return '#3a4252';
    return null;
  });
}

function conduit(w) {
  return paint(w * 16, 16, (x, y) => {
    if (y >= 8 && y <= 12) {
      if (y === 8) return '#4a5a50';
      if (y === 12) return '#0a100c';
      return x % 9 === 4 && y === 10 ? '#2aff6a' : '#26302a';
    }
    if (x % 16 === 3 && y < 8 && y > 1) return y % 2 ? '#3a4a40' : '#1a241e';
    if (x % 16 === 3 && y === 1) return '#2aff6a';
    return null;
  });
}

// Type-6 shuttlecraft: the end-of-level goal. The player walks in through the hatch at x≈40.
function shuttle() {
  const c = mk(80, 80);
  const g = c.getContext('2d');
  const R = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  R('#30343c', 6, 40, 68, 34);            // outline
  R('#e0e4ec', 7, 41, 66, 32);            // hull
  R('#ffffff', 7, 41, 66, 2);             // top highlight
  R('#a0a8b8', 7, 66, 66, 7);             // lower shading
  R('#30343c', 66, 40, 8, 6);             // sloped nose
  R('#e0e4ec', 66, 46, 7, 2);
  R('#1a3a6a', 63, 46, 9, 7);             // cockpit window
  R('#4a7ab8', 64, 47, 3, 2);
  R('#cc2a3c', 7, 55, 66, 1);             // pinstripe
  R('#30343c', 2, 60, 60, 8);             // nacelle
  R('#c8ccd8', 3, 61, 58, 5);
  R('#4ab0ff', 3, 64, 58, 1);
  R('#ff4a3a', 57, 61, 4, 5);
  R('#30343c', 14, 73, 4, 7);             // landing struts
  R('#30343c', 62, 73, 4, 7);
  R('#30343c', 32, 47, 16, 27);           // hatch frame
  R('#101418', 33, 48, 14, 26);           // open hatch
  R('#ffe0a0', 33, 48, 14, 1);
  R('#30343c', 18, 46, 8, 5);             // side windows
  R('#1a3a6a', 19, 47, 6, 3);
  return c;
}

// Starfleet pennant on the transporter beacon.
function flagSprite() {
  return paint(16, 16, (x, y) => {
    const inTri = x >= Math.abs(y - 7) * 2 && y <= 14;
    if (!inTri) return null;
    if (x === Math.abs(y - 7) * 2 || y === 0 || y === 14) return '#0e1a3a';
    // Tiny gold delta.
    if (y >= 4 && y <= 10 && Math.abs(x - 10) <= (y - 4) * 0.5 && !(y >= 9 && x === 10)) return '#f8d040';
    return '#3a6ad8';
  });
}

function phaserBeam() {
  return [0, 1].map((f) => paint(12, 4, (x, y) => {
    if (y === 1 || y === 2) return f ? '#fff8d0' : '#ffe0a0';
    return (x + f) % 2 ? '#ff8a20' : '#ff5a10';
  }));
}

// ---------------------------------------------------------------- assembly

export function buildArt() {
  const art = { themes: {} };
  for (const [name, th] of Object.entries(THEMES)) {
    const borg = name === 'borg';
    const tiles = [];
    tiles[T.GROUND] = borg ? borgGround(false) : planetGround(th, false);
    tiles[T.BRICK] = borg ? borgPanel(th.hull) : hullTile(th.hull);
    tiles[T.USED] = usedTile(th.used);
    tiles[T.BLOCK] = containerTile(th.block);
    [tiles[T.PIPE_TL], tiles[T.PIPE_TR], tiles[T.PIPE_L], tiles[T.PIPE_R]] = pipeTiles(th.pipe);
    tiles[T.POLE] = poleTile(th.pole, false);
    tiles[T.POLE_TOP] = poleTile(th.pole, true);
    const walkerRows = borg ? [DRONE, DRONE2] : [FERENGI, FERENGI2];
    const walkerPal = borg ? DRONE_PAL : FERENGI_PAL;
    const probePal = borg ? PROBE_PAL : PROBE_PAL_PLANET;
    art.themes[name] = {
      tiles,
      groundTop: borg ? borgGround(true) : planetGround(th, true),
      question: [0, 1, 2, 3].map((f) => questionTile(th.q, f)),
      sky: skyCanvas(th.sky, th.stars),
      celestial: borg ? null : celestial(),
      mountains: mountains(name),
      hills: hills(name),
      clouds: borg ? null : nebulaCanvas(),
      castle: shuttle(),
      hudBand: th.hud,
      walker: walkerRows.map((r) => sprite(r, walkerPal)),
      walkerFlat: sprite(borg ? DRONE_FLAT : FERENGI_FLAT, walkerPal),
      probe: [PROBE, PROBE2].map((r) => sprite(r, probePal)),
      sphere: sprite(SPHERE_ONLY, probePal),
      debris: debris(tiles[T.BRICK]),
    };
  }
  art.latinum = latinumFrames();
  art.hero = heroFrames(HERO);
  art.heroPhaser = heroFrames(HERO_PHASER);
  art.badge = badgeSprite();
  art.tea = teaSprite();
  art.phaser = sprite(PHASER, PHASER_PAL);
  art.flag = flagSprite();
  art.beam = phaserBeam();
  const decorCache = {};
  art.decor = (type, w) => {
    const k = type + w;
    if (!decorCache[k]) decorCache[k] = ({ rocks, flora, sensor, conduit }[type] || rocks)(w);
    return decorCache[k];
  };
  return art;
}

function debris(brick) {
  const c = mk(8, 8);
  c.getContext('2d').drawImage(brick, 0, 0, 8, 8, 0, 0, 8, 8);
  return c;
}
