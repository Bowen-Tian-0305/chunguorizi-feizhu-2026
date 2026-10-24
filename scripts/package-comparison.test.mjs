import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePackages} from '../public/package-comparison.js';
import {createQuoteBook, putQuote, confirmQuote, confirmComparison, quoteAssessment, replaceQuote, setQuoteContext} from '../public/quote-context.js';
import {planMeals} from '../public/meal-planner.js';
import {planDining} from '../public/dining-planner.js';

const context = {city: '杭州', hotel: {id: 'flyai:101', name: '杭州测试酒店', address: '测试路1号'}, checkIn: '2026-11-01', checkOut: '2026-11-03'};
const party = {adults: 2, children: 0};
const quote = (total, slot, fields = {}, kind = 'manual', ctx = context) => ({context: ctx, source: {id: `${kind}-${slot}`, kind}, fields: {total, currency: 'CNY', priceBasis: 'total', roomType: '高级大床房', cancellation: '入住前一天可取消', payment: '预付', breakfastCount: slot === 'B' ? 2 : 0, mealRights: 0, ...fields}});
function book(extraA = {}, extraB = {}, kind = 'manual') {
  let result = putQuote(createQuoteBook(context), 'A', quote(1200, 'A', extraA, kind));
  result = putQuote(result, 'B', quote(1440, 'B', extraB, kind));
  return confirmComparison(confirmQuote(confirmQuote(result, 'A'), 'B'));
}
const slot = (date, kind = 'outside', meal = 'breakfast') => ({date, kind, meal, candidateId: kind === 'outside' ? 'food-1' : null, status: 'scheduled', name: '本地测试餐厅'});
const food = ({hotel = false, budget = false, children = false, premium = 240, conditional = false, costPatch = {}, slots} = {}) => {
  const knownItems = [...(hotel && premium !== null ? [{code: 'package-premium', amount: premium, description: '含早套餐全程增量'}] : []), ...(!hotel && !budget ? [{code: 'outside-menu', date: '2026-11-02', amount: 60}, {code: 'outside-menu', date: '2026-11-03', amount: 60}] : [])];
  return {status: 'feasible', slots: slots || [slot('2026-11-02', hotel ? 'hotel' : 'outside'), slot('2026-11-03', hotel ? 'hotel' : 'outside')], cost: {currency: 'CNY', scope: 'adult-breakfast-increment-excludes-room-price', knownItems, budgetItems: budget ? [{code: 'outside-user-budget', date: '2026-11-02', amount: 50}, {code: 'outside-user-budget', date: '2026-11-03', amount: 50}] : [], unknownAmounts: children ? [{code: 'children-price-unknown', scope: 'children', message: '儿童餐费未核'}] : [], conditional, quotesIncludeDemo: false, ...costPatch}};
};
const options = (a = food(), b = food({hotel: true})) => [{id: 'outside', quoteSlot: 'A', title: '早餐吃街坊', mealPlan: a}, {id: 'hotel', quoteSlot: 'B', title: '早餐在酒店', mealPlan: b}];
const compare = (opts = options(), quoteBook = book(), p = party) => comparePackages({quoteBook, party: p, options: opts});

test('whole room total is added once, with breakfast premium removed and input unchanged', () => {
  const input = {quoteBook: book(), party, options: options()}, before = JSON.stringify(input);
  const result = comparePackages(input), [a, b] = result.options;
  assert.equal(a.adultEstimate, 1320);
  assert.equal(b.adultEstimate, 1440);
  assert.equal(b.roomAmount, 1440);
  assert.equal(b.food.knownAmount, 0);
  assert.equal(b.food.removedPackagePremium, 240);
  assert.equal(result.comparison.difference, 120);
  assert.equal(result.comparison.cheapestOptionId, 'outside');
  assert.equal(result.breakfastAttribution.premium, 240);
  assert.equal(JSON.stringify(input), before);
});

