// Breakfast-only planning; lunch, dinner and voucher redemption require a separate meal module.
// Evidence confirmation is explicit; a populated POI is not evidence.
const DAY = 86400000;
const copy = value => JSON.parse(JSON.stringify(value));
const reason = (code, message) => ({code, message});
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
const unique = values => [...new Set(values)];
const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase();
const clock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null;
const timeText = value => value === null ? null : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return null;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}
function stayDates(checkIn, checkOut) {
  const start = dateNumber(checkIn), end = dateNumber(checkOut);
  if (start === null || end === null || end <= start || end - start > 30 * DAY) return [];
  return Array.from({length: (end - start) / DAY}, (_, i) => new Date(start + (i + 1) * DAY).toISOString().slice(0, 10));
}
function applies(record, date) {
  const from = record.validFrom || record.valid_from, to = record.validTo || record.valid_to;
  if (from && (dateNumber(from) === null || date < from) || to && (dateNumber(to) === null || date > to)) return false;
  const weekdays = record.isoWeekdays || record.iso_weekdays;
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay() || 7;
  return Array.isArray(weekdays) && weekdays.length > 0 && weekdays.every(day => Number.isInteger(day) && day >= 1 && day <= 7) ? weekdays.includes(weekday) : null;
}
function confirmed(record) {
  return record?.confirmed === true && record.can_be_auto_scheduled !== false && record.state !== 'known_snapshot' && record.assurance !== 'local_snapshot_not_live_reverified';
}

function assessDiet(dietary = {}, restrictions = {}) {
  const reasons = [], exclusions = [], avoid = unique([...(restrictions.avoidIngredients || []), ...(restrictions.allergens || [])].map(normalize).filter(Boolean));
  const allergens = (restrictions.allergens || []).map(normalize);
  const contains = (dietary.contains || []).map(normalize), excluded = (dietary.excludedIngredients || []).map(normalize);
  for (const ingredient of avoid) {
    if (contains.includes(ingredient)) exclusions.push(reason('ingredient-conflict', `已知所选餐食含${ingredient}，与你的饮食要求冲突`));
    else if (!confirmed(dietary) || !excluded.includes(ingredient)) reasons.push(reason('ingredient-unknown', `${ingredient}是否可避开尚未确认`));
  }
  if (allergens.length && (!confirmed(dietary) || dietary.crossContactConfirmed !== true)) reasons.push(reason('cross-contact-unknown', '过敏原交叉接触条件尚未向商家确认'));
  return {reasons, exclusions, allergenAssessment: allergens.length ? reasons.length || exclusions.length ? 'requires-confirmation' : 'merchant-confirmed-recheck' : 'not-assessed'};
}

function scheduleTime(schedules, date, {walk, departure, ready, duration, returnToHotel, meal = 'breakfast'}) {
  const label = {breakfast:'早餐',lunch:'午餐',dinner:'晚餐'}[meal] || '餐食';
  const reasons = [], exclusions = [];
  const relevant = (Array.isArray(schedules) ? schedules : []).map(schedule => ({schedule, applicability: applies(schedule, date)}));
  const applicable = relevant.filter(item => item.applicability === true).map(item => item.schedule);
  const mealScoped = schedule => (!schedule.meal || schedule.meal === meal) && (!schedule.schedule_kind || schedule.schedule_kind === 'meal_service') && (!schedule.scope || [meal, `${meal}_meal_not_total_venue_hours`, 'meal_service'].includes(schedule.scope));
  const closed = applicable.filter(schedule => schedule.closed === true && confirmed(schedule) && mealScoped(schedule));
  const opened = applicable.filter(schedule => schedule.closed !== true && confirmed(schedule) && mealScoped(schedule));
  if (applicable.some(schedule => schedule.conflict === true) || closed.length && opened.length) {
    reasons.push(reason('schedule-conflict', `该日期${label}开闭或时段存在冲突，先核对再安排`));
    return {time: null, reasons, exclusions};
  }
  if (closed.length) {
    exclusions.push(reason('closed', `已确认该日期不供应${label}`));
    return {time: null, reasons, exclusions};
  }
  if (!opened.length) {
    reasons.push(reason('meal-time-unknown', relevant.some(item => item.applicability === false) && !relevant.some(item => item.applicability === null) ? '现有时段没有覆盖这一天，不能推断营业或关闭' : `这一天的${label}供应时段尚未确认`));
    return {time: null, reasons, exclusions};
  }
  if (walk === null) {
    reasons.push(reason('route-time-unknown', '步行路线未确认，暂不能确定出发和返回时间'));
    return {time: null, reasons, exclusions};
  }
  let completeWindow = false, durationFits = false;
  for (const schedule of opened.sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
    const start = clock(schedule.start), end = clock(schedule.end);
    if (start === null || end === null || end <= start) continue;
    completeWindow = true;
    const mealStart = Math.max(start, (ready ?? 0) + walk), mealEnd = mealStart + duration;
    if (mealEnd > end) continue;
    durationFits = true;
    const finish = mealEnd + (returnToHotel ? walk : 0);
    if (departure !== null && finish > departure) continue;
    return {time: {leaveHotel: timeText(mealStart - walk), start: timeText(mealStart), end: timeText(mealEnd), returnHotel: returnToHotel ? timeText(finish) : null, finish: timeText(finish), walkMinutes: walk, mealMinutes: duration, returnToHotel}, reasons, exclusions};
  }
  if (!completeWindow) reasons.push(reason('meal-time-unknown', `缺少完整${label}起止时间，不能从餐厅营业时段推断`));
  else exclusions.push(reason(durationFits ? 'departure-too-early' : 'not-enough-time', durationFits ? '吃完并按设定返回酒店后，赶不上你的出门时间' : `可用${label}时段不足以完成用餐和已知路程`));
  return {time: null, reasons, exclusions};
}

