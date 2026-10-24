import {planMeals} from './meal-planner.js';
import {planDining} from './dining-planner.js';
import {buildMealEvidence} from './meal-evidence.js';
import {comparePackages} from './package-comparison.js';
import {createMealFeedback, saveMealFeedback} from './meal-feedback.js';

const MEALS = {breakfast: '早餐', lunch: '午餐', dinner: '晚餐'};
const DAY = 86400000;
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const finiteMoney = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const yuan = value => finiteMoney(value) ? `¥${value.toLocaleString('zh-CN', {maximumFractionDigits: 2})}` : '待核';
const slotKey = slot => `${slot.date}|${slot.meal || 'breakfast'}`;
const candidateKey = slot => slot.meal === 'breakfast' && slot.kind === 'hotel' ? 'hotel-breakfast' : String(slot.candidateId || slot.venueId || '');
const statusText = status => ({scheduled: '供餐与时间已核', feasible: '供餐与时间已核', ready: '供餐与时间已核', pending: '待核对', 'needs-confirmation': '待核对', 'locked-conflict': '选择有冲突', unresolved: '待选地点', incomplete: '尚未接齐', invalid: '先补信息', skipped: '不在行程内'}[status] || '待核对');
const signature = plan => JSON.stringify((plan?.slots || []).map(slot => [slot.date, slot.meal || 'breakfast', slot.kind, slot.candidateId || null]));
const parts = value => [...new Set(String(value || '').split(/[,，、;；\n]+/).map(item => item.trim()).filter(Boolean))];
const VOUCHER_FIELDS = ['type','currency','venueId','menuId','meal','validFrom','validTo','isoWeekdays','maxAdults','childrenPolicy','uses','value','minimumSpend','minimumSpendBasis','stacking','extraFees','reservation'];
const todayBeijing = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);

