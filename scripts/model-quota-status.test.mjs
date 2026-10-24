import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createModelQuota} from '../model-quota.mjs';
import {createRemoteModelQuota} from '../remote-model-quota.mjs';

test('quota status reads exact visitor and site counters without reserving or exposing identifiers',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'meal-quota-status-')),file=path.join(dir,'quota.json');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const quota=createModelQuota({MODEL_QUOTA_FILE:file,REALTIME_AI_ENABLED:'1',MAX_MODEL_CALLS_PER_DAY:'3',MODEL_CALLS_PER_IP_DAY:'2',MODEL_CALLS_PER_IP_HOUR:'1'});
  const now=Date.parse('2026-10-23T15:30:00Z');
  assert.equal(quota.status('visitor-a',now).status,'unavailable');
  quota('visitor-a',now);
  const before=await readFile(file,'utf8'),result=quota.status('visitor-a',now);
  assert.deepEqual(result.remaining,{hour:0,day:1,siteDay:2});
  assert.equal(result.resetsAt.hour,'2026-10-24T00:00:00.000+08:00');
  assert.equal(result.resetsAt.day,'2026-10-24T00:00:00.000+08:00');
  assert.deepEqual(quota.status('visitor-b',now).remaining,{hour:1,day:2,siteDay:2});
  assert.equal(await readFile(file,'utf8'),before);
  assert.ok(!JSON.stringify(result).includes('visitor-a'));
  assert.ok(!JSON.stringify(result).includes(JSON.parse(before).salt));
  assert.deepEqual(quota.status('visitor-a',now+30*60_000).remaining,{hour:1,day:2,siteDay:3});
  quota('visitor-a',now+30*60_000);
  assert.deepEqual(quota.status('visitor-a',now+90*60_000).remaining,{hour:1,day:1,siteDay:2});
});

test('damaged, locked, absent and disabled ledgers show unavailable without creating quota',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'meal-quota-bad-')),file=path.join(dir,'quota.json');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const quota=createModelQuota({MODEL_QUOTA_FILE:file,REALTIME_AI_ENABLED:'1'});
  await writeFile(file,'{broken');
  assert.equal(quota.status('visitor').status,'unavailable');
  await writeFile(file,JSON.stringify({day:1,total:-1,salt:'x',clients:{}}));
  assert.equal(quota.status('visitor').status,'unavailable');
  await writeFile(file,JSON.stringify({day:1,total:0,salt:'a'.repeat(64),clients:{['b'.repeat(64)]:null}}));
  assert.equal(quota.status('visitor').status,'unavailable');
  assert.throws(()=>quota('visitor'),{status:503});
  await mkdir(file+'.lock');
  assert.equal(quota.status('visitor').status,'unavailable');
  assert.equal(createModelQuota({MODEL_QUOTA_FILE:dir}).status('visitor').status,'unavailable');
  assert.equal(createModelQuota({MODEL_QUOTA_FILE:file,REALTIME_AI_ENABLED:'0'}).status('visitor').status,'unavailable');
  assert.equal((await createRemoteModelQuota({},()=>assert.fail('a quota read cannot reserve remotely')).status('visitor')).status,'unavailable');
});
