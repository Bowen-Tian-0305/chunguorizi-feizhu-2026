import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildMealEvidence} from '../public/meal-evidence.js';
import {planMeals} from '../public/meal-planner.js';
import {planDining} from '../public/dining-planner.js';

const hotel = {id: 'supplier-1', reviewed_id: 'H09', name: '杭州城中香格里拉大酒店', address: '拱墅区长寿路6号杭州嘉里中心', longitude: 120.16, latitude: 30.26};
const trip = {hotel, checkIn: '2026-11-01', checkOut: '2026-11-03'};
const context = () => ({hotel: {...hotel}, checkIn: trip.checkIn, checkOut: trip.checkOut});
const route = () => ({minutes: 8, meters: 500, queried_at: '2026-10-23T06:00:00Z', source: '高德步行路径规划 2.0'});
const place = (patch = {}) => ({id: 'POI1', name: '具体早餐店', address: '某路10号', location: '120.17,30.27', route: route(), ...patch});
const evidence = () => ({
  hotel: {hotel_id: 'H09', name: hotel.name, address: hotel.address},
  sources: [{source_id: 'S1', url: 'https://example.com/menu', title: '公开菜单', retrieved_at: '2026-10-11'}],
  venues: [
    {venue_id: 'V1', hotel_id: 'H09', name: '酒店自助餐厅', address: hotel.address, source_ids: 'S1', services: [
      {service_id: 'H_LUNCH', meal_type: 'lunch', weekdays: '周一至周五', start_time: '11:30', end_time: '14:00', source_ids: 'S1'},
      {service_id: 'H_DINNER', meal_type: 'dinner', weekdays: 'Mon-Sat', start_time: '17:30', end_time: '21:00', source_ids: 'S1'}]},
    {venue_id: 'V2', hotel_id: '', name: '具体早餐店', address: '某路10号', source_ids: 'S1', services: [
      {service_id: 'E_BREAKFAST', meal_type: 'breakfast', weekdays: 'daily', start_time: '06:00', end_time: '10:00', source_ids: 'S1', local_specialties: '杭式点心'},
      {service_id: 'E_LUNCH', meal_type: 'lunch', weekdays: '未知', start_time: '11:00', end_time: '14:00', source_ids: 'S1'}]},
    {venue_id: 'OTHER', hotel_id: 'H10', name: '另一酒店的餐厅', services: [{service_id: 'WRONG', meal_type: 'dinner', weekdays: 'daily', start_time: '17:00', end_time: '22:00'}]}
  ], offers: [{offer_id: 'OF1', venue_id: 'V2', service_id: 'E_BREAKFAST', price: '28', currency: 'CNY', price_basis: 'per_person', is_from_price: 'false', source_ids: 'S1'}]
});
const refs = () => JSON.parse(readFileSync(new URL('../data/hotel_meal_policies.json', import.meta.url), 'utf8'));
const policy = pid => {const d = refs(); return {...d.hotels.find(h => h.policyId === pid), sources: d.sources};};
const confirmation = items => ({context: context(), items});
const schedule = (patch = {}) => ({confirmed: true, isoWeekdays: [1, 2, 3, 4, 5, 6, 7], start: '06:00', end: '10:00', ...patch});
const price = (amount, meal = 'breakfast', patch = {}) => ({confirmed: true, amount, currency: 'CNY', basis: 'per_adult_per_meal', scope: meal, taxIncluded: true, feesIncluded: true, ...patch});

test('reused manual ids and contradictory addresses never carry trip confirmations to another property',()=>{
  const currentHotel={...hotel,id:'manual-0',name:'另一家酒店',address:'另外路20号'};
  const confirmations={context:{hotel:{...hotel,id:'manual-0'},checkIn:trip.checkIn,checkOut:trip.checkOut},items:[{candidateId:'POI1',meal:'breakfast',date:'2026-11-02',confirmed:true,schedules:[schedule()]}]};
  let result=buildMealEvidence({...trip,hotel:currentHotel,places:[place()],confirmations});
  assert.equal(result.candidates[0].breakfast.confirmed,false);
  confirmations.context.hotel={...currentHotel,address:'错误分店地址'};
  result=buildMealEvidence({...trip,hotel:currentHotel,places:[place()],confirmations});
  assert.equal(result.candidates[0].breakfast.confirmed,false);
});

