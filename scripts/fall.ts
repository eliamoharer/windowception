import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,720'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('http://127.0.0.1:5173/?debug=1&seed=1', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => (window as any).__warp?.(1500));

const fells = () => page.evaluate(() => (window as any).__fells ?? 0);

console.log('hold D 6s -> expect at least one fall');
await page.keyboard.down('d');
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const st = await page.evaluate(() => (window as any).__state);
  if (i % 3 === 0) console.log(`  t=${(i * 0.5).toFixed(1)}s`, JSON.stringify(st), 'fells', await fells());
}
await page.keyboard.up('d');
console.log('fells after hold:', await fells());

console.log('\nhands-off 6s -> expect no further falls');
const before = await fells();
for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 1000));
console.log('fells delta while idle:', (await fells()) - before);
console.log('errors:', errs.length ? errs.join(';') : 'none');
await browser.close();
