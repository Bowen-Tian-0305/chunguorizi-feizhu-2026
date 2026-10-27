import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright')); }
catch { ({chromium}=require('../../promo-rework/src/node_modules/playwright')); }
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const arg=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback};
const start=Number(arg('--start','0')),end=Number(arg('--end','72'));
const output=path.resolve(root,arg('--output','../picture-draft.mp4'));
const stills=args.includes('--stills');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--hide-scrollbars','--force-color-profile=srgb']});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
page.on('pageerror',e=>{throw e});
await page.goto('file://'+path.join(root,'index.html'));
await page.evaluate(()=>window.ready);
if(stills){
  const dir=path.resolve(root,'../assets/frames');await fs.mkdir(dir,{recursive:true});
  for(const file of await fs.readdir(dir))if(/^t-\d+\.\d\.png$/.test(file))await fs.unlink(path.join(dir,file));
  const times=[0,1.2,2.4,3.5,4.8,5.5,6.8,7.2,9.2,10.8,14,14.4,18,21.2,21.6,24,28.4,28.8,32.4,35.6,36,40.8,45.2,45.6,50.4,54.8,55.2,57.6,59.6,60,63.6,66.8,67.2,69.6,71.6];
  for(const t of times){await page.evaluate(t=>window.render(t),t);await page.screenshot({path:path.join(dir,`t-${t.toFixed(1).padStart(4,'0')}.png`)});console.log(`still ${t}`)}
}else{
  await fs.mkdir(path.dirname(output),{recursive:true});
  const ff=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','30','-i','pipe:0','-an','-c:v','libx264','-preset',arg('--preset','medium'),'-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['pipe','inherit','inherit']});
  const done=new Promise((resolve,reject)=>{ff.on('close',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}`)))});
  const frames=Math.round((end-start)*30);
  for(let i=0;i<frames;i++){
    const t=start+i/30;await page.evaluate(t=>window.render(t),t);
    const buf=await page.screenshot({type:'jpeg',quality:95});
    if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));
    if(i%30===0)console.log(`${t.toFixed(1)}s / ${end}s`);
  }
  ff.stdin.end();await done;console.log(output);
}
await browser.close();
