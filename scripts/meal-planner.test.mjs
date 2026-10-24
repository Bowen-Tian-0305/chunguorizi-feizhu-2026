import test from 'node:test';
import assert from 'node:assert/strict';
import {planMeals} from '../public/meal-planner.js';

const weekdays = [1, 2, 3, 4, 5, 6, 7];
const schedule = (patch = {}) => ({isoWeekdays: weekdays, start: '06:00', end: '10:00', confirmed: true, ...patch});
const price = amount => ({amount, currency: 'CNY', scope: 'breakfast', basis: 'per_adult_per_meal', confirmed: true, taxIncluded: true, feesIncluded: true});
const candidate = (id, patch = {}) => ({id, name: `具体门店${id}`, longitude: 120.16, latitude: 30.27, route: {minutes: 8, confirmed: true}, breakfast: {confirmed: true, schedules: [schedule()]}, price: price(30), localSpecialty: true, ...patch});
const base = () => ({checkIn: '2026-11-01', checkOut: '2026-11-03', party: {adults: 2, children: 0}, quotes: {comparable: true, plain: 1200, included: 1440}, hotelBreakfast: {confirmed:true,count: 2, schedules: [schedule({start: '07:00'})]}, candidates: [candidate('local'), candidate('near', {route: {minutes: 2, confirmed: true}, localSpecialty: false, price: price(10)})], preferences: {priority: 'local', walkLimitMinutes: 15, adultBudget: 35, mealMinutes: 30, readyTime: '07:00'}});
const find = (result, id) => result.plans.find(plan => plan.id === id);
const codes = option => [...option.reasons, ...option.exclusions].map(item => item.code);


test('hotel supply, per-day supply, menu prices and dietary evidence stay independent',()=>{
  const input=base();delete input.hotelBreakfast.confirmed;
  assert.equal(planMeals(input).evaluations['2026-11-02'].hotel.state,'pending');
  input.hotelBreakfast.confirmed=true;input.hotelBreakfast.confirmedDates=['2026-11-02'];
  const result=planMeals(input);assert.equal(result.evaluations['2026-11-02'].hotel.state,'eligible');assert.equal(result.evaluations['2026-11-03'].hotel.state,'pending');
  input.candidates[0].price=null;input.candidates[0].priceByDate={'2026-11-02':price(12),'2026-11-03':price(20)};
  assert.equal(planMeals(input).evaluations['2026-11-02'].outside[0].adultPrice,12);
  assert.equal(planMeals(input).evaluations['2026-11-03'].outside[0].adultPrice,20);
});

test('a disputed late breakfast interval does not block an earlier confirmed meal', () => {
  const input=base();
  input.hotelBreakfast.conflicts=[{isoWeekdays:weekdays,timeScope:{start:'09:30',end:'10:00'}}];
  assert.equal(planMeals(input).evaluations['2026-11-02'].hotel.state,'eligible');
  input.preferences.readyTime='09:15';
  assert.equal(planMeals(input).evaluations['2026-11-02'].hotel.state,'pending');
});

test('a current-trip confirmed time resolves public uncertainty only for that exact stay', () => {
  const input=base();
  input.hotelBreakfast.conflicts=[{isoWeekdays:weekdays,timeScope:{start:null,end:null}}];
  input.hotelBreakfast.tripConfirmed=true;
  input.hotelBreakfast.confirmationContext={checkIn:input.checkIn,checkOut:input.checkOut};
  assert.equal(planMeals(input).evaluations['2026-11-02'].hotel.state,'eligible');
  input.hotelBreakfast.confirmationContext.checkOut='2026-11-04';
  assert.equal(planMeals(input).evaluations['2026-11-02'].hotel.state,'pending');
});

test('published breakfast windows can produce a clearly provisional time without scheduling the meal', () => {
  const input=base();
  input.hotelBreakfast.schedules=[];
  input.hotelBreakfast.referenceSchedules=[schedule({start:'07:00',confirmed:false,state:'known_snapshot'})];
  const plan=find(planMeals(input),'hotel');
  assert.equal(plan.slots[0].status,'pending');
  assert.equal(plan.slots[0].time,null);
  assert.equal(plan.slots[0].tentativeTime.start,'07:00');
  assert.equal(plan.cost.conditional,true);
  input.hotelBreakfast.conflicts=[{isoWeekdays:weekdays,timeScope:{start:'07:00',end:'07:30'}}];
  assert.equal(find(planMeals(input),'hotel').slots[0].tentativeTime,null);
  input.hotelBreakfast.conflicts=[];input.departureTime='06:00';
  const late=find(planMeals(input),'hotel').slots[0];
  assert.equal(late.tentativeTime,null);
  assert.ok(late.reasons.some(reason=>reason.code==='reference-departure-too-early'));
});

