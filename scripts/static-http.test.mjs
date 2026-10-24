import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {mkdtemp,mkdir,cp,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {gunzipSync} from 'node:zlib';

test('static HTTP gzip and ETags preserve bytes, revalidate changed content and keep APIs no-store',async t=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const temp=await mkdtemp(path.join(tmpdir(),'meal-static-http-'));
  let child;
  t.after(async()=>{if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}await rm(temp,{recursive:true,force:true});});
  await mkdir(path.join(temp,'data'));await mkdir(path.join(temp,'public'));
  for(const file of ['server.mjs','model-quota.mjs','remote-model-quota.mjs','wav-audio.mjs','booking-extraction.mjs','request-cache.mjs','meal-refine.mjs'])await cp(path.join(root,file),path.join(temp,file));
  for(const file of ['evidence.json','ranking.json','hotel_policy.json','hotel_meal_policies.json','hotel_breakfast_official.json','breakfast_spots.json','demo_hotel.json','cities.json'])await cp(path.join(root,'data',file),path.join(temp,'data',file));
  const fixtures={'index.html':'<!doctype html><title>中文首页</title>','style.css':'body { color: #123456; }','app.js':"export const title = '用餐计划一';",'icon.svg':'<svg xmlns="http://www.w3.org/2000/svg"><title>早餐</title></svg>','image.png':Buffer.from([137,80,78,71,13,10,26,10]),'hero.webp':Buffer.from('RIFF0000WEBP')};
  for(const [file,body] of Object.entries(fixtures))await writeFile(path.join(temp,'public',file),body);
  const socket=net.createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const request=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path:url,headers,method},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);});
    req.on('error',reject);req.setTimeout(2000,()=>req.destroy(new Error('HTTP timeout')));req.end();
  });
  let stderr='';
  child=spawn(process.execPath,['server.mjs'],{cwd:temp,env:{PATH:process.env.PATH,PORT:String(port),HOST:'127.0.0.1',REALTIME_AI_ENABLED:'0',REALTIME_QUERY_ENABLED:'0'},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
  let ready=false;
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('test server exited: '+stderr);try{ready=(await request('/api/cities')).status===200;if(ready)break;}catch{}await delay(20);}
  assert.equal(ready,true,'test server readiness');
  for(const file of ['index.html','style.css','app.js','icon.svg']){
    const response=await request('/'+file,{'Accept-Encoding':'gzip'});
    assert.equal(response.status,200);assert.equal(response.headers['content-encoding'],'gzip');
    assert.equal(response.headers.vary,'Accept-Encoding');assert.equal(response.headers['cache-control'],'no-cache');
    assert.equal(Number(response.headers['content-length']),response.body.length);
    assert.deepEqual(gunzipSync(response.body),Buffer.from(fixtures[file]));
  }
  const first=await request('/app.js',{'Accept-Encoding':'gzip'});
  const unchanged=await request('/app.js',{'Accept-Encoding':'gzip','If-None-Match':'"unrelated", W/'+first.headers.etag});
  assert.equal(unchanged.status,304);assert.equal(unchanged.body.length,0);assert.equal(unchanged.headers.vary,'Accept-Encoding');
  const changed=fixtures['app.js'].replace('计划一','计划二'); // Same byte length, so size/mtime alone are insufficient.
  await writeFile(path.join(temp,'public','app.js'),changed);
  const updated=await request('/app.js',{'Accept-Encoding':'gzip','If-None-Match':first.headers.etag});
  assert.equal(updated.status,200);assert.notEqual(updated.headers.etag,first.headers.etag);assert.deepEqual(gunzipSync(updated.body),Buffer.from(changed));
  assert.equal((await request('/app.js',{'Accept-Encoding':'gzip','If-None-Match':updated.headers.etag})).status,304);
  for(const encoding of ['gzip;q=0','*;q=1, gzip;q=0','br','gzip;q=invalid']){
    const response=await request('/app.js',{'Accept-Encoding':encoding});
    assert.equal(response.headers['content-encoding'],undefined);assert.equal(response.headers.vary,'Accept-Encoding');
    assert.deepEqual(response.body,Buffer.from(changed));assert.equal(Number(response.headers['content-length']),response.body.length);
  }
  assert.equal((await request('/app.js',{'Accept-Encoding':'*;q=1'})).headers['content-encoding'],'gzip');
  for(const file of ['image.png','hero.webp']){
    const response=await request('/'+file,{'Accept-Encoding':'gzip'});
    assert.equal(response.headers['content-encoding'],undefined);assert.deepEqual(response.body,fixtures[file]);
    assert.equal(Number(response.headers['content-length']),response.body.length);
  }
  assert.equal((await request('/hero.webp')).headers['content-type'],'image/webp');
  for(const [url,method] of [['/api/cities','GET'],['/api/quota','GET'],['/api/explain','POST']]){
    const response=await request(url,{'Accept-Encoding':'gzip','If-None-Match':'*'},method);
    assert.notEqual(response.status,304);assert.equal(response.headers['cache-control'],'no-store');
    assert.equal(response.headers.etag,undefined);assert.equal(response.headers['content-encoding'],undefined);
  }
  assert.equal((await request('/%2e%2e%2fserver.mjs')).status,404);
});