test('public hotel policy is reference-only, has no inferred count, and preserves prices and child conditions', () => {
  assert.deepEqual(buildMealEvidence({hotel: null}).candidates, []);
  const result = buildMealEvidence({...trip, mealPolicy: policy('HD04')});
  assert.equal(result.hotelBreakfast.confirmed, false);
  assert.equal(result.hotelBreakfast.tripConfirmed, false);
  assert.equal('count' in result.hotelBreakfast, false);
  assert.ok(result.hotelBreakfast.referenceSchedules.length);
  assert.ok(result.hotelBreakfast.referenceSchedules.every(s => !s.confirmed));
  assert.ok(result.hotelBreakfast.priceReferences.every(p => !p.confirmed && p.automatic_quote_use === false));
  assert.ok(result.hotelBreakfast.childRuleReferences.some(r => r.conditions?.circleMember === true));
  assert.deepEqual(result.hotelMeals, []);
});

test('published contradictions remain visible while common intervals take precedence for proposals', () => {
  for (const [pid, name, address, expectedStart, expectedEnd] of [
    ['HD08', '杭州西湖假日酒店', '拱墅区延安路348号', '06:30', '10:00'],
    ['HD25', '杭州金沙湖和达希尔顿嘉悦里酒店', '钱塘区金沙大道835号', '06:30', '10:30']
  ]) {
    const p = policy(pid), h = {name, address};
    const result = buildMealEvidence({...trip, hotel: h, mealPolicy: p});
    assert.ok(result.hotelBreakfast.publishedSchedules.length > result.hotelBreakfast.referenceSchedules.length);
    assert.ok(result.hotelBreakfast.referenceSchedules.every(s => s.start === expectedStart));
    assert.equal(result.hotelBreakfast.referenceSchedules.find(s => s.isoWeekdays.includes(6)).end, expectedEnd);
    assert.ok(result.hotelBreakfast.conflicts.length);
    assert.ok(result.hotelBreakfast.conflicts.every(c => c.timeScope && 'start' in c.timeScope && !c.tripConfirmed));
  }
});

test('current walking API maps minutes but POI cost and present-day opening do not become meal facts', () => {
  const result = buildMealEvidence({...trip, places: [place({cost: '8', opentime_today: '00:00-24:00', business_hours: '全天', price: price(8)})]});
  const c = result.candidates[0];
  assert.equal(c.route.confirmed, true);
  assert.equal(c.route.minutes, 8);
  assert.equal(c.longitude, 120.17);
  assert.equal(c.latitude, 30.27);
  assert.equal(c.price, null);
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    assert.equal(c.meals[meal].confirmed, false);
    assert.deepEqual(c.meals[meal].schedules, []);
  }
  const unverified = buildMealEvidence({...trip, places: [place({route: {minutes: 8, confirmed: true}, location: ',30.27'})]}).candidates[0];
  assert.equal(unverified.route.confirmed, false);
  assert.equal(unverified.longitude, null);
});

test('nested and flat evidence group hotel meals and never give another hotel onsite privileges', () => {
  const input = evidence();
  const result = buildMealEvidence({...trip, evidence: input, places: [place({curated_match: {venue_id: 'V2'}})]});
  assert.deepEqual(result.hotelMeals.map(c => c.id), ['V1']);
  assert.equal(result.hotelMeals[0].route.minutes, 0);
  assert.equal(result.hotelMeals[0].onSite, true);
  assert.deepEqual(result.hotelMeals[0].meals.lunch.referenceSchedules[0].isoWeekdays, [1, 2, 3, 4, 5]);
  assert.deepEqual(result.hotelMeals[0].meals.dinner.referenceSchedules[0].isoWeekdays, [1, 2, 3, 4, 5, 6]);
  assert.equal(result.candidates[0].meals.lunch.referenceSchedules[0].isoWeekdays, null);
  assert.ok(result.sourceNotes.some(n => n.code === 'meal-weekdays-unknown'));
  const flat = {...input, meal_services: input.venues.flatMap(v => v.services.map(s => ({...s, venue_id: v.venue_id}))), venues: input.venues.map(({services, ...v}) => v)};
  assert.equal(buildMealEvidence({...trip, evidence: flat}).hotelMeals.length, 1);
});