test('hotel, outside and mixed plans are distinct; whole-stay premium is paid once', () => {
  const result = planMeals(base());
  assert.equal(result.status, 'ready');
  assert.equal(result.plans.length, 3);
  assert.deepEqual(result.dates, ['2026-11-02', '2026-11-03']);
  assert.equal(find(result, 'hotel').cost.knownAmount, 240);
  assert.equal(find(result, 'outside').cost.knownAmount, 120);
  assert.equal(find(result, 'mixed').cost.knownAmount, 300);
  assert.equal(find(result, 'mixed').cost.hotelUseDays, 1);
  assert.equal(find(result, 'mixed').cost.knownItems.find(item => item.code === 'package-premium').amount, 240);
  assert.equal(result.plans.filter(plan => plan.recommended).length, 1);
});

test('early train excludes hotel breakfast and uses a verified early-opening external place', () => {
  const input = base();input.departureTime = '07:00';input.preferences.readyTime = '05:45';
  const result = planMeals(input);
  assert.ok(codes(result.evaluations['2026-11-02'].hotel).includes('departure-too-early'));
  assert.ok(result.plans.every(plan => plan.slots.every(slot => slot.kind === 'outside' && slot.status === 'scheduled')));
  assert.ok(result.plans.every(plan => !plan.cost.knownItems.some(item => item.code === 'package-premium')));
  assert.equal(result.evaluations['2026-11-02'].outside[0].time.returnHotel, '06:38');
});

test('a confirmed closed date excludes that place only on the affected weekday', () => {
  const input = base();
  input.candidates[0].breakfast.schedules = [schedule({isoWeekdays: [1], closed: true}), schedule({isoWeekdays: [2]})];
  const result = planMeals(input);
  assert.equal(result.evaluations['2026-11-02'].outside[0].state, 'excluded');
  assert.ok(codes(result.evaluations['2026-11-02'].outside[0]).includes('closed'));
  assert.equal(result.evaluations['2026-11-03'].outside[0].state, 'eligible');
  assert.equal(find(result, 'outside').slots[0].candidateId, 'near');
});

test('venue hours, missing breakfast end time or unconfirmed supply never become a scheduled breakfast', () => {
  for (const breakfast of [
    {confirmed: true, schedules: [schedule({scope: 'venue_hours', end: '20:00'})]},
    {confirmed: true, schedules: [schedule({meal: 'dinner'})]},
    {confirmed: true, schedules: [schedule({end: null})]},
    {confirmed: false, schedules: [schedule()]}
  ]) {
    const input = base();input.candidates = [candidate('unknown', {breakfast})];
    const result = planMeals(input);
    assert.equal(result.evaluations['2026-11-02'].outside[0].state, 'pending');
    assert.equal(find(result, 'outside').slots[0].status, 'pending');
    assert.equal(find(result, 'outside').slots[0].time, null);
    assert.equal(find(result, 'outside').cost.conditional, true);
    assert.equal(find(result, 'outside').status, 'needs-confirmation');
  }
});

test('insufficient eating or round-trip time excludes a place even when it is open', () => {
  const input = base();input.departureTime = '07:20';
  input.candidates = [candidate('too-late', {breakfast: {confirmed: true, schedules: [schedule({start: '07:10', end: '07:20'})]}})];
  const result = planMeals(input);
  assert.ok(codes(result.evaluations['2026-11-02'].outside[0]).includes('not-enough-time'));
  assert.ok(result.plans.every(plan => plan.status === 'incomplete'));
  assert.ok(result.plans.every(plan => plan.cost.adultEstimate === null && plan.cost.familyTotal === null));
});

test('unknown/short included count blocks a firm hotel choice and children never become a family total', () => {
  for (const count of [undefined, 1]) {
    const input = base();input.hotelBreakfast.count = count;input.party.children = 1;
    const result = planMeals(input), hotel = find(result, 'hotel');
    assert.equal(hotel.status, 'needs-confirmation');
    assert.equal(hotel.cost.adultEstimate, null);
    assert.equal(hotel.cost.familyTotal, null);
    assert.ok(hotel.cost.unknownAmounts.some(item => item.code === 'children-price-unknown'));
    assert.ok(hotel.cost.unknownAmounts.some(item => item.code === 'extra-adult-breakfast-unknown'));
    assert.equal(find(result, 'outside').cost.adultEstimate, 120);
    assert.equal(find(result, 'outside').cost.familyTotal, null);
  }
});

