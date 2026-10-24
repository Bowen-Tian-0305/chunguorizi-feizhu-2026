import test from 'node:test';
import assert from 'node:assert/strict';
import {createMealFeedback, saveMealFeedback, rankWithMealFeedback} from '../public/meal-feedback.js';
const context = {hotel:{id:'hotel-1',name:'酒店一分店',address:'杭州某路1号'},checkIn:'2026-11-01',checkOut:'2026-11-03'};
const now = Date.parse('2026-11-02T13:00:00+08:00');
const entry = (patch={}) => ({id:'feedback-1',candidateId:'shop-1',date:'2026-11-02',meal:'breakfast',taste:'liked',partyAcceptance:'all',waitMinutes:5,...patch});
const save = (state, value=entry(), ctx=context) => saveMealFeedback(state,value,{context:ctx,now});
const rank = (state,candidates,slot={date:'2026-11-02',meal:'dinner'}) => rankWithMealFeedback(candidates,{state,context,slot});

test('feedback keeps actual party spending separate and strips private or unknown fields without mutation',()=>{
  const initial=createMealFeedback(context),before=JSON.stringify(initial);
  const input=entry({actualSpend:{amount:98,currency:'CNY',basis:'party_total',adults:2,children:1},notes:'private note',image:'private image',budget:50});
  const result=save(initial,input);assert.equal(result.ok,true);assert.equal(JSON.stringify(initial),before);
  assert.deepEqual(result.state.records[0].actualSpend,input.actualSpend);
  for(const key of ['notes','image','budget'])assert.equal(key in result.state.records[0],false);
  const output=rank(result.state,[{id:'shop-1',state:'eligible',adultPrice:30}]);
  assert.equal(output[0].adultPrice,30);assert.equal(output[0].feedback.previousActualSpend.amount,98);
  assert.match(output[0].feedback.priceNotice,/不是本次菜单价/);
});
test('only real past trip dates, exact branch context, and valid spending and wait values can be saved',()=>{
  const initial=createMealFeedback(context);
  for(const patch of [{date:'2026-11-03'},{date:'2026-10-31'},{date:'2026-02-30'},{waitMinutes:-1},{waitMinutes:1.5},{actualSpend:{amount:10,currency:'USD',basis:'party_total',adults:2,children:0}},{taste:'safe-for-allergies'}])assert.equal(save(initial,entry(patch)).ok,false);
  assert.equal(save(initial,entry(),{...context,hotel:{...context.hotel,address:'另一个分店'}}).ok,false);
  assert.equal(save(initial,entry(),{...context,checkOut:'2026-11-04'}).ok,false);
  assert.throws(()=>createMealFeedback({...context,checkOut:context.checkIn}),TypeError);
});
test('taste and party acceptance affect later choices but never promote infeasible candidates',()=>{
  const state=save(createMealFeedback(context)).state;
  const candidates=[{id:'other',state:'eligible'},{id:'shop-1',state:'excluded',reason:'过敏成分冲突'},{id:'unknown',state:'pending'}];
  const before=JSON.stringify(candidates),result=rank(state,candidates);
  assert.equal(result[0].id,'other');assert.equal(result[2].id,'shop-1');assert.equal(result[2].state,'excluded');
  assert.equal(result[2].reason,'过敏成分冲突');assert.equal(JSON.stringify(candidates),before);
  const eligible=rank(state,[{id:'other',state:'eligible'},{id:'shop-1',state:'eligible'}]);
  assert.equal(eligible[0].id,'shop-1');assert.ok(eligible[0].feedback.reasons.some(text=>text.includes('同行人')));
});
test('feedback does not leak to the same or earlier meal, another trip or another property',()=>{
  const state=save(createMealFeedback(context)).state,candidates=[{id:'other',state:'eligible'},{id:'shop-1',state:'eligible'}];
  assert.deepEqual(rank(state,candidates,{date:'2026-11-02',meal:'breakfast'}).map(c=>c.id),['other','shop-1']);
  assert.deepEqual(rank(state,candidates,{date:'2026-11-01',meal:'dinner'}).map(c=>c.id),['other','shop-1']);
  const changed={...context,hotel:{...context.hotel,name:'另一家酒店'}};
  assert.ok(rankWithMealFeedback(candidates,{state,context:changed,slot:{date:'2026-11-02',meal:'dinner'}}).every(c=>c.feedback.score===0));
});
test('long wait and disliked food are explained without changing locked choices',()=>{
  const state=save(createMealFeedback(context),entry({taste:'disliked',partyAcceptance:'none',waitMinutes:70})).state;
  const result=rank(state,[{id:'shop-1',state:'eligible',locked:true},{id:'other',state:'eligible'}]);
  assert.equal(result[0].id,'shop-1');assert.equal(result[0].locked,true);assert.ok(result[0].feedback.score<0);
  assert.ok(result[0].feedback.reasons.some(text=>text.includes('70分钟')));
});
test('editing updates one exact meal and a duplicate id cannot overwrite another meal',()=>{
  let state=save(createMealFeedback(context)).state;
  const updated=save(state,entry({taste:'disliked'}));assert.equal(updated.ok,true);assert.equal(updated.state.records.length,1);
  assert.equal(state.records[0].taste,'liked');assert.equal(updated.state.records[0].taste,'disliked');
  assert.equal(save(state,entry({candidateId:'other'})).ok,false);
  const malformed={...state,records:[{...state.records[0],recordedOn:undefined}]};
  assert.equal(rank(malformed,[{id:'shop-1',state:'eligible'}])[0].feedback.score,0);
});
