import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src');
const out = path.join(root, 'assets', 'render'); await fsp.mkdir(out, { recursive: true });
const stills = path.join(root, 'assets', 'stills'); await fsp.mkdir(stills, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.normalize(path.join(src, url === '/' ? 'scene-3d.html' : url));
  if (url.startsWith('/assets/')) file = path.normalize(path.join(root, url));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
});
await new Promise(resolve => server.listen(4197, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', error => console.error('PAGE', error));
page.on('console', message => { if (message.type() === 'error') console.error('CONSOLE', message.text()); });
await page.goto('http://127.0.0.1:4197/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.ready === true, { timeout: 60000 });
if (process.env.PROMO_3D_PREVIEW) {
  for (const [name, time] of [['wide', 2], ['price', 8], ['gather', 13.8], ['web', 17.7]]) {
    await page.evaluate(t => window.renderAt(t), time);
    await page.screenshot({ path: path.join(stills, `3d-${name}.png`) });
  }
} else {
  const target = path.join(out, '3d.mp4');
  const encoder = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', target], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let frame = 0; frame < 540; frame++) {
    const time = frame / 30; await page.evaluate(t => window.renderAt(t), time);
    const image = await page.screenshot({ type: 'png' });
    if (!encoder.stdin.write(image)) await once(encoder.stdin, 'drain');
    if (frame % 60 === 0) console.log(`3D ${frame}/540`);
  }
  encoder.stdin.end(); const [code] = await once(encoder, 'close'); if (code !== 0) throw new Error(`ffmpeg ${code}`);
}
await browser.close(); server.close();
