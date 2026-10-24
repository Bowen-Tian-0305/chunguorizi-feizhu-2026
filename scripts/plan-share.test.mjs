import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizePlanSnapshot,encodePlanSnapshot,decodePlanSnapshot,createPlanShareUrl,renderSharedPlan} from '../public/plan-share.js';
const input=()=>({hotel:{name:'杭州酒店',address:'杭州一号路',apiKey:'secret'},checkIn:'2026-11-01',checkOut:'2026-11-03',party:{adults:2,children:1},demo:true,slots:[{date:'2026-11-02',meal:'breakfast',name:'面馆',status:'pending',tentativeTime:{start:'08:00',end:'08:45'},map_url:'https://uri.amap.com/marker?position=120.1,30.2&name=面馆&key=secret',notes:'private note'}],cost:{knownAmount:240,budgetAmount:140,unknownAmounts:[{scope:'children',message:'private'}],scope:'adult-meals-increment-excludes-room-price'},image:'private image',audio:'private audio',notes:'private note'});
test('Unicode snapshot round trips only explicit fields and preserves provisional times and scope',()=>{
  const value=input(),before=JSON.stringify(value),decoded=decodePlanSnapshot(encodePlanSnapshot(value));
  assert.equal(decoded.hotel.name,'杭州酒店');assert.equal(decoded.demo,true);assert.equal(decoded.slots[0].tentative,true);
  assert.equal(decoded.cost.scope,value.cost.scope);assert.equal(decoded.cost.unknownCount,1);assert.equal(JSON.stringify(value),before);
  const body=JSON.stringify(decoded);for(const secret of ['secret','private note','private image','private audio'])assert.equal(body.includes(secret),false);
});
test('share payload stays in a URL fragment without source query parameters or credentials',()=>{
  const url=new URL(createPlanShareUrl(input(),'https://example.com/?account_token=private'));
  assert.equal(url.pathname,'/share.html');assert.equal(url.search,'');assert.ok(url.hash.startsWith('#plan='));
  assert.equal(decodePlanSnapshot(new URLSearchParams(url.hash.slice(1)).get('plan')).hotel.name,'杭州酒店');
  for(const origin of ['http://example.com','https://user:pass@example.com','javascript:alert(1)'])assert.throws(()=>createPlanShareUrl(input(),origin));
  assert.ok(createPlanShareUrl(input(),'http://127.0.0.1:4182').startsWith('http://127.0.0.1:4182/'));
});
test('malformed, oversized, unsupported and impossible snapshots are rejected',()=>{
  for(const token of ['', '!', 'a'.repeat(24001),btoa('{"version":999}')])assert.throws(()=>decodePlanSnapshot(token));
  for(const patch of [{checkOut:'2026-02-30'},{party:{adults:0,children:1}},{slots:Array(91).fill(input().slots[0])},{slots:[...input().slots,...input().slots]}])assert.throws(()=>sanitizePlanSnapshot({...input(),...patch}));
  const huge=input();huge.slots=Array.from({length:90},(_,i)=>({date:`2026-11-${String(Math.floor(i/3)+1).padStart(2,'0')}`,meal:['breakfast','lunch','dinner'][i%3],name:'长'.repeat(200),address:'址'.repeat(400)}));huge.checkOut='2026-12-01';
  assert.throws(()=>encodePlanSnapshot(huge),RangeError);
});
test('only the existing server marker link shape is retained and executable links are dropped',()=>{
  const value=input();assert.equal(new URL(sanitizePlanSnapshot(value).slots[0].mapUrl).searchParams.has('key'),false);
  for(const bad of ['javascript:alert(1)','https://evil.example/','https://uri.amap.com.evil.example/marker?position=1,1','https://uri.amap.com/marker?position=999,999','https://uri.amap.com/private-secret']){
    value.slots[0].map_url=bad;assert.equal(sanitizePlanSnapshot(value).slots[0].mapUrl,null);
  }
});
test('read only renderer uses text content for untrusted names and exposes no editing controls',()=>{
  const make=tag=>({tag,children:[],textContent:'',append(...nodes){this.children.push(...nodes)},replaceChildren(){this.children=[]}});
  const previous=globalThis.document;globalThis.document={createElement:make};
  try{const root=make('main'),value=input();value.hotel.name='<img src=x onerror=alert(1)>';renderSharedPlan(root,sanitizePlanSnapshot(value));
    const all=[];const walk=n=>{all.push(n);n.children.forEach(walk)};walk(root);
    assert.ok(all.some(n=>n.textContent===value.hotel.name));assert.ok(!all.some(n=>['input','button','img','form'].includes(n.tag)));
    assert.ok(all.some(n=>n.textContent.includes('参考时段')));
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