test('choosing B and eating outside keeps full B price even when no hotel breakfast is used', () => {
  const result = compare([{id: 'B-outside', quoteSlot: 'B', mealPlan: food()}]);
  assert.equal(result.options[0].roomAmount, 1440);
  assert.equal(result.options[0].adultEstimate, 1560);
});

test('different meal benefits allow whole-package spending but never unlock breakfast attribution', () => {
  const quotes = book({}, {mealRights: 1, mealRightType: 'dinner'});
  assert.equal(quoteAssessment(quotes).comparable, false);
  const b = food({hotel: true, premium: null, costPatch: {unknownAmounts: [{code: 'package-premium-unknown', scope: 'adults', message: '早餐增量不可归因'}]}});
  const result = compare(options(food(), b), quotes);
  assert.equal(result.options[1].adultEstimate, 1440);
  assert.equal(result.comparison.difference, 120);
  assert.equal(result.breakfastAttribution.comparable, false);
  assert.equal(result.breakfastAttribution.premium, null);
  assert.ok(result.notices.some(item => item.code === 'different-package-terms' && item.field === 'mealRights'));
  assert.ok(result.notices.some(item => item.code === 'cash-comparison-only'));
  assert.equal(quoteAssessment(quotes).comparable, false);
});

test('room, cancellation and payment differences remain visible instead of becoming breakfast value', () => {
  const result = compare(options(), book({}, {roomType: '湖景大床房', cancellation: '不可取消', payment: '到店付'}));
  assert.equal(result.comparison.cheapestOptionId, 'outside');
  assert.deepEqual(result.notices.filter(item => item.code === 'different-package-terms').map(item => item.field).sort(), ['breakfastCount', 'cancellation', 'payment', 'roomType']);
  assert.equal(result.breakfastAttribution.premium, null);
});

test('user budgets are separate estimates, not confirmed costs or family totals', () => {
  const result = compare(options(food({budget: true}), food({hotel: true})));
  const a = result.options[0];
  assert.equal(a.knownAmount, 1200);
  assert.equal(a.budgetAmount, 100);
  assert.equal(a.adultEstimate, 1300);
  assert.equal(a.familyTotal, null);
  assert.equal(result.comparison.status, 'budget-estimate');
  assert.match(a.summary, /预算约/);
});

test('children never disappear from cost scope and never receive an invented family total', () => {
  const result = compare(options(), book(), {adults: 2, children: 1});
  assert.equal(result.options[0].adultEstimate, 1320);
  assert.equal(result.options[0].familyTotal, null);
  assert.ok(result.options.every(option => option.food.unknownAmounts.some(item => item.scope === 'children')));
  assert.match(result.comparison.summary, /未核儿童餐费/);
});

test('unknown adult spending prevents a price ranking and is not treated as zero', () => {
  const b = food({hotel: true, costPatch: {unknownAmounts: [{code: 'extra-adult-breakfast-unknown', date: '2026-11-02', scope: 'adults', message: '补买待核'}]}});
  const result = compare(options(food(), b));
  assert.equal(result.options[1].adultEstimate, null);
  assert.equal(result.comparison, null);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.options[1].food.unknownAmounts.some(item => item.code === 'extra-adult-breakfast-unknown'));
});

test('A plan cannot silently treat hotel breakfast as covered; B must cover all adults', () => {
  const a = compare([{id: 'A-hotel', quoteSlot: 'A', mealPlan: food({hotel: true})}]);
  assert.equal(a.options[0].adultEstimate, null);
  assert.ok(a.options[0].food.unknownAmounts.some(item => item.code === 'hotel-breakfast-entitlement-unknown'));
  const short = compare(options(), book({}, {breakfastCount: 1}));
  assert.equal(short.options[1].adultEstimate, null);
});

