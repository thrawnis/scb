// Headless playthrough: runs the real game logic in Node with a simple bot.
// The bot holds right and jumps at walls and pits; when it dies it rewinds to an earlier
// snapshot (using the game's own save/restore) and retries with different jump timing.
// Enemies are removed, so this verifies that the terrain of every level is beatable.
import { Game } from '../web/js/game.js';
import { LEVELS, TILE } from '../web/js/config.js';
import { RNG } from '../web/js/rng.js';

const canvas = { getContext: () => ({}) };
const audio = { sfx() {}, music() {} };
let ok = true;

for (let li = 0; li < LEVELS.length; li++) {
  const keys = {};
  const prev = {};
  const input = { held: (b) => !!keys[b], pressed: (b) => !!keys[b] && !prev[b] };
  const game = new Game(canvas, {}, audio, input);
  game.score = 0; game.coins = 0; game.lives = 99;
  game.loadLevel(li);
  game.enemies = [];
  game.startPlay();
  const w = game.world;
  const rng = new RNG(li + 1);
  const snap = () => JSON.parse(JSON.stringify(game.serialize()));
  const snaps = [snap()];
  let frames = 0, deaths = 0, jumpHold = 0, backoff = 0, stuck = 0, bestX = 0;
  let pol = { pitHold: 40, wallHold: 14, lead: 10, run: true };
  let cleared = false;
  while (frames < 60 * 600 && deaths < 400) {
    frames++;
    const p = game.player;
    Object.assign(prev, keys);
    for (const k in keys) keys[k] = false;
    if (game.state === 'play') {
      if (p.onGround && frames % 20 === 0) { snaps.push(snap()); if (snaps.length > 30) snaps.shift(); }
      const ahead = p.x + p.w + 2;
      const footY = Math.floor((p.y + p.h + 1) / TILE);
      const rows = [Math.floor(p.y / TILE), Math.floor((p.y + p.h - 1) / TILE)];
      const wall = rows.some((ty) => w.solid(Math.floor((ahead + 6) / TILE), ty));
      let pit = true;
      for (let ty = footY; ty < w.h; ty++) if (w.solid(Math.floor((ahead + pol.lead) / TILE), ty)) pit = false;
      if (backoff > 0) { keys.left = true; backoff--; } else { keys.right = true; keys.run = pol.run; }
      if (p.onGround && (wall || pit) && backoff === 0) jumpHold = pit ? pol.pitHold : pol.wallHold;
      if (jumpHold > 0) { keys.jump = true; jumpHold--; }
      if (p.x > bestX + 1) { bestX = p.x; stuck = 0; } else if (++stuck > 90) { backoff = 20 + rng.int(0, 30); stuck = 0; }
    }
    game.update();
    if (game.state === 'dying') {
      deaths++;
      // Rewind further back the more often we die, and try a different jump style.
      const back = Math.min(snaps.length, 1 + rng.int(0, Math.min(6, Math.floor(deaths / 3))));
      const snap = snaps[snaps.length - back];
      snaps.length = Math.max(1, snaps.length - (back - 1));
      game.lives = 99;
      game.restore(snap);
      game.enemies = [];
      pol = { pitHold: rng.int(6, 40), wallHold: rng.int(6, 30), lead: rng.int(0, 24), run: rng.chance(0.7) };
      jumpHold = 0; backoff = rng.chance(0.3) ? rng.int(5, 40) : 0;
      continue;
    }
    if (game.state === 'tally') { cleared = true; break; }
  }
  const name = LEVELS[li].name;
  if (cleared) console.log(`level ${name}: cleared after ${(frames / 60).toFixed(0)}s of play, ${deaths} rewinds`);
  else { console.log(`level ${name}: NOT cleared, furthest x=${(bestX / TILE).toFixed(1)} tiles of ${w.w}`); ok = false; }
}
process.exit(ok ? 0 : 1);