test('confirmations require both exact dates and stable hotel id or complete name plus address', () => {
  const items = [{candidateId: 'POI1', meal: 'breakfast', confirmed: true, schedules: [schedule()], price: price(30)}];
  for (const patch of [{checkIn: '2026-11-02'}, {checkOut: '2026-11-04'}, {hotel: {id: 'other', name: hotel.name, address: '另一地址'}}, {hotel: {name: hotel.name}}]) {
    const result = buildMealEvidence({...trip, places: [place()], confirmations: {context: {...context(), ...patch}, items}});
    assert.equal(result.candidates[0].breakfast.confirmed, false);
    assert.equal(result.candidates[0].price, null);
    assert.ok(result.sourceNotes.some(n => n.code === 'confirmation-context-mismatch'));
  }
  const byFullIdentity = buildMealEvidence({...trip, places: [place()], confirmations: {context: {...context(), hotel: {name: hotel.name, address: hotel.address}}, items}});
  assert.equal(byFullIdentity.candidates[0].breakfast.confirmed, true);
});

test('a supply checkbox cannot confirm old schedules, price, dietary, another meal or another candidate', () => {
  const result = buildMealEvidence({...trip, evidence: evidence(), places: [place({curated_match: {venue_id: 'V2'}}), place({id: 'POI2'})], confirmations: confirmation([{candidateId: 'POI1', meal: 'breakfast', confirmed: true}])});
  const c = result.candidates[0];
  assert.equal(c.breakfast.confirmed, true);
  assert.ok(c.breakfast.schedules.every(s => !s.confirmed));
  assert.equal(c.price, null);
  assert.equal(c.breakfast.dietary, undefined);
  assert.equal(c.meals.lunch.confirmed, false);
  assert.equal(result.candidates[1].breakfast.confirmed, false);
});

test('every dimension has its own confirmation; malformed scope, unknown source and venue hours are rejected', () => {
  const cases = [
    {schedules: [schedule({confirmed: false})]},
    {schedules: [schedule({scope: 'venue_hours'})]},
    {schedules: [schedule({isoWeekdays: undefined})]},
    {schedules: [schedule({referenceId: 'nonexistent'})]},
    {schedules: [schedule({end: null})]}
  ];
  for (const patch of cases) {
    const result = buildMealEvidence({...trip, places: [place()], confirmations: confirmation([{candidateId: 'POI1', meal: 'breakfast', confirmed: true, ...patch, price: price(20, 'breakfast', {confirmed: false}), dietary: {confirmed: false, excludedIngredients: ['花生']}}])});
    assert.ok(result.candidates[0].breakfast.schedules.every(s => !s.confirmed));
    assert.equal(result.candidates[0].price, null);
    assert.deepEqual(result.candidates[0].breakfast.dietaryByDate, {});
  }
});

test('a matching reference confirms only that value, preserving original public source and user origin', () => {
  const p = policy('HD04'), referenceId = p.compatiblePublishedWindows[0].id;
  const result = buildMealEvidence({...trip, mealPolicy: p, confirmations: confirmation([{candidateId: 'hotel-breakfast', meal: 'breakfast', confirmed: true, schedules: [{referenceId, confirmed: true}]}])});
  assert.equal(result.hotelBreakfast.tripConfirmed, true);
  assert.deepEqual(result.hotelBreakfast.confirmationContext.checkIn, trip.checkIn);
  assert.equal(result.hotelBreakfast.schedules[0].origin.type, 'user_confirmed_public_reference');
  assert.equal(result.hotelBreakfast.schedules[0].origin.referenceId, referenceId);
  assert.ok(result.hotelBreakfast.schedules[0].sourceRefs.some(s => s.url?.includes('shangri-la.com')));
  assert.equal(result.hotelBreakfast.price, null);
  assert.equal('count' in result.hotelBreakfast, false);
});