test('unconfirmed OCR price/basis, conflict, foreign currency and nightly prices are blocked', () => {
  for (const patch of [{currency: 'USD'}, {priceBasis: 'nightly'}, {total: -1}]) {
    const quotes = replaceQuote(book(), 'B', quote(1440, 'B', patch));
    assert.equal(compare(options(), quotes).options[1].status, 'blocked');
  }
  const unconfirmed = replaceQuote(book(), 'B', quote(1440, 'B', {}, 'screenshot'));
  assert.equal(compare(options(), unconfirmed).options[1].status, 'blocked');
  const totalOnly = confirmQuote(unconfirmed, 'B', ['total']);
  assert.equal(compare(options(), totalOnly).options[1].status, 'blocked');
  const conflicting = putQuote(book(), 'B', quote(1500, 'different-image', {}, 'screenshot'));
  assert.equal(compare(options(), conflicting).options[1].status, 'blocked');
});

test('different city, hotel branch and stay dates cannot reuse a confirmed quote', () => {
  for (const change of [{city: '上海'}, {hotel: {...context.hotel, id: 'flyai:102'}}, {hotel: {...context.hotel, address: '另一地址'}}, {checkOut: '2026-11-04'}]) {
    const quotes = {...book(), context: {...context, ...change}};
    assert.equal(compare(options(), quotes).comparison, null);
    assert.ok(compare(options(), quotes).options.every(option => option.status === 'blocked'));
  }
  const stale = setQuoteContext(book(), {...context, checkOut: '2026-11-04'});
  assert.equal(compare(options(), stale).options[0].status, 'blocked');
});

test('different meal coverage and demo/real mixtures cannot produce a cheaper-option ranking', () => {
  const fewer = food({hotel: true, slots: [slot('2026-11-02', 'hotel')]});
  assert.equal(compare(options(food(), fewer)).comparison, null);
  let mixed = book();
  mixed = replaceQuote(mixed, 'B', quote(1440, 'B', {}, 'demo'));
  assert.equal(compare(options(), mixed).comparison, null);
  const demo = compare(options(), book({}, {}, 'demo'));
  assert.match(demo.comparison.summary, /示例/);
  assert.equal(demo.options[0].familyTotal, null);
});

test('package-covered main meals must be bound to the selected quote before being free', () => {
  const dinner = food({slots: [slot('2026-11-01', 'hotel', 'dinner')], costPatch: {scope: 'adult-meals-increment-excludes-room-price', knownItems: [{code: 'package-meal-covered', date: '2026-11-01', meal: 'dinner', candidateId: 'hotel-restaurant', amount: 0, coveredByPackage: true}]}});
  const input = {id: 'B-dinner', quoteSlot: 'B', mealPlan: dinner};
  assert.equal(compare([input]).options[0].status, 'blocked');
  assert.equal(compare([{...input, mealPlanQuoteSlot: 'A'}]).options[0].status, 'blocked');
  assert.equal(compare([{...input, mealPlanQuoteSlot: 'B'}]).options[0].adultEstimate, 1440);
});

test('unknown voucher face values and aggregate discounts are never subtracted a second time', () => {
  const plan = food({costPatch: {discountAmount: 9999}});
  plan.voucherResults = [{id: 'unknown-voucher', value: 200, uses: 2, status: 'unapplied', appliedDiscount: 0, coveredAmount: 0, usesConsumed: 0}];
  const result = compare([{id: 'A', quoteSlot: 'A', mealPlan: plan}]);
  assert.equal(result.options[0].adultEstimate, 1320);
  assert.ok(result.options[0].notices.some(item => item.code === 'unverified-voucher-not-deducted'));
  plan.voucherResults[0] = {id: 'confirmed-voucher', status: 'applied', appliedDiscount: 20, coveredAmount: 0, usesConsumed: 1};
  assert.equal(compare([{id: 'A', quoteSlot: 'A', mealPlan: plan}]).options[0].status, 'blocked');
  assert.equal(compare([{id: 'A', quoteSlot: 'A', mealPlanQuoteSlot: 'A', mealPlan: plan}]).options[0].adultEstimate, 1320);
});

