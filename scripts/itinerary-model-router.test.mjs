import test from 'node:test';
import assert from 'node:assert/strict';
import {createItineraryRouter, freeQuotaCode, itineraryRequest} from '../itinerary-model-router.mjs';

const schema = {type:'json_schema', json_schema:{name:'result', strict:true, schema:{type:'object'}}};
const messages = [{role:'system', content:'Return JSON'}, {role:'user', content:[{type:'image_url', image_url:{url:'data:image/png;base64,AA=='}}]}];
const input = {messages, schema, maxTokens:500, timeoutMs:35_000};
const exhausted = () => Object.assign(new Error('provider free quota'), {code:freeQuotaCode});
const primary = 'qwen4-max';
const standby = 'deepseek-v4.1-flash-1017';
const later = 'kimi-k3.1-pro';

test('request format is selected per model, retaining the image and strict schema where supported', () => {
  assert.equal(itineraryRequest(primary, messages, schema, 500).reasoning_effort, 'none');
  assert.equal(itineraryRequest(standby, messages, schema, 500).response_format, schema);
  for (const name of [later, 'qwen3.8-omni-flash']) {
    const request = itineraryRequest(name, messages, schema, 500);
    assert.deepEqual(request.response_format,{type:'json_object'});
    assert.match(request.messages[0].content,/单一顶层 JSON 对象/);
    assert.strictEqual(request.messages[1],messages[1]);
  }
  assert.equal(messages[0].content,'Return JSON');
});

test('free exhaustion retries once, skips temporarily depleted models, and shares one deadline', async () => {
  const calls = [];
  let now = 10_000;
  const route = createItineraryRouter({
    primary,fallbackModels:[primary,'unverified',standby,later],now:()=>now,
    request: async ({model},time) => {
      calls.push([model,time]);
      now += 110;
      if (model !== later) throw exhausted();
      return {model};
    }
  });
  await assert.rejects(route(input),{status:429,code:freeQuotaCode});
  assert.deepEqual(calls,[[primary,35_000],[standby,34_890]]);
  assert.deepEqual(await route(input),{model:later});
  now += 15 * 60 * 1000;
  await assert.rejects(route(input),{status:429,code:freeQuotaCode});
  assert.deepEqual(calls.slice(-2).map(([model])=>model),[primary,standby]);
});

test('provider throttling, invalid requests and timeouts never trigger a second call', async () => {
  for (const error of [Object.assign(new Error('throttled'),{status:429}), Object.assign(new Error('bad request'),{status:400}), new DOMException('timeout','TimeoutError')]) {
    const calls = [];
    const route = createItineraryRouter({primary,fallbackModels:[standby],request:async ({model})=>{
      calls.push(model);
      throw error;
    }});
    await assert.rejects(route(input),reason=>reason===error);
    assert.deepEqual(calls,[primary]);
  }
});
