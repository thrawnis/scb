// All graphics are generated at startup: sprites from text pixel-art with palettes,
// tiles and backgrounds from small procedural routines. Everything is drawn once into
// offscreen canvases, so each frame is just a handful of drawImage calls.
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

// ---------------------------------------------------------------- palettes

const HERO = {
  k: '#2a1630', c: '#ff5a6e', C: '#c02a4a', W: '#ffffff', h: '#6a3a1a', s: '#ffd0a0', S: '#e8a070',
  e: '#1a1430', y: '#ffd23a', b: '#3a78f0', B: '#2448b0', p: '#4a3a8a', d: '#8a4a20',
};
const HERO_FIRE = { ...HERO, c: '#ff9a1a', C: '#c05a10', b: '#f4f4fa', B: '#b8b8d8', y: '#ff4a3a', p: '#c03050' };

// ---------------------------------------------------------------- hero art

const HERO_TOP = [
  '.....kkkkkk.....',
  '....kccccccWk...',
  '...kccccccccck..',
  '...kCCCCCCCCCCk.',
  '...khhssssesk...',
  '...khsssssessk..',
  '...kSssssssssk..',
  '....kkSSSSSkk...',
  '...kyyyyyyyyk...',
  '..kbbyybbbbbbk..',
  '..kbbbbbbbbsbk..',
  '..ksbBbbbbBbsk..',
  '...kBBBBBBBBk...',
];
const LEGS = {
  stand: ['...kppk..kppk...', '..kddddk.kdddk..', '..kkkkk..kkkkk..'],
  walk1: ['..kppk...kppk...', '.kdddk....kdddk.', '.kkkk......kkkk.'],
  walk2: ['.....kppppk.....', '.....kddddk.....', '.....kkkkkk.....'],
  walk3: ['...kppkkppk.....', '..kdddkkdddk....', '..kkkkk.kkkk....'],
  jump: ['..kppk....kppk..', '.kddk......kddk.', '.kkk........kkk.'],
};
const JUMP_ARMS = ['..kbbyybbbbbbks.', '..kbbbbbbbbbbks.', '..kbBbbbbbBbbk..'];

// Big form: same head on a broader torso, with legs drawn procedurally per pose.
const BIG_TORSO = [
  '...kyyyyyyyyk...', '..kyyyyyyyyyyk..', '.kbbbyybbbbbbbk.', '.kbbbbyybbbbbbk.', 'kbbbbbbbbbbbbbbk',
  'kbbBbbbbbbbbBbbk', 'kbbBbbbbbbbbBbbk', 'ksBBbbbbbbbbBBsk', 'kssBbbbbbbbbBssk', '.kkBBBBBBBBBBkk.',
  '..kppppppppppk..', '..kppppkkppppk..',
];
const BIG_JUMP_TORSO = [
  '...kyyyyyyyyk.k.', '..kyyyyyyyyyyksk', '.kbbbyybbbbbbbkk', '.kbbbbyybbbbbbk.', 'kbbbbbbbbbbbbbbk',
  ...BIG_TORSO.slice(5),
];
// [hipX, footX] for the back leg then the front leg; legs are 5px wide, 12 rows incl. shoes.
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

// ---------------------------------------------------------------- enemies & items

