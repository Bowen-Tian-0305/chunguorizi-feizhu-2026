import {assessMealTiming,assessDietaryRequirements} from './meal-planner.js';
import {rankWithMealFeedback} from './meal-feedback.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const reason=(code,message)=>({code,message});
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1_000_000;
const round=value=>Math.round(value*100)/100;
const clock=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
const textTime=value=>`${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
function dateNumber(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const time=Date.parse(value+'T00:00:00Z');return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;}
function applies(record,date){const day=new Date(date+'T00:00:00Z').getUTCDay()||7;return Array.isArray(record.isoWeekdays)&&record.isoWeekdays.includes(day)&&(!record.validFrom||dateNumber(record.validFrom)!==null&&date>=record.validFrom)&&(!record.validTo||dateNumber(record.validTo)!==null&&date<=record.validTo);}
function conflictApplies(record,date){
  const from=record.validFrom||record.valid_from,to=record.validTo||record.valid_to;
  if(from&&dateNumber(from)!==null&&date<from||to&&dateNumber(to)!==null&&date>to)return false;
  const days=record.isoWeekdays||record.iso_weekdays;
  return !Array.isArray(days)||!days.length||!days.every(day=>Number.isInteger(day)&&day>=1&&day<=7)||days.includes(new Date(date+'T00:00:00Z').getUTCDay()||7);
}
const current=record=>record?.confirmed===true&&record.state!=='known_snapshot'&&record.assurance!=='local_snapshot_not_live_reverified'&&record.can_be_auto_scheduled!==false;

function confirmedMenu(candidate,meal,date){
  const price=candidate.meals?.[meal]?.priceByDate?.[date] || candidate.priceByDate?.[meal]?.[date] || candidate.prices?.[meal];
  if(!current(price)||price.automatic_quote_use===false||!money(price.amount)||price.currency!=='CNY'||price.basis!=='per_adult_per_meal'||price.scope!==meal||price.taxIncluded!==true||price.feesIncluded!==true||price.isFromPrice||price.is_from_price)return null;
  if(price.dates&&(!Array.isArray(price.dates)||!price.dates.includes(date)))return null;
  if(price.isoWeekdays&&!applies(price,date))return null;
  if(price.validFrom&&(dateNumber(price.validFrom)===null||date<price.validFrom)||price.validTo&&(dateNumber(price.validTo)===null||date>price.validTo))return null;
  return price;
}

function assess(candidate,kind,date,meal,input,options){
  const evidence=candidate.meals?.[meal]||{},reasons=[],exclusions=[];
  const dietary=evidence.dietaryByDate?.[date]||candidate.dietaryByDate?.[meal]?.[date]||evidence.dietary||candidate.dietary;
  const diet=assessDietaryRequirements(dietary?.dates&&!dietary.dates.includes(date)?{...dietary,confirmed:false}:dietary,input.restrictions);
  reasons.push(...diet.reasons);exclusions.push(...diet.exclusions);
  const supplyConfirmed=current(evidence)&&(!Array.isArray(evidence.confirmedDates)||evidence.confirmedDates.includes(date));
  const available=Object.hasOwn(evidence.availabilityByDate||{},date)?evidence.availabilityByDate[date]:evidence.available;
  if(!supplyConfirmed)reasons.push(reason('supply-unknown','这家具体餐厅在本次日期供应这一餐尚未确认'));
  if(supplyConfirmed&&available===false)exclusions.push(reason('meal-unavailable','已确认这一天不供应这一餐'));
  let walk=0;
  if(kind==='outside'){
    if(typeof candidate.longitude!=='number'||!Number.isFinite(candidate.longitude)||Math.abs(candidate.longitude)>180||typeof candidate.latitude!=='number'||!Number.isFinite(candidate.latitude)||Math.abs(candidate.latitude)>90)reasons.push(reason('location-unknown','具体分店位置尚未核对'));
    walk=candidate.route?.confirmed===true&&typeof candidate.route.minutes==='number'&&Number.isFinite(candidate.route.minutes)&&candidate.route.minutes>=0?Math.ceil(candidate.route.minutes):null;
    if(walk===null)reasons.push(reason('route-unknown','从本次酒店到这家分店的步行路线尚未核对'));
    else if(walk>options.walkLimit)exclusions.push(reason('too-far','步行时间超过你设定的上限'));
  }
  const desired=clock(options.times[meal]);
  let ready=Math.max(0,desired-(walk||0));
  if(date===input.checkIn){if(clock(input.arrivalTime)!==null)ready=Math.max(ready,clock(input.arrivalTime));else reasons.push(reason('arrival-time-unknown','入住当天几点到酒店还未填写，这顿先作候选'));}
  if(date===input.checkOut&&clock(input.departureTime)===null)reasons.push(reason('departure-time-unknown','退房当天几点离开还未填写，这顿先作候选'));
  const timing={date,meal,walkMinutes:walk,readyTime:textTime(ready),departureTime:date===input.checkOut?input.departureTime:undefined,mealMinutes:options.duration,returnToHotel:options.returnToHotel};
  const scheduled=assessMealTiming({...timing,schedules:evidence.schedules});
  reasons.push(...scheduled.reasons);exclusions.push(...scheduled.exclusions);
  const references=(evidence.referenceSchedules||[]).map(record=>({...record,confirmed:true,state:undefined,assurance:undefined,can_be_auto_scheduled:true}));
  const reference=!scheduled.time&&references.length?assessMealTiming({...timing,schedules:references}):null;
  let proposed=reference?.time||null;
  if(proposed)reasons.push(reason('published-reference','参考时刻按公开时段估算，本次供餐尚待确认'));
  for(const item of reference?.exclusions||[])reasons.push(reason('reference-'+item.code,'按公开时段参考：'+item.message));
  const conflicts=(evidence.conflicts||[]).filter(conflict=>conflictApplies(conflict,date)&&!(evidence.tripConfirmed&&evidence.confirmationContext?.checkIn===input.checkIn&&evidence.confirmationContext?.checkOut===input.checkOut&&scheduled.time));
  const relevant=conflicts.some(conflict=>{const time=scheduled.time||proposed,start=clock(conflict.timeScope?.start),end=clock(conflict.timeScope?.end);return !time||start===null||end===null||clock(time.start)<end&&clock(time.end)>start;});
  if(relevant){reasons.push(reason('evidence-conflict','与你用餐时间相关的公开资料有不同说法，请向商家确认'));proposed=null;}
  const covered=evidence.coveredByPackage?.confirmed===true&&evidence.coveredByPackage.quoteSlot===input.quoteSlot&&['A','B'].includes(input.quoteSlot);
  const menu=confirmedMenu(candidate,meal,date);
  return {date,meal,kind,candidateId:candidate.id,name:candidate.name,state:exclusions.length?'excluded':reasons.length?'pending':'eligible',time:scheduled.time,referenceTime:proposed,reasons,exclusions,walkMinutes:walk,adultPrice:menu?.amount??null,menuId:menu?.menuId||null,coveredByPackage:covered,localSpecialty:candidate.localSpecialty===true,allergenAssessment:diet.allergenAssessment,sourceRefs:copy(candidate.sourceRefs||[])};
}

function selectMeal(date,meal,all,input,options,usage,lock){
  const evaluated=all.map(({candidate,kind})=>assess(candidate,kind,date,meal,input,options));
  const ranked=[...evaluated].sort((a,b)=>{
    const state={eligible:0,pending:1,excluded:2};let delta=state[a.state]-state[b.state];if(delta)return delta;
    if(options.priority==='local'){delta=(usage.get(a.candidateId)||0)-(usage.get(b.candidateId)||0);if(delta)return delta;if(a.localSpecialty!==b.localSpecialty)return a.localSpecialty?-1:1;}
    if(options.priority==='budget'){if((a.adultPrice===null)!==(b.adultPrice===null))return a.adultPrice===null?1:-1;if(a.adultPrice!==b.adultPrice)return a.adultPrice-b.adultPrice;}
    return (a.walkMinutes??120)-(b.walkMinutes??120)||String(a.candidateId).localeCompare(String(b.candidateId));
  });
  const feedbackRanked=input.feedback&&input.feedbackContext?rankWithMealFeedback(ranked.map(item=>({...item,id:item.candidateId})),{state:input.feedback,context:input.feedbackContext,slot:{date,meal}}):ranked;
  const selected=lock?feedbackRanked.find(item=>item.kind===lock.kind&&item.candidateId===lock.candidateId):feedbackRanked.find(item=>item.state!=='excluded');
  if(!selected)return {date,meal,kind:lock?.kind||'unresolved',candidateId:lock?.candidateId||null,name:lock?'已锁定的餐厅':'这顿还没有合适的候选',locked:Boolean(lock),status:lock?'locked-conflict':'unresolved',time:null,tentativeTime:null,adultPrice:null,walkMinutes:null,reasons:[reason(lock?'locked-candidate-missing':'no-option',lock?'已锁定的分店不在当前候选中，保留选择等你确认':'现有资料还不能安排这一餐')],exclusions:[]};
  const status=selected.state==='excluded'?'locked-conflict':selected.state==='eligible'?'scheduled':'pending';
  usage.set(selected.candidateId,(usage.get(selected.candidateId)||0)+1);
  return {...copy(selected),locked:Boolean(lock),status,time:status==='scheduled'?selected.time:null,tentativeTime:status==='pending'?selected.time||selected.referenceTime:null,selectionReasons:[reason('selection',lock?'保留你锁定的具体餐厅':options.priority==='local'?'优先当地味，并让不同餐次有些变化':options.priority==='easy'?'优先较少步行的选项':'优先已核价格，未知费用单独列出')]};
}

// Voucher validation and cost aggregation are kept separate from restaurant ranking.
function applyVouchers(vouchers,slots,items,input){
  const results=[],usedSlots=new Set(),ids=new Set();
  const required=['type','currency','venueId','menuId','meal','validFrom','validTo','isoWeekdays','maxAdults','childrenPolicy','uses','value','minimumSpend','minimumSpendBasis','stacking','extraFees','reservation'];
  for(const voucher of Array.isArray(vouchers)?vouchers:[]){
    const result={id:voucher?.id||null,status:'unapplied',appliedDiscount:0,coveredAmount:0,usesConsumed:0,applications:[],reasons:[]};results.push(result);
    const reject=message=>result.reasons.push(reason('voucher-unconfirmed',message));
    if(!voucher?.id||ids.has(voucher.id)){reject('餐券需要独立且不重复的标识');continue;}ids.add(voucher.id);
    const confirmed=new Set(Array.isArray(voucher.confirmedFields)?voucher.confirmedFields:[]);
    if(required.some(field=>!confirmed.has(field))){reject('餐券的分店、菜单、日期、餐次、人数或核销条件尚未逐项核对');continue;}
    if(!['fixed_amount','percent','included_meal'].includes(voucher.type)||voucher.currency!=='CNY'||!['lunch','dinner'].includes(voucher.meal)||!voucher.venueId||!voucher.menuId||dateNumber(voucher.validFrom)===null||dateNumber(voucher.validTo)===null||voucher.validTo<voucher.validFrom||!Array.isArray(voucher.isoWeekdays)||!voucher.isoWeekdays.length||!voucher.isoWeekdays.every(day=>Number.isInteger(day)&&day>=1&&day<=7)||!Number.isInteger(voucher.uses)||voucher.uses<1||voucher.uses>30||!Number.isInteger(voucher.maxAdults)||voucher.maxAdults<input.party.adults||!money(voucher.value)||voucher.type==='percent'&&voucher.value>100||!money(voucher.minimumSpend)||voucher.minimumSpendBasis!=='original_adult_menu_subtotal'||!['none','allowed'].includes(voucher.stacking)||voucher.extraFees!==0||!['not_required','confirmed'].includes(voucher.reservation)){
      reject('餐券适用范围或核销值还不完整；额外收费及预约需确认后再算');continue;
    }
    if(input.party.children>0&&voucher.childrenPolicy!=='confirmed_for_this_party'){reject('同行儿童的餐券适用与补买条件尚未核清');continue;}
    if(voucher.type==='included_meal'&&voucher.value!==0){reject('已含餐次不能按券面金额当现金抵扣');continue;}
    for(const slot of slots){
      if(result.usesConsumed>=voucher.uses)break;
      const key=slot.date+'|'+slot.meal;
      if(slot.meal!==voucher.meal||slot.candidateId!==voucher.venueId||slot.menuId!==voucher.menuId||!applies(voucher,slot.date)||['locked-conflict','unresolved'].includes(slot.status))continue;
      const item=items.find(item=>item.date===slot.date&&item.meal===slot.meal&&item.candidateId===slot.candidateId&&item.code==='confirmed-menu');
      if(!item||item.coveredByPackage||item.amount<=0||item.originalAmount<voucher.minimumSpend||usedSlots.has(key)&&voucher.stacking==='none')continue;
      // A second voucher cannot stack over a previous explicitly non-stackable redemption.
      if(items.some(item=>item.date===slot.date&&item.meal===slot.meal&&item.nonStackableVoucher))continue;
      const amount=voucher.type==='included_meal'?item.amount:Math.min(item.amount,round(voucher.type==='percent'?item.originalAmount*voucher.value/100:voucher.value));
      if(amount<=0)continue;
      item.amount=round(item.amount-amount);item.nonStackableVoucher=voucher.stacking==='none';
      if(voucher.type==='included_meal'){item.coveredByPackage=true;result.coveredAmount=round(result.coveredAmount+amount);}
      else result.appliedDiscount=round(result.appliedDiscount+amount);
      result.usesConsumed++;result.applications.push({date:slot.date,meal:slot.meal,candidateId:slot.candidateId,amount,kind:voucher.type==='included_meal'?'included-meal':'cash-discount'});usedSlots.add(key);
    }
    if(result.usesConsumed)result.status=result.usesConsumed===voucher.uses?'applied':'partly-applied';
    else reject('当前选餐没有匹配到已核菜单与全部核销条件，未抵扣费用');
  }
  return results;
}

function totalCost(slots,breakfast,input,options){
  const knownItems=copy(breakfast?.cost?.knownItems||[]),budgetItems=copy(breakfast?.cost?.budgetItems||[]),unknownAmounts=copy(breakfast?.cost?.unknownAmounts||[]);
  for(const slot of slots.filter(slot=>slot.meal==='lunch'||slot.meal==='dinner')){
    if(slot.reasons?.some(item=>item.code==='meal-overlap')){
      unknownAmounts.push({code:'overlapping-meal',date:slot.date,meal:slot.meal,scope:'adults',message:'这顿与前一餐时段重叠，需调整时刻后再核算完整费用'});
      if(money(options.budgets[slot.meal]))budgetItems.push({code:'user-budget',date:slot.date,meal:slot.meal,amount:round(options.budgets[slot.meal]*input.party.adults),description:'你设定的成人用餐预算，不是门店报价'});
      continue;
    }
    if(['unresolved','locked-conflict'].includes(slot.status)){
      unknownAmounts.push({code:'unresolved-meal',date:slot.date,meal:slot.meal,scope:'adults',message:'这顿尚无适用安排，费用不完整'});
      if(money(options.budgets[slot.meal]))budgetItems.push({code:'user-budget',date:slot.date,meal:slot.meal,amount:round(options.budgets[slot.meal]*input.party.adults),description:'你设定的成人用餐预算，不是门店报价'});
      continue;
    }
    if(slot.coveredByPackage)knownItems.push({code:'package-meal-covered',date:slot.date,meal:slot.meal,candidateId:slot.candidateId,amount:0,coveredByPackage:true,description:'已核本次套餐覆盖这一餐，额外餐费为零，不再叠加餐券抵扣'});
    else if(money(slot.adultPrice)){const amount=round(slot.adultPrice*input.party.adults);knownItems.push({code:'confirmed-menu',date:slot.date,meal:slot.meal,candidateId:slot.candidateId,amount,originalAmount:amount,description:'已确认本次日期与餐次的成人含税费菜单价'});}
    else if(money(options.budgets[slot.meal]))budgetItems.push({code:'user-budget',date:slot.date,meal:slot.meal,amount:round(options.budgets[slot.meal]*input.party.adults),description:'你设定的成人用餐预算，不是门店报价'});
    else unknownAmounts.push({code:'menu-price-unknown',date:slot.date,meal:slot.meal,scope:'adults',message:'菜单价和这顿人均预算尚未填写'});
  }
  if(input.party.children>0&&!unknownAmounts.some(item=>item.scope==='children'))unknownAmounts.push({code:'children-price-unknown',scope:'children',message:'儿童收费未逐餐核清，不提供全家总价'});
  const voucherResults=applyVouchers(input.vouchers,slots,knownItems,input);
  const sum=items=>round(items.reduce((total,item)=>total+item.amount,0));
  const knownAmount=sum(knownItems),budgetAmount=sum(budgetItems),adultUnknown=unknownAmounts.some(item=>item.scope==='adults');
  const conditional=slots.some(slot=>slot.status!=='scheduled')||budgetItems.length>0||unknownAmounts.length>0;
  return {cost:{currency:'CNY',scope:'adult-meals-increment-excludes-room-price',coverage:breakfast?'breakfast-and-listed-main-meals':'listed-main-meals-only',knownItems,budgetItems,unknownAmounts,knownAmount,budgetAmount,adultEstimate:adultUnknown?null:round(knownAmount+budgetAmount),familyTotal:!breakfast||input.party.children>0||conditional?null:knownAmount,conditional,discountAmount:round((breakfast?.cost?.discountAmount||0)+voucherResults.reduce((total,result)=>total+result.appliedDiscount,0)),quotesIncludeDemo:breakfast?.cost?.quotesIncludeDemo===true,excludes:['基础房费','未核儿童餐费','交通费用','未满足条件的餐券价值',...(!breakfast?['未输入的早餐安排']:[])]},voucherResults};
}

function markMealOverlaps(slots){
  const previousByDate=new Map();
  for(const slot of slots){
    const proposed=slot.time||slot.tentativeTime;
    const start=clock(proposed?.leaveHotel)??clock(proposed?.start);
    const end=clock(proposed?.finish)??clock(proposed?.end);
    if(start===null||end===null)continue;
    const previous=previousByDate.get(slot.date)||[];
    const overlapping=slot.meal?previous.find(item=>start<item.end&&end>item.start):null;
    if(overlapping){
      slot.reasons=[...(slot.reasons||[]),reason('meal-overlap',`这顿与${overlapping.meal}的用餐及已知路程时段重叠，请调整偏好时刻或门店`)];
      slot.status=slot.locked?'locked-conflict':'pending';
      slot.time=null;
      slot.tentativeTime=null;
    }
    previous.push({start,end,meal:{breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}[slot.meal||'breakfast']});
    previousByDate.set(slot.date,previous);
  }
}

/**
 * Builds lunch/dinner around a previously selected breakfast plan without changing its slots.
 * Candidates/hotelMeals: {id,name,route:{minutes,confirmed},meals:{lunch|dinner:{confirmed,
 * schedules:[{isoWeekdays,start,end,confirmed}],referenceSchedules?,dietary?,coveredByPackage?}},
 * prices:{lunch|dinner:{amount,currency:'CNY',basis:'per_adult_per_meal',scope,confirmed,
 * taxIncluded,feesIncluded,menuId?}},longitude,latitude,localSpecialty,sourceRefs}.
 * Voucher confirmedFields must name every required field checked above. value is cash CNY,
 * percentage OFF (10 = 10% off), or zero for an included meal. menuId must match the selected
 * confirmed menu. A user's budget can never be used as the base for a redemption.
 * arrivalTime/departureTime apply only on check-in/check-out. Other times are user preferences.
 * Optional feedback is a createMealFeedback state; feedbackContext is its exact hotel/name/address
 * and stay dates. The selected slot carries feedback.reasons and previousActualSpend for display.
 * Feedback reranks only already-assessed candidates within the same feasibility class.
 */
export function planDining(input={}){
  const errors=[],start=dateNumber(input.checkIn),end=dateNumber(input.checkOut),party=input.party||{},preferences=input.preferences||{};
  if(start===null||end===null||end<=start||end-start>30*86400000)errors.push(reason('invalid-dates','入住与退房应相隔1–30晚'));
  if(!Number.isInteger(party.adults)||party.adults<1||party.adults>12||!Number.isInteger(party.children)||party.children<0||party.children>8)errors.push(reason('invalid-party','请核对成人和儿童人数'));
  const options={priority:['local','budget','easy'].includes(preferences.priority)?preferences.priority:'local',walkLimit:preferences.walkLimitMinutes??15,duration:preferences.mealMinutes??45,returnToHotel:preferences.returnToHotel!==false,times:{lunch:preferences.lunchTime||preferences.desiredTimes?.lunch||'12:00',dinner:preferences.dinnerTime||preferences.desiredTimes?.dinner||'18:00'},budgets:{lunch:preferences.lunchBudget??preferences.adultBudgets?.lunch??null,dinner:preferences.dinnerBudget??preferences.adultBudgets?.dinner??null}};
  if(!Number.isInteger(options.duration)||options.duration<5||options.duration>180||typeof options.walkLimit!=='number'||!Number.isFinite(options.walkLimit)||options.walkLimit<0||options.walkLimit>120)errors.push(reason('invalid-duration','请核对用餐时间与步行上限'));
  if(Object.values(options.times).some(value=>clock(value)===null)||['arrivalTime','departureTime'].some(field=>input[field]!==undefined&&clock(input[field])===null))errors.push(reason('invalid-time','时刻请使用HH:MM'));
  if(Object.values(options.budgets).some(value=>value!==null&&!money(value)))errors.push(reason('invalid-budget','人均预算应为有效非负金额'));
  const hotels=Array.isArray(input.hotelMeals)?input.hotelMeals:input.hotelMeals?[input.hotelMeals]:[];
  const all=[...hotels.map(candidate=>({candidate,kind:'hotel'})),...(Array.isArray(input.candidates)?input.candidates:[]).map(candidate=>({candidate,kind:'outside'}))],ids=new Set();
  for(const {candidate} of all){if(!candidate?.id||ids.has(candidate.id))errors.push(reason('invalid-candidate','具体餐厅标识缺失或重复'));ids.add(candidate?.id);}
  const locks=new Map();
  for(const lock of input.locks||[]){const key=lock.date+'|'+lock.meal;if(!['breakfast','lunch','dinner'].includes(lock.meal)||!['hotel','outside'].includes(lock.kind)||!lock.candidateId&&lock.meal!=='breakfast'||dateNumber(lock.date)===null||lock.date<input.checkIn||lock.date>input.checkOut||locks.has(key))errors.push(reason('invalid-lock','请核对锁定餐次的日期与具体餐厅'));else locks.set(key,lock);}
  let breakfast=input.breakfastPlan;
  if(breakfast?.plans)breakfast=breakfast.plans.find(plan=>plan.recommended)||breakfast.plans[0];
  if(errors.length)return {status:'invalid',errors,slots:copy(breakfast?.slots||[]),cost:null,voucherResults:[],assumptions:[]};
  const slots=copy(breakfast?.slots||[]),usage=new Map();
  for(let time=start;time<=end;time+=86400000){
    const date=new Date(time).toISOString().slice(0,10),checkIn=time===start,checkOut=time===end;
    const meals=[];
    if(!checkIn&&!checkOut||checkIn&&clock(input.arrivalTime)!==null&&clock(input.arrivalTime)<15*60||checkOut&&clock(input.departureTime)!==null&&clock(input.departureTime)>=11*60)meals.push('lunch');
    if(!checkOut||clock(input.departureTime)!==null&&clock(input.departureTime)>=17*60)meals.push('dinner');
    // An earlier departure may make a locked meal infeasible; it must not erase the choice.
    for(const meal of ['lunch','dinner'])if(locks.has(date+'|'+meal)&&!meals.includes(meal))meals.push(meal);
    for(const meal of meals)slots.push(selectMeal(date,meal,all,input,options,usage,locks.get(date+'|'+meal)));
  }
  const order={breakfast:0,lunch:1,dinner:2};slots.sort((a,b)=>a.date.localeCompare(b.date)||order[a.meal||'breakfast']-order[b.meal||'breakfast']);
  markMealOverlaps(slots);
  const {cost,voucherResults}=totalCost(slots,breakfast,input,options);
  const status=slots.some(slot=>['unresolved','locked-conflict'].includes(slot.status))?'incomplete':slots.some(slot=>slot.status!=='scheduled')?'needs-confirmation':'ready';
  const assumptions=[reason('meal-duration',`每顿预留${options.duration}分钟用餐，排队时间未知`),reason('walking',options.returnToHotel?'外出按从酒店步行往返计算，不含下一站的交通':'外出只计酒店至餐厅单程，后续路程另核'),reason('coverage','到达时间未知时先留入住日晚餐；离开时间未知时不加退房日午晚餐。临界时刻只决定待安排餐次，仍需逐店核对能否吃完。'),reason('cost-scope','金额为基础房费之外的成人三餐增量，预算与已核支出分列；早餐套餐增量只计一次')];
  return {status,errors:[],slots,cost,voucherResults,assumptions};
}