test('explicit inputs stay dated; multi-day prices and dietary confirmations do not leak across days', () => {
  const result = buildMealEvidence({...trip, places: [place()], confirmations: confirmation([
    {candidateId: 'POI1', meal: 'breakfast', date: '2026-11-02', confirmed: true, schedules: [schedule()], price: price(20), dietary: {confirmed: true, contains: [], excludedIngredients: ['花生'], crossContactConfirmed: true}},
    {candidateId: 'POI1', meal: 'breakfast', date: '2026-11-03', confirmed: true, schedules: [schedule()], price: price(35)}
  ])});
  const c = result.candidates[0];
  assert.deepEqual(c.breakfast.confirmedDates, ['2026-11-02', '2026-11-03']);
  assert.deepEqual(c.breakfast.schedules.map(s => [s.validFrom, s.validTo]), [['2026-11-02', '2026-11-02'], ['2026-11-03', '2026-11-03']]);
  assert.equal(c.price, null);
  assert.equal(c.priceByDate['2026-11-02'].amount, 20);
  assert.equal(c.priceByDate['2026-11-03'].amount, 35);
  assert.equal(c.breakfast.dietaryByDate['2026-11-02'].confirmed, true);
  assert.equal(c.breakfast.dietaryByDate['2026-11-03'], undefined);
  assert.equal(c.breakfast.dietary, undefined);
  assert.equal(c.priceByDate['2026-11-02'].origin.type, 'user_input');
});

test('explicit same-price confirmations merge dates while unknown taxes and POI averages stay unusable as confirmed totals', () => {
  const result = buildMealEvidence({...trip, places: [place()], confirmations: confirmation([
    {candidateId: 'POI1', meal: 'breakfast', date: '2026-11-02', price: price(20, 'breakfast', {taxIncluded: undefined, feesIncluded: undefined})},
    {candidateId: 'POI1', meal: 'breakfast', date: '2026-11-03', price: price(20, 'breakfast', {taxIncluded: undefined, feesIncluded: undefined})}
  ])});
  const c = result.candidates[0];
  assert.deepEqual(c.price.dates, ['2026-11-02', '2026-11-03']);
  assert.equal(c.price.taxIncluded, null);
  assert.equal(c.price.feesIncluded, null);
  assert.equal(c.breakfast.confirmed, false);
});

test('weekday ranges parse explicitly while empty, partial, invalid, or unknown labels remain unknown', () => {
  const labels = ['每日', 'Mon-Fri', '星期六至星期日', '周一、周三', '周一至五', '', '未知', 'Mon-Funday'];
  const expected = [[1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5], [6, 7], [1, 3], [1, 2, 3, 4, 5], null, null, null];
  for (let i = 0; i < labels.length; i++) {
    const e = evidence(); e.venues[0].services[0].weekdays = labels[i];
    assert.deepEqual(buildMealEvidence({...trip, evidence: e}).hotelMeals[0].meals.lunch.referenceSchedules[0].isoWeekdays, expected[i]);
  }
});

test('adapter is pure and imports work directly in the actual breakfast planner', () => {
  const input = {...trip, places: [place()], evidence: evidence(), mealPolicy: policy('HD04'), confirmations: confirmation([{candidateId: 'POI1', meal: 'breakfast', date: '2026-11-02', confirmed: true, schedules: [schedule()], price: price(20)}])};
  const before = JSON.stringify(input), originalFetch = globalThis.fetch;
  globalThis.fetch = () => {throw new Error('adapter must never request');};
  try {
    const adapted = buildMealEvidence(input);
    assert.equal(JSON.stringify(input), before);
    const result = planMeals({...trip, ...adapted, party: {adults: 2, children: 0}, preferences: {adultBudget: 35, walkLimitMinutes: 15, readyTime: '06:00', mealMinutes: 30}, quotes: {comparable: true, plain: 1200, included: 1440}});
    assert.equal(result.evaluations['2026-11-02'].outside[0].state, 'eligible');
    assert.equal(result.evaluations['2026-11-02'].outside[0].adultPrice, 20);
    assert.equal(result.evaluations['2026-11-03'].outside[0].state, 'pending');
    assert.equal(result.evaluations['2026-11-03'].outside[0].adultPrice, null);
  } finally {globalThis.fetch = originalFetch;}
});