const BLOB = [
  '................', '................', '................',
  '......kkkk......', '....kkmmmmkk....', '...kmmmmmmmmk...', '..kmmLmmmmmmmk..', '..kmLLmmmmmmmk..',
  '.kmmmwwmmwwmmmk.', '.kmmmwemmwemmmk.', '.kmmmwemmwemmmk.', '.kmmmmmmmmmmmmk.',
  '.kMmmmmmmmmmmMk.', '.kMMmmmmmmmmMMk.', '..kMMMMMMMMMMk..', '...kkkkkkkkkk...',
];
const BLOB2 = ['................', ...BLOB.slice(0, 13), ...BLOB.slice(14)];
const BLOB_FLAT = [
  ...Array(10).fill('................'),
  '.....kkkkkk.....', '..kkmmmmmmmmkk..', '.kmmmeemmeemmmk.', '.kMmmmmmmmmmmMk.', '.kMMMMMMMMMMMMk.', '..kkkkkkkkkkkk..',
];
const BUG = [
  '................', '................', '................',
  '........kkkk....', '......kkggggkk..', '.....kgGggggggk.', '....kgGGgggkgggk', '....kgGgggkggggk',
  '.kkkkggggkgggggk', 'kssskDDDDDDDDDDk', 'kswskyyyyyyyyyyk', 'ksssskkkkkkkkkk.',
  '.kkk.kssk.kssk..', '.....kssk.kssk..', '....kkkk.kkkk...', '................',
];
const BUG2 = [...BUG.slice(0, 12), '.kkk..kssk.kssk.', '......kssk.kssk.', '.....kkkk.kkkk..', '................'];
const SHELL = [
  ...Array(6).fill('................'),
  '.....kkkkkk.....', '...kkggggggkk...', '..kgGGgkkggggk..', '.kgGggkggkgggggk', '.kgGgkggggkggggk',
  '.kggggkggkgggggk', '.kDDDDDDDDDDDDDk', '.kyyyyyyyyyyyyyk', '..kkkkkkkkkkkkk.', '................',
];
const BERRY = [
  '................', '.......kk.......', '......klLk......', '...kkkkllkkkk...', '..kRRRRkkRRRRk..',
  '.kRWWRRRRRRRRRk.', '.kRWRRRRRRRRRRk.', '.kRRRRRRRRRRRRk.', '.kRRRRRRRRRRRRk.', '.kRRRRRRRRRRRrk.',
  '.kRRRRRRRRRRrrk.', '..kRRRRRRRRrrk..', '...kRRRRRRrrk...', '....kkrrrrkk....', '......kkkk......', '................',
];
const BLOOM = [
  '................', '.....kkkkkk.....', '...kkOOOOOOkk...', '..kOOyyyyyyOOk..', '..kOyywwwwyyOk..',
  '..kOOyyyyyyOOk..', '...kkOOOOOOkk...', '.....kkllkk.....', '..kk...ll...kk..', '.kLLk..ll..kLLk.',
  '.kLllk.ll.kllLk.', '..kllllllllllk..', '...kkkkllkkkk...', '.......ll.......', '......kllk......', '......kkkk......',
];

const BLOB_PAL = { k: '#2a1030', m: '#b05ae0', M: '#7a30a8', L: '#e8b8ff', w: '#ffffff', e: '#1a1030' };
const BLOB_PAL_CAVE = { ...BLOB_PAL, m: '#ff8a3a', M: '#c04a1a', L: '#ffd0a0' };
const BUG_PAL = { k: '#142010', g: '#3cc860', G: '#a8f8a8', D: '#1e7a34', y: '#f8e070', s: '#f8c890', w: '#ffffff' };
const BUG_PAL_CAVE = { ...BUG_PAL, g: '#e04a8a', G: '#ffb0d8', D: '#8a1a50' };

// ---------------------------------------------------------------- tiles

const THEMES = {
  overworld: {
    sky: ['#3a78e8', '#5a9cf8', '#80bcff', '#a8d8ff', '#cdeeff'],
    grass: ['#a8ff78', '#5cd040', '#3aa830', '#23802a'],
    dirt: ['#e8a060', '#c8743c', '#a0542a', '#7a3a1e'],
    brick: { body: '#d8683c', hi: '#ffa878', lo: '#a0442a', mortar: '#5a2418' },
    block: { hi: '#f8d8a0', mid: '#c89058', lo: '#7a4a28', edge: '#4a2814' },
  },
  underground: {
    sky: ['#060a1c', '#0c1430', '#121c40', '#18244e', '#1e2c5a'],
    grass: ['#a0fff0', '#3ae0c0', '#20a090', '#127068'],
    dirt: ['#7080c0', '#5464a4', '#3a4680', '#262e5a'],
    brick: { body: '#3a8ab8', hi: '#90dcff', lo: '#1e5078', mortar: '#0a1a38' },
    block: { hi: '#b0c0f0', mid: '#6878b8', lo: '#38427a', edge: '#1c2048' },
  },
};

function groundTile(th, top) {
  return paint(TILE, TILE, (x, y) => {
    const n = noise(x, y, 7);
    if (top) {
      const edge = 3 + ((x * 5 + 3) % 7 < 2 ? 1 : 0) + (x % 4 === 1 ? 1 : 0);
      if (y === 0) return th.grass[0];
      if (y < edge - 1) return n < 0.15 ? th.grass[0] : th.grass[1];
      if (y < edge) return th.grass[2];
      if (y === edge) return th.grass[3];
    }
    // Dirt with pebbles and soft shading toward the bottom.
    const px = (x + 3 * Math.floor(y / 6)) % 8;
    if (n > 0.93) return th.dirt[0];
    if ((px === 2 && y % 6 === 2) || (px === 6 && y % 6 === 5)) return th.dirt[2];
    if (n < 0.08) return th.dirt[3];
    return y > 12 && n < 0.4 ? th.dirt[2] : th.dirt[1];
  });
}

