import { generateLevel } from '../web/js/levelgen.js';
const ch = ['.', '#', 'B', '?', 'u', 'X', '[', ']', '|', '|', 'o', '!', '^'];
for (const i of [0, 1]) {
  const L = generateLevel(i);
  const grid = [];
  for (let y = 0; y < L.height; y++) {
    let row = '';
    for (let x = 0; x < L.width; x++) row += ch[L.tiles[y * L.width + x]];
    grid.push(row.split(''));
  }
  for (const e of L.entities) grid[e.y / 16][e.x / 16] = e.type === 'walker' ? 'w' : 's';
  console.log(`Level ${L.name} width=${L.width} fp=${L.fingerprint} enemies=${L.entities.length} contents=${JSON.stringify(Object.values(L.contents).reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {}))}`);
  for (let s = 0; s < L.width; s += 110) console.log(grid.map((r) => r.slice(s, s + 110).join('')).join('\n') + '\n');
}
