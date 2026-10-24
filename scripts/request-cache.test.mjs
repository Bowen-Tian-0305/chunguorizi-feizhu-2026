import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {createPublicQueryCache, publicQueryKey, beijingDate, PUBLIC_QUERY_TTL_MS} from '../request-cache.mjs';

const hotel = {city:'杭州', query:'西湖酒店', checkIn:'2026-11-07', checkOut:'2026-11-09'};
const around = {city:'杭州', lng:'120.123456', lat:'30.123456', keyword:'早餐'};
const walk = {origin:'120.123456,30.123456', destination:'120.133456,30.133456'};
const geo = {city:'杭州', address:'杭州市上城区测试路1号酒店'};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve=yes; reject=no;}); return {promise, resolve, reject};};

test('public cache keys keep the whole query context and the Beijing day for nearby results', () => {
  const beforeMidnight = Date.parse('2026-10-23T15:59:59.999Z');
  const afterMidnight = beforeMidnight + 1;
  assert.equal(beijingDate(beforeMidnight), '2026-10-23');
  assert.equal(beijingDate(afterMidnight), '2026-10-24');
  const original = publicQueryKey('hotels', hotel, beforeMidnight);
  for (const [field, value] of Object.entries({city:'苏州', query:'另一家酒店', checkIn:'2026-11-08', checkOut:'2026-11-10'}))
    assert.notEqual(publicQueryKey('hotels', {...hotel, [field]:value}, beforeMidnight), original);
  assert.notEqual(publicQueryKey('nearby', around, beforeMidnight), publicQueryKey('nearby', around, afterMidnight));
  for (const [field, value] of Object.entries({city:'上海', lng:'120.999999', lat:'30.999999', keyword:'晚餐'}))
    assert.notEqual(publicQueryKey('nearby', {...around, [field]:value}, beforeMidnight), publicQueryKey('nearby', around, beforeMidnight));
  assert.notEqual(publicQueryKey('route', walk), publicQueryKey('route', {origin:walk.destination, destination:walk.origin}));
  assert.notEqual(publicQueryKey('route', walk), publicQueryKey('route', {...walk, destination:'120.133457,30.133456'}));
  assert.notEqual(publicQueryKey('geocode', geo), publicQueryKey('geocode', {...geo, city:'苏州'}));
  assert.notEqual(publicQueryKey('geocode', geo), publicQueryKey('geocode', {...geo, address:geo.address+'分店'}));
  assert.notEqual(publicQueryKey('hotels', {...hotel, query:'a,b', city:'c'}), publicQueryKey('hotels', {...hotel, query:'a', city:'b,c'}));
});

test('only supported public query types and complete keys can reach a loader', async () => {
  const cache = createPublicQueryCache();
  let calls = 0;
  for (const kind of ['extract', 'transcribe', 'understand', 'explain', 'private-plan'])
    await assert.rejects(cache.read(kind, {text:'private input'}, () => ++calls), TypeError);
  await assert.rejects(cache.read('hotels', {...hotel, checkOut:undefined}, () => ++calls), TypeError);
  assert.equal(calls, 0);
  assert.equal(cache.size, 0);
});

test('each public result expires at its TTL without refreshing queried_at on cache hits', async () => {
  assert.deepEqual(PUBLIC_QUERY_TTL_MS, {hotels:300_000, nearby:300_000, route:1_800_000, geocode:86_400_000});
  for (const [kind, params] of [['hotels', hotel], ['nearby', around], ['route', walk], ['geocode', geo]]) {
    let now = Date.parse('2026-10-23T01:00:00Z'), calls = 0;
    const cache = createPublicQueryCache({now:() => now});
    const load = () => ({items:[++calls], queried_at:new Date(now).toISOString()});
    const first = await cache.read(kind, params, load);
    now += PUBLIC_QUERY_TTL_MS[kind] - 1;
    assert.deepEqual(await cache.read(kind, params, load), first);
    assert.equal(calls, 1);
    now += 1;
    const fresh = await cache.read(kind, params, load);
    assert.equal(calls, 2);
    assert.notEqual(fresh.queried_at, first.queried_at);
  }
});

test('nearby data cannot cross Beijing midnight even when its five minute TTL has not elapsed', async () => {
  let now = Date.parse('2026-10-23T15:59:59Z'), calls = 0;
  const cache = createPublicQueryCache({now:() => now});
  const first = await cache.read('nearby', around, () => ({items:[++calls]}));
  now += 1000;
  const next = await cache.read('nearby', around, () => ({items:[++calls]}));
  assert.deepEqual(first.items, [1]);
  assert.deepEqual(next.items, [2]);
});

test('concurrent identical misses share one upstream reservation and callers receive independent values', async () => {
  const cache = createPublicQueryCache(), upstream = deferred();
  let reservations = 0;
  const load = () => {reservations++; return upstream.promise;};
  const pending = Array.from({length:20}, () => cache.read('hotels', hotel, load));
  await Promise.resolve();
  assert.equal(reservations, 1);
  assert.equal(cache.size, 1);
  upstream.resolve({items:[{name:'同一酒店'}], queried_at:'2026-10-23T01:00:00Z'});
  const results = await Promise.all(pending);
  assert.ok(results.every(result => result.queried_at === results[0].queried_at));
  results[0].items[0].name = 'changed by one caller';
  assert.equal(results[1].items[0].name, '同一酒店');
  assert.equal((await cache.read('hotels', hotel, load)).items[0].name, '同一酒店');
  assert.equal(reservations, 1);
});

