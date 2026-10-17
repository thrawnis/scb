export const TILE = 16;
export const VIEW_W = 256; // SNES resolution
export const VIEW_H = 224;
export const ROWS = 14;
export const FPS = 60;

// Bump when level generation changes in a way that alters existing levels.
// Saves made with another version reload at the start of their level instead of mid-level.
export const GEN_VERSION = 1;

// Fixed seeds: every player gets exactly the same levels.
export const LEVELS = [
  { name: '1-1', title: 'Sunny Meadows', theme: 'overworld', seed: 0x5cb00001, width: 210, difficulty: 0.35, time: 400 },
  { name: '1-2', title: 'Crystal Caverns', theme: 'underground', seed: 0x5cb00002, width: 200, difficulty: 0.7, time: 400 },
];

export const T = {
  EMPTY: 0, GROUND: 1, BRICK: 2, QUESTION: 3, USED: 4, BLOCK: 5,
  PIPE_TL: 6, PIPE_TR: 7, PIPE_L: 8, PIPE_R: 9,
  COIN: 10, POLE: 11, POLE_TOP: 12,
};

const SOLID = new Uint8Array(16);
for (const t of [T.GROUND, T.BRICK, T.QUESTION, T.USED, T.BLOCK, T.PIPE_TL, T.PIPE_TR, T.PIPE_L, T.PIPE_R]) SOLID[t] = 1;
export const isSolidTile = (t) => SOLID[t] === 1;