function contextOf(facts) {
  const hotel = facts.hotel || {};
  return {hotel: {id: hotel.id || undefined, name: hotel.name || '', address: hotel.address || ''}, checkIn: facts.checkIn, checkOut: facts.checkOut};
}
function contextKey(facts) { return JSON.stringify(contextOf(facts)); }
function breakfastDates(facts) {
  const start = Date.parse(`${facts.checkIn}T00:00:00Z`), end = Date.parse(`${facts.checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 30 * DAY) return [];
  return Array.from({length: (end - start) / DAY}, (_, i) => new Date(start + (i + 1) * DAY).toISOString().slice(0, 10));
}

// Only explicit food exclusions and explicit allergies become constraints. Other wording stays visible.
function dietaryRequirements(text) {
  const avoidIngredients = [], allergens = [], unparsed = [];
  for (const phrase of String(text || '').split(/[;；,，\n]+/).map(item => item.trim()).filter(Boolean)) {
    let match = phrase.match(/^(?:对)?([^：:，,；;]{1,24}?)过敏$/);
    if (match && !/不|可能|疑似|是否|没有|严重|轻微/.test(match[1])) allergens.push(...parts(match[1]));
    else if ((match = phrase.match(/^(?:不吃|不食|忌口[:：]?)([^：:，,；;]{1,24})$/))) avoidIngredients.push(...parts(match[1]));
    else if (!/^(?:想吃|喜欢|想尝|想试)/.test(phrase)) unparsed.push(phrase);
  }
  return {avoidIngredients: [...new Set(avoidIngredients)], allergens: [...new Set(allergens)], unparsed};
}

/** A local, session-only meal workspace. No request or navigation is made by this module. */
export function createMealWorkspace({getFacts, getQuoteBook = () => null, requestMealRefine = async () => { throw new Error('单餐建议暂不可用，请稍后重试。'); }, onBreakfastSelectionChange = () => {}, onPlanChange = () => {}}) {
  let state = freshState(), current = null, mounted = false, previewRevision = 0, refineRevision = 0, refineBusy = false;
  const extraPlaces = new Map();
  const el = id => document.getElementById(id);
  function freshState() {
    return {context: null, intent: null, calendarDates: [], assignments: [], confirmations: {context: null, items: []}, voucher: null, feedback: null, history: [], prefs: {lunchBudget: null, dinnerBudget: null, mealMinutes: 45, readyTime: '', lunchTime: '12:00', dinnerTime: '18:00', arrivalTime: '', departureTime: '', returnToHotel: true}};
  }
  function snapshot() { return clone({intent: state.intent, calendarDates: state.calendarDates, assignments: state.assignments, confirmations: state.confirmations, voucher: state.voucher, feedback: state.feedback, prefs: state.prefs}); }
  function remember() { state.history.push(snapshot()); if (state.history.length > 10) state.history.shift(); }
  function ensureContext(facts) {
    const key = contextKey(facts);
    if (state.context === key) return;
    const previous = state.context, prefs = state.prefs;
    state = freshState(); state.context = key; state.prefs = prefs;
    state.intent = {type: 'manual', dates: [...(facts.selectedHotelBreakfastDates || [])].sort()};
    state.calendarDates = [...state.intent.dates];
    state.confirmations.context = contextOf(facts);
    extraPlaces.clear();
    if (previous) { closeDialog(); setStatus('酒店或日期已更换，请为这趟行程重新核对用餐信息。'); }
    writePreferences();
  }
  function allPlaces(facts) {
    const places = new Map();
    for (const place of [...(facts.places || []), ...extraPlaces.values()]) if (place?.id && place.name) places.set(String(place.id), place);
    return [...places.values()];
  }
  function mount() {
    if (mounted || !el('timeline') || !el('makePlan')) return;
    mounted = true;
    const preferences = document.createElement('details'); preferences.id = 'mealDiningPreferences'; preferences.className = 'mw-preferences';
    preferences.innerHTML = `<summary><span>把午晚餐也接上</span><small>预算与到离店时间，可稍后补</small></summary><div class="mw-preferences-body"><p>用餐时长是你为每顿饭预留的时间。菜单、排队与真实路线仍需核对。</p><div class="mw-fields"><label>午餐预算 · 元/成人<input id="mealLunchBudget" type="number" min="0" max="100000" step="0.01" placeholder="可留空，金额未知"></label><label>晚餐预算 · 元/成人<input id="mealDinnerBudget" type="number" min="0" max="100000" step="0.01" placeholder="可留空，金额未知"></label><label>每顿预留用餐 · 分钟<input id="mealDuration" type="number" min="5" max="180" step="1" value="45"></label><label>早餐准备好时间<input id="mealReadyTime" type="time"></label><label>午餐希望几点吃<input id="mealLunchTime" type="time" value="12:00"></label><label>晚餐希望几点吃<input id="mealDinnerTime" type="time" value="18:00"></label><label>入住日到达酒店<input id="mealArrivalTime" type="time"><small>不知道可留空，入住日餐次保留待核</small></label><label>退房日离开酒店<input id="mealDepartureTime" type="time"><small>不知道可留空，退房日餐次保留待核</small></label></div><label class="mw-check"><input id="mealReturnHotel" type="checkbox" checked><span>外出吃完后回酒店（按酒店往返步行预留）</span></label><p class="mw-small">不回酒店时，只计去餐馆的路程；餐后去下一站的时间需要另外安排。</p><p class="mw-prefs-note" id="mealPreferencesNote" aria-live="polite"></p></div>`;
    const action = el('makePlan').closest('.form-actions') || el('makePlan'); action.before(preferences);
    const strategies = document.createElement('section'); strategies.id = 'mealStrategyChoices'; strategies.className = 'mw-strategies'; strategies.setAttribute('aria-label', '早餐策略与三餐预算');
    const heading = el('timeline').previousElementSibling;
    (heading?.classList.contains('timeline-head') ? heading : el('timeline')).before(strategies);
    const dialog = document.createElement('dialog'); dialog.id = 'mealWorkspaceDialog'; dialog.className = 'mw-dialog'; dialog.setAttribute('aria-labelledby', 'mealDialogTitle'); document.body.append(dialog);
    const refineBox = el('refineText')?.closest('.plan-refine');
    if (refineBox) {
      refineBox.insertAdjacentHTML('afterbegin', '<label class="mw-refine-target">先选要调整的这一顿<select id="mealRefineTarget" aria-label="要调整的日期和餐次"><option value="">请选择日期与餐次</option></select></label>');
      refineBox.querySelector(':scope > span').textContent = '这顿想怎么换？';
      el('refineText').placeholder = '比如：这顿少走一点路，想吃当地味';
      el('refineText').setAttribute('aria-label', '这顿的调整需求');
      el('refinePlan').textContent = '给这顿换个选择 ↗';
      for (const input of [el('mealRefineTarget'), el('refineText')]) input.addEventListener('input', () => { refineRevision++; });
    }
    dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
    const bindings = {mealLunchBudget: 'lunchBudget', mealDinnerBudget: 'dinnerBudget', mealDuration: 'mealMinutes', mealReadyTime: 'readyTime', mealLunchTime: 'lunchTime', mealDinnerTime: 'dinnerTime', mealArrivalTime: 'arrivalTime', mealDepartureTime: 'departureTime', mealReturnHotel: 'returnToHotel'};
    Object.entries(bindings).forEach(([id, key]) => el(id).addEventListener('change', () => {
      const input = el(id); if (!input.checkValidity()) { input.reportValidity(); return; }
      remember(); state.prefs[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.value === '' ? null : Number(input.value) : input.value;
      if (key === 'mealMinutes' && state.prefs.mealMinutes === null) { state.prefs.mealMinutes = 45; input.value = 45; }
      render(); el('mealPreferencesNote').textContent = '已按当前偏好重新排列，保留你锁定的餐次。';
    }));
  }
  function writePreferences() {
    const bindings = {mealLunchBudget: 'lunchBudget', mealDinnerBudget: 'dinnerBudget', mealDuration: 'mealMinutes', mealReadyTime: 'readyTime', mealLunchTime: 'lunchTime', mealDinnerTime: 'dinnerTime', mealArrivalTime: 'arrivalTime', mealDepartureTime: 'departureTime', mealReturnHotel: 'returnToHotel'};
    Object.entries(bindings).forEach(([id, key]) => { if (!el(id)) return; if (el(id).type === 'checkbox') el(id).checked = state.prefs[key]; else el(id).value = state.prefs[key] ?? ''; });
  }
  function setStatus(message) { const node = el('mealWorkspaceStatus'); if (node) node.textContent = message; }
  function assignmentFor(slot, assignments = state.assignments) { return assignments.find(item => item.date === slot.date && item.meal === (slot.meal || 'breakfast')); }
  function candidateList(evidence) {
    return [...(evidence.candidates || []), ...(evidence.hotelMeals || [])].filter((item, index, array) => item?.id && array.findIndex(other => other.id === item.id) === index);
  }
  function inputFor(facts, evidence, assignments) {
    return {checkIn: facts.checkIn, checkOut: facts.checkOut, party: facts.party, quotes: facts.quotes, hotelBreakfast: {...evidence.hotelBreakfast, count: facts.breakfastCount}, candidates: evidence.candidates || [], restrictions: dietaryRequirements(facts.dietaryText), preferences: {...facts.preferences, mealMinutes: state.prefs.mealMinutes, returnToHotel: state.prefs.returnToHotel, ...(state.prefs.readyTime ? {readyTime: state.prefs.readyTime} : {})}, ...(facts.morningDeparture ? {departureTime: facts.morningDeparture} : {}), locks: assignments.filter(item => item.meal === 'breakfast').map(item => ({date: item.date, kind: item.kind, candidateId: item.candidateId}))};
  }
  function manualBreakfast(facts, evidence, assignments, intent, baseline) {
    const dates = breakfastDates(facts), picks = new Set(intent.dates || []);
    const locks = dates.map(date => {
      const existing = assignments.find(item => item.date === date && item.meal === 'breakfast');
      if (existing) return {date, kind: existing.kind, candidateId: existing.candidateId};
      if (picks.has(date)) return {date, kind: 'hotel'};
      const outside = [...(baseline.evaluations[date]?.outside || [])].filter(item => item.state !== 'excluded').sort((a, b) => {
        const rank = value => value.state === 'eligible' ? 0 : 1;
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        if (facts.preferences?.priority === 'budget' && a.adultPrice !== b.adultPrice) return (a.adultPrice ?? Infinity) - (b.adultPrice ?? Infinity);
        if (facts.preferences?.priority === 'local' && a.localSpecialty !== b.localSpecialty) return a.localSpecialty ? -1 : 1;
        return (a.walkMinutes ?? Infinity) - (b.walkMinutes ?? Infinity);
      })[0];
      return {date, kind: 'outside', candidateId: outside?.candidateId || '__outside_not_selected__'};
    });
    const result = planMeals({...inputFor(facts, evidence, assignments), locks});
    const plan = result.plans[0]; if (!plan) return null;
    plan.id = 'manual'; plan.title = '按你选的早餐日期'; plan.recommended = false;
    for (const slot of plan.slots) if (slot.candidateId === '__outside_not_selected__') {
      slot.name = '外出早餐待选'; slot.candidateId = null; slot.kind = 'unresolved'; slot.status = 'unresolved'; slot.reasons = [{code: 'outside-not-selected', message: '这天未选酒店早餐，先挑一家具体门店，再核对供餐与步行路线'}];
    }
    return plan;
  }
  function connectDining(facts, evidence, breakfastPlan, assignments) {
    const prefs = state.prefs;
    const input = {checkIn: facts.checkIn, checkOut: facts.checkOut, party: facts.party, breakfastPlan, candidates: evidence.candidates || [], hotelMeals: evidence.hotelMeals || [], vouchers: facts.useVoucher === false || !(facts.vouchers || []).length ? [] : state.voucher ? [state.voucher] : facts.vouchers || [], restrictions: dietaryRequirements(facts.dietaryText), preferences: {...facts.preferences, mealMinutes: prefs.mealMinutes, lunchBudget: prefs.lunchBudget, dinnerBudget: prefs.dinnerBudget, adultBudgets: {lunch: prefs.lunchBudget, dinner: prefs.dinnerBudget}, desiredTimes: {lunch: prefs.lunchTime, dinner: prefs.dinnerTime}, lunchTime: prefs.lunchTime, dinnerTime: prefs.dinnerTime, returnToHotel: prefs.returnToHotel}, locks: assignments.filter(item => item.meal !== 'breakfast').map(item => ({...item})), ...(prefs.arrivalTime ? {arrivalTime: prefs.arrivalTime} : {}), ...(prefs.departureTime ? {departureTime: prefs.departureTime} : {})};
    const result = planDining({...input, ...(state.feedback?.records?.length ? {feedback: state.feedback, feedbackContext: contextOf(facts)} : {})});
    const baseline = state.feedback?.records?.length ? planDining(input) : null;
    for (const slot of result.slots || []) {
      slot.meal = slot.meal || slot.mealType || 'breakfast';
      slot.locked = assignmentFor(slot, assignments)?.locked === true;
      const previous = baseline?.slots?.find(item => slotKey(item) === slotKey(slot));
      if (previous?.candidateId && previous.candidateId !== slot.candidateId && !assignmentFor(slot, assignments)) slot.feedbackChange = {previousName: previous.name};
    }
    const unparsed = dietaryRequirements(facts.dietaryText).unparsed;
    if (unparsed.length) {
      result.status = result.status === 'invalid' ? 'invalid' : 'needs-confirmation';
      for (const slot of result.slots || []) if (slot.status === 'scheduled') { slot.status = 'pending'; slot.tentativeTime = slot.time; slot.time = null; slot.reasons = [...(slot.reasons || []), {code: 'dietary-wording', message: '饮食说明中有尚未逐项核对的内容，请保留原话向店家确认'}]; }
    }
    return {...result, id: breakfastPlan.id, title: breakfastPlan.title, breakfastPlan};
  }
  function compute(facts, intent = state.intent, assignments = state.assignments) {
    const evidence = buildMealEvidence({hotel: facts.hotel, mealPolicy: facts.mealPolicy, evidence: facts.evidence, places: allPlaces(facts), checkIn: facts.checkIn, checkOut: facts.checkOut, confirmations: state.confirmations});
    const breakfast = planMeals(inputFor(facts, evidence, assignments));
    let selected = intent?.type === 'manual' ? manualBreakfast(facts, evidence, assignments, intent, breakfast) : breakfast.plans.find(plan => plan.id === intent?.id) || breakfast.plans[0];
    if (!selected) return {facts, evidence, breakfast, selected: {status: 'invalid', slots: [], cost: null, errors: breakfast.errors || [], title: '先补齐本次行程'}, choices: []};
    selected.slots.forEach(slot => { slot.meal = 'breakfast'; slot.locked = assignmentFor(slot, assignments)?.locked === true; });
    const selectedDining = connectDining(facts, evidence, selected, assignments), seen = new Set([signature(selected)]);
    const choices = [{intent: clone(intent), plan: selectedDining, current: true}];
    for (const strategy of breakfast.plans) {
      const key = signature(strategy); if (seen.has(key)) continue; seen.add(key);
      strategy.slots.forEach(slot => { slot.meal = 'breakfast'; slot.locked = assignmentFor(slot, assignments)?.locked === true; });
      choices.push({intent: {type: 'strategy', id: strategy.id}, plan: connectDining(facts, evidence, strategy, assignments), current: false});
      if (choices.length === 3) break;
    }
    return {facts, evidence, breakfast, selected: selectedDining, choices};
  }
  function costView(plan) {
    const cost = plan?.cost || {}, known = cost.knownAmount ?? cost.knownAdultAmount, budget = cost.budgetAmount ?? cost.adultBudgetAmount;
    const unknown = cost.unknownAmounts || cost.unknowns || [];
    return {known: finiteMoney(known) ? known : null, budget: finiteMoney(budget) ? budget : null, unknown: Array.isArray(unknown) ? unknown : [], demo: cost.quotesIncludeDemo === true || plan?.breakfastPlan?.cost?.quotesIncludeDemo === true};
  }
  function costMarkup(plan, compact = false) {
    const cost = costView(plan);
    return `<div class="mw-costs${compact ? ' mw-costs-compact' : ''}"><span>${cost.demo ? '示例已知金额' : '已核金额'}<b>${yuan(cost.known)}</b></span><span>预算预留<b>${yuan(cost.budget)}</b></span><span>未知金额<b>${cost.unknown.length ? `${cost.unknown.length} 项` : '无已列未知项'}</b></span></div>${cost.demo ? '<p class="mw-demo">含示例输入；差价为演示值</p>' : ''}`;
  }
  function packageMarkup(model) {
    const facts = model.facts;
    const outsideAssignments = model.selected.slots.filter(slot => ['lunch', 'dinner'].includes(slot.meal) && slot.candidateId).map(slot => ({date: slot.date, meal: slot.meal, kind: slot.kind, candidateId: slot.candidateId, locked: true}));
    const outsideFacts = {...facts, vouchers: [], useVoucher: false};
    const outside = compute(outsideFacts, {type: 'manual', dates: []}, outsideAssignments).selected;
    const result = comparePackages({quoteBook: getQuoteBook(), party: facts.party, options: [
      {id: 'A', quoteSlot: 'A', title: 'A · 不含早，早餐都外出', mealPlan: outside, mealPlanQuoteSlot: 'A'},
      {id: 'B', quoteSlot: 'B', title: 'B · 含早，按当前吃法', mealPlan: model.selected, mealPlanQuoteSlot: 'B'}
    ]});
    const cards = (result.options || []).map(option => `<article class="mw-package-card"><h4>${esc(option.title)}</h4><strong>${option.adultEstimate === null ? '总额待核' : yuan(option.adultEstimate)}</strong><p>${esc(String(option.summary || "").startsWith(`${option.title}：`) ? option.summary.slice(option.title.length + 1) : option.summary)}</p><dl><div><dt>全程房费</dt><dd>${yuan(option.roomAmount)}</dd></div><div><dt>已核成人额外餐费</dt><dd>${yuan(option.food?.knownAmount)}</dd></div><div><dt>成人预算预留</dt><dd>${yuan(option.budgetAmount)}</dd></div></dl>${option.food?.unknownAmounts?.length ? `<small>另有 ${option.food.unknownAmounts.length} 项待核金额，暂不计作零元</small>` : ''}${option.errors?.length ? `<small>${esc(option.errors[0].message)}</small>` : ''}</article>`).join('');
    return `<section class="mw-package-comparison" aria-label="两档套餐整体现金支出"><div class="mw-section-title"><div><span class="mini-label">房费 + 所列餐次</span><h3>房费和餐费，放在一起看</h3></div></div><p class="mw-scope">A 按全程外出早餐排，B 按当前早餐日期排；午晚餐沿用本页选择。房费各算一次，已核餐费、预算和未知金额分开看。儿童收费未知时，不报全家总价。</p><div class="mw-package-grid">${cards}</div><p class="mw-package-result">${esc(result.comparison?.summary || '有报价或餐费仍待核，先看各档已知金额，暂不排名。')}</p><details class="mw-package-notes"><summary>报价与权益还要核对什么</summary><ul>${[...(result.notices || []), ...(result.options || []).flatMap(option => [...(option.notices || []), ...(option.errors || []), ...(option.food?.unknownAmounts || [])])].map(item => item.message).filter(Boolean).filter((message, index, array) => array.indexOf(message) === index).slice(0, 12).map(message => `<li>${esc(message)}</li>`).join('') || '<li>请以本次商品与门店确认结果为准。</li>'}</ul></details>${voucherMarkup(model)}</section>`;
  }
  function voucherMarkup(model) {
    if (!(model.facts.vouchers || []).length) return '';
    const meals = model.selected.slots.filter(slot => ['lunch', 'dinner'].includes(slot.meal) && slot.candidateId);
    const v = state.voucher || {}, selected = meals.find(slot => `${slot.date}|${slot.meal}|${slot.candidateId}` === v.slotKey) || meals[0];
    const weekdays = v.isoWeekdays || [1, 2, 3, 4, 5, 6, 7];
    return `<details class="mw-voucher" ${state.voucher ? 'open' : ''}><summary>核对酒店餐券的使用条件</summary><p>只在本次选中的具体门店、菜单和日期匹配且菜单价已核时抵扣。条款不清楚可留空，金额保持未抵扣。</p><form id="mealVoucherForm"><div class="mw-fields"><label>用在哪一顿<select name="slot">${meals.map(slot => `<option value="${esc(`${slot.date}|${slot.meal}|${slot.candidateId}`)}" ${slot === selected ? 'selected' : ''}>${esc(slot.date)} · ${esc(MEALS[slot.meal])} · ${esc(slot.name)}</option>`).join('')}</select></label><label>券类型<select name="type"><option value="fixed_amount" ${v.type === 'fixed_amount' ? 'selected' : ''}>固定金额抵扣</option><option value="percent" ${v.type === 'percent' ? 'selected' : ''}>按百分比抵扣</option><option value="included_meal" ${v.type === 'included_meal' ? 'selected' : ''}>套餐已含这一餐</option></select></label><label>抵扣额 / 折扣百分比<input name="value" type="number" min="0" max="100000" step="0.01" value="${esc(v.value ?? '')}" placeholder="已含餐次填 0"></label><label>最多覆盖成人<input name="maxAdults" type="number" min="1" max="12" step="1" value="${esc(v.maxAdults ?? model.facts.party.adults)}"></label><label>适用开始日期<input name="validFrom" type="date" value="${esc(v.validFrom || model.facts.checkIn)}"></label><label>适用结束日期<input name="validTo" type="date" value="${esc(v.validTo || model.facts.checkOut)}"></label><label>最低原价消费 · 元<input name="minimumSpend" type="number" min="0" max="100000" step="0.01" value="${esc(v.minimumSpend ?? 0)}"></label><label>预约条件<select name="reservation"><option value="not_required" ${v.reservation !== 'confirmed' ? 'selected' : ''}>已核对无需预约</option><option value="confirmed" ${v.reservation === 'confirmed' ? 'selected' : ''}>已完成并确认预约</option></select></label><label>叠加其他优惠<select name="stacking"><option value="none" ${v.stacking !== 'allowed' ? 'selected' : ''}>不可叠加</option><option value="allowed" ${v.stacking === 'allowed' ? 'selected' : ''}>已确认可叠加</option></select></label></div><fieldset><legend>适用星期</legend><div class="mw-weekdays">${['一','二','三','四','五','六','日'].map((name, index) => `<label><input name="weekday" type="checkbox" value="${index + 1}" ${weekdays.includes(index + 1) ? 'checked' : ''}>周${name}</label>`).join('')}</div></fieldset><label class="mw-check"><input name="feesClear" type="checkbox" ${v.extraFees === 0 ? 'checked' : ''}><span>已核对没有额外必付费用</span></label><label class="mw-check"><input name="childrenClear" type="checkbox" ${v.childrenPolicy === 'confirmed_for_this_party' ? 'checked' : ''}><span>已核对同行儿童的适用与补买条件（无儿童也请核对）</span></label><label class="mw-check"><input name="allChecked" type="checkbox" ${v.confirmedFields?.length === VOUCHER_FIELDS.length ? 'checked' : ''}><span>已逐项核对券类型、币种、具体门店、所选菜单、餐次、日期、星期、份数、儿童、次数、券值、最低消费口径、叠加、额外收费和预约条件</span></label><p class="mw-small">当前餐次的菜单标识：${esc(selected?.menuId || '未核到；请先逐餐核对菜单价，暂不能抵扣')}。券次数沿用套餐输入的次数。</p><p class="mw-form-error" id="mealVoucherError" role="status"></p><button type="submit" class="mw-button" ${meals.length ? '' : 'disabled'}>保存餐券核对</button></form></details>`;
  }
  function renderChoices(model) {
    const node = el('mealStrategyChoices');
    node.innerHTML = `<div class="mw-section-title"><div><span class="mini-label">先选早餐，再接三餐</span><h3>这趟的几种吃法</h3></div><button type="button" id="mealWorkspaceUndo" class="mw-text" ${state.history.length ? '' : 'disabled'}>撤回上一步${state.history.length ? ` · ${state.history.length}` : ''}</button></div><p class="mw-scope">费用是基础房费之外的成人三餐增量。已核菜单价、你填的预算与未知金额分开列；不含未知儿童餐费。含早套餐增量只算一次。</p><div class="mw-strategy-grid">${model.choices.map((choice, index) => {
      const hotelDays = choice.plan.breakfastPlan.slots.filter(slot => slot.kind === 'hotel').map(slot => slot.date.slice(5));
      const outsideDays = choice.plan.breakfastPlan.slots.filter(slot => slot.kind !== 'hotel').length;
      return `<article class="mw-strategy${choice.current ? ' is-current' : ''}"><div class="mw-strategy-top"><span>${choice.current ? '当前安排' : `另一种吃法 ${index}`}</span><span>${statusText(choice.plan.status)}</span></div><h4>${esc(choice.plan.title)}</h4><p>${hotelDays.length ? `酒店早餐 ${hotelDays.join('、')}` : '不安排酒店早餐'}${outsideDays ? `；其余 ${outsideDays} 顿外出或待选` : ''}</p>${costMarkup(choice.plan, true)}<button type="button" class="mw-button ${choice.current ? 'is-muted' : ''}" data-strategy="${index}" ${choice.current ? 'disabled' : ''}>${choice.current ? '正在使用' : '先看差异 →'}</button></article>`;
    }).join('')}</div>${model.choices.length < 3 && model.choices.length ? '<p class="mw-small">按当前门店与锁定餐次，只列出吃法确有不同的选择。</p>' : ''}${packageMarkup(model)}<div id="mealWorkspaceStatus" class="mw-live" role="status" aria-live="polite"></div>`;
    node.querySelectorAll('[data-strategy]').forEach(button => button.addEventListener('click', () => { const choice = model.choices[Number(button.dataset.strategy)]; showPreview({intent: choice.intent, assignments: clone(state.assignments), title: choice.plan.title}); }));
    node.querySelector('#mealVoucherForm')?.addEventListener('submit', event => {
      event.preventDefault(); const form = event.currentTarget, value = name => form.elements.namedItem(name).value, checked = name => form.elements.namedItem(name).checked;
      const slot = model.selected.slots.find(item => `${item.date}|${item.meal}|${item.candidateId}` === value('slot'));
      const error = message => { form.querySelector('#mealVoucherError').textContent = message; };
      if (!slot?.menuId) return error('这顿尚未核到具体菜单与成人价格，先逐餐核对后再记录餐券。');
      if (!form.checkValidity()) return form.reportValidity();
      const weekdays = [...form.querySelectorAll('[name="weekday"]:checked')].map(input => Number(input.value));
      if (!weekdays.length || value('validTo') < value('validFrom')) return error('请核对适用日期与星期。');
      const type = value('type'), amount = value('value') === '' ? null : Number(value('value'));
      if (amount === null || type === 'included_meal' && amount !== 0 || type === 'percent' && amount > 100) return error('请填写券值；已含餐次填 0，百分比不超过 100。');
      const complete = checked('allChecked') && checked('feesClear') && checked('childrenClear');
      remember(); state.voucher = {id: 'package-rights', slotKey: value('slot'), type, currency: 'CNY', venueId: slot.candidateId, menuId: slot.menuId, meal: slot.meal, validFrom: value('validFrom'), validTo: value('validTo'), isoWeekdays: weekdays, maxAdults: Number(value('maxAdults')), childrenPolicy: checked('childrenClear') ? 'confirmed_for_this_party' : 'unknown', uses: Number(model.facts.vouchers[0].uses), value: amount, minimumSpend: Number(value('minimumSpend')), minimumSpendBasis: 'original_adult_menu_subtotal', stacking: value('stacking'), extraFees: checked('feesClear') ? 0 : null, reservation: value('reservation'), confirmedFields: complete ? VOUCHER_FIELDS : []};
      const plan = render();
      const applied = (plan?.voucherResults || []).some(result => result.appliedDiscount > 0 || result.coveredAmount > 0);
      setStatus(!complete ? '已保存餐券线索；待核条件未齐，金额暂不抵扣。' : applied ? '已按这顿已核菜单和核销条件计入餐券；金额只抵扣一次。' : '已保存餐券条件；当前所选餐次未匹配核销范围，金额未抵扣。');
    });
    el('mealWorkspaceUndo').addEventListener('click', undo);
    if (model.selected.status === 'invalid') setStatus((model.selected.errors || []).map(item => item.message).join('；') || '请先确认有效的入住与退房日期、同行人数。');
  }
  function rowReasons(slot) {
    return [...(slot.reasons || []), ...(slot.exclusions || [])].map(item => typeof item === 'string' ? item : item.message).filter(Boolean).filter((message, index, array) => array.indexOf(message) === index);
  }
  function timeMarkup(slot) {
    const time = slot.time || slot.tentativeTime;
    if (!time) return '<p class="mw-time">供餐或完整时段待核，暂不排确定时间。</p>';
    if (typeof time === 'string') return `<p class="mw-time">${slot.time ? '' : '参考 · '}${esc(time)}${slot.time ? '' : '，条件待核'}</p>`;
    const segments = [time.leaveHotel ? `${time.leaveHotel} 从酒店出发` : '', time.start ? `${time.start}${time.end ? `–${time.end}` : ''} 用餐` : '', time.returnHotel ? `${time.returnHotel} 回到酒店` : ''].filter(Boolean);
    return `<p class="mw-time">${slot.time ? '' : '参考 · '}${esc(segments.join(' · ') || '时刻待核')}${slot.time ? '' : '；供餐与条件待核'}</p>`;
  }
  function renderRows(model) {
    const target = el('mealRefineTarget'), selectedTarget = target?.value;
    if (target) {
      target.innerHTML = '<option value="">请选择日期与餐次</option>' + model.selected.slots.filter(slot => slot.status !== 'skipped').map(slot => `<option value="${esc(slotKey(slot))}">${esc(slot.date)} · ${esc(MEALS[slot.meal])} · ${esc(slot.name || '地点待选')}${slot.locked ? '（已锁定，需先解锁）' : ''}</option>`).join('');
      if ([...target.options].some(option => option.value === selectedTarget)) target.value = selectedTarget;
    }
    const timeline = el('timeline'); timeline.innerHTML = ''; timeline.classList.add('mw-timeline');
    for (const slot of model.selected.slots || []) {
      if (slot.status === 'skipped') continue;
      const row = document.createElement('article'); row.className = 'meal-row mw-meal-row'; row.dataset.mealType = MEALS[slot.meal]; row.dataset.mealKey = slotKey(slot);
      const reasons = rowReasons(slot), route = slot.walkMinutes ?? slot.time?.walkMinutes ?? slot.tentativeTime?.walkMinutes;
      const routeText = slot.kind === 'hotel' || slot.candidateId === 'hotel-breakfast' ? '酒店内用餐' : typeof route === 'number' ? `酒店至门店单程步行 ${route} 分钟${route > (model.facts.preferences?.walkLimitMinutes ?? 15) ? ' · 超出步行上限' : ''}` : '酒店至具体分店的步行路线待核';
      const price = slot.adultPrice;
      row.innerHTML = `<div class="mw-meal-date"><time datetime="${esc(slot.date)}">${esc(slot.date.slice(5))}</time><span class="meal-type">${esc(MEALS[slot.meal] || '用餐')}</span></div><div class="mw-meal-main"><div class="mw-meal-title"><strong>${esc(slot.name || '这顿饭的地点待选')}</strong><span class="meal-state">${slot.locked ? '已锁定 · ' : ''}${statusText(slot.status)}</span></div>${timeMarkup(slot)}<p>${esc(routeText)} · 每顿预留 ${state.prefs.mealMinutes} 分钟，不含排队。</p><p>${finiteMoney(price) ? `本次已核成人菜单价 ${yuan(price)}/人` : '本次成人菜单价待核'}${model.facts.party?.children > 0 ? '；儿童收费另核' : ''}</p>${slot.feedbackChange ? `<p class="mw-feedback-reason">参考这趟已记录的感受，这顿从「${esc(slot.feedbackChange.previousName)}」改选「${esc(slot.name)}」；仍以本次供餐、路线和忌口核对为准。</p>` : ''}${slot.feedback?.reasons?.length ? `<p class="mw-feedback-reason">这家店的本次用餐记录：${esc(slot.feedback.reasons.join('；'))}。${slot.feedback.priceNotice ? esc(slot.feedback.priceNotice) : ''}</p>` : ''}${reasons.length ? `<details class="mw-reasons"><summary>这顿饭还要留意什么</summary><ul>${reasons.slice(0, 10).map(message => `<li>${esc(message)}</li>`).join('')}</ul></details>` : ''}<div class="mw-row-actions"><button type="button" class="mw-text" data-action="replace">换一家店 ↗</button><button type="button" class="mw-text" data-action="lock">${slot.locked ? '解除锁定' : '锁定这顿'}</button><button type="button" class="mw-text" data-action="confirm" ${candidateKey(slot) ? '' : 'disabled'}>核对本次用餐信息</button>${candidateKey(slot) && slot.date <= todayBeijing() ? `<button type="button" class="mw-text" data-action="feedback">${state.feedback?.records?.some(item => item.id === `${slotKey(slot)}|${candidateKey(slot)}`) ? '编辑这顿反馈' : '记录吃过的感受'}</button>` : ''}</div></div>`;
      row.querySelector('[data-action="replace"]').addEventListener('click', () => chooseForSlot(slot));
      row.querySelector('[data-action="lock"]').addEventListener('click', () => toggleLock(slot));
      row.querySelector('[data-action="confirm"]').addEventListener('click', () => confirmSlot(slot)); row.querySelector('[data-action="feedback"]')?.addEventListener('click', () => showFeedback(slot)); timeline.append(row);
    }
    if (!(model.selected.slots || []).length) timeline.innerHTML = '<p class="mw-empty">先补齐行程日期与同行人数，再把每顿饭接起来。</p>';
    const notes = document.createElement('div'); notes.className = 'mw-plan-notes';
    const unknowns = costView(model.selected).unknown;
    const assumptions = (model.selected.assumptions || []).map(item => typeof item === 'string' ? item : item.message).filter(Boolean);
    notes.innerHTML = `<p>以上为${['ready', 'feasible'].includes(model.selected.status) ? '按已核条件排出的安排' : '待核对的三餐草案'}。${esc(model.facts.dietaryText ? `饮食说明原文：「${model.facts.dietaryText}」。明确不吃的食材与过敏分别核对；未识别的描述保留原话。` : '如果有过敏或交叉接触要求，请逐餐向商家确认。')}</p>${unknowns.length ? `<details><summary>哪些金额仍未知 · ${unknowns.length} 项</summary><ul>${unknowns.map(item => `<li>${esc(typeof item === 'string' ? item : [item.date, item.message || item.description || '该项金额尚未核实'].filter(Boolean).join(' · '))}</li>`).join('')}</ul></details>` : ''}${assumptions.length ? `<details><summary>这份安排预留了什么</summary><ul>${[...new Set(assumptions)].map(message => `<li>${esc(message)}</li>`).join('')}</ul></details>` : ''}`; timeline.append(notes);
    const sourceNotes = [...new Set((model.evidence.sourceNotes || []).map(item => item.message).filter(Boolean))];
    if (sourceNotes.length) notes.insertAdjacentHTML('beforeend', `<details><summary>这些门店资料，还需怎样核对</summary><ul>${sourceNotes.map(message => `<li>${esc(message)}</li>`).join('')}</ul></details>`);
    const vouchers = model.selected.voucherResults || [];
    if (vouchers.length) notes.insertAdjacentHTML('beforeend', `<details><summary>餐券与套餐权益怎么计</summary><ul>${vouchers.map(voucher => `<li>${voucher.appliedDiscount > 0 ? `已按核销条件扣减 ${yuan(voucher.appliedDiscount)}。` : voucher.coveredAmount > 0 ? `已核套餐覆盖用餐 ${yuan(voucher.coveredAmount)}，不作现金重复抵扣。` : '这张权益未抵扣金额。'}${esc((voucher.reasons || []).map(item => item.message).filter(Boolean).join('；'))}</li>`).join('')}</ul></details>`);
    if (state.feedback?.records?.length) {
      const records = state.feedback.records;
      notes.insertAdjacentHTML('beforeend', `<details class="mw-feedback-records"><summary>这趟已记下的用餐感受 · ${records.length} 顿</summary><p>保存在当前页面会话；可编辑、清空或撤回，不写入分享快照。</p><ul>${records.map((record, index) => {
        const name = record.candidateId === 'hotel-breakfast' ? model.evidence.hotelBreakfast?.name || '酒店早餐' : candidateList(model.evidence).find(item => item.id === record.candidateId)?.name || '已记录的具体门店';
        return `<li><button type="button" class="mw-text" data-feedback-record="${index}">${esc(record.date)} · ${esc(MEALS[record.meal])} · ${esc(name)} · 编辑</button>${record.actualSpend ? `<span>全桌实付 ${yuan(record.actualSpend.amount)}，只作回顾</span>` : ''}</li>`;
      }).join('')}</ul></details>`);
      notes.querySelectorAll('[data-feedback-record]').forEach(button => button.addEventListener('click', () => {
        const record = records[Number(button.dataset.feedbackRecord)];
        const name = record.candidateId === 'hotel-breakfast' ? model.evidence.hotelBreakfast?.name || '酒店早餐' : candidateList(model.evidence).find(item => item.id === record.candidateId)?.name || '已记录的具体门店';
        showFeedback({...record, kind: record.candidateId === 'hotel-breakfast' ? 'hotel' : 'outside', name});
      }));
    }
    const tab = document.querySelector('[data-result-tab].active')?.dataset.resultTab;
    if (tab === 'breakfast') timeline.querySelectorAll('.meal-row').forEach(row => row.classList.toggle('hidden', row.dataset.mealType !== '早餐'));
  }
  function publish() { if (current?.selected) onPlanChange(clone(current.selected)); }
  function render() {
    refineRevision++;
    mount(); if (!mounted) return null;
    const facts = getFacts(); ensureContext(facts);
    const calendarDates = [...(facts.selectedHotelBreakfastDates || [])].sort();
    if (JSON.stringify(calendarDates) !== JSON.stringify(state.calendarDates)) {
      remember(); const previousDates = new Set(state.calendarDates), nextDates = new Set(calendarDates);
      state.assignments = state.assignments.filter(item => item.meal !== 'breakfast' || item.locked || previousDates.has(item.date) === nextDates.has(item.date));
      state.intent = {type: 'manual', dates: calendarDates}; state.calendarDates = calendarDates;
    }
    try { current = compute(facts); renderChoices(current); renderRows(current); publish(); return clone(current.selected); }
    catch (error) { el('timeline').innerHTML = '<p class="mw-empty">本次用餐信息还不能连成方案，请核对行程日期、人数和具体门店。</p>'; setStatus('用餐信息尚不完整，请补齐后重试。'); console.error('Meal workspace:', error); return null; }
  }
  function syncBreakfast() {
    const dates = (current?.selected?.breakfastPlan?.slots || []).filter(slot => slot.kind === 'hotel').map(slot => slot.date);
    state.calendarDates = [...dates].sort(); onBreakfastSelectionChange(dates);
  }
  function undo() {
    const previous = state.history.pop(); if (!previous) return;
    Object.assign(state, previous); state.calendarDates = [...(getFacts().selectedHotelBreakfastDates || [])].sort(); closeDialog(); writePreferences(); render(); syncBreakfast(); setStatus('已撤回上一步，恢复之前的选择与核对记录。');
  }
  function toggleLock(slot) {
    if (!candidateKey(slot)) { setStatus('先为这顿饭选一家具体门店，再锁定。'); return; }
    remember(); const existing = assignmentFor(slot);
    if (existing) existing.locked = !existing.locked;
    else state.assignments.push({date: slot.date, meal: slot.meal, kind: slot.kind, candidateId: slot.candidateId, locked: true});
    render(); setStatus(slot.locked ? '已解除这顿饭的锁定。' : '已锁定这顿饭，调整偏好时会保留；条件冲突仍会提示。');
  }
  function openDialog(title, body, setup) {
    const dialog = el('mealWorkspaceDialog'); if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.innerHTML = `<div class="mw-dialog-head"><h3 id="mealDialogTitle">${esc(title)}</h3><button class="mw-close" type="button" aria-label="关闭对话框">×</button></div>${body}`;
    dialog.querySelector('.mw-close').addEventListener('click', closeDialog); setup?.(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeDialog() { previewRevision++; const dialog = el('mealWorkspaceDialog'); if (dialog?.open) { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); } }
  function showPreview(proposal) {
    const facts = getFacts(); if (contextKey(facts) !== state.context) { render(); return; }
    const proposed = compute(facts, proposal.intent, proposal.assignments).selected;
    if (proposal.guard && (!proposal.guard() || otherMealFingerprint(proposed, proposal.targetKey) !== proposal.otherFingerprint)) { setRefineStatus('其他餐次或当前条件发生变化，请重新请求这一顿的建议。'); return; }
    const before = new Map((current?.selected.slots || []).map(slot => [slotKey(slot), slot]));
    const changes = (proposed.slots || []).filter(slot => { const old = before.get(slotKey(slot)); return !old || old.kind !== slot.kind || old.candidateId !== slot.candidateId; });
    const originalContext = state.context, revision = ++previewRevision;
    openDialog('先看看这次怎么变', `<p class="mw-dialog-intro">${esc(proposal.title || proposed.title)}。采用后会同步酒店早餐日期；你可以撤回。</p><div class="mw-preview-cost"><div><span>当前安排</span>${costMarkup(current.selected, true)}</div><div><span>准备采用</span>${costMarkup(proposed, true)}</div></div><p class="mw-small">已核金额与预算均为基础房费之外的成人增量；未知金额未被当作零元。含早套餐全程增量不按使用天数打折。</p><ul class="mw-diff">${changes.length ? changes.map(slot => `<li><span>${esc(slot.date.slice(5))} · ${esc(MEALS[slot.meal])}</span><s>${esc(before.get(slotKey(slot))?.name || '待选')}</s><strong>→ ${esc(slot.name || '待选')}</strong><small>${statusText(slot.status)}${slot.locked ? ' · 保留锁定' : ''}</small></li>`).join('') : '<li>门店与餐次没有变化，已按当前条件重新核对时间与费用。</li>'}</ul><p class="mw-dialog-notice">${['ready', 'feasible'].includes(proposed.status) ? '当前条件已经核对；出发前仍可再向门店复核。' : '这是一份待核对草案。采用只保存你的选择，不能替代营业、菜单与忌口核对。'}</p><div class="mw-dialog-actions"><button type="button" class="mw-button is-muted" id="mealPreviewCancel">返回再看看</button><button type="button" class="mw-button" id="mealPreviewApply" ${proposed.status === 'invalid' ? 'disabled' : ''}>采用这份安排</button></div>`, dialog => {
      dialog.querySelector('#mealPreviewCancel').addEventListener('click', closeDialog);
      dialog.querySelector('#mealPreviewApply').addEventListener('click', () => {
        if (state.context !== originalContext || contextKey(getFacts()) !== originalContext || revision !== previewRevision) { closeDialog(); render(); return; }
        if (proposal.guard && (!proposal.guard() || otherMealFingerprint(compute(getFacts(), proposal.intent, proposal.assignments).selected, proposal.targetKey) !== proposal.otherFingerprint)) { closeDialog(); setRefineStatus('当前条件已变化，这次建议已失效；请重新请求。'); return; }
        remember(); state.intent = clone(proposal.intent); state.assignments = clone(proposal.assignments); closeDialog(); render(); syncBreakfast(); setStatus('已采用这份安排。早餐日期已同步，可以撤回。');
      });
    });
  }
  function routeNote(candidate) {
    const route = candidate?.route;
    if (!route || typeof route.minutes !== 'number') return '这家具体分店的步行路线尚未核实。可以先作为候选，时间保持待核。';
    return `酒店到这家具体分店步行约 ${route.minutes} 分钟${route.minutes > (current?.facts.preferences?.walkLimitMinutes ?? 15) ? '，超出当前步行上限；选择后会保留冲突提示' : ''}。菜单、餐次供应与忌口仍要单独核对。`;
  }
  function makeAssignment(slot, id) {
    const old = assignmentFor(slot);
    return {date: slot.date, meal: slot.meal, kind: id === 'hotel-breakfast' ? 'hotel' : slot.meal !== 'breakfast' && (current.evidence.hotelMeals || []).some(item => item.id === id) ? 'hotel' : 'outside', candidateId: id === 'hotel-breakfast' ? null : id, locked: old?.locked || false};
  }
  function replaceAssignment(slot, id) {
    const assignments = clone(state.assignments).filter(item => slotKey(item) !== slotKey(slot)); assignments.push(makeAssignment(slot, id));
    showPreview({intent: clone(state.intent), assignments, title: `为 ${slot.date.slice(5)} ${MEALS[slot.meal]} 换一家店`});
  }
  function chooseForSlot(slot) {
    const candidates = slot.meal === 'breakfast' ? current.evidence.candidates || [] : candidateList(current.evidence);
    const options = [...(slot.meal === 'breakfast' ? [{id: 'hotel-breakfast', name: current.evidence.hotelBreakfast?.name || '酒店早餐'}] : []), ...candidates];
    openDialog(`给 ${slot.date.slice(5)} ${MEALS[slot.meal]} 换一家店`, `<p class="mw-dialog-intro">只列具体门店。资料未核清的仍可先选作候选，不会排成确定时间。</p><label class="mw-dialog-field">选一家门店<select id="mealReplaceCandidate">${options.map(item => `<option value="${esc(item.id)}">${esc(item.name)}${typeof item.route?.minutes === 'number' ? ` · 步行 ${item.route.minutes} 分钟` : item.id === 'hotel-breakfast' ? '' : ' · 路线待核'}</option>`).join('')}</select></label><p id="mealReplaceRoute" class="mw-dialog-notice"></p><div class="mw-dialog-actions"><button id="mealReplacePreview" type="button" class="mw-button" ${options.length ? '' : 'disabled'}>先看更换差异 →</button></div>${!options.length ? '<p>先从地图选择一家具体门店，再回来安排。</p>' : ''}`, dialog => {
      const select = dialog.querySelector('#mealReplaceCandidate'); if (options.some(item => item.id === candidateKey(slot))) select.value = candidateKey(slot);
      const update = () => { dialog.querySelector('#mealReplaceRoute').textContent = select.value === 'hotel-breakfast' ? '酒店早餐仍需核对份数、供餐时段和本次饮食要求。' : routeNote(options.find(item => String(item.id) === select.value)); };
      select.addEventListener('change', update); update(); dialog.querySelector('#mealReplacePreview').addEventListener('click', () => replaceAssignment(slot, select.value));
    });
  }
  function choosePlace(place) {
    mount(); const facts = getFacts(); ensureContext(facts);
    if (!place?.id || !place?.name) { render(); setStatus('先选中有名称和具体分店信息的地点，再安排到某一顿。'); return; }
    extraPlaces.set(String(place.id), place); render();
    const slots = (current?.selected.slots || []).filter(slot => slot.status !== 'skipped');
    openDialog(`把「${place.name}」安排到哪一顿`, `<p class="mw-dialog-intro">${esc(place.address || '具体地址尚待核对')}</p><p class="mw-dialog-notice">${esc(routeNote(place))}</p><label class="mw-dialog-field">日期与餐次<select id="mealPlaceSlot">${slots.map(slot => `<option value="${esc(slotKey(slot))}">${esc(slot.date)} · ${esc(MEALS[slot.meal])} · 当前：${esc(slot.name || '待选')}</option>`).join('')}</select></label><div class="mw-dialog-actions"><button type="button" class="mw-button" id="mealPlacePreview" ${slots.length ? '' : 'disabled'}>先看安排差异 →</button></div>`, dialog => { dialog.querySelector('#mealPlacePreview').addEventListener('click', () => { const slot = slots.find(item => slotKey(item) === dialog.querySelector('#mealPlaceSlot').value); if (slot) replaceAssignment(slot, String(place.id)); }); });
  }
  function publishedWindowFor(slot) {
    const target = candidateKey(slot) === 'hotel-breakfast' ? current.evidence.hotelBreakfast : candidateList(current.evidence).find(item => item.id === candidateKey(slot))?.meals?.[slot.meal];
    const weekday = new Date(`${slot.date}T00:00:00Z`).getUTCDay() || 7;
    const windows = (target?.referenceSchedules || []).filter(record => Array.isArray(record.isoWeekdays) && record.isoWeekdays.includes(weekday) && (!record.validFrom || record.validFrom <= slot.date) && (!record.validTo || record.validTo >= slot.date));
    const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '');
    if (!windows.length || windows.some(record => record.closed || !validTime(record.start) || !validTime(record.end) || record.end <= record.start)) return null;
    const start = windows.map(record => record.start).sort().at(-1), end = windows.map(record => record.end).sort()[0];
    return start < end ? {start, end, confirmed: false} : null;
  }
  function confirmSlot(slot) {
    const id = candidateKey(slot); if (!id) return;
    const existing = state.confirmations.items.find(item => item.candidateId === id && item.meal === slot.meal && (item.date === slot.date || item.dates?.includes(slot.date))) || {};
    const savedSchedule = (existing.schedules || []).find(item => (!item.validFrom || item.validFrom <= slot.date) && (!item.validTo || item.validTo >= slot.date));
    const referenceWindow = savedSchedule ? null : publishedWindowFor(slot);
    const schedule = savedSchedule || referenceWindow || {}, price = existing.price || {}, dietary = existing.dietary || {};
    const restrictions = dietaryRequirements(current.facts.dietaryText), hasDietaryNeeds = restrictions.avoidIngredients.length || restrictions.allergens.length || restrictions.unparsed.length;
    const date = slot.date, originalContext = state.context;
    openDialog(`核对 ${date.slice(5)} ${MEALS[slot.meal]}`, `<form id="mealConfirmationForm"><p class="mw-dialog-intro"><strong>${esc(slot.name)}</strong><br>把向酒店或门店确认的供餐和时段记下来；菜单价、忌口可稍后补。</p><fieldset><legend>这次是否供应</legend><label class="mw-check"><input name="supply" type="checkbox" ${existing.confirmed ? 'checked' : ''}><span>已确认这家门店在所选日期供应${esc(MEALS[slot.meal])}</span></label></fieldset><fieldset><legend>完整供餐时段</legend>${referenceWindow ? '<p class="mw-small mw-reference-note">公开参考，仍需核对本次日期。</p>' : ''}<div class="mw-fields"><label>开始供餐<input name="start" type="time" value="${esc(schedule.start || '')}"></label><label>结束供餐<input name="end" type="time" value="${esc(schedule.end || '')}"></label></div><label class="mw-check"><input name="scheduleChecked" type="checkbox" ${schedule.confirmed ? 'checked' : ''}><span>已核对以上完整起止时段，适用于这次日期与餐次</span></label></fieldset><details class="mw-confirm-extra" ${price.confirmed ? 'open' : ''}><summary>补充成人菜单价与税费</summary><div class="mw-confirm-extra-body"><label class="mw-dialog-field">元 / 成人 / 本餐次<input name="amount" type="number" min="0" max="100000" step="0.01" placeholder="不知道可留空" value="${finiteMoney(price.amount) ? price.amount : ''}"></label><label class="mw-dialog-field">本次所选菜单 / 套餐编号<input name="menuId" maxlength="100" placeholder="用于核对餐券；没有可留空" value="${esc(price.menuId || '')}"></label><label class="mw-check"><input name="priceChecked" type="checkbox" ${price.confirmed ? 'checked' : ''}><span>已核对本次所选餐食的成人菜单价</span></label><label class="mw-check"><input name="tax" type="checkbox" ${price.taxIncluded ? 'checked' : ''}><span>已确认金额包含税费</span></label><label class="mw-check"><input name="fees" type="checkbox" ${price.feesIncluded ? 'checked' : ''}><span>已确认金额包含服务费及其他必付费用</span></label><p class="mw-small">按这次选择的菜单与人数填写，暂不清楚可留空。</p></div></details><details class="mw-confirm-extra" ${hasDietaryNeeds || dietary.confirmed ? 'open' : ''}><summary>核对这顿的忌口与过敏要求</summary><div class="mw-confirm-extra-body">${current.facts.dietaryText ? `<p class="mw-small">你的原话：${esc(current.facts.dietaryText)}</p>` : ''}<label class="mw-dialog-field">已知包含的食材<input name="contains" maxlength="400" placeholder="逗号分隔，可留空" value="${esc((dietary.contains || []).join('，'))}"></label><label class="mw-dialog-field">已确认可以避开的食材<input name="excluded" maxlength="400" placeholder="逐项填食材名，可留空" value="${esc((dietary.excludedIngredients || []).join('，'))}"></label><label class="mw-check"><input name="dietChecked" type="checkbox" ${dietary.confirmed ? 'checked' : ''}><span>已向店家核对这次所选餐食的食材与忌口</span></label><label class="mw-check"><input name="crossContact" type="checkbox" ${dietary.crossContactConfirmed ? 'checked' : ''}><span>已单独核对所填过敏原的交叉接触条件</span></label><p class="mw-small">如有过敏，请向店家逐项核对食材与交叉接触，出发前再复核。</p></div></details><p id="mealConfirmationError" class="mw-form-error" role="status"></p><div class="mw-dialog-actions"><button type="button" class="mw-button is-muted" id="mealConfirmCancel">暂不记录</button><button type="submit" class="mw-button">保存本次核对</button></div></form>`, dialog => {
      const form = dialog.querySelector('form'); dialog.querySelector('#mealConfirmCancel').addEventListener('click', closeDialog);
      form.addEventListener('submit', event => {
        event.preventDefault(); if (contextKey(getFacts()) !== originalContext) { closeDialog(); render(); return; }
        const value = name => form.elements.namedItem(name).value, checked = name => form.elements.namedItem(name).checked;
        const error = message => { dialog.querySelector('#mealConfirmationError').textContent = message; };
        if (checked('scheduleChecked') && (!value('start') || !value('end') || value('end') <= value('start'))) return error('请填写完整且结束晚于开始的供餐时段；暂不清楚时可取消时段确认。');
        if (checked('priceChecked') && (value('amount') === '' || !finiteMoney(Number(value('amount'))))) return error('要确认菜单价，请填写非负金额；暂不清楚时可取消价格确认。');
        const item = {candidateId: id, meal: slot.meal, date, confirmed: checked('supply'), schedules: checked('scheduleChecked') ? [{isoWeekdays: [new Date(`${date}T00:00:00Z`).getUTCDay() || 7], validFrom: date, validTo: date, start: value('start'), end: value('end'), confirmed: true, origin: 'user_input'}] : [], ...(value('amount') !== '' ? {price: {amount: Number(value('amount')), currency: 'CNY', basis: 'per_adult_per_meal', scope: slot.meal, dates: [date], ...(value('menuId').trim() ? {menuId: value('menuId').trim()} : {}), confirmed: checked('priceChecked'), taxIncluded: checked('tax'), feesIncluded: checked('fees'), origin: 'user_input'}} : {}), dietary: {contains: parts(value('contains')), excludedIngredients: parts(value('excluded')), confirmed: checked('dietChecked'), crossContactConfirmed: checked('crossContact'), origin: 'user_input'}};
        remember(); state.confirmations.items = state.confirmations.items.filter(other => !(other.candidateId === id && other.meal === slot.meal && (other.date === date || other.dates?.includes(date)))); state.confirmations.items.push(item); closeDialog(); render(); setStatus('已保存这次用餐的逐项核对；缺少的条件继续保留待核。');
      });
    });
  }
  function showFeedback(slot) {
    const facts = getFacts(), context = contextOf(facts), id = `${slotKey(slot)}|${candidateKey(slot)}`;
    const existing = state.feedback?.records?.find(item => item.id === id);
    openDialog(`记下 ${slot.date.slice(5)} ${MEALS[slot.meal]} 的感受`, `<form id="mealFeedbackForm"><p class="mw-dialog-intro"><strong>${esc(slot.name)}</strong><br>只记录这趟在这家具体门店吃过的一餐。反馈留在当前页面会话，用来调整后续选店。</p><div class="mw-fields"><label>口味感受<select name="taste"><option value="">暂不评价</option><option value="liked" ${existing?.taste === 'liked' ? 'selected' : ''}>喜欢</option><option value="neutral" ${existing?.taste === 'neutral' ? 'selected' : ''}>一般</option><option value="disliked" ${existing?.taste === 'disliked' ? 'selected' : ''}>不太合适</option></select></label><label>同行接受度<select name="partyAcceptance"><option value="">暂不评价</option><option value="all" ${existing?.partyAcceptance === 'all' ? 'selected' : ''}>大家都能接受</option><option value="some" ${existing?.partyAcceptance === 'some' ? 'selected' : ''}>部分人接受</option><option value="none" ${existing?.partyAcceptance === 'none' ? 'selected' : ''}>大家都不太接受</option></select></label><label>实际等位 · 分钟<input name="waitMinutes" type="number" min="0" max="600" step="1" placeholder="不知道可留空" value="${esc(existing?.waitMinutes ?? '')}"></label><label>实际全桌花费 · 元<input name="actualSpend" type="number" min="0" max="1000000" step="0.01" placeholder="不知道可留空" value="${esc(existing?.actualSpend?.amount ?? '')}"></label><label>这顿实际成人<input name="actualAdults" type="number" min="1" max="12" step="1" value="${esc(existing?.actualSpend?.adults ?? facts.party.adults)}"></label><label>这顿实际儿童<input name="actualChildren" type="number" min="0" max="8" step="1" value="${esc(existing?.actualSpend?.children ?? facts.party.children)}"></label></div><p class="mw-small">实付仅供这趟回顾，不替换本次菜单价、预算、报价或餐券核销金额；等位也不代表下次会等同样久。</p><p class="mw-form-error" id="mealFeedbackError" role="status"></p><div class="mw-dialog-actions">${existing ? '<button type="button" class="mw-button is-muted" id="mealFeedbackClear">清空这顿</button>' : ''}<button type="button" class="mw-button is-muted" id="mealFeedbackCancel">暂不记录</button><button type="submit" class="mw-button">保存感受</button></div></form>`, dialog => {
      const form = dialog.querySelector('form'), error = message => { dialog.querySelector('#mealFeedbackError').textContent = message; };
      dialog.querySelector('#mealFeedbackCancel').addEventListener('click', closeDialog);
      dialog.querySelector('#mealFeedbackClear')?.addEventListener('click', () => { remember(); state.feedback.records = state.feedback.records.filter(item => item.id !== id); closeDialog(); render(); setStatus('已清空这顿反馈，后续选店已重新排列；可以撤回。'); });
      form.addEventListener('submit', event => {
        event.preventDefault(); if (contextKey(getFacts()) !== state.context) { closeDialog(); render(); return; }
        if (!form.checkValidity()) return form.reportValidity();
        const value = name => form.elements.namedItem(name).value;
        const spend = value('actualSpend') === '' ? null : {amount: Number(value('actualSpend')), currency: 'CNY', basis: 'party_total', adults: Number(value('actualAdults')), children: Number(value('actualChildren'))};
        let current = state.feedback;
        try { current ||= createMealFeedback(context); } catch { return error('请先核对酒店分店地址和入住日期。'); }
        const saved = saveMealFeedback(current, {id, candidateId: candidateKey(slot), date: slot.date, meal: slot.meal, taste: value('taste') || null, partyAcceptance: value('partyAcceptance') || null, waitMinutes: value('waitMinutes') === '' ? null : Number(value('waitMinutes')), actualSpend: spend}, {context});
        if (!saved.ok) return error(saved.errors.join('；'));
        remember(); state.feedback = saved.state; closeDialog(); render(); setStatus('已保存这顿感受；后续餐次按已核条件与反馈重新排列，可以撤回。');
      });
    });
  }
  function setRefineStatus(message) { if (el('refineStatus')) el('refineStatus').textContent = message; }
  function otherMealFingerprint(plan, targetKey) {
    return JSON.stringify((plan?.slots || []).filter(slot => slotKey(slot) !== targetKey).map(slot => [slotKey(slot), slot.kind, candidateKey(slot), slot.locked === true]).sort((a, b) => a[0].localeCompare(b[0])));
  }
  function refineInputSignature() { return JSON.stringify({facts: getFacts(), quote: getQuoteBook(), work: snapshot(), target: el('mealRefineTarget')?.value, text: el('refineText')?.value}); }
  function checkRefineTarget() {
    const key = el('mealRefineTarget')?.value, slot = current?.selected.slots.find(item => slotKey(item) === key);
    if (!key || !slot) { setRefineStatus('先选择日期和餐次，再告诉我这一顿想怎么换。'); el('mealRefineTarget')?.focus(); return false; }
    if (slot.locked) { setRefineStatus('这顿已锁定。请先在餐次卡片上解除锁定，再请求建议。'); return false; }
    return true;
  }
  async function refine(text) {
    if (refineBusy) return;
    const targetKey = el('mealRefineTarget')?.value;
    if (!targetKey) { setRefineStatus('先选择日期和餐次，再告诉我这一顿想怎么换。'); el('mealRefineTarget')?.focus(); return; }
    render();
    const slot = current?.selected.slots.find(item => slotKey(item) === targetKey);
    if (!slot) { setRefineStatus('这顿已不在当前行程，请重新选择。'); return; }
    if (slot.locked) { setRefineStatus('这顿已锁定。请先在餐次卡片上解除锁定，再请求建议。'); return; }
    text = String(text || '').trim();
    if (!text || text.length > 500) { setRefineStatus('请用 1–500 字写下这一顿的需求。'); return; }
    const facts = getFacts();
    const frozen = current.selected.slots.filter(item => candidateKey(item)).map(item => ({date: item.date, meal: item.meal, kind: item.kind, candidateId: item.candidateId, locked: item.locked === true}));
    const candidates = [...(slot.meal === 'breakfast' ? [{id: 'hotel-breakfast', name: current.evidence.hotelBreakfast?.name || '酒店早餐', address: facts.hotel.address, onSite: true}, ...(current.evidence.candidates || [])] : candidateList(current.evidence))];
    candidates.sort((a, b) => Number(b.id === candidateKey(slot)) - Number(a.id === candidateKey(slot)));
    const evaluated = [];
    for (const candidate of candidates) {
      const address = candidate.address || (candidate.onSite ? facts.hotel.address : '');
      if (!candidate.id || String(candidate.id).length > 120 || !candidate.name || candidate.name.length > 100 || !address || address.length > 240 || evaluated.some(item => item.id === String(candidate.id))) continue;
      const assignments = frozen.filter(item => slotKey(item) !== targetKey); assignments.push(makeAssignment(slot, String(candidate.id)));
      const trial = compute(facts, state.intent, assignments).selected.slots.find(item => slotKey(item) === targetKey);
      if (!trial) continue;
      evaluated.push({id: String(candidate.id), name: candidate.name, address, routeMinutes: typeof trial.walkMinutes === 'number' ? trial.walkMinutes : candidate.onSite ? 0 : null, status: trial.status === 'scheduled' ? 'eligible' : ['locked-conflict', 'unresolved'].includes(trial.status) || trial.exclusions?.length ? 'excluded' : 'pending', reasons: rowReasons(trial).slice(0, 6).map(reason => reason.slice(0, 120))});
      if (evaluated.length === 25) break;
    }
    if (!evaluated.length) { setRefineStatus('先从附近地图选一家有具体分店地址的门店，再请求这一顿的建议。'); return; }
    const requestTarget = {date: slot.date, meal: slot.meal, candidateId: candidateKey(slot) || null};
    const revision = ++refineRevision, inputSignature = refineInputSignature(), otherFingerprint = otherMealFingerprint(current.selected, targetKey);
    const isCurrent = () => revision === refineRevision && inputSignature === refineInputSignature();
    refineBusy = true; el('refinePlan').disabled = true; setRefineStatus('正在为这一顿找选择；收到后先给你看差异。');
    try {
      const result = await requestMealRefine({text, target: requestTarget, candidates: evaluated});
      if (!isCurrent()) { setRefineStatus('你已修改行程、目标或需求，刚才的建议没有覆盖新条件。'); return; }
      if (result?.status === 'needs-clarification') { setRefineStatus(result.reason || '请再补充这顿更在意什么，或先核对候选门店条件。'); return; }
      if (result?.status !== 'preview' || result.previewOnly !== true || result.requiresRecalculation !== true || !result.target || ['date', 'meal', 'candidateId'].some(key => result.target[key] !== requestTarget[key]) || !evaluated.some(item => item.id === result.candidateId && item.status !== 'excluded')) { setRefineStatus('这次建议没有匹配到可核对的当前门店，请重新请求。'); return; }
      const assignments = frozen.filter(item => slotKey(item) !== targetKey); assignments.push(makeAssignment(slot, result.candidateId));
      const plan = compute(facts, state.intent, assignments).selected;
      if (otherMealFingerprint(plan, targetKey) !== otherFingerprint) { setRefineStatus('这次建议会改变其他餐次，已保留原安排；请改用手动换店。'); return; }
      setRefineStatus('建议已重算，采用前请核对差异与待确认条件。');
      showPreview({intent: clone(state.intent), assignments, title: `${slot.date.slice(5)} ${MEALS[slot.meal]} · ${result.reason || '看看这一顿的新选择'}`, targetKey, otherFingerprint, guard: isCurrent});
    } catch (error) { setRefineStatus(isCurrent() ? error.message || '这顿的建议暂时不可用，请稍后重试；当前安排已保留。' : '当前条件已变化，刚才的响应已失效。'); }
    finally { refineBusy = false; el('refinePlan').disabled = false; }
  }
  function reset() { refineRevision++; closeDialog(); state = freshState(); current = null; extraPlaces.clear(); writePreferences(); }
  mount();
  return {render, choosePlace, reset, refine, checkRefineTarget};
}