/** Shared deterministic checks for a named meal; published references remain unconfirmed. */
export function assessMealTiming({schedules,date,meal,walkMinutes,departureTime,readyTime,mealMinutes,returnToHotel=true}) {
  return scheduleTime(schedules,date,{meal,walk:walkMinutes,departure:clock(departureTime),ready:clock(readyTime),duration:mealMinutes,returnToHotel});
}
export function assessDietaryRequirements(dietary,restrictions) {return assessDiet(dietary,restrictions);}

function currentAdultPrice(candidate, date) {
  const price = candidate.priceByDate?.[date] || candidate.price;
  if (!price || !confirmed(price) || price.automatic_quote_use === false || !money(price.amount) || price.currency !== 'CNY' || price.basis !== 'per_adult_per_meal' || price.scope !== 'breakfast' || price.isFromPrice === true || price.is_from_price === true || price.taxIncluded !== true || price.feesIncluded !== true) return null;
  if (price.dates && (!Array.isArray(price.dates) || !price.dates.includes(date))) return null;
  if ((price.isoWeekdays || price.iso_weekdays) && applies(price, date) !== true) return null;
  if (price.validFrom && (dateNumber(price.validFrom) === null || date < price.validFrom) || price.validTo && (dateNumber(price.validTo) === null || date > price.validTo)) return null;
  return price.amount;
}

function overlapsConflict(conflict, time) {
  if (!time) return true;
  const start = clock(conflict.timeScope?.start), end = clock(conflict.timeScope?.end);
  if (start === null || end === null || end <= start) return true;
  return clock(time.start) < end && clock(time.end) > start;
}