test('actual breakfast and dining outputs integrate without inferred voucher or menu value', () => {
  const breakfast = planMeals({checkIn: context.checkIn, checkOut: context.checkOut, party, quotes: {comparable: true, plain: 1200, included: 1440}, hotelBreakfast: {count: 2, confirmed: false, schedules: []}, candidates: [], preferences: {adultBudget: 25}}).plans.find(plan => plan.id === 'hotel');
  const dining = planDining({checkIn: context.checkIn, checkOut: context.checkOut, party, breakfastPlan: breakfast, candidates: [], preferences: {lunchBudget: 60, dinnerBudget: 80}, vouchers: [{id: 'unknown', value: 300, uses: 2, confirmedFields: []}]});
  const result = compare([{id: 'B', quoteSlot: 'B', mealPlanQuoteSlot: 'B', mealPlan: dining}]);
  assert.equal(result.options[0].roomAmount, 1440);
  assert.equal(result.options[0].food.removedPackagePremium, 240);
  assert.equal(result.options[0].adultEstimate, null); // unresolved main meals remain unknown, even with user budgets.
  assert.equal(result.options[0].budgetAmount, 440);
  assert.equal(result.options[0].knownAmount, 1440);
  assert.equal(result.options[0].familyTotal, null);
});

test('invalid input and malformed meal cost do not return a plausible financial total', () => {
  for (const input of [{}, {quoteBook: book(), party: {adults: 0, children: 0}, options: options()}, {quoteBook: book(), party, options: [{id: 'same', quoteSlot: 'A'}, {id: 'same', quoteSlot: 'B'}]}]) assert.equal(comparePackages(input).status, 'invalid');
  for (const patch of [{knownItems: [{amount: -5}]}, {knownItems: {}}, {budgetItems: null}, {unknownAmounts: [null]}, {scope: 'total-including-room'}, {currency: 'USD'}]) {
    assert.equal(compare([{id: 'A', quoteSlot: 'A', mealPlan: food({costPatch: patch})}]).options[0].status, 'blocked');
  }
  const malformedPlan = food(); malformedPlan.slots = {}; assert.equal(compare([{id: 'A', quoteSlot: 'A', mealPlan: malformedPlan}]).options[0].status, 'blocked');
  const malformedVoucher = food(); malformedVoucher.voucherResults = {}; assert.equal(compare([{id: 'A', quoteSlot: 'A', mealPlan: malformedVoucher}]).options[0].status, 'blocked');
});

test('unsupported reductions from confirmed menus are restored, while exact verified applications are retained once', () => {
  const plan = food({slots: [slot('2026-11-01', 'outside', 'dinner')], costPatch: {scope: 'adult-meals-increment-excludes-room-price', knownItems: [{code: 'confirmed-menu', date: '2026-11-01', meal: 'dinner', candidateId: 'food-1', amount: 60, originalAmount: 100}]}});
  plan.voucherResults = [{status: 'unapplied', value: 40, appliedDiscount: 0}];
  const option = {id: 'A', quoteSlot: 'A', mealPlanQuoteSlot: 'A', mealPlan: plan};
  assert.equal(compare([option]).options[0].adultEstimate, 1300);
  assert.ok(compare([option]).options[0].notices.some(item => item.code === 'unsupported-discount-restored'));
  plan.voucherResults = [{status: 'applied', appliedDiscount: 40, usesConsumed: 1, applications: [{date: '2026-11-01', meal: 'dinner', candidateId: 'food-1', kind: 'cash-discount', amount: 40}]}];
  assert.equal(compare([option]).options[0].adultEstimate, 1260);
  plan.voucherResults[0].applications[0].candidateId = 'different-branch';
  assert.equal(compare([option]).options[0].adultEstimate, 1300);
});
