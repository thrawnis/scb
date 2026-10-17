// Small, fast, deterministic PRNG (mulberry32). Same seed => same sequence on every browser.
export class RNG {
  constructor(seed) { this.s = seed >>> 0; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // Integer in [lo, hi] inclusive.
  int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(entries) {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [v, w] of entries) { if ((r -= w) < 0) return v; }
    return entries[entries.length - 1][0];
  }
}

// FNV-1a hash, used to fingerprint generated levels so saves can detect generator changes.
export function hash32(arr) {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) { h ^= arr[i]; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