test('ambiguous duplicate POI ids and another property policy cannot confirm a specific branch', () => {
  const result = buildMealEvidence({...trip, mealPolicy: policy('HD25'), places: [place(), place({address: '不同分店20号'})]});
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.hotelBreakfast.referenceSchedules, []);
  assert.ok(result.sourceNotes.some(n => n.code === 'ambiguous-place-id'));
  assert.ok(result.sourceNotes.some(n => n.code === 'policy-hotel-mismatch'));
});

test('adapter feeds actual lunch/dinner planner with date-specific verified supply, time and price', () => {
  const adapted = buildMealEvidence({...trip, evidence: evidence(), places: [place()], confirmations: confirmation([{candidateId: 'POI1', meal: 'lunch', date: '2026-11-02', confirmed: true, schedules: [schedule({start: '11:00', end: '14:00'})], price: price(45, 'lunch')}])});
  const result = planDining({...trip, ...adapted, party: {adults: 2, children: 0}, arrivalTime: '16:00', departureTime: '10:00', preferences: {lunchTime: '12:00', dinnerTime: '18:00', walkLimitMinutes: 15, mealMinutes: 45, lunchBudget: 50, dinnerBudget: 60}});
  const lunch = result.slots.find(s => s.date === '2026-11-02' && s.meal === 'lunch');
  assert.equal(lunch.status, 'scheduled');
  assert.equal(lunch.candidateId, 'POI1');
  assert.equal(lunch.adultPrice, 45);
  assert.ok(result.cost.knownItems.some(item => item.date === '2026-11-02' && item.meal === 'lunch' && item.amount === 90));
  assert.equal(result.slots.find(s => s.date === '2026-11-02' && s.meal === 'dinner').status, 'pending');
});


test('a dated confirmed menu survives adaptation and redeems only its matching voucher', () => {
  const item = {candidateId:'V1', meal:'lunch', date:'2026-11-02', confirmed:true,
    schedules:[schedule({start:'11:30',end:'14:00'})], price:price(50,'lunch',{menuId:' lunch-menu-1 '})};
  const coupon={id:'voucher1',type:'fixed_amount',currency:'CNY',venueId:'V1',menuId:'lunch-menu-1',meal:'lunch',validFrom:'2026-11-02',validTo:'2026-11-02',isoWeekdays:[1],maxAdults:2,childrenPolicy:'not_applicable',uses:1,value:20,minimumSpend:0,minimumSpendBasis:'original_adult_menu_subtotal',stacking:'none',extraFees:0,reservation:'not_required'};
  coupon.confirmedFields=Object.keys(coupon);
  const adapted=()=>buildMealEvidence({...trip,evidence:evidence(),confirmations:confirmation([item])});
  const run=(voucher=coupon)=>planDining({...trip,party:{adults:2,children:0},hotelMeals:adapted().hotelMeals,vouchers:[voucher]});
  assert.equal(adapted().hotelMeals[0].meals.lunch.priceByDate['2026-11-02'].menuId,'lunch-menu-1');
  assert.equal(run().voucherResults[0].appliedDiscount,20);
  assert.equal(run({...coupon,menuId:'different-menu'}).voucherResults[0].appliedDiscount,0);
  assert.equal(run({...coupon,validFrom:'2026-11-03',validTo:'2026-11-03',isoWeekdays:[2]}).voucherResults[0].appliedDiscount,0);
  item.price.confirmed=false;
  assert.equal(run().voucherResults[0].appliedDiscount,0);
  item.price.confirmed=true;item.price.menuId={id:'lunch-menu-1'};
  assert.equal(run().voucherResults[0].appliedDiscount,0);
});
