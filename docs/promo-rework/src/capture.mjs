import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const raw = path.join(root, 'assets', 'raw');
const stills = path.join(root, 'assets', 'stills');
await fs.mkdir(raw, { recursive: true });
await fs.mkdir(stills, { recursive: true });
const baseURL = process.env.PROMO_BASE_URL || 'http://127.0.0.1:4186';
const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars'] });
const report = [];
const hold = (page, ms = 1400) => page.waitForTimeout(ms);

async function prepare(page) {
  page.on('pageerror', error => { throw error; });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: `.promo-pointer{position:fixed;z-index:2147483647;width:18px;height:18px;border:3px solid #b65335;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 0 0 5px #f7f2e855;transition:width .12s,height .12s}.promo-pointer.down{width:30px;height:30px;background:#b6533533}` });
  await page.evaluate(() => {
    const dot = document.createElement('div'); dot.className = 'promo-pointer'; dot.style.left = '-40px'; dot.style.top = '-40px'; document.body.append(dot);
    addEventListener('pointermove', event => { dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`; });
    addEventListener('pointerdown', () => dot.classList.add('down')); addEventListener('pointerup', () => dot.classList.remove('down'));
  });
  await hold(page, 900);
}
async function center(page, selector, offset = 100) {
  await page.locator(selector).evaluate((node, top) => scrollTo({ top: Math.max(0, node.getBoundingClientRect().top + scrollY - top), behavior: 'instant' }), offset);
  await hold(page, 450);
}
async function demo(page) {
  await page.locator('#tryDemo').click();
  await page.locator('#resultPane:not(.hidden) .meal-row').first().waitFor({ timeout: 30000 });
  await hold(page, 1400);
}
async function capture(name, fn, mobile = false) {
  if (process.env.CAPTURE_ONLY && process.env.CAPTURE_ONLY !== name) return;
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce', recordVideo: { dir: raw, size: mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 } } });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const data = await fn(page, context);
  await page.screenshot({ path: path.join(stills, `${name}.png`) });
  const video = page.video(); await context.close(); await video.saveAs(path.join(raw, `${name}.webm`));
  report.push({ name, mobile, errors, ...data }); console.log(`captured ${name}`);
}

await capture('01-input', async page => {
  await center(page, '#quickStart', 80);
  await page.screenshot({ path: path.join(stills, 'home-texture.png') });
  await hold(page, 1000);
  await page.locator('#tripVoiceText').click();
  await page.locator('#tripVoiceText').pressSequentially('杭州住两晚，两位成人。一天酒店早餐，一天尝尝当地味道。', { delay: 35 });
  await hold(page, 1300);
  await page.locator('#showExample').click(); await hold(page, 2300);
  return { entries: await page.locator('#tripVoiceText').inputValue(), exampleVisible: await page.locator('#examplePanel').isVisible() };
});

await capture('02-quotes', async page => {
  await demo(page); await page.locator('.journey-step[data-pane="preferences"]').click();
  await center(page, '.quote-comparison-panel', 80); await hold(page, 1800);
  await page.locator('[data-quote-slot="A"] summary').click(); await hold(page, 1000);
  await page.locator('[data-quote-slot="B"] summary').first().click(); await hold(page, 1800);
  return await page.locator('.quote-comparison-panel').evaluate(node => ({ prices: [document.querySelector('#roomOnly').value, document.querySelector('#roomWith').value], comparable: document.querySelector('#comparable').checked, text: node.innerText.slice(0, 3000) }));
});

await capture('03-breakfast', async page => {
  await demo(page); await center(page, '#planDecision', 70); await hold(page, 1700);
  const active = page.locator('[data-breakfast-date][aria-pressed="true"]').first(); await active.click(); await hold(page, 4000);
  return await page.locator('#breakfastComparison').evaluate(node => ({ text: node.innerText, dates: [...node.querySelectorAll('[data-breakfast-date]')].map(x => [x.dataset.breakfastDate, x.getAttribute('aria-pressed')]) }));
});

await capture('04-package', async page => {
  await demo(page); await center(page, '.mw-package-comparison', 70); await hold(page, 5500);
  return { text: await page.locator('.mw-package-comparison').innerText() };
});

await capture('05-discover', async page => {
  await page.locator('#discoverNav').click(); await center(page, '#cityFoodSection', 65); await hold(page, 2200);
  await page.locator('[data-mode="main"]').click(); await hold(page, 2500);
  return { credit: await page.locator('.local-food-photo figcaption').innerText(), cards: await page.locator('#cityFoodResults article').count() };
});

await capture('06-nearby', async page => {
  await demo(page); await center(page, '#nearbySection', 60); await hold(page, 1600);
  await page.locator('#expandMap').click(); await hold(page, 1000);
  const choice = page.locator('#mapPlaceChoices button').first(); if (await choice.count()) await choice.click();
  await hold(page, 3800);
  return { text: (await page.locator('#nearbySection').innerText()).slice(0, 6000) };
});

await capture('07-manual', async page => {
  await demo(page);
  const row = page.locator('.meal-row').filter({ hasText: /午餐/ }).first(); const targetKey = await row.getAttribute('data-meal-key');
  const before = await page.locator('.meal-row').evaluateAll(nodes => nodes.map(node => ({ key: node.dataset.mealKey, text: node.querySelector('.mw-meal-title strong')?.textContent })));
  for (const item of before) {
    if (item.key === targetKey) continue;
    const button = page.locator(`.meal-row[data-meal-key="${item.key}"] [data-action="lock"]`);
    if (await button.count() && (await button.innerText()) === '锁定这顿') await button.click();
  }
  await center(page, '.plan-refine', 100); await hold(page, 900);
  await row.locator('[data-action="replace"]').click(); await hold(page, 1000);
  const select = page.locator('#mealReplaceCandidate'); const current = await select.inputValue();
  const alternative = (await select.locator('option').evaluateAll(nodes => nodes.map(node => node.value))).find(value => value !== current);
  await select.selectOption(alternative); await hold(page, 1200); await page.locator('#mealReplacePreview').click(); await hold(page, 3300);
  const diff = await page.locator('#mealWorkspaceDialog').innerText();
  await page.locator('#mealPreviewApply').click(); await hold(page, 2600);
  const after = await page.locator('.meal-row').evaluateAll(nodes => nodes.map(node => ({ key: node.dataset.mealKey, text: node.querySelector('.mw-meal-title strong')?.textContent, locked: node.innerText.includes('已锁定') })));
  return { targetKey, before, after, diff, changed: after.filter((item, index) => item.text !== before[index]?.text).map(item => item.key) };
});

await capture('08-mobile', async page => {
  await demo(page); await center(page, '#breakfastComparison', 65);
  await page.locator('[data-breakfast-date][aria-pressed="true"]').first().click(); await hold(page, 2100);
  await center(page, '.break-even', 180); await hold(page, 3000);
  return { viewport: await page.evaluate(() => [innerWidth, innerHeight]), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), text: await page.locator('.break-even').innerText() };
}, true);

let shareURL = '';
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage(); await prepare(page); await demo(page);
  await page.getByRole('button', { name: '分享只读方案' }).click(); await page.locator('.share-dialog .primary').click(); shareURL = await page.locator('.share-dialog textarea').inputValue(); await context.close();
}
await capture('09-share', async page => {
  await demo(page); await center(page, '#planSection > .section-heading', 70);
  await page.getByRole('button', { name: '分享只读方案' }).click(); await hold(page, 3000);
  const preview = await page.locator('.share-preview-summary').innerText();
  await page.goto(shareURL, { waitUntil: 'networkidle' }); await hold(page, 3300);
  return { preview, sharedText: (await page.locator('#sharedPlan').innerText()).slice(0, 5000), localUrlVisible: (await page.locator('body').innerText()).includes('127.0.0.1') };
});

await fs.writeFile(path.join(root, 'assets', 'capture-report.json'), JSON.stringify(report, null, 2));
await browser.close();
