import test from 'node:test';
import assert from 'node:assert/strict';
import {planDining} from '../public/dining-planner.js';
import {createMealFeedback,saveMealFeedback} from '../public/meal-feedback.js';
const days=[1,2,3,4,5,6,7];
const schedule=(meal,patch={})=>({isoWeekdays:days,start:meal==='lunch'?'11:00':'17:00',end:meal==='lunch'?'15:00':'21:00',confirmed:true,...patch});
const menu=(meal,amount=100,patch={})=>({amount,currency:'CNY',basis:'per_adult_per_meal',scope:meal,confirmed:true,taxIncluded:true,feesIncluded:true,menuId:meal+'-menu',...patch});
const venue=(id='restaurant')=>({id,name:'具体餐厅'+id,longitude:120.16,latitude:30.27,route:{minutes:8,confirmed:true},meals:{lunch:{confirmed:true,schedules:[schedule('lunch')]},dinner:{confirmed:true,schedules:[schedule('dinner')]}},prices:{lunch:menu('lunch'),dinner:menu('dinner')}});
function input(){return {checkIn:'2026-11-01',checkOut:'2026-11-03',party:{adults:2,children:0},arrivalTime:'16:00',departureTime:'10:00',breakfastPlan:{slots:[{date:'2026-11-02',kind:'hotel',candidateId:null,name:'酒店早餐',status:'scheduled',time:{start:'07:00',end:'07:30'}},{date:'2026-11-03',kind:'hotel',candidateId:null,name:'酒店早餐',status:'scheduled',time:{start:'07:00',end:'07:30'}}],cost:{knownItems:[{code:'package-premium',amount:240}],budgetItems:[],unknownAmounts:[],quotesIncludeDemo:true}},hotelMeals:[venue()],candidates:[],preferences:{priority:'easy',walkLimitMinutes:15,mealMinutes:45,lunchTime:'12:00',dinnerTime:'18:00'}};}
function voucher(patch={}){const v={id:'voucher',type:'fixed_amount',currency:'CNY',venueId:'restaurant',menuId:'dinner-menu',meal:'dinner',validFrom:'2026-11-01',validTo:'2026-11-03',isoWeekdays:days,maxAdults:2,childrenPolicy:'not_applicable',uses:2,value:50,minimumSpend:150,minimumSpendBasis:'original_adult_menu_subtotal',stacking:'none',extraFees:0,reservation:'not_required',...patch};v.confirmedFields=Object.keys(v);return v;}

test('past feedback reranks feasible later dining without changing hard constraints, locks or prices',()=>{
  const value=input(),context={hotel:{id:'hotel-1',name:'测试酒店',address:'测试路1号'},checkIn:value.checkIn,checkOut:value.checkOut};
  value.hotelMeals=[];value.candidates=[venue('first'),venue('liked')];value.preferences.priority='easy';
  value.feedbackContext=context;
  value.feedback=saveMealFeedback(createMealFeedback(context),{id:'f1',candidateId:'liked',date:'2026-11-01',meal:'dinner',taste:'liked',partyAcceptance:'all',actualSpend:{amount:12,currency:'CNY',basis:'party_total',adults:2,children:0}},{context,now:Date.parse('2026-11-02T12:00:00+08:00')}).state;
  const later=()=>planDining(value).slots.find(slot=>slot.date==='2026-11-02'&&slot.meal==='lunch');
  assert.equal(later().candidateId,'liked');assert.equal(later().adultPrice,100);
  assert.equal(later().feedback.previousActualSpend.amount,12);
  value.candidates[1].dietary={confirmed:true,contains:['花生']};value.restrictions={avoidIngredients:['花生']};
  assert.equal(later().candidateId,'first');
  value.restrictions={avoidIngredients:[]};value.locks=[{date:'2026-11-02',meal:'lunch',kind:'outside',candidateId:'first'}];
  assert.equal(later().candidateId,'first');assert.equal(later().locked,true);
  value.locks=[];value.feedbackContext={...context,hotel:{...context.hotel,address:'另一分店'}};
  assert.equal(later().candidateId,'first');
});

