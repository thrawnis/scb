// Save in one browser context, load by code in a fresh one (simulates another device).
const pw = await import(process.env.PW || 'playwright'); const { chromium } = pw.default || pw;
const out = process.argv[2] || '.';
const url = (process.env.URL || 'http://localhost:8080/') + '#debug';
const browser = await chromium.launch();
const errors = [];
const fail = (m) => { console.log('FAIL: ' + m); process.exitCode = 1; };

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 700 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForTimeout(300);
  return page;
}

const a = await newPage();
await a.click('text=New Game');
await a.waitForTimeout(2800);
await a.keyboard.down('ArrowRight');
await a.waitForTimeout(1000);
await a.keyboard.up('ArrowRight');
await a.waitForTimeout(400);
// Break something deterministic so the tile diff is non-empty.
await a.evaluate(() => { const g = window.scb.game; g.world.set(20, 8, 0); g.score = 1234; g.enemies = g.enemies.filter((e) => e.x > 600); });
await a.keyboard.press('Escape');
await a.waitForTimeout(200);
await a.click('text=Save Game');
await a.click('.slot >> nth=0');
await a.waitForSelector('.savecode strong');
const code = await a.textContent('.savecode strong');
await a.screenshot({ path: `${out}/04-saved.png` });
const before = await a.evaluate(() => { const g = window.scb.game; return { x: g.player.x, y: g.player.y, score: g.score, tile: g.world.tile(20, 8), enemies: g.enemies.length, time: g.time }; });
console.log('saved code', code, JSON.stringify(before));

const b = await newPage();
await b.click('text=Load Game');
await b.fill('.code input', code.toLowerCase());
await b.click('.code button');
await b.waitForSelector('text=Save found');
await b.click('.slot >> nth=1');
await b.waitForTimeout(100);
const after = await b.evaluate(() => { const g = window.scb.game; return { state: g.state, x: g.player.x, y: g.player.y, score: g.score, tile: g.world.tile(20, 8), enemies: g.enemies.length, time: g.time, open: window.scb.ui.isOpen }; });
console.log('loaded', JSON.stringify(after));
if (after.state !== 'play' || after.open) fail('not playing after load');
if (Math.abs(after.x - before.x) > 16 || after.score !== before.score || after.tile !== 0) fail('state mismatch');
await b.waitForTimeout(500);
await b.screenshot({ path: `${out}/05-loaded.png` });

// Slot 2 in browser B is now linked to the code; local load should work too.
await b.keyboard.press('Escape');
await b.waitForTimeout(200);
await b.screenshot({ path: `${out}/06-pause.png` });
console.log('after esc', await b.evaluate(() => JSON.stringify({ s: window.scb.game.state, open: window.scb.ui.isOpen, en: window.scb.input.enabled, focus: document.activeElement?.tagName })));
await b.click('text=Load Game');
const slots = await b.$$eval('.slot', (els) => els.map((e) => e.textContent));
console.log('slots in B:', slots);
if (!slots[1].includes(code)) fail('imported slot not linked to code');

// Bad code is handled.
await b.click('text=Back');
await b.click('text=Load Game');
await b.fill('.code input', 'ZZZZ-ZZZZ');
await b.click('.code button');
await b.waitForTimeout(500);
console.log('bad code msg:', await b.textContent('.error'));
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
