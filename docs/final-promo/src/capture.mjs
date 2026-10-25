import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const raw = path.join(root, 'assets', 'raw');
const shots = path.join(root, 'assets', 'stills');
await fs.mkdir(raw, { recursive: true });
await fs.mkdir(shots, { recursive: true });
const baseURL = process.env.PROMO_BASE_URL || 'http://127.0.0.1:4173';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars'] });
const reportPath = path.join(root, 'assets', 'capture-report.json');
const report = process.env.CAPTURE_ONLY ? JSON.parse(await fs.readFile(reportPath, 'utf8')).filter(item => item.name !== process.env.CAPTURE_ONLY) : [];

async function hold(page, ms = 1800) { await page.waitForTimeout(ms); }
async function center(page, selector, offset = 120) {
  await page.locator(selector).evaluate((node, top) => window.scrollTo({ top: Math.max(0, node.getBoundingClientRect().top + scrollY - top), behavior: 'instant' }), offset);
  await hold(page, 500);
}
async function demo(page) {
  await page.locator('#tryDemo').click();
  await page.locator('#resultPane:not(.hidden) .meal-row').first().waitFor({ timeout: 30000 });
  await hold(page, 1800);
}
async function capture(name, fn, mobile = false) {
  if (process.env.CAPTURE_ONLY && process.env.CAPTURE_ONLY !== name) return;
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    recordVideo: { dir: raw, size: mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 } }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await hold(page, 900);
  const data = await fn(page, context);
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false });
  const video = page.video();
  await context.close();
  await video.saveAs(path.join(raw, `${name}.webm`));
  report.push({ name, mobile, errors, ...data });
  console.log(`captured ${name}`);
}

await capture('01-home', async page => {
  await center(page, '#quickStart', 100);
  await hold(page, 2500);
});

await capture('02-input', async page => {
  await center(page, '#quickStart', 100);
  await page.locator('#tripVoiceText').fill('周六去杭州住两晚，两位成人。想用一次酒店早餐，另一天尝尝当地味道。');
  await hold(page, 1400);
  await page.locator('#showExample').click();
  await hold(page, 1800);
  await page.locator('#showExample').click();
  await center(page, '#quickStart', 100);
  await hold(page, 800);
});

await capture('03-quotes', async page => {
  await demo(page);
  await page.locator('.journey-step[data-pane="preferences"]').click();
  await center(page, '.quote-comparison-panel', 110);
  await hold(page, 3200);
  return await page.locator('.quote-comparison-panel').evaluate(node => ({ demoNotice: document.querySelector('#demoNotice')?.textContent, prices: [document.querySelector('#roomOnly')?.value, document.querySelector('#roomWith')?.value], dates: [document.querySelector('#checkIn')?.value, document.querySelector('#checkOut')?.value] }));
});

await capture('04-breakfast', async page => {
  await demo(page);
  await center(page, '#planDecision', 90);
  await hold(page, 1300);
  const active = page.locator('[data-breakfast-date][aria-pressed="true"]').first();
  await active.click();
  await hold(page, 3200);
  return await page.locator('#breakfastComparison').evaluate(node => ({ text: node.innerText, dates: [...node.querySelectorAll('[data-breakfast-date]')].map(x => [x.dataset.breakfastDate, x.getAttribute('aria-pressed')]) }));
});

await capture('05-package', async page => {
  await demo(page);
  await center(page, '.mw-package-comparison', 100);
  await hold(page, 3500);
  return { text: await page.locator('.mw-package-comparison').innerText() };
});

await capture('06-nearby', async page => {
  await demo(page);
  await center(page, '#nearbySection', 85);
  await hold(page, 1300);
  await page.locator('#expandMap').click();
  await hold(page, 1500);
  const first = page.locator('#mapPlaceChoices button').first();
  if (await first.count()) await first.click();
  await hold(page, 2500);
  return { text: (await page.locator('#nearbySection').innerText()).slice(0, 8000) };
});

await capture('07-refine', async page => {
  await demo(page);
  await center(page, '.plan-refine', 160);
  const options = await page.locator('#mealRefineTarget option').all();
  let value = '';
  for (const option of options) {
    const text = await option.textContent();
    const candidate = await option.getAttribute('value');
    if (candidate && /午餐|晚餐/.test(text || '') && !text?.includes('已锁定')) { value = candidate; break; }
  }
  if (!value) value = await options[1]?.getAttribute('value') || '';
  await page.locator('#mealRefineTarget').selectOption(value);
  await page.locator('#refineText').fill('这顿少走一点路，想吃当地味');
  await hold(page, 1000);
  await page.locator('#refinePlan').click();
  await Promise.race([
    page.locator('#mealWorkspaceDialog[open]').waitFor({ timeout: 30000 }),
    page.locator('#refineStatus').filter({ hasText: /不可用|失败|未配置|无法|保留|重新请求/ }).waitFor({ timeout: 30000 })
  ]).catch(() => {});
  await hold(page, 3000);
  return { livePreview: await page.locator('#mealWorkspaceDialog[open]').count() > 0, status: await page.locator('#refineStatus').innerText() };
});

await capture('07-manual-preview', async page => {
  await demo(page);
  const row = page.locator('.meal-row').filter({ hasText: /午餐/ }).first();
  const targetKey = await row.getAttribute('data-meal-key');
  const keys = await page.locator('.meal-row').evaluateAll(nodes => nodes.map(node => node.dataset.mealKey));
  for (const key of keys) {
    if (key === targetKey) continue;
    await page.locator(`.meal-row[data-meal-key="${key}"] [data-action="lock"]`).click();
  }
  await center(page, '.plan-refine', 150);
  await row.locator('[data-action="replace"]').click();
  await hold(page, 900);
  const select = page.locator('#mealReplaceCandidate');
  const values = await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
  const current = await select.inputValue();
  const alternative = values.find(value => value !== current);
  if (alternative) await select.selectOption(alternative);
  await hold(page, 800);
  await page.locator('#mealReplacePreview').click();
  await hold(page, 3000);
  return { manualPreview: await page.locator('#mealWorkspaceDialog[open]').count() > 0 };
});

await capture('08-mobile', async page => {
  await demo(page);
  await center(page, '#breakfastComparison', 70);
  const active = page.locator('[data-breakfast-date][aria-pressed="true"]').first();
  await active.click();
  await hold(page, 2500);
  await center(page, '.break-even', 220);
  await hold(page, 2000);
  return { viewport: await page.evaluate(() => [innerWidth, innerHeight]), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) };
}, true);

await capture('09-share', async page => {
  await demo(page);
  await center(page, '#planSection > .section-heading', 100);
  await page.getByRole('button', { name: '分享只读方案' }).click();
  await hold(page, 2600);
  const preview = await page.locator('.share-preview-summary').innerText();
  await page.locator('.share-dialog .primary').click();
  await hold(page, 1400);
  const url = await page.locator('.share-dialog textarea').inputValue();
  await page.goto(url, { waitUntil: 'networkidle' });
  await hold(page, 2800);
  return { preview, sharedText: (await page.locator('#sharedPlan').innerText()).slice(0, 5000) };
});

await capture('10-discover', async page => {
  await page.locator('#discoverNav').click();
  await center(page, '#cityFoodSection', 80);
  await hold(page, 3000);
});

await fs.writeFile(path.join(root, 'assets', 'capture-report.json'), JSON.stringify(report, null, 2));
await browser.close();