function assessOption(kind, candidate, date, input, options) {
  const reasons = [], exclusions = [], hotel = kind === 'hotel';
  const breakfast = hotel ? input.hotelBreakfast || {} : candidate.breakfast || {};
  const dietary=breakfast.dietaryByDate?.[date] || candidate.dietaryByDate?.[date] || breakfast.dietary || candidate.dietary;
  const diet = assessDiet(dietary?.dates&&!dietary.dates.includes(date)?{...dietary,confirmed:false}:dietary, input.restrictions);
  reasons.push(...diet.reasons); exclusions.push(...diet.exclusions);
  const supplyConfirmed=confirmed(breakfast)&&(!Array.isArray(breakfast.confirmedDates)||breakfast.confirmedDates.includes(date));
  const available=Object.hasOwn(breakfast.availabilityByDate||{},date)?breakfast.availabilityByDate[date]:breakfast.available;
  if(!supplyConfirmed)reasons.push(reason('breakfast-supply-unknown','尚未确认该具体餐厅在这一天供应早餐'));
  if(available===false&&supplyConfirmed)exclusions.push(reason('no-breakfast','已确认该餐厅在这一天不供应早餐'));
  const departure = clock(input.departures?.[date] ?? input.departureTime);
  let walk = 0;
  if (hotel) {
    if (Array.isArray(breakfast.usableDates) && !breakfast.usableDates.includes(date)) exclusions.push(reason('hotel-date-unavailable', '你已把这一天设为不用酒店早餐'));
    if (!Number.isInteger(breakfast.count) || breakfast.count < 0) reasons.push(reason('breakfast-count-unknown', '含早份数尚未核对'));
    else if (breakfast.count < input.party.adults) reasons.push(reason('breakfast-count-short', '套餐早餐份数不足全部成人，补买条件和金额待确认'));
  } else {
    const coordinatesKnown = typeof candidate.longitude === 'number' && Number.isFinite(candidate.longitude) && Math.abs(candidate.longitude) <= 180 && typeof candidate.latitude === 'number' && Number.isFinite(candidate.latitude) && Math.abs(candidate.latitude) <= 90;
    if (!coordinatesKnown) reasons.push(reason('location-unknown', '具体分店坐标尚未核对'));
    const route = candidate.route;
    walk = route && route.confirmed === true && typeof route.minutes === 'number' && Number.isFinite(route.minutes) && route.minutes >= 0 ? Math.ceil(route.minutes) : null;
    if (walk === null) reasons.push(reason('route-unverified', '酒店到这家具体分店的步行路线尚未核对'));
    else if (walk > options.walkLimit) exclusions.push(reason('too-far', '步行时间超过你的上限'));
    if(candidate.can_be_auto_scheduled===false&&!reasons.some(item=>item.code==='breakfast-supply-unknown'))reasons.push(reason('breakfast-supply-unknown','该分店当前只作公开资料参考'));
  }
  const timing = {walk, departure, ready: options.ready, duration: options.duration, returnToHotel: options.returnToHotel};
  const scheduled = scheduleTime(breakfast.schedules, date, timing);
  reasons.push(...scheduled.reasons); exclusions.push(...scheduled.exclusions);
  // Published windows may support a provisional time, never current-trip confirmation.
  const references = (breakfast.referenceSchedules || []).map(window => ({...window, confirmed:true, state:undefined, assurance:undefined, can_be_auto_scheduled:true}));
  const reference = !scheduled.time && references.length ? scheduleTime(references, date, timing) : null;
  let referenceTime = reference?.time || null;
  const context = breakfast.confirmationContext;
  const tripConfirmed = breakfast.tripConfirmed === true && context?.checkIn === input.checkIn && context?.checkOut === input.checkOut && Boolean(scheduled.time);
  const affectedConflicts = (breakfast.conflicts || []).filter(conflict => applies(conflict, date) !== false && !tripConfirmed && overlapsConflict(conflict, scheduled.time || referenceTime));
  if (affectedConflicts.length) {
    reasons.push(reason('evidence-conflict', '与你用餐时段相关的公开资料存在不同说法，请向商家确认'));
    referenceTime = null;
  }
  if (referenceTime) reasons.push(reason('published-time-reference', '建议时刻按公开参考时段估算，本次供餐仍待确认'));
  for (const item of reference?.exclusions || []) reasons.push(reason(`reference-${item.code}`, `按公开参考时段：${item.message}`));
  const state = exclusions.length ? 'excluded' : reasons.length ? 'pending' : 'eligible';
  return {kind, candidateId: hotel ? null : candidate.id, name: hotel ? input.hotelBreakfast?.name || '酒店早餐' : candidate.name, date, state, time: scheduled.time, referenceTime, reasons, exclusions, allergenAssessment: diet.allergenAssessment, walkMinutes: walk, adultPrice: hotel ? null : currentAdultPrice(candidate, date), localSpecialty: candidate.localSpecialty === true, sourceRefs: copy(candidate.sourceRefs || breakfast.sourceRefs || [])};
}

function ranked(options, priority) {
  const rank = option => option.state === 'eligible' ? 0 : option.state === 'pending' ? 1 : 2;
  return [...options].sort((a, b) => {
    const state = rank(a) - rank(b); if (state) return state;
    if (priority === 'local' && a.localSpecialty !== b.localSpecialty) return a.localSpecialty ? -1 : 1;
    if (priority === 'budget') {
      if ((a.adultPrice === null) !== (b.adultPrice === null)) return a.adultPrice === null ? 1 : -1;
      if (a.adultPrice !== null && a.adultPrice !== b.adultPrice) return a.adultPrice - b.adultPrice;
    }
    return (a.walkMinutes ?? Infinity) - (b.walkMinutes ?? Infinity) || String(a.candidateId).localeCompare(String(b.candidateId));
  });
}

