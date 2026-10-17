// Unit-style checks of core mechanics using the real game code (no browser needed).
import { Game } from '../web/js/game.js';
import { T, TILE } from '../web/js/config.js';
import { Enemy } from '../web/js/entities.js';

const canvas = { getContext: () => ({}) };
const audio = { sfx() {}, music() {} };
let failures = 0;
const check = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) failures++; };

function setup() {
  const keys = {}, prev = {};
  const input = { keys, held: (b) => !!keys[b], pressed: (b) => !!keys[b] && !prev[b], step() { Object.assign(prev, keys); } };
  const g = new Game(canvas, {}, audio, input);
  g.score = 0; g.coins = 0; g.lives = 3;
  g.loadLevel(0);
  g.startPlay();
  g.enemies = [];
  const run = (n) => { for (let i = 0; i < n; i++) { g.update(); input.step(); } };
  return { g, input, run };
}

// Power-up from a question block.
{
  const { g, run } = setup();
  const idx = Object.keys(g.world.contents).map(Number).find((i) => g.world.contents[i] === 'power');
  const tx = idx % g.world.w, ty = Math.floor(idx / g.world.w);
  g.player.x = tx * TILE + 2; g.player.y = (ty + 1) * TILE + 2; g.player.vy = -3;
  run(1);
  check('bumping power block spawns a combadge', g.items.length === 1 && g.items[0].kind === 'badge');
  check('block becomes used', g.world.tile(tx, ty) === T.USED);
  run(40);
  const it = g.items[0];
  g.player.x = it.x; g.player.y = it.y + it.h - g.player.h; g.player.vy = 0;
  run(1);
  check('collecting combadge makes player big', g.player.size === 1 && g.player.h === 28);
  run(40);
  // Big player breaks bricks.
  const bi = g.world.tiles.findIndex((t, i) => t === T.BRICK && !g.world.contents[i] && Math.floor(i / g.world.w) > 3);
  const bx = bi % g.world.w, by = Math.floor(bi / g.world.w);
  g.player.x = bx * TILE + 2; g.player.y = (by + 1) * TILE + 1; g.player.vy = -3;
  run(1);
  check('big player breaks a brick', g.world.tile(bx, by) === T.EMPTY);
}

// Phaser form fires straight shots that knock out enemies.
{
  const { g, run } = setup();
  const p = g.player;
  run(5);
  p.setSize(2);
  run(5);
  const e = new Enemy('walker', p.x + 80, 11 * TILE); e.vx = 0;
  g.enemies.push(e);
  g.input.keys.run = true;
  run(1);
  g.input.keys.run = false;
  check('phaser form fires a shot', g.shots.length === 1 && g.shots[0].vy === 0);
  run(30);
  check('phaser shot knocks out an enemy', e.state === 'dead' || !g.enemies.includes(e));
}

// Older saves with fruit item names still load.
{
  const { Item } = await import('../web/js/entities.js');
  check('legacy item names map to new items', Item.restore({ k: 'bloom', x: 0, y: 0 }).kind === 'phaser' && Item.restore({ k: 'life', x: 0, y: 0 }).kind === 'tea');
}

// Stomp a walker, get hurt by one.
{
  const { g, run } = setup();
  const p = g.player;
  run(5);
  const e = new Enemy('walker', p.x + 20, (11) * TILE);
  e.vx = 0;
  g.enemies.push(e);
  run(5);
  p.x = e.x; p.y = e.y - 30; p.vy = 3;
  run(6);
  check('stomping a walker flattens it', e.state === 'flat' && g.score >= 100);
  run(40);
  check('flattened walker is removed', !g.enemies.includes(e));
  const e2 = new Enemy('walker', p.x + 40, 11 * TILE);
  g.enemies.push(e2);
  run(80);
  check('touching a walker kills small player', g.state === 'dying');
}

// Shell: stomp, kick, it knocks out another enemy.
{
  const { g, run } = setup();
  const p = g.player;
  run(5);
  const s = new Enemy('shell', p.x + 30, 11 * TILE); s.vx = 0;
  const victim = new Enemy('walker', p.x + 120, 11 * TILE); victim.vx = 0;
  g.enemies.push(s, victim);
  run(3);
  p.x = s.x; p.y = s.y - 30; p.vy = 3;
  run(6);
  check('stomping shell enemy leaves a shell', s.state === 'shell');
  run(30);
  p.x = s.x - p.w - 1; p.y = s.y + s.h - p.h; p.vx = 1; p.inv = 0;
  g.input.keys.right = true;
  run(3);
  g.input.keys.right = false;
  check('touching a shell kicks it', s.state === 'slide' && s.vx > 0);
  run(60);
  check('sliding shell knocks out other enemies', victim.state === 'dead' || !g.enemies.includes(victim));
}

// Save -> restore round trip reproduces the same state.
{
  const { g, run } = setup();
  g.loadLevel(0); g.startPlay();
  g.input.keys.right = true; g.input.keys.run = true;
  run(200);
  g.input.keys.right = false; g.input.keys.run = false;
  const a = JSON.stringify(g.serialize());
  const { g: g2 } = setup();
  g2.restore(JSON.parse(a));
  const b = JSON.stringify(g2.serialize());
  check('save/restore round trip is exact', a === b);
  const tampered = JSON.parse(a); tampered.fp = 123;
  check('save from changed levels restarts the level', g2.restore(tampered) === 'restart' && g2.state === 'intro');
  let threw = false;
  try { g2.restore({ v: 99 }); } catch { threw = true; }
  check('incompatible save is rejected', threw);
}

// Determinism: levels are identical every time they are generated.
{
  const { generateLevel } = await import('../web/js/levelgen.js');
  check('level generation is deterministic', generateLevel(0).fingerprint === generateLevel(0).fingerprint && generateLevel(1).fingerprint === generateLevel(1).fingerprint);
}

process.exit(failures ? 1 : 0);