function brickTile(th) {
  const b = th.brick;
  return paint(TILE, TILE, (x, y) => {
    const row = Math.floor(y / 4);
    const off = row % 2 ? 4 : 0;
    const bx = (x + off) % 8;
    const by = y % 4;
    if (by === 3 || bx === 7) return b.mortar;
    if (by === 0) return b.hi;
    if (bx === 0) return by === 2 ? b.lo : b.hi;
    if (by === 2 && bx > 4) return b.lo;
    return noise(x, y, 3) < 0.06 ? b.lo : b.body;
  });
}

function bevelTile(c, inset) {
  return paint(TILE, TILE, (x, y) => {
    if (x === 15 || y === 15) return c.edge;
    if (x === 0 || y === 0) return c.hi;
    if (x === 14 || y === 14) return c.lo;
    if (inset && (x === 3 || y === 3) && x >= 3 && y >= 3 && x <= 12 && y <= 12) return c.lo;
    if (inset && (x === 12 || y === 12) && x >= 3 && y >= 3 && x <= 12 && y <= 12) return c.hi;
    if (x === 1 || y === 1) return c.hi;
    return c.mid;
  });
}

const Q_GLYPH = ['..####..', '.##..##.', '.....##.', '....##..', '...##...', '........', '...##...'];

function questionTile(body) {
  const pal = { edge: '#7a3a08', hi: '#fff4b0', lo: '#c87810' };
  return paint(TILE, TILE, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return pal.edge;
    const corner = (x === 2 || x === 13) && (y === 2 || y === 13);
    if (corner) return pal.edge;
    const gx = x - 4, gy = y - 4;
    if (gx >= 0 && gx < 8 && gy >= 0 && gy < 7 && Q_GLYPH[gy][gx] === '#') return '#ffffff';
    if (gx >= 1 && gx < 9 && gy >= 1 && gy < 8 && Q_GLYPH[gy - 1][gx - 1] === '#') return pal.edge;
    if (x === 1 || y === 1) return pal.hi;
    if (x === 14 || y === 14) return pal.lo;
    return body;
  });
}

function usedTile() {
  return paint(TILE, TILE, (x, y) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return '#3a1c08';
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return '#3a1c08';
    if (x === 1 || y === 1) return '#c08858';
    if (x === 14 || y === 14) return '#6a3a1a';
    return '#9a6236';
  });
}

// Pipe colour across its 32px width, giving a rounded, lit look.
function pipeShade(x, w) {
  const t = x / (w - 1);
  if (x === 0 || x === w - 1) return '#0a4a20';
  if (t < 0.12) return '#24a848';
  if (t < 0.3) return '#a8f8b0';
  if (t < 0.38) return '#5ce07a';
  if (t < 0.7) return '#2ec050';
  if (t < 0.85) return '#20a040';
  return '#137a34';
}

function pipeTiles() {
  const top = (half) => paint(TILE, TILE, (x, y) => {
    const gx = x + half * 16;
    if (y === 0 || y === 13) return '#0a4a20';
    if (y > 13) {
      const bx = gx - 2;
      if (bx < 0 || bx > 27) return null;
      return y === 14 ? '#0a4a20' : pipeShade(bx, 28);
    }
    if (y === 1) return gx === 0 || gx === 31 ? '#0a4a20' : '#c8ffd0';
    return pipeShade(gx, 32);
  });
  const body = (half) => paint(TILE, TILE, (x) => {
    const bx = x + half * 16 - 2;
    if (bx < 0 || bx > 27) return null;
    return pipeShade(bx, 28);
  });
  return [top(0), top(1), body(0), body(1)];
}

function coinFrames() {
  const widths = [5, 3, 1, 3];
  return widths.map((hw, f) => paint(TILE, TILE, (x, y) => {
    const cx = 7.5, cy = 7.5, ry = 6.5;
    const dx = (x - cx) / (hw + 0.5), dy = (y - cy) / ry;
    const d = dx * dx + dy * dy;
    if (d > 1) return null;
    if (d > 0.62) return f === 2 ? '#c88010' : '#a86808';
    if (hw > 1 && x < cx - hw * 0.3 && y < cy) return '#fff4b0';
    if (hw > 2 && Math.abs(x - cx) < 1 && Math.abs(y - cy) < 3.5) return '#c88010';
    return '#f8c830';
  }));
}