test('complete meal coverage preserves breakfast objects and counts the whole-stay premium once',()=>{
  const value=input(),original=structuredClone(value);value.arrivalTime='14:00';value.departureTime='15:00';
  const result=planDining(value);
  assert.equal(result.status,'ready');assert.equal(result.slots.length,7);
  assert.deepEqual(result.slots.filter(slot=>!slot.meal),original.breakfastPlan.slots);
  assert.equal(result.cost.knownItems.filter(item=>item.code==='package-premium').length,1);
  assert.equal(result.cost.knownAmount,1240);
  assert.equal(value.breakfastPlan.cost.knownItems[0].amount,240);
  assert.equal(result.cost.quotesIncludeDemo,true);
});
test('overlapping breakfast and main meals remain visible but cannot form a ready plan or complete cost',()=>{
  const value=input();value.breakfastPlan.slots[0].time={start:'12:00',end:'12:30'};
  const result=planDining(value),lunch=result.slots.find(slot=>slot.date==='2026-11-02'&&slot.meal==='lunch');
  assert.equal(lunch.candidateId,'restaurant');assert.equal(lunch.status,'pending');assert.equal(lunch.time,null);
  assert.ok(lunch.reasons.some(item=>item.code==='meal-overlap'));
  assert.equal(result.cost.adultEstimate,null);
  assert.ok(result.cost.unknownAmounts.some(item=>item.code==='overlapping-meal'));
  value.locks=[{date:'2026-11-02',meal:'lunch',kind:'hotel',candidateId:'restaurant'}];
  assert.equal(planDining(value).slots.find(slot=>slot.date==='2026-11-02'&&slot.meal==='lunch').status,'locked-conflict');
});
test('nearby lunch and dinner preferences cannot overlap their eating windows',()=>{
  const value=input();value.preferences.lunchTime='17:30';value.preferences.dinnerTime='18:00';
  value.hotelMeals[0].meals.lunch.schedules=[schedule('lunch',{end:'19:00'})];
  const result=planDining(value),dinner=result.slots.find(slot=>slot.date==='2026-11-02'&&slot.meal==='dinner');
  assert.equal(dinner.status,'pending');assert.equal(dinner.time,null);
  assert.ok(dinner.reasons.some(item=>item.code==='meal-overlap'));
});
test('third meal checks every earlier interval even when the middle meal ends first',()=>{
  const value=input();value.breakfastPlan.slots[0].time={start:'11:00',end:'13:00'};
  value.preferences.lunchTime='11:10';value.preferences.dinnerTime='12:00';
  value.hotelMeals[0].meals.dinner.schedules=[schedule('dinner',{start:'11:00',end:'15:00'})];
  value.vouchers=[voucher({validFrom:'2026-11-02',validTo:'2026-11-02',uses:1})];
  const result=planDining(value),day=result.slots.filter(slot=>slot.date==='2026-11-02');
  const lunch=day.find(slot=>slot.meal==='lunch'),dinner=day.find(slot=>slot.meal==='dinner');
  assert.equal(lunch.status,'pending');assert.equal(dinner.status,'pending');assert.equal(dinner.time,null);
  assert.ok(dinner.reasons.some(item=>item.code==='meal-overlap'&&item.message.includes('早餐')));
  assert.ok(!result.cost.knownItems.some(item=>item.date==='2026-11-02'&&item.meal==='dinner'));
  assert.equal(result.voucherResults[0].usesConsumed,0);
  assert.equal(result.cost.adultEstimate,null);
});
test('unknown arrival is provisional and unknown departure adds no invented checkout main meal',()=>{
  const value=input();delete value.arrivalTime;delete value.departureTime;
  const result=planDining(value),first=result.slots.find(slot=>slot.date===value.checkIn);
  assert.equal(first.meal,'dinner');assert.equal(first.status,'pending');assert.equal(first.time,null);
  assert.equal(first.tentativeTime.start,'18:00');assert.ok(first.reasons.some(item=>item.code==='arrival-time-unknown'));
  assert.equal(result.slots.filter(slot=>slot.date===value.checkOut&&slot.meal).length,0);
});
test('route limit and insufficient time cannot silently replace a locked restaurant',()=>{
  const value=input();value.hotelMeals=[];value.candidates=[venue('outside')];value.preferences.walkLimitMinutes=5;
  value.locks=[{date:'2026-11-02',meal:'lunch',kind:'outside',candidateId:'outside'}];
  const result=planDining(value),locked=result.slots.find(slot=>slot.date==='2026-11-02'&&slot.meal==='lunch');
  assert.equal(locked.status,'locked-conflict');assert.equal(locked.candidateId,'outside');assert.equal(locked.time,null);assert.equal(locked.tentativeTime,null);
  assert.equal(result.cost.adultEstimate,null);
  value.preferences.walkLimitMinutes=15;value.departureTime='12:10';
  assert.ok(planDining(value).slots.filter(slot=>slot.date===value.checkOut&&slot.meal==='lunch').every(slot=>slot.status!=='scheduled'));
});
test('meal service days and full meal windows are separate from general venue hours',()=>{
  const value=input();value.hotelMeals[0].meals.lunch.schedules=[schedule('lunch',{scope:'venue_hours'})];
  assert.equal(planDining(value).slots.find(slot=>slot.meal==='lunch').status,'pending');
  value.hotelMeals[0].meals.lunch.schedules=[schedule('lunch',{isoWeekdays:[2],closed:true})];
  assert.equal(planDining(value).slots.find(slot=>slot.meal==='lunch').status,'pending');
});
test('historical prices, missing tax and POI averages never become known menu amounts',()=>{
  for(const patch of [{state:'known_snapshot'},{taxIncluded:false},{currency:'USD'},{isFromPrice:true}]){
    const value=input();value.hotelMeals[0].prices={lunch:menu('lunch',100,patch),dinner:menu('dinner',100,patch)};value.hotelMeals[0].cost=20;
    assert.equal(planDining(value).cost.knownAmount,240);assert.equal(planDining(value).cost.adultEstimate,null);
  }
});
test('user budgets stay separate and unknown children never become a family total',()=>{
  const value=input();value.party.children=1;value.hotelMeals[0].prices={};value.preferences.lunchBudget=30;value.preferences.dinnerBudget=60;
  const result=planDining(value);assert.equal(result.cost.knownAmount,240);assert.equal(result.cost.budgetAmount,300);assert.equal(result.cost.adultEstimate,540);assert.equal(result.cost.familyTotal,null);assert.ok(result.cost.unknownAmounts.some(item=>item.scope==='children'));
});
test('local preference diversifies actual candidates and known ingredient conflicts are excluded',()=>{
  const value=input();value.hotelMeals=[];value.candidates=[venue('one'),venue('two')];value.preferences.priority='local';
  let result=planDining(value);assert.equal(new Set(result.slots.filter(slot=>slot.meal).map(slot=>slot.candidateId)).size,2);
  value.restrictions={avoidIngredients:['花生'],allergens:[]};value.candidates[0].dietary={confirmed:true,contains:['花生']};
  result=planDining(value);assert.ok(result.slots.filter(slot=>slot.meal).every(slot=>slot.candidateId==='two'));
  value.restrictions={avoidIngredients:[],allergens:['花生']};assert.ok(planDining(value).slots.filter(slot=>slot.meal).every(slot=>slot.status==='pending'));
});
test('per-day supply, price and dietary confirmations cannot leak to another date',()=>{
  const value=input(),dinner=value.hotelMeals[0].meals.dinner;
  dinner.confirmedDates=['2026-11-01'];dinner.priceByDate={'2026-11-01':menu('dinner',20),'2026-11-02':menu('dinner',40)};
  const result=planDining(value),dinners=result.slots.filter(slot=>slot.meal==='dinner');
  assert.equal(dinners[0].adultPrice,20);assert.equal(dinners[1].adultPrice,40);assert.equal(dinners[0].status,'scheduled');assert.equal(dinners[1].status,'pending');
});
test('unconfirmed vouchers do not reduce any amount and cannot redeem a user budget',()=>{
  const value=input();value.vouchers=[{id:'unknown',uses:2,value:200}];
  assert.equal(planDining(value).cost.discountAmount,0);assert.equal(planDining(value).cost.knownAmount,840);
  value.vouchers=[voucher()];value.hotelMeals[0].prices={};value.preferences.lunchBudget=30;value.preferences.dinnerBudget=100;
  assert.equal(planDining(value).voucherResults[0].usesConsumed,0);assert.equal(planDining(value).cost.discountAmount,0);
});
test('verified cash vouchers match menu, date, people and uses, with bounded deductions',()=>{
  const value=input();value.vouchers=[voucher()];const original=structuredClone(value),result=planDining(value);
  assert.equal(result.cost.discountAmount,100);assert.equal(result.cost.knownAmount,740);assert.equal(result.voucherResults[0].usesConsumed,2);assert.deepEqual(value,original);
  value.vouchers=[voucher({value:10000})];assert.equal(planDining(value).cost.discountAmount,400);
  for(const patch of [{menuId:'another-menu'},{maxAdults:1},{extraFees:10},{validTo:'2026-10-31'},{currency:'USD'},{reservation:'pending'}]){value.vouchers=[voucher(patch)];assert.equal(planDining(value).cost.discountAmount,0);}
});
test('included meals are not cash discounts and cannot stack over an already included package meal',()=>{
  const value=input();value.vouchers=[voucher({type:'included_meal',value:0})];let result=planDining(value);
  assert.equal(result.voucherResults[0].coveredAmount,400);assert.equal(result.cost.discountAmount,0);assert.equal(result.cost.knownAmount,440);
  value.quoteSlot='B';value.hotelMeals[0].meals.dinner.coveredByPackage={quoteSlot:'B',confirmed:true};
  result=planDining(value);assert.equal(result.voucherResults[0].coveredAmount,0);assert.equal(result.cost.knownAmount,440);
});
test('non-stackable redemptions and voucher counts remain bounded across the whole stay',()=>{
  const value=input();value.vouchers=[voucher({id:'first',uses:1}),voucher({id:'second',uses:2,stacking:'allowed'})];
  const result=planDining(value);assert.equal(result.voucherResults[0].usesConsumed,1);assert.equal(result.voucherResults[1].usesConsumed,1);assert.equal(result.cost.discountAmount,100);
});
test('invalid trip constraints return explicit errors without changing input',()=>{
  for(const patch of [{checkOut:'2026-02-30'},{arrivalTime:'29:00'},{party:{adults:0,children:0}},{preferences:{mealMinutes:0}},{candidates:[venue(),venue()]}]){
    const value={...input(),...patch},original=structuredClone(value);assert.equal(planDining(value).status,'invalid');assert.deepEqual(value,original);
  }
});
test('changing arrival or departure keeps locked main meals visible with their actual conflict',()=>{
  const value=input();value.departureTime='10:00';
  value.locks=[{date:value.checkOut,meal:'lunch',kind:'hotel',candidateId:'restaurant'}];
  let slot=planDining(value).slots.find(slot=>slot.date===value.checkOut&&slot.meal==='lunch');
  assert.equal(slot.candidateId,'restaurant');assert.equal(slot.locked,true);assert.equal(slot.status,'locked-conflict');assert.equal(slot.time,null);
  delete value.departureTime;
  slot=planDining(value).slots.find(slot=>slot.date===value.checkOut&&slot.meal==='lunch');
  assert.equal(slot.locked,true);assert.equal(slot.status,'pending');assert.equal(slot.time,null);assert.ok(slot.reasons.some(item=>item.code==='departure-time-unknown'));
  value.locks=[{date:value.checkIn,meal:'lunch',kind:'hotel',candidateId:'restaurant'}];
  slot=planDining(value).slots.find(slot=>slot.date===value.checkIn&&slot.meal==='lunch');
  assert.equal(slot.locked,true);assert.equal(slot.status,'locked-conflict');assert.equal(slot.time,null);
});
test('a voucher menu identifier must come from the exact confirmed menu price used on that day',()=>{
  const value=input(),place=value.hotelMeals[0];
  place.priceByDate={dinner:{'2026-11-01':menu('dinner',20,{menuId:'small-menu'})}};
  value.vouchers=[voucher({uses:1,validTo:'2026-11-01',minimumSpend:0})];
  let result=planDining(value),slot=result.slots.find(slot=>slot.date===value.checkIn&&slot.meal==='dinner');
  assert.equal(slot.adultPrice,20);assert.equal(slot.menuId,'small-menu');assert.equal(result.cost.discountAmount,0);
  value.vouchers=[voucher({uses:1,validTo:'2026-11-01',menuId:'small-menu',minimumSpend:0})];
  assert.equal(planDining(value).cost.discountAmount,40);
  place.priceByDate.dinner['2026-11-01'].taxIncluded=false;
  result=planDining(value);slot=result.slots.find(slot=>slot.date===value.checkIn&&slot.meal==='dinner');
  assert.equal(slot.adultPrice,null);assert.equal(slot.menuId,null);assert.equal(result.cost.discountAmount,0);
});
test('public meal conflicts respect their date range and unknown weekday coverage stays uncertain',()=>{
  const value=input(),meal=value.hotelMeals[0].meals.dinner;
  meal.conflicts=[{validFrom:'2026-10-01',validTo:'2026-10-31',timeScope:{start:'17:00',end:'21:00'}}];
  assert.ok(planDining(value).slots.filter(slot=>slot.meal==='dinner').every(slot=>slot.status==='scheduled'));
  meal.conflicts=[{isoWeekdays:[],validFrom:'2026-11-01',validTo:'2026-11-01',timeScope:{start:'17:00',end:'21:00'}}];
  const slots=planDining(value).slots.filter(slot=>slot.meal==='dinner');
  assert.equal(slots[0].status,'pending');assert.ok(slots[0].reasons.some(item=>item.code==='evidence-conflict'));assert.equal(slots[1].status,'scheduled');
});
test('incomplete voucher entries remain unapplied without interrupting the meal plan',()=>{
  const value=input();value.vouchers=[null,{id:'malformed',confirmedFields:{type:true}}];
  const result=planDining(value);assert.equal(result.status,'ready');assert.equal(result.cost.discountAmount,0);
  assert.equal(result.voucherResults.length,2);assert.ok(result.voucherResults.every(item=>item.status==='unapplied'&&item.reasons.length));
});
