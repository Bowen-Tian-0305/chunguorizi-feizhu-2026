import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMealRefineInput,constrainMealRefineOutput,runMealRefine} from '../meal-refine.mjs';

const input=()=>({text:'这顿想少走一点路',target:{date:'2026-11-02',meal:'dinner',candidateId:'old'},candidates:[{id:'branch-1',name:'测试一分店',address:'杭州测试路1号',routeMinutes:8,status:'eligible',reasons:['本次时段已核']},{id:'branch-2',name:'测试二分店',address:'杭州测试路2号',routeMinutes:null,status:'pending'}]});
const answer=()=>({status:'suggested',candidateId:'branch-1',reasonCode:'less-walking'});
const payload=value=>({choices:[{message:{content:JSON.stringify(value)}}]});

test('single-meal input admits only bounded explicit target and unique branch summaries',()=>{
  const value=input(),before=JSON.stringify(value);assert.deepEqual(validateMealRefineInput(value).target,value.target);assert.equal(JSON.stringify(value),before);
  for(const patch of [{text:'x'.repeat(501)},{target:{...value.target,date:'2026-02-30'}},{target:{...value.target,meal:'all'}},{target:{...value.target,adults:3}},{candidates:[value.candidates[0],{...value.candidates[0],id:' branch-1 '}]},{candidates:Array(26).fill(value.candidates[0])},{notes:'private'},{audio:'private'},{order:{id:'private'}},{candidates:[{...value.candidates[0],price:100}]},{candidates:[{...value.candidates[0],routeMinutes:Infinity}]}])assert.throws(()=>validateMealRefineInput({...value,...patch}),{status:400});
});

test('output cannot invent ids, amounts, benefits or change the target and remains a preview',()=>{
  const value=validateMealRefineInput(input()),result=constrainMealRefineOutput(answer(),value);
  assert.equal(result.status,'preview');assert.deepEqual(result.target,value.target);assert.equal(result.previewOnly,true);assert.equal(result.requiresRecalculation,true);
  assert.deepEqual(Object.keys(result).sort(),['candidateId','previewOnly','reason','requiresRecalculation','status','target']);
  for(const patch of [{candidateId:'invented'},{amount:0},{benefits:'免费晚餐'},{target:{date:'2026-11-03'}},{reason:'保证无过敏原'},{reasonCode:'free-meal'},{candidateId:'branch-2'}])assert.throws(()=>constrainMealRefineOutput({...answer(),...patch},value),{status:502});
  value.candidates[0].status='excluded';
  assert.equal(constrainMealRefineOutput(answer(),value).status,'needs-clarification');
  assert.equal(constrainMealRefineOutput({status:'needs-clarification',candidateId:null,reasonCode:'request-unclear'},value).candidateId,null);
});

test('one preview reserves once, calls once and never retries unsafe model output',async()=>{
  let reserved=0,calls=0;
  const options={reserve:()=>{reserved++;},generate:async messages=>{calls++;assert.equal(messages.length,2);return payload(answer());}};
  assert.equal((await runMealRefine(input(),options)).candidateId,'branch-1');assert.equal(reserved,1);assert.equal(calls,1);
  await assert.rejects(runMealRefine({...input(),notes:'private'},options),{status:400});assert.equal(reserved,1);assert.equal(calls,1);
  await assert.rejects(runMealRefine(input(),{reserve:()=>{throw Object.assign(new Error('limit'),{status:429});},generate:()=>assert.fail('must not call model after quota rejection')}),{status:429});
  await assert.rejects(runMealRefine(input(),{reserve:()=>{reserved++;},generate:()=>{calls++;return payload({...answer(),candidateId:'invented'});}}),{status:502});
  assert.equal(reserved,2);assert.equal(calls,2);
});