function poleTile(topBall) {
  return paint(TILE, TILE, (x, y) => {
    if (topBall) {
      const d = (x - 7.5) ** 2 + (y - 9.5) ** 2;
      if (d < 4) return '#e0ffe0';
      if (d < 13) return '#3ad04a';
      if (d < 20) return '#0e5a1a';
      return null;
    }
    if (x === 7) return '#c8ffc8';
    if (x === 8) return '#4ac850';
    if (x === 6 || x === 9) return '#0e5a1a';
    return null;
  });
}

// ---------------------------------------------------------------- backgrounds

function skyCanvas(cols) {
  // Banded gradient with 2x2 ordered dithering between bands: the classic 16-bit sky.
  const bands = cols.length - 1;
  const bayer = [[0, 2], [3, 1]];
  return paint(VIEW_W, VIEW_H, (x, y) => {
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

function mountains(theme) {
  const W = 512;
  if (theme === 'underground') {
    const h = ridge(11, W, [[3, 18], [7, 9], [17, 4]]);
    const rng = new RNG(5);
    const crystals = Array.from({ length: 14 }, () => ({ x: rng.int(0, W - 1), y: rng.int(70, 170), s: rng.int(2, 4) }));
    return paint(W, VIEW_H, (x, y) => {
      const top = 60 + h(x); // stalactites hang from the top
      const bottom = 150 + h(x + 97) * 0.8;
      for (const c of crystals) {
        const dx = Math.abs(x - c.x), dy = y - c.y;
        if (dy >= -c.s * 2 && dy <= c.s * 2 && dx <= c.s - Math.abs(dy) / 2) return dx === 0 ? '#d8ffff' : '#3ac8f0';
      }
      if (y < top) return y > top - 2 ? '#2a3a78' : '#141c40';
      if (y > bottom) return y < bottom + 2 ? '#2a3a78' : '#141c40';
      return null;
    });
  }
  const h = ridge(3, W, [[2, 22], [5, 12], [11, 5]]);
  return paint(W, VIEW_H, (x, y) => {
    const top = 100 - h(x);
    if (y < top) return null;
    const snow = top < 82 && y < top + (82 - top) * 0.6 + 2;
    const lit = h(x + 1) - h(x) > 0; // slope facing the light
    if (snow) return lit ? '#ffffff' : '#d8e0ff';
    if (y < top + 2) return '#c8d0ff';
    return lit ? '#a0aaf0' : '#8890e0';
  });
}

function hills(theme) {
  const W = 512;
  if (theme === 'underground') {
    const h = ridge(21, W, [[4, 14], [9, 7]]);
    return paint(W, VIEW_H, (x, y) => {
      const top = 160 - h(x);
      if (y < top) return null;
      if (y < top + 2) return '#3a4a90';
      return noise(x, y, 9) < 0.05 ? '#2e3c7a' : '#222c5e';
    });
  }
  const h = ridge(8, W, [[3, 20], [6, 10], [13, 3]]);
  return paint(W, VIEW_H, (x, y) => {
    const top = 150 - h(x);
    if (y < top) return null;
    if (y < top + 2) return '#a8f090';
    const dots = (x * 7 + y * 3) % 23 === 0 && y > top + 6;
    if (dots) return '#2a8a3a';
    const lit = h(x + 1) - h(x) > 0;
    return y < top + 8 && lit ? '#6cd060' : '#48b04c';
  });
}

function cloudsCanvas() {
  const W = 512;
  const rng = new RNG(42);
  const puffs = [];
  for (let i = 0; i < 6; i++) {
    const cx = i * 85 + rng.int(0, 40), cy = rng.int(30, 80), n = rng.int(3, 5);
    for (let j = 0; j < n; j++) puffs.push({ x: cx + j * 11 - n * 5, y: cy - (j % 2) * 5 - (j > 0 && j < n - 1 ? 4 : 0), r: rng.int(8, 12) });
  }
  const inside = (x, y, grow) => {
    for (const p of puffs) {
      for (const ox of [-W, 0, W]) {
        const dx = x - p.x - ox, dy = (y - p.y) * 1.25;
        if (dx * dx + dy * dy < (p.r + grow) ** 2) return p;
      }
    }
    return null;
  };
  return paint(W, 120, (x, y) => {
    const p = inside(x, y, 0);
    if (p) {
      const lower = inside(x, y - 3, 0) == null;
      return lower ? '#d0e4ff' : '#ffffff';
    }
    return inside(x, y, 1) ? '#9ab8f0' : null;
  });
}

// ---------------------------------------------------------------- decorations & set pieces

function bush(w) {
  const pw = w * 16;
  const rng = new RNG(w * 13);
  const balls = [];
  for (let i = 0; i < w * 2; i++) balls.push({ x: 6 + i * ((pw - 12) / Math.max(1, w * 2 - 1)), y: 10 - rng.int(0, 4), r: rng.int(6, 8) });
  return paint(pw, 16, (x, y) => {
    let hit = null;
    for (const b of balls) if ((x - b.x) ** 2 + (y - b.y) ** 2 < b.r * b.r) hit = b;
    if (!hit) {
      for (const b of balls) if ((x - b.x) ** 2 + (y - b.y) ** 2 < (b.r + 1) ** 2) return '#1a5a2a';
      return y >= 12 ? '#2a7a34' : null;
    }
    const dx = x - hit.x, dy = y - hit.y;
    if (dx < -1 && dy < -2 && dx * dx + dy * dy < hit.r * hit.r * 0.5) return '#9cf080';
    return dy > 2 ? '#2e9a3c' : '#4cc450';
  });
}

function fence(w) {
  return paint(w * 16, 16, (x, y) => {
    const post = x % 8 < 2;
    if (post && y >= 2) return x % 8 === 0 ? '#fff4e0' : '#c8a070';
    if ((y === 5 || y === 6 || y === 11 || y === 12)) return y % 6 === 5 ? '#fff4e0' : '#c8a070';
    return null;
  });
}

function flowers(w) {
  const rng = new RNG(w * 7 + 1);
  const fl = Array.from({ length: w * 3 }, (_, i) => ({ x: 3 + i * 5 + rng.int(0, 2), h: rng.int(5, 10), c: rng.pick(['#ff6a8a', '#ffd23a', '#ffffff', '#c080ff']) }));
  return paint(w * 16, 16, (x, y) => {
    for (const f of fl) {
      const top = 16 - f.h;
      if (Math.abs(x - f.x) <= 1 && Math.abs(y - top) <= 1 && !(x === f.x && y === top)) return f.c;
      if (x === f.x && y === top) return '#ffe080';
      if (x === f.x && y > top) return '#2e9a3c';
    }
    return y >= 14 && noise(x, y, 2) < 0.5 ? '#3aa830' : null;
  });
}

function crystal(w) {
  const rng = new RNG(w * 3 + 9);
  const cs = Array.from({ length: w + 1 }, (_, i) => ({ x: 4 + i * 12 + rng.int(-2, 2), h: rng.int(6, 14), hw: rng.int(2, 3) }));
  return paint(w * 16, 16, (x, y) => {
    for (const c of cs) {
      const top = 16 - c.h;
      if (y < top) continue;
      const span = Math.min(c.hw, (y - top) * 0.7);
      if (Math.abs(x - c.x) <= span) return x <= c.x ? (x === c.x ? '#e8ffff' : '#7ae8ff') : '#2a9ad0';
    }
    return null;
  });
}

function castle(th, brick) {
  // 5 tiles wide, 5 tall, drawn from the brick tile with battlements and a door.
  const c = mk(80, 80);
  const ctx = c.getContext('2d');
  const put = (tx, ty) => ctx.drawImage(brick, tx * 16, ty * 16);
  for (let ty = 2; ty < 5; ty++) for (let tx = 0; tx < 5; tx++) put(tx, ty);
  for (let tx = 1; tx < 4; tx++) put(tx, 1);
  for (let tx = 1; tx < 4; tx++) put(tx, 0);
  // Crenellations: knock out alternate squares on the top rows of each level.
  ctx.clearRect(16, 0, 48, 4);
  for (let i = 0; i < 3; i++) ctx.drawImage(brick, 0, 0, 16, 4, 16 + i * 16, 0, 8, 4);
  ctx.clearRect(0, 32, 16, 4); ctx.clearRect(64, 32, 16, 4);
  ctx.drawImage(brick, 0, 0, 8, 4, 0, 32, 8, 4);
  ctx.drawImage(brick, 0, 0, 8, 4, 64, 32, 8, 4);
  // Door and windows.
  ctx.fillStyle = '#100818';
  ctx.fillRect(32, 56, 16, 24);
  ctx.beginPath(); ctx.arc(40, 56, 8, Math.PI, 0); ctx.fill();
  ctx.fillRect(22, 12, 6, 10); ctx.fillRect(52, 12, 6, 10);
  ctx.fillStyle = th.brick.hi;
  ctx.fillRect(22, 11, 6, 1); ctx.fillRect(52, 11, 6, 1);
  return c;
}

function flagSprite() {
  return paint(16, 16, (x, y) => {
    // Pennant pointing left, attached at the pole on its right edge.
    const inTri = x >= Math.abs(y - 7) * 2 && y <= 14;
    if (!inTri) return null;
    if (x === Math.abs(y - 7) * 2 || y === 0 || y === 14) return '#1a3a1a';
    const d = (x - 10) ** 2 + (y - 7) ** 2;
    if (d < 6) return '#ff5a6e';
    return '#ffffff';
  });
}

function fireball() {
  return [0, 1, 2, 3].map((f) => paint(8, 8, (x, y) => {
    const d = (x - 3.5) ** 2 + (y - 3.5) ** 2;
    if (d > 12) return null;
    const a = Math.atan2(y - 3.5, x - 3.5) + f * Math.PI / 2;
    if (d < 3) return '#fff8c0';
    return Math.sin(a * 2) > 0 ? '#ffb020' : '#ff5a10';
  }));
}

// ---------------------------------------------------------------- assembly

export function buildArt() {
  const art = { themes: {} };
  for (const [name, th] of Object.entries(THEMES)) {
    const tiles = [];
    tiles[T.GROUND] = groundTile(th, false);
    tiles[T.BRICK] = brickTile(th);
    tiles[T.USED] = usedTile();
    tiles[T.BLOCK] = bevelTile(th.block, true);
    [tiles[T.PIPE_TL], tiles[T.PIPE_TR], tiles[T.PIPE_L], tiles[T.PIPE_R]] = pipeTiles();
    tiles[T.POLE] = poleTile(false);
    tiles[T.POLE_TOP] = poleTile(true);
    art.themes[name] = {
      tiles,
      groundTop: groundTile(th, true),
      question: ['#f8b830', '#ffd868', '#e8a020', '#f8b830'].map(questionTile),
      sky: skyCanvas(th.sky),
      mountains: mountains(name),
      hills: hills(name),
      clouds: name === 'overworld' ? cloudsCanvas() : null,
      castle: castle(th, tiles[T.BRICK]),
      blob: [sprite(BLOB, name === 'overworld' ? BLOB_PAL : BLOB_PAL_CAVE), sprite(BLOB2, name === 'overworld' ? BLOB_PAL : BLOB_PAL_CAVE)],
      blobFlat: sprite(BLOB_FLAT, name === 'overworld' ? BLOB_PAL : BLOB_PAL_CAVE),
      bug: [BUG, BUG2].map((r) => flipPair(sprite(r, name === 'overworld' ? BUG_PAL : BUG_PAL_CAVE))),
      shell: sprite(SHELL, name === 'overworld' ? BUG_PAL : BUG_PAL_CAVE),
      debris: brickDebris(tiles[T.BRICK]),
    };
  }
  art.coin = coinFrames();
  art.hero = heroFrames(HERO);
  art.heroFire = heroFrames(HERO_FIRE);
  art.berry = sprite(BERRY, { k: '#3a0a1a', R: '#ff3a5a', r: '#b81a3a', W: '#ffffff', l: '#3aa830', L: '#8ae070' });
  art.lifeBerry = sprite(BERRY, { k: '#0a2a10', R: '#4ad860', r: '#1e8a3a', W: '#ffffff', l: '#ffd23a', L: '#fff0a0' });
  art.bloom = sprite(BLOOM, { k: '#4a1a0a', O: '#ff6a1a', y: '#ffd23a', w: '#fff8d0', l: '#3aa830', L: '#8ae070' });
  art.flag = flagSprite();
  art.fireball = fireball();
  const decorCache = {};
  art.decor = (type, w) => {
    const k = type + w;
    if (!decorCache[k]) decorCache[k] = { bush, fence, flowers, crystal }[type](w);
    return decorCache[k];
  };
  return art;
}

// Bug art faces left; swap so .r faces right like every other sprite.
const flipPair = (s) => ({ r: s.l, l: s.r });

function brickDebris(brick) {
  const c = mk(8, 8);
  c.getContext('2d').drawImage(brick, 0, 0, 8, 8, 0, 0, 8, 8);
  return c;
}