function selectSlot(date, evaluations, preference, lock) {
  const hotel = evaluations.hotel, outside = ranked(evaluations.outside, preference.priority);
  let selected;
  if (lock) {
    selected = lock.kind === 'hotel' ? hotel : outside.find(candidate => candidate.candidateId === lock.candidateId);
    if (!selected) return {date, kind: lock.kind, candidateId: lock.candidateId || null, name: '已锁定的餐次', locked: true, status: 'locked-conflict', time: null, reasons: [reason('locked-candidate-missing', '已锁定的门店不在本次候选中，请保留或由你解除锁定')], exclusions: [], adultPrice: null};
  } else {
    const preferred = preference.kind === 'hotel' ? [hotel] : outside, fallback = preference.kind === 'hotel' ? outside : [hotel];
    selected = preferred.find(candidate => candidate.state === 'eligible') || preferred.find(candidate => candidate.state === 'pending') || fallback.find(candidate => candidate.state === 'eligible') || fallback.find(candidate => candidate.state === 'pending');
  }
  if (!selected) return {date, kind: 'unresolved', candidateId: null, name: '这顿早餐还需补充选择', locked: false, status: 'unresolved', time: null, reasons: [reason('no-feasible-option', '现有选项都不适用，尚无可执行早餐安排')], exclusions: [], adultPrice: null};
  const status = selected.state === 'excluded' ? 'locked-conflict' : selected.state === 'eligible' ? 'scheduled' : 'pending';
  const selectionReasons = [reason(lock ? 'user-locked' : 'selection', lock ? '保留你锁定的餐次，不自动替换门店' : status === 'scheduled' ? '早餐供应与时段已确认，按预留用餐时间可完成' : '只作待确认候选，尚未形成确定排程')];
  if (selected.kind === 'outside' && selected.walkMinutes !== null) selectionReasons.push(reason('walking', `已核酒店至该具体分店步行约 ${selected.walkMinutes} 分钟`));
  if (selected.kind === 'outside' && preference.priority === 'local' && selected.localSpecialty) selectionReasons.push(reason('local-preference', '有当地特色资料，符合你想尝本地味的偏好'));
  if (selected.kind === 'outside' && preference.priority === 'budget' && selected.adultPrice !== null) selectionReasons.push(reason('budget-preference', '优先选择已核成人早餐价格，避免把未知价格当便宜'));
  return {...copy(selected), locked: Boolean(lock), status, time: status === 'scheduled' ? selected.time : null, tentativeTime: status === 'scheduled' || status === 'locked-conflict' ? null : selected.time || selected.referenceTime, selectionReasons};
}

function planCost(slots, input, options) {
  const knownItems = [], budgetItems = [], unknownAmounts = [], adults = input.party.adults, children = input.party.children;
  const hotelSlots = slots.filter(slot => slot.kind === 'hotel'), usesHotel = hotelSlots.length > 0;
  const quotes = input.quotes || {};
  if (usesHotel) {
    if (quotes.comparable === true && money(quotes.plain) && money(quotes.included) && quotes.included >= quotes.plain) knownItems.push({code: 'package-premium', amount: Math.round((quotes.included - quotes.plain) * 100) / 100, description: '含早套餐全程增量；只付一次，不按使用天数打折'});
    else unknownAmounts.push({code: 'package-premium-unknown', scope: 'adults', message: '尚无可比较的本次两档全程总价，含早增量未知'});
    if (!Number.isInteger(input.hotelBreakfast?.count) || input.hotelBreakfast.count < adults) for (const slot of hotelSlots) unknownAmounts.push({code: 'extra-adult-breakfast-unknown', date: slot.date, scope: 'adults', message: '酒店早餐含份数或成人补买金额待确认'});
  }
  for (const slot of slots.filter(slot => slot.kind !== 'hotel')) {
    if (money(slot.adultPrice)) knownItems.push({code: 'outside-menu', date: slot.date, amount: Math.round(slot.adultPrice * adults * 100) / 100, description: '已确认的本次成人早餐菜单价'});
    else if (money(options.adultBudget)) budgetItems.push({code: 'outside-user-budget', date: slot.date, amount: Math.round(options.adultBudget * adults * 100) / 100, description: '用户设定的成人外出早餐预算，非门店报价'});
    else unknownAmounts.push({code: 'outside-price-unknown', date: slot.date, scope: 'adults', message: '外出早餐菜单价及人均预算均未知'});
  }
  if (children > 0) unknownAmounts.push({code: 'children-price-unknown', scope: 'children', message: '儿童收费和可用套餐份数未确认，不提供全家总价'});
  for (const slot of slots.filter(slot => ['locked-conflict', 'unresolved'].includes(slot.status))) unknownAmounts.push({code: 'unresolved-meal-cost', date: slot.date, scope: 'adults', message: '这顿尚无可执行安排，不能给出完整早餐费用'});
  const sum = items => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100;
  const knownAmount = sum(knownItems), budgetAmount = sum(budgetItems), adultUnknown = unknownAmounts.some(item => item.scope === 'adults');
  const adultEstimate = adultUnknown ? null : Math.round((knownAmount + budgetAmount) * 100) / 100;
  return {currency: 'CNY', scope: 'adult-breakfast-increment-excludes-room-price', conditional: slots.some(slot => slot.status !== 'scheduled'), knownAmount, knownItems, budgetAmount, budgetItems, unknownAmounts, adultEstimate, familyTotal: children > 0 || budgetItems.length || adultUnknown || slots.some(slot => slot.status !== 'scheduled') ? null : knownAmount, discountAmount: 0, hotelUseDays: hotelSlots.length, quotesIncludeDemo: quotes.demo === true, excludes: ['基础房费', '儿童餐费', '交通费用', '未经核实的餐券价值']};
}

