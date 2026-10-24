import test from 'node:test';
import assert from 'node:assert/strict';
import {sameWeekdayAmbiguity,guardSameWeekdayDates} from '../trip-date-guard.mjs';

const extracted=()=>({fields:{check_in:'2026-10-31',check_out:'2026-11-02',nights:2,adults:2,children:1,dietary:'不吃海鲜',meal_priority:'local',walk_limit_minutes:10},evidence:{check_in:'周六',check_out:'周六住两晚',nights:'两晚',adults:'两大一小',children:'两大一小',dietary:'不吃海鲜'},summary:'2026-10-31入住杭州，住两晚，两大一小。',questions:['10月31日几点到？'],model:'test'});

test('bare current weekday clears unsupported stay dates and date-bearing summary while retaining supported facts',()=>{
  const result=extracted(),before=JSON.stringify(result);
  const guarded=guardSameWeekdayDates(result,{text:'周六去杭州住两晚，两大一小，想吃当地早餐，不吃海鲜，最多走十分钟。',today:'2026-10-24'});
  assert.equal(guarded.fields.check_in,undefined);assert.equal(guarded.fields.check_out,undefined);
  assert.equal(guarded.evidence.check_in,undefined);assert.equal(guarded.evidence.check_out,undefined);
  assert.equal(guarded.needsDateConfirmation,true);
  for(const key of ['nights','adults','children','dietary','meal_priority','walk_limit_minutes'])assert.equal(guarded.fields[key],result.fields[key]);
  assert.ok(!/2026-10-31|10月31日/.test(JSON.stringify(guarded)));
  assert.match(guarded.questions[0],/今天还是下周的周六/);
  assert.equal(JSON.stringify(result),before);
  assert.equal(sameWeekdayAmbiguity('星期一去住两晚','2026-10-26'),'周一');
  assert.equal(sameWeekdayAmbiguity('礼拜天去住两晚','2026-10-25'),'周日');
});

test('explicit today, week qualifiers and calendar dates preserve extraction',()=>{
  for(const text of ['今天周六去杭州','周六就是今天去杭州','周六（今天）去杭州','本周六去杭州','这周的周六去杭州','下周六去杭州','下个星期六去杭州','下一个周六去杭州','下周的星期六去杭州','10月31日周六去杭州','周六（10月31日）去杭州','十月三十一日周六去杭州','2026-10-31周六去杭州']){
    const result=extracted();assert.equal(guardSameWeekdayDates(result,{text,today:'2026-10-24'}),result,text);
  }
  assert.equal(sameWeekdayAmbiguity('10月31日入住，周六到杭州','2026-10-24','10月31日'),null);
});

test('ordinary future weekdays remain usable and an unrelated mention of today does not anchor a bare weekday',()=>{
  const result=extracted();
  assert.equal(guardSameWeekdayDates(result,{text:'周日去杭州住两晚',today:'2026-10-24'}),result);
  assert.notEqual(result.needsDateConfirmation,true);
  assert.equal(sameWeekdayAmbiguity('周六去杭州，今天先看看饭怎么安排','2026-10-24'),'周六');
  assert.equal(sameWeekdayAmbiguity('周六去杭州','2026-02-30'),null);
});

test('explicit short month/day stays intact across a meal weekday while decimal prices do not anchor dates',()=>{
  for(const monthDay of ['10/30','10-30']){
    const result=extracted();
    result.fields.check_in='2026-10-30';result.fields.check_out='2026-11-01';
    result.evidence.check_in=monthDay;result.summary='10月30日入住，住两晚。';
    assert.equal(guardSameWeekdayDates(result,{text:`${monthDay}住两晚，周六想吃当地早餐`,today:'2026-10-24'}),result);
  }
  for(const text of ['10/31周六去杭州','10-31周六去杭州','周六（10/31）去杭州','周六10-31去杭州'])assert.equal(sameWeekdayAmbiguity(text,'2026-10-24'),null,text);
  assert.equal(sameWeekdayAmbiguity('早餐预算10.30元，周六去杭州','2026-10-24','10.30'),'周六');
  assert.equal(sameWeekdayAmbiguity('周六10.30元早餐','2026-10-24'),'周六');
});