test('upstream and quota failures are not cached, and a later retry can succeed', async () => {
  const cache = createPublicQueryCache(), failure = deferred();
  let calls = 0;
  const load = () => {calls++; return failure.promise;};
  const a = cache.read('hotels', hotel, load), b = cache.read('hotels', hotel, load);
  const waiting = Promise.allSettled([a, b]);
  failure.reject(Object.assign(new Error('upstream unavailable'), {status:502}));
  const failed = await waiting;
  assert.ok(failed.every(result => result.status === 'rejected' && result.reason.status === 502));
  assert.equal(calls, 1);
  assert.equal(cache.size, 0);
  await assert.rejects(cache.read('hotels', hotel, () => {throw Object.assign(new Error('quota'), {status:429});}), {status:429});
  assert.equal(cache.size, 0);
  assert.deepEqual(await cache.read('hotels', hotel, () => ({items:['retried']})), {items:['retried']});
});

test('LRU eviction bounds completed results and the limit cannot be configured above 512', async () => {
  const cache = createPublicQueryCache({maxEntries:2});
  let calls = 0;
  const get = query => cache.read('hotels', {...hotel, query}, () => ({call:++calls}));
  const a = await get('A');
  await get('B');
  assert.deepEqual(await get('A'), a); // B is now least recently used.
  await get('C');
  assert.equal(cache.size, 2);
  assert.deepEqual(await get('A'), a);
  await get('B');
  assert.equal(calls, 4);
  assert.equal(cache.size, 2);
  for (const maxEntries of [0, -1, 513, 1.5, Infinity]) assert.throws(() => createPublicQueryCache({maxEntries}), RangeError);
});

test('pending entries also count toward capacity and are never evicted into duplicate upstream calls', async () => {
  const cache = createPublicQueryCache({maxEntries:2}), first = deferred(), second = deferred();
  let calls = 0;
  const a = cache.read('hotels', {...hotel, query:'A'}, () => {calls++; return first.promise;});
  const b = cache.read('hotels', {...hotel, query:'B'}, () => {calls++; return second.promise;});
  await assert.rejects(cache.read('hotels', {...hotel, query:'C'}, () => {calls++; return {};}), {status:503});
  const joined = cache.read('hotels', {...hotel, query:'A'}, () => {calls++; return {};});
  assert.equal(cache.size, 2);
  first.resolve({items:['A']}); second.resolve({items:['B']});
  assert.deepEqual(await a, await joined);
  await b;
  assert.equal(calls, 2);
  await cache.read('hotels', {...hotel, query:'C'}, () => {calls++; return {};});
  assert.equal(cache.size, 2);
  assert.equal(calls, 3);
});

test('service access checks still run before cached hits and pending joins; exhausted upstream quota does not charge hits', async () => {
  let enabled = true, reservations = 0;
  const cache = createPublicQueryCache({assertAccess:() => {if (!enabled) throw Object.assign(new Error('disabled'), {status:503});}});
  const load = () => {
    if (reservations >= 1) throw Object.assign(new Error('exhausted'), {status:429});
    reservations++;
    return {items:['public snapshot']};
  };
  const first = await cache.read('hotels', hotel, load);
  assert.deepEqual(await cache.read('hotels', hotel, load), first);
  await assert.rejects(cache.read('hotels', {...hotel, query:'different'}, load), {status:429});
  assert.equal(reservations, 1);
  enabled = false;
  await assert.rejects(cache.read('hotels', hotel, load), {status:503});
  assert.equal(reservations, 1);
  enabled = true;
  const upstream = deferred();
  const pending = cache.read('route', walk, () => upstream.promise);
  enabled = false;
  await assert.rejects(cache.read('route', walk, () => assert.fail('must not start another upstream')), {status:503});
  upstream.resolve({minutes:7});
  assert.deepEqual(await pending, {minutes:7});
});