function voucherNotes(vouchers) {
  return (vouchers || []).map(voucher => ({id: voucher.id || null, appliedDiscount: 0, code: 'voucher-not-deducted', message: voucher.meal && voucher.meal !== 'breakfast' ? '该餐券不属于早餐餐次，本方案不计抵扣' : '尚未核清具体套餐、分店、日期、人数和核销条件；本方案不把餐券当现金抵扣'}));
}

/**
 * Inputs: {checkIn,checkOut,party:{adults,children},quotes:{comparable,plain,included,demo?},
 * hotelBreakfast:{name?,count,usableDates?,schedules,dietary?,conflicts?}, candidates:[{id,name,
 * longitude,latitude,route:{minutes,confirmed},breakfast:{confirmed,schedules},dietary?,
 * localSpecialty?,price?:{amount,currency:'CNY',basis:'per_adult_per_meal',scope:'breakfast',
 * confirmed,taxIncluded,feesIncluded}}], preferences:{priority,adultBudget,walkLimitMinutes,
 * mealMinutes,readyTime?,returnToHotel?},departureTime?,departures?:{[date]:'HH:MM'},
 * restrictions?:{avoidIngredients:[],allergens:[]},locks?:[{date,kind:'hotel'|'outside',candidateId?}]}.
 * A schedule has {isoWeekdays:[1..7],start,end,confirmed,closed?,validFrom?,validTo?}.
 * Dietary evidence has {contains:[],excludedIngredients:[],confirmed,crossContactConfirmed}.
 * Historical data must stay unconfirmed; confirmed:true denotes explicit current-trip confirmation.
 * No external calls occur. Reusing the same evidence with another priority reranks locally.
 */
