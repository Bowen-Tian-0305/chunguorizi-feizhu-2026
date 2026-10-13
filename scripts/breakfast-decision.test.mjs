import test from 'node:test';
import assert from 'node:assert/strict';
import {compareBreakfast, breakfastDates} from '../public/breakfast-decision.js';
const trip = {plain:1200,included:1440,adults:2,children:0,count:2,days:1,nights:2,budget:35,comparable:true};
test('one breakfast: unused mornings remain a cost in both options', () => {
  const decision = compareBreakfast(trip);
  assert.equal(decision.perUse,120);
  assert.equal(decision.outsideAll,140);
  assert.equal(decision.packageAll,310);
  assert.equal(decision.saving,-170);
  assert.equal(decision.minimumDays,4);
  assert.equal(compareBreakfast({...trip,days:2}).saving,-100);
});
test('equal price and zero premium are not described as more expensive', () => {
  assert.equal(compareBreakfast({...trip,budget:120}).saving,0);
  const free = compareBreakfast({...trip,included:1200,budget:0});
  assert.equal(free.saving,0);
  assert.equal(free.minimumDays,1);
});
test('unknown child policy does not produce a full family quote', () => {
  assert.equal(compareBreakfast({...trip,children:1}).status,'children-unknown');
});
test('missing or incompatible facts block price advice', () => {
  for (const [change,status] of [ [{plain:null},'missing-price'],[{included:1100},'negative-premium'],[{comparable:false},'different-terms'],[{count:1},'short-count'],[{count:0},'missing-count'],[{days:0},'unused'],[{budget:null},'missing-budget'],[{adults:0},'invalid'] ])
    assert.equal(compareBreakfast({...trip,...change}).status,status);
});
test('breakfast calendar includes checkout and excludes checkin across month boundaries', () => {
  assert.deepEqual(breakfastDates('2026-10-31','2026-11-02'),['2026-11-01','2026-11-02']);
  assert.deepEqual(breakfastDates('2026-11-02','2026-11-02'),[]);
});
