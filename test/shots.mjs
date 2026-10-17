// Screenshots of specific scenes via the #debug handle.
const pw = await import(process.env.PW || 'playwright'); const { chromium } = pw.default || pw;
const out = process.argv[2] || '.';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 768, height: 672 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto((process.env.URL || 'http://localhost:8080/') + '#debug');
await page.waitForTimeout(300);
await page.click('text=New Game');
const scene = async (name, fn, wait = 300) => {
  await page.evaluate(fn);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
};
await scene('10-big', () => { const g = window.scb.game; g.startPlay(); g.player.setSize(1); g.player.x = 230; });
await scene('11-fire-items', () => {
  const g = window.scb.game; g.player.setSize(2);
  g.bumpBlock(17, 8); g.particles.push({ kind: 'text', text: '1000', x: 200, y: 120, t: 0 });
}, 1200);
await scene('12-end', () => { const g = window.scb.game; g.player.x = (g.level.flagX - 6) * 16; g.player.y = 64; g.enemies = []; }, 800);
await scene('13-castle', () => { const g = window.scb.game; g.player.x = (g.level.flagX + 2) * 16; g.player.y = 150; }, 900);
await scene('14-cave', () => { const g = window.scb.game; g.loadLevel(1, 1); g.startPlay(); g.player.x = 60 * 16; g.player.y = 100; }, 900);
await scene('15-cave-end', () => { const g = window.scb.game; g.player.x = (g.level.flagX - 8) * 16; g.player.y = 40; g.enemies = []; }, 900);
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