export function planMeals(input = {}) {
  const errors = [], dates = stayDates(input.checkIn, input.checkOut), party = input.party || {};
  if (!dates.length) errors.push(reason('invalid-dates', '入住与退房需为有效日期，相隔 1–30 晚'));
  if (!Number.isInteger(party.adults) || party.adults < 1 || party.adults > 12 || !Number.isInteger(party.children) || party.children < 0 || party.children > 8) errors.push(reason('invalid-party', '同行成人或儿童人数无效'));
  const preferences = input.preferences || {};
  const options = {priority: ['local', 'budget', 'easy'].includes(preferences.priority) ? preferences.priority : 'local', walkLimit: preferences.walkLimitMinutes ?? 15, adultBudget: preferences.adultBudget ?? null, duration: preferences.mealMinutes ?? 30, ready: preferences.readyTime === undefined ? null : clock(preferences.readyTime), returnToHotel: preferences.returnToHotel !== false};
  if (typeof options.walkLimit !== 'number' || !Number.isFinite(options.walkLimit) || options.walkLimit < 0 || options.walkLimit > 120) errors.push(reason('invalid-walk-limit', '步行上限需在 0–120 分钟之间'));
  if (!Number.isInteger(options.duration) || options.duration < 5 || options.duration > 180) errors.push(reason('invalid-meal-duration', '用餐时间需在 5–180 分钟之间'));
  if (preferences.readyTime !== undefined && options.ready === null || input.departureTime !== undefined && clock(input.departureTime) === null || Object.values(input.departures || {}).some(value => clock(value) === null)) errors.push(reason('invalid-time', '出发或准备好用餐的时刻格式应为 HH:MM'));
  if (options.adultBudget !== null && !money(options.adultBudget)) errors.push(reason('invalid-budget', '成人早餐预算需为有效非负金额'));
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const ids = new Set();
  for (const candidate of candidates) if (!candidate.id || ids.has(candidate.id)) errors.push(reason('invalid-candidate-id', '餐馆候选需要不重复的具体分店标识')); else ids.add(candidate.id);
  const locks = new Map();
  for (const lock of input.locks || []) {
    if (!dates.includes(lock.date) || !['hotel', 'outside'].includes(lock.kind) || locks.has(lock.date)) errors.push(reason('invalid-lock', '锁定餐次的日期、选项或重复记录需要核对'));
    else locks.set(lock.date, lock);
  }
  if (errors.length) return {status: 'invalid', errors, dates, plans: [], evaluations: {}, assumptions: []};
  const evaluations = {};
  for (const date of dates) evaluations[date] = {hotel: assessOption('hotel', {}, date, input, options), outside: candidates.map(candidate => assessOption('outside', candidate, date, input, options))};
  const strategies = [{id: 'hotel', title: '酒店优先', kind: 'hotel'}, {id: 'outside', title: '外出尝味', kind: 'outside'}, {id: 'mixed', title: '酒店与街头穿插', kind: 'mixed'}];
  const plans = [], signatures = new Set();
  for (const strategy of strategies) {
    let remainingHotel = Math.ceil(dates.length / 2);
    const slots = dates.map(date => {
      const kind = strategy.kind === 'mixed' ? remainingHotel > 0 ? 'hotel' : 'outside' : strategy.kind;
      const slot = selectSlot(date, evaluations[date], {kind, priority: options.priority}, locks.get(date));
      if (strategy.kind === 'mixed' && slot.kind === 'hotel') remainingHotel--;
      return slot;
    });
    const signature = JSON.stringify(slots.map(slot => [slot.date, slot.kind, slot.candidateId]));
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    const status = slots.some(slot => ['locked-conflict', 'unresolved'].includes(slot.status)) ? 'incomplete' : slots.some(slot => slot.status === 'pending') ? 'needs-confirmation' : 'feasible';
    const pending = slots.flatMap(slot => [...slot.reasons, ...slot.exclusions].map(item => ({date: slot.date, candidateId: slot.candidateId, ...item})));
    plans.push({id: strategy.id, title: strategy.title, status, recommended: false, slots, cost: planCost(slots, input, options), confirmations: pending, voucherNotes: voucherNotes(input.vouchers), reasons: [reason('strategy', strategy.kind === 'hotel' ? '在可行选项中优先利用酒店早餐；不可用的日期再找外出选择' : strategy.kind === 'outside' ? '在可行选项中优先选择具体外出门店；没有合适门店时保留酒店选项' : '在可行日期安排酒店与外出早餐，保留你锁定的餐次')]});
  }
  const statusRank = {feasible: 0, 'needs-confirmation': 1, incomplete: 2};
  plans.sort((a, b) => {
    const status = statusRank[a.status] - statusRank[b.status]; if (status) return status;
    if (options.priority === 'budget' && a.cost.adultEstimate !== b.cost.adultEstimate) return (a.cost.adultEstimate ?? Infinity) - (b.cost.adultEstimate ?? Infinity);
    if (options.priority === 'easy') return a.slots.reduce((total, slot) => total + (slot.walkMinutes ?? 120), 0) - b.slots.reduce((total, slot) => total + (slot.walkMinutes ?? 120), 0);
    if (options.priority === 'local') return b.slots.filter(slot => slot.localSpecialty).length - a.slots.filter(slot => slot.localSpecialty).length;
    return 0;
  });
  if (plans[0]) plans[0].recommended = true;
  const assumptions = [reason('dining-duration', `按每顿 ${options.duration} 分钟用餐预留，排队时间未知`), reason('walking-scope', options.returnToHotel ? '外出早餐按从酒店步行往返计算；不含额外绕行和候车' : '只计从酒店到餐馆的单程步行；去下一目的地的时间尚未核实'), reason('cost-scope', '费用为基础房费之外的成人早餐增量；用户预算与已确认菜单价分开列出')];
  return {status: plans.some(plan => plan.status === 'feasible') ? 'ready' : 'needs-confirmation', errors: [], dates, plans, evaluations, assumptions};
}