test('an entirely unknown dataset yields conditional candidates, no claim of a feasible plan', () => {
  const input = base();input.hotelBreakfast = {};
  input.candidates = [candidate('poi-only', {route: {minutes: 5}, breakfast: {}, price: null})];
  const result = planMeals(input);
  assert.equal(result.status, 'needs-confirmation');
  assert.ok(result.plans.every(plan => plan.status !== 'feasible'));
  assert.ok(result.plans.flatMap(plan => plan.slots).every(slot => slot.status !== 'scheduled'));
  assert.equal(result.evaluations['2026-11-02'].outside[0].time, null);
});

test('locked choice survives preference changes and stays locked when it becomes infeasible', () => {
  const input = base();input.locks = [{date: '2026-11-02', kind: 'outside', candidateId: 'local'}];
  input.preferences.priority = 'easy';input.preferences.walkLimitMinutes = 5;
  const result = planMeals(input);
  for (const plan of result.plans) {
    const slot = plan.slots[0];
    assert.equal(slot.candidateId, 'local');
    assert.equal(slot.locked, true);
    assert.equal(slot.status, 'locked-conflict');
    assert.ok(codes(slot).includes('too-far'));
    assert.equal(plan.cost.adultEstimate, null);
  }
  input.locks = [{date: '2026-11-02', kind: 'outside', candidateId: 'deleted-place'}];
  assert.ok(planMeals(input).plans.every(plan => plan.slots[0].candidateId === 'deleted-place' && plan.slots[0].status === 'locked-conflict'));
});

test('local, easy and budget priorities actually rerank the same evidence without external calls or mutation', () => {
  const input = base(), original = JSON.stringify(input), oldFetch = globalThis.fetch;
  globalThis.fetch = () => {throw new Error('pure planning must not fetch');};
  try {
    assert.equal(find(planMeals(input), 'outside').slots[0].candidateId, 'local');
    assert.equal(find(planMeals({...input, preferences: {...input.preferences, priority: 'easy'}}), 'outside').slots[0].candidateId, 'near');
    assert.equal(find(planMeals({...input, preferences: {...input.preferences, priority: 'budget'}}), 'outside').slots[0].candidateId, 'near');
    assert.equal(JSON.stringify(input), original);
  } finally {globalThis.fetch = oldFetch;}
});

test('POI average is never a breakfast quote; missing menu prices use a separately labelled user budget', () => {
  const input = base();input.candidates = [candidate('poi', {price: {amount: 500, basis: 'poi_average', confirmed: true}, averagePrice: 500, average_cost: 500})];
  const outside = find(planMeals(input), 'outside');
  assert.equal(outside.status, 'feasible');
  assert.equal(outside.cost.knownAmount, 0);
  assert.equal(outside.cost.budgetAmount, 140);
  assert.equal(outside.cost.adultEstimate, 140);
  assert.equal(outside.cost.familyTotal, null);
  assert.ok(outside.cost.budgetItems.every(item => item.code === 'outside-user-budget'));
});

test('a missing price and budget still permits a time-feasible candidate while leaving its amount unknown', () => {
  const input = base();input.candidates = [candidate('no-menu', {price: null})];delete input.preferences.adultBudget;
  const outside = find(planMeals(input), 'outside');
  assert.equal(outside.status, 'feasible');
  assert.equal(outside.slots[0].status, 'scheduled');
  assert.equal(outside.cost.adultEstimate, null);
  assert.equal(outside.cost.knownAmount, 0);
  assert.ok(outside.cost.unknownAmounts.every(item => item.code === 'outside-price-unknown'));
});

test('allergen uncertainty is not safety; a known ingredient conflict excludes rather than suggests', () => {
  const input = base();input.restrictions = {allergens: ['花生']};
  input.candidates = [candidate('allergen', {dietary: {confirmed: true, excludedIngredients: ['花生']}})];
  let result = planMeals(input), option = result.evaluations['2026-11-02'].outside[0];
  assert.equal(option.state, 'pending');assert.ok(codes(option).includes('cross-contact-unknown'));
  assert.equal(option.allergenAssessment, 'requires-confirmation');
  input.candidates[0].dietary.crossContactConfirmed = true;
  option = planMeals(input).evaluations['2026-11-02'].outside[0];
  assert.equal(option.state, 'eligible');assert.equal(option.allergenAssessment, 'merchant-confirmed-recheck');
  input.candidates[0].dietary.contains = ['花生'];
  option = planMeals(input).evaluations['2026-11-02'].outside[0];
  assert.equal(option.state, 'excluded');assert.ok(codes(option).includes('ingredient-conflict'));
  assert.equal('safe' in option, false);
});

