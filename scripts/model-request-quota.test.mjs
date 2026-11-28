import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lP8AAAAASUVORK5CYII=';
const wav = Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000', 'hex');
const valid = {
  transcribe: {audio: 'data:audio/wav;base64,' + wav.toString('base64')},
  understand: {text:'杭州住两晚，两位成人。'},
  extract: {image},
  explain: {nights:2}
};

async function startServer(t, key) {
  const temp = await mkdtemp(path.join(tmpdir(), 'meal-request-quota-'));
  const preload = path.join(temp, 'upstream.mjs');
  const ledger = path.join(temp, 'quota.json');
  await writeFile(ledger, JSON.stringify({day:0,salt:'1'.repeat(64),total:0,clients:{}}));
  await writeFile(preload, `
    globalThis.fetch = async () => Response.json({message:'test upstream unavailable'}, {status:502});
  `);
  const socket = net.createServer().listen(0, '127.0.0.1');
  await once(socket,'listening');
  const {port} = socket.address();
  await new Promise(resolve=>socket.close(resolve));
  const child = spawn(process.execPath, ['--import', preload, 'server.mjs'], {
    cwd:root,
    env:{
      PATH:process.env.PATH, HOST:'127.0.0.1', PORT:String(port), DASHSCOPE_API_KEY:key,
      MODEL_QUOTA_FILE:ledger, ALLOW_LOCAL_BAILIAN_CONFIG:'0'
    },
    stdio:['ignore','pipe','inherit']
  });
  t.after(async ()=>{
    if(child.exitCode===null && child.signalCode===null){
      const ended = once(child, 'exit');
      child.kill();
      await ended;
    }
    await rm(temp,{recursive:true,force:true});
  });

  await Promise.race([
    once(child.stdout, 'data'),
    once(child, 'exit').then(([code])=>{throw new Error('Test server exited: ' + code);}),
    delay(5000, null, {ref:false}).then(()=>{throw new Error('Test server startup timed out');})
  ]);
  const origin = 'http://127.0.0.1:' + port;
  const remaining = async ()=>{
    const response = await fetch(origin + '/api/quota');
    assert.equal(response.status,200);
    return (await response.json()).modelCalls.remaining;
  };
  const post = async (route, body)=>{
    const response = await fetch(origin + '/api/' + route, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:typeof body==='string' ? body : JSON.stringify(body)
    });
    return {status:response.status, ...await response.json()};
  };
  return {post,remaining};
}

test('four AI endpoints validate request bodies and inputs before reserving a call', async t=>{
  const {post,remaining} = await startServer(t,'fixture-key');
  const before = await remaining();
  const invalid = [
    ['transcribe',{audio:'data:audio/wav;base64,AAAA'},400],
    ['transcribe',{audio:'data:audio/mp3;base64,AAAA'},400],
    ['understand',{text:'  '},400],
    ['understand',{text:'杭州'},400],
    ['understand',{text:['杭州住两晚']},400],
    ['extract',{image:image.replace('png','gif')},400],
    ['extract',{image:'data:image/png;base64,AAAA'},400],
    ['extract',{image:'data:image/png;base64,' + Buffer.alloc(5_000_001).toString('base64')},413],
    ['explain',{nights:0},400],
    ['explain',{nights:1.5},400],
    ['explain',{nights:true},400],
    ['explain',{nights:2,extra:'a'.repeat(20_000)},413]
  ];
  for(const route of Object.keys(valid)){
    invalid.push([route,'{broken',400],[route,null,400],[route,{},400]);
  }
  for(const [route,body,status] of invalid){
    const result = await post(route,body);
    assert.equal(result.status,status,route + ': ' + result.error);
    assert.deepEqual(await remaining(),before,route + ' changed AI quota');
  }
});

test('missing Bailian key leaves all four endpoints free of quota charges', async t=>{
  const {post,remaining} = await startServer(t,'');
  const before = await remaining();
  for(const [route,body] of Object.entries(valid)){
    const result = await post(route,body);
    assert.equal(result.status,503,route + ': ' + result.error);
    assert.match(result.error,/暂未配置/);
    assert.deepEqual(await remaining(),before,route + ' changed AI quota');
  }
});

test('each validated AI request reserves exactly once even when its upstream fails', async t=>{
  const {post,remaining} = await startServer(t,'fixture-key');
  for(const [route,body] of Object.entries(valid)){
    const before = await remaining();
    const result = await post(route,body);
    assert.equal(result.status,502,route + ': ' + result.error);
    assert.equal(result.error,'test upstream unavailable');
    assert.deepEqual(await remaining(),{hour:before.hour-1,day:before.day-1,siteDay:before.siteDay-1});
  }
});