test('server integration: validation and missing keys do not consume quota; shared hotel hits cost one durable reservation', async t => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const temp = await mkdtemp(path.join(tmpdir(), 'chunguorizi-public-cache-'));
  const counter = path.join(temp, 'fake-upstream-count.txt');
  const fake = path.join(temp, 'fake-flyai.mjs');
  await writeFile(fake, `#!/usr/bin/env node\nimport {appendFileSync} from 'node:fs';\nappendFileSync(process.env.TEST_FLYAI_CALLS, 'call\\n');\nsetTimeout(() => process.stdout.write(JSON.stringify({status:0,data:{itemList:[{shId:'test-hotel',name:'测试酒店',address:'杭州市测试路1号'}]}})), 100);\n`);
  await chmod(fake, 0o700);
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = {
    PATH:process.env.PATH, PORT:String(port), HOST:'127.0.0.1',
    REALTIME_AI_ENABLED:'0', REALTIME_QUERY_ENABLED:'1',
    MODEL_QUOTA_FILE:path.join(temp, 'ai-quota.json'),
    MAX_LIVE_QUERIES_PER_DAY:'1', LIVE_QUERIES_PER_IP_DAY:'1', LIVE_QUERIES_PER_IP_HOUR:'1',
    FLYAI_BIN:fake, TEST_FLYAI_CALLS:counter
  };
  let child;
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended;
  }
  t.after(async () => {await stop(); await rm(temp, {recursive:true, force:true});});
  async function start() {
    child = spawn(process.execPath, ['server.mjs'], {cwd:root, env, stdio:'ignore'});
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error('test server stopped before readiness');
      try {if ((await fetch(`${base}/api/cities`)).ok) return;} catch {}
      await delay(20);
    }
    throw new Error('test server did not become ready');
  }
  const query = new URLSearchParams({q:hotel.query, checkIn:hotel.checkIn, checkOut:hotel.checkOut, city:hotel.city});
  await start();
  const refineInput={text:'这顿想少走路',target:{date:'2026-11-08',meal:'dinner',candidateId:null},candidates:[{id:'test-branch',name:'测试门店',address:'杭州市测试路1号',routeMinutes:8,status:'eligible'}]};
  const refine = body => fetch(`${base}/api/meal-refine`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await refine({...refineInput,notes:'private'})).status,400);
  assert.equal((await refine(refineInput)).status,503);
  await assert.rejects(readFile(path.join(temp,'ai-quota.json')),{code:'ENOENT'});
  assert.equal((await fetch(`${base}/api/hotels?checkIn=invalid`)).status, 400);
  assert.equal((await fetch(`${base}/api/geocode?address=x`)).status, 400);
  assert.equal((await fetch(`${base}/api/nearby?lng=120.123456&lat=30.123456&city=杭州`)).status, 503);
  const responses = await Promise.all(Array.from({length:8}, () => fetch(`${base}/api/hotels?${query}`)));
  assert.ok(responses.every(response => response.status === 200));
  const bodies = await Promise.all(responses.map(response => response.json()));
  assert.ok(bodies.every(body => JSON.stringify(body) === JSON.stringify(bodies[0])));
  assert.equal(bodies[0].items[0].name, '测试酒店');
  assert.equal((await readFile(counter, 'utf8')).trim().split('\n').length, 1);
  const ledger = JSON.parse(await readFile(path.join(temp, 'live-query-quota.json'), 'utf8'));
  assert.equal(ledger.total, 1);
  const quotaResponse = await fetch(`${base}/api/quota`);
  assert.equal(quotaResponse.status, 200);
  const quotaStatus = await quotaResponse.json();
  assert.equal(quotaStatus.unit, 'calls');
  assert.equal(quotaStatus.countingBasis, 'reserved_attempts');
  assert.equal(quotaStatus.timeZone, 'Asia/Shanghai');
  assert.equal(quotaStatus.modelCalls.status, 'unavailable');
  assert.deepEqual(quotaStatus.liveQueries.remaining, {hour:0, day:0, siteDay:0});
  assert.match(quotaStatus.accounting, /语音转写、需求提取/);
  assert.ok(!JSON.stringify(quotaStatus).includes(ledger.salt));
  assert.equal((await fetch(`${base}/api/quota`)).status, 200);
  assert.equal(JSON.parse(await readFile(path.join(temp, 'live-query-quota.json'), 'utf8')).total, 1);
  const other = new URLSearchParams(query); other.set('city', '苏州');
  assert.equal((await fetch(`${base}/api/hotels?${other}`)).status, 429);
  const hit = await fetch(`${base}/api/hotels?${query}`);
  assert.equal(hit.status, 200);
  assert.equal((await hit.json()).queried_at, bodies[0].queried_at);
  await stop(); await start(); // Public result cache is volatile; the quota ledger is not.
  assert.equal((await fetch(`${base}/api/hotels?${query}`)).status, 429);
  assert.equal((await readFile(counter, 'utf8')).trim().split('\n').length, 1);
  await stop();
  Object.assign(env, {REALTIME_AI_ENABLED:'1', MAX_MODEL_CALLS_PER_DAY:'2', MODEL_CALLS_PER_IP_DAY:'2', MODEL_CALLS_PER_IP_HOUR:'2'});
  await start();
  const invalidModelRequest = endpoint => fetch(`${base}/api/${endpoint}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
  assert.equal((await invalidModelRequest('transcribe')).status, 400);
  assert.equal((await invalidModelRequest('understand')).status, 400);
  const modelStatus = await (await fetch(`${base}/api/quota`)).json();
  assert.deepEqual(modelStatus.modelCalls.remaining, {hour:0, day:0, siteDay:0});
  assert.equal((await invalidModelRequest('understand')).status, 429);
  assert.equal((await refine(refineInput)).status,429);
  assert.equal(JSON.parse(await readFile(path.join(temp, 'ai-quota.json'), 'utf8')).total, 2);
});