test('historical snapshots never become current executable evidence merely because values exist', () => {
  const input = base();input.candidates = [candidate('old', {breakfast: {confirmed: true, state: 'known_snapshot', schedules: [schedule({state: 'known_snapshot'})]}, price: {...price(10), automatic_quote_use: false}})];
  const result = planMeals(input), option = result.evaluations['2026-11-02'].outside[0];
  assert.equal(option.state, 'pending');assert.equal(option.adultPrice, null);
  assert.equal(find(result, 'outside').cost.knownAmount, 0);
  assert.equal(find(result, 'outside').cost.budgetAmount, 140);
});

test('missing weekday coverage is unknown; a conflict affects only its scoped date', () => {
  const input = base();input.checkIn = '2026-10-31';input.checkOut = '2026-11-02';
  input.hotelBreakfast.schedules = [schedule({isoWeekdays: [1, 2, 3, 4, 5, 6]})];
  input.hotelBreakfast.conflicts = [{isoWeekdays: [7], reason: 'Sunday conflict'}];
  const result = planMeals(input);
  assert.equal(result.evaluations['2026-11-01'].hotel.state, 'pending');
  assert.ok(codes(result.evaluations['2026-11-01'].hotel).includes('meal-time-unknown'));
  assert.equal(codes(result.evaluations['2026-11-01'].hotel).includes('closed'), false);
  assert.equal(result.evaluations['2026-11-02'].hotel.state, 'eligible');
});

test('user-selected hotel dates retain the entire package premium; unusable vouchers never reduce it', () => {
  const input = base();input.hotelBreakfast.usableDates = ['2026-11-03'];
  input.vouchers = [{id: 'wrong-meal', meal: 'dinner', amount: 500, valid: false}];
  const result = planMeals(input), hotel = find(result, 'hotel');
  assert.equal(hotel.slots[0].kind, 'outside');assert.equal(hotel.slots[1].kind, 'hotel');
  assert.equal(hotel.cost.hotelUseDays, 1);
  assert.equal(hotel.cost.knownItems.find(item => item.code === 'package-premium').amount, 240);
  assert.equal(hotel.cost.discountAmount, 0);
  assert.equal(hotel.voucherNotes[0].appliedDiscount, 0);
});

test('unknown tax, foreign currency or out-of-date menu values cannot enter known meal amounts', () => {
  for (const patch of [{taxIncluded: false}, {feesIncluded: false}, {currency: 'USD'}, {validTo: '2026-10-31'}, {isFromPrice: true}]) {
    const input = base();input.candidates = [candidate('uncertain', {price: {...price(10), ...patch}})];
    const outside = find(planMeals(input), 'outside');
    assert.equal(outside.cost.knownAmount, 0);
    assert.equal(outside.cost.budgetAmount, 140);
  }
});

test('invalid dates, party, time, duplicated candidate IDs and duplicate locks return explicit errors', () => {
  for (const patch of [{checkIn: '2026-02-30'}, {checkOut: '2027-01-01'}, {party: {adults: 0, children: 0}}, {departureTime: '25:00'}, {candidates: [candidate('same'), candidate('same')]}, {locks: [{date: '2026-11-02', kind: 'hotel'}, {date: '2026-11-02', kind: 'hotel'}]}]) {
    const result = planMeals({...base(), ...patch});
    assert.equal(result.status, 'invalid');assert.equal(result.plans.length, 0);assert.ok(result.errors.length);
  }
});

test('fractional route minutes round up conservatively and proposed times remain valid clock strings', () => {
  const input = base();input.candidates = [candidate('seconds', {route: {minutes: 2.2, confirmed: true}})];
  const option = planMeals(input).evaluations['2026-11-02'].outside[0];
  assert.equal(option.walkMinutes, 3);
  assert.equal(option.time.start, '07:03');assert.equal(option.time.returnHotel, '07:36');
});

test('a weekday-specific menu quote is not applied to a different weekday', () => {
  const input = base();input.candidates = [candidate('weekday-price', {price: {...price(10), isoWeekdays: [1]}})];
  const result = planMeals(input), outside = find(result, 'outside');
  assert.equal(result.evaluations['2026-11-02'].outside[0].adultPrice, 10);
  assert.equal(result.evaluations['2026-11-03'].outside[0].adultPrice, null);
  assert.equal(outside.cost.knownAmount, 20);
  assert.equal(outside.cost.budgetAmount, 70);
  assert.ok(outside.slots[0].selectionReasons.some(item => item.code === 'walking'));
});
