// Whole-stay cash comparison. Breakfast attribution remains owned by quote-context.js.
import {matchQuoteContexts, quoteAssessment} from './quote-context.js';

const SLOTS = ['A', 'B'];
const MEALS = ['breakfast', 'lunch', 'dinner'];
const TOTAL = new Set(['total', 'stay-total', '全程', '全程总价', '入住全程']);
const RMB = new Set(['cny', 'rmb', '人民币', '¥', '￥']);
const TERMS = {roomType: '房型', cancellation: '退改政策', payment: '支付条件', occupancy: '入住人数', roomCount: '房间数', otherTerms: '其他权益或条款', breakfastCount: '早餐份数', mealRights: '餐券次数', mealRightType: '餐券餐次'};
const copy = value => JSON.parse(JSON.stringify(value));
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const known = record => record?.confirmed === true && !['', 'unknown', '未知', '未提供', '待确认', '待核对', '不详'].includes(normalize(record.value));
const money = amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000;
const round = amount => Math.round((amount + Number.EPSILON) * 100) / 100;
const sum = items => round(items.reduce((total, item) => total + item.amount, 0));
const issue = (code, message, extra = {}) => ({code, message, ...extra});
const yuan = amount => `¥${amount.toLocaleString('zh-CN', {maximumFractionDigits: 2})}`;
function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

function inspectQuote(book, slot) {
  const errors = [], notices = [], quote = book?.quotes?.[slot];
  if (!quote) return {quote: null, errors: [issue('missing-quote', `请补充套餐 ${slot} 的本次全程报价`)], notices};
  const fields = quote.fields || {};
  errors.push(...matchQuoteContexts(quote.context || {}, book.context || {}).reasons);
  // A locally generated row index cannot identify a different hotel branch.
  const a = quote.context?.hotel, b = book.context?.hotel;
  if (/^manual[-:]?\d+$/i.test(a?.id || '') && a?.id === b?.id && normalize(a?.name) !== normalize(b?.name)) errors.push(issue('hotel-unverified', '请核对同名酒店的具体分店'));
  if (!Array.isArray(quote.conflicts) || quote.conflicts.length) errors.push(issue('quote-conflict', `套餐 ${slot} 的报价或条款仍有未处理冲突`));
  if (!Array.isArray(quote.invalidFields) || quote.invalidFields.some(field => ['total', 'priceBasis', 'currency'].includes(field))) errors.push(issue('invalid-price', `套餐 ${slot} 的金额、币种或价格口径无效`));
  if (!known(fields.total) || !money(fields.total.value)) errors.push(issue('unconfirmed-total', `请核对套餐 ${slot} 的全程总价`));
  if (!known(fields.priceBasis) || !TOTAL.has(normalize(fields.priceBasis.value))) errors.push(issue('non-total-price', `套餐 ${slot} 必须使用已核对的全程总价`));
  if (fields.currency && (!known(fields.currency) || !RMB.has(normalize(fields.currency.value)))) errors.push(issue('unsupported-currency', `请将套餐 ${slot} 的金额换算并确认为人民币`));
  else if (!fields.currency) notices.push(issue('currency-input-scope', '金额按页面人民币输入口径计算；外币报价请先换算并核对'));
  return {quote, errors, notices};
}

function termsNotices(book) {
  const notices = [], a = book?.quotes?.A?.fields || {}, b = book?.quotes?.B?.fields || {};
  for (const [field, label] of Object.entries(TERMS)) {
    const left = a[field], right = b[field];
    if (known(left) && known(right) && normalize(left.value) !== normalize(right.value)) notices.push(issue('different-package-terms', `两档套餐的${label}不同，请结合实际需要选择；现金支出差额不代表早餐价格`, {field, A: left.value, B: right.value}));
    else if (known(left) !== known(right)) notices.push(issue('unverified-package-terms', `两档套餐的${label}尚未全部核清，不给未核权益估值`, {field}));
  }
  return notices;
}

function blockedOption(option, errors, notices) {
  return {id: option.id, quoteSlot: option.quoteSlot, title: option.title || `套餐 ${option.quoteSlot}`, status: 'blocked', currency: 'CNY', roomAmount: null, knownAmount: null, budgetAmount: null, adultEstimate: null, familyTotal: null, scope: 'whole-stay-room-plus-listed-adult-meals', conditional: true, coverage: [], lines: [], food: null, errors, notices, summary: errors[0]?.message || '请补齐本次报价和用餐范围'};
}

function optionCost(option, book, party) {
  const {quote, errors, notices} = inspectQuote(book, option.quoteSlot);
  const plan = option.mealPlan, cost = plan?.cost;
  if (!plan || !Array.isArray(plan.slots) || !plan.slots.length || !cost) errors.push(issue('missing-meal-plan', '请为这档套餐选择需要比较的餐次'));
  if (cost && (!['adult-breakfast-increment-excludes-room-price', 'adult-meals-increment-excludes-room-price'].includes(cost.scope) || cost.currency !== 'CNY')) errors.push(issue('unsupported-food-cost', '餐费必须使用基础房费之外的成人用餐明细，不能直接叠加已含房费的总额'));
  const hasCostArrays = cost && ['knownItems', 'budgetItems', 'unknownAmounts'].every(field => Array.isArray(cost[field]));
  if (cost && !hasCostArrays) errors.push(issue('invalid-food-cost', '餐费明细不完整，请重新生成本次方案'));
  if (hasCostArrays && ([...cost.knownItems, ...cost.budgetItems].some(item => !item || !money(item.amount)) || cost.unknownAmounts.some(item => !item || typeof item !== 'object'))) errors.push(issue('invalid-food-amount', '餐费明细含无效金额，请重新核对'));
  if (plan?.voucherResults !== undefined && !Array.isArray(plan.voucherResults)) errors.push(issue('invalid-voucher-result', '餐券核销明细不完整，请重新生成本次方案'));
  if (errors.length) return blockedOption(option, errors, notices);
  const coverage = [], seen = new Set();
  for (const slot of plan?.slots || []) {
    const meal = slot?.meal || 'breakfast', key = `${slot?.date}|${meal}`;
    if (!slot || !MEALS.includes(meal) || dateNumber(slot.date) === null || slot.date < book.context?.checkIn || slot.date > book.context?.checkOut || meal === 'breakfast' && slot.date === book.context?.checkIn || seen.has(key)) errors.push(issue('invalid-meal-coverage', '餐次日期或范围不一致，请重新核对本次行程'));
    seen.add(key); coverage.push(key);
  }
  if (option.mealPlanQuoteSlot !== undefined && option.mealPlanQuoteSlot !== option.quoteSlot) errors.push(issue('meal-package-mismatch', '这份餐费按另一档套餐权益计算，请为当前套餐重新生成'));
  const hasIncludedMeals = (cost?.knownItems || []).some(item => item.coveredByPackage === true || item.code === 'package-meal-covered');
  const hasVoucherUse = (plan?.voucherResults || []).some(result => result?.appliedDiscount > 0 || result?.coveredAmount > 0 || result?.usesConsumed > 0);
  if ((hasIncludedMeals || hasVoucherUse) && option.mealPlanQuoteSlot !== option.quoteSlot) errors.push(issue('meal-package-unverified', '已含餐食或餐券抵扣需要对应到当前套餐，核对前不计入总额'));
  if (errors.length) return blockedOption(option, errors, notices);

  const removedItems = cost.knownItems.filter(item => item.code === 'package-premium');
  const knownItems = copy(cost.knownItems.filter(item => item.code !== 'package-premium'));
  // Verified planner applications are the only support for reductions from a known menu.
  // A voucher face value, aggregate discount or an unapplied voucher cannot lower that menu.
  for (const item of knownItems) {
    if (item.code !== 'confirmed-menu' || !money(item.originalAmount) || item.originalAmount <= item.amount) continue;
    const applications = (plan.voucherResults || []).filter(result => ['applied', 'partly-applied'].includes(result?.status)).flatMap(result => Array.isArray(result.applications) ? result.applications : []);
    const supported = sum(applications.filter(application => application?.date === item.date && application.meal === item.meal && application.candidateId === item.candidateId && ['cash-discount', 'included-meal'].includes(application.kind) && money(application.amount)));
    const reduction = round(item.originalAmount - item.amount);
    if (supported < reduction) {
      item.amount = round(item.originalAmount - Math.min(supported, reduction));
      if (item.amount > 0) item.coveredByPackage = false;
      notices.push(issue('unsupported-discount-restored', '没有对应已核核销明细的菜单折扣未计入，按已核菜单原价保留预算'));
    }
  }
  const budgetItems = copy(cost.budgetItems);
  const unknownAmounts = copy(cost.unknownAmounts.filter(item => item?.code !== 'package-premium-unknown'));
  const hotelBreakfast = plan.slots.filter(slot => (!slot.meal || slot.meal === 'breakfast') && slot.kind === 'hotel');
  const count = quote.fields.breakfastCount;
  if (hotelBreakfast.length && (!known(count) || !Number.isInteger(count.value) || count.value < party.adults)) unknownAmounts.push(issue('hotel-breakfast-entitlement-unknown', `套餐 ${option.quoteSlot} 是否覆盖所选日期全部成人的酒店早餐仍待核对`, {scope: 'adults', dates: hotelBreakfast.map(slot => slot.date)}));
  for (const slot of plan.slots.filter(slot => ['locked-conflict', 'unresolved'].includes(slot.status))) {
    if (!unknownAmounts.some(item => item.date === slot.date && (!item.meal || item.meal === (slot.meal || 'breakfast')) && item.scope === 'adults')) unknownAmounts.push(issue('unresolved-meal-cost', '这顿尚无可执行安排，费用仍需补充', {scope: 'adults', date: slot.date, meal: slot.meal || 'breakfast'}));
  }
  if (party.children > 0 && !unknownAmounts.some(item => item.scope === 'children')) unknownAmounts.push(issue('children-price-unknown', '儿童餐费尚未逐餐核清，不提供全家总价', {scope: 'children'}));
  const roomAmount = quote.fields.total.value, foodKnown = sum(knownItems), budgetAmount = sum(budgetItems), knownAmount = round(roomAmount + foodKnown);
  // An unknown scope is never silently treated as zero adult spending.
  const adultUnknown = unknownAmounts.some(item => item.scope !== 'children');
  const adultEstimate = adultUnknown ? null : round(knownAmount + budgetAmount);
  const demo = quote.demo === true || cost.quotesIncludeDemo === true;
  const conditional = cost.conditional === true || plan.slots.some(slot => slot.status !== 'scheduled') || unknownAmounts.length > 0 || budgetItems.length > 0;
  const familyTotal = !party.children && !conditional && !demo ? knownAmount : null;
  const title = option.title || `套餐 ${option.quoteSlot}`;
  const lines = [{kind: 'room', amount: roomAmount, label: `套餐 ${option.quoteSlot} 全程房费，只计一次`}, {kind: 'confirmed-food', amount: foodKnown, label: demo ? '示例成人额外餐费' : '已核成人额外餐费'}, {kind: 'user-budget', amount: budgetAmount, label: '你设定的成人用餐预算，非门店报价'}];
  if (hotelBreakfast.length) notices.push(issue('whole-package-price', '已含早餐按所选套餐覆盖，不重复叠加含早价差；少吃或不吃也不会降低套餐房费'));
  if ((plan.voucherResults || []).some(result => !['applied', 'partly-applied'].includes(result?.status))) notices.push(issue('unverified-voucher-not-deducted', '未满足核销条件的餐券未抵扣费用'));
  const summary = adultEstimate === null ? `${title}：${demo ? '示例' : ''}已知金额 ${yuan(knownAmount)}，另有待核餐费${budgetAmount ? `及成人预算 ${yuan(budgetAmount)}` : ''}` : `${title}：全程房费与所列成人用餐${budgetItems.length ? '预算约' : '支出'} ${yuan(adultEstimate)}${party.children ? '，儿童餐费另核' : ''}${conditional ? '，供餐及安排仍以确认结果为准' : ''}${demo ? '（示例）' : ''}`;
  return {id: option.id, quoteSlot: option.quoteSlot, title, status: adultUnknown ? 'incomplete' : conditional || demo ? 'estimate' : 'ready', demo, currency: 'CNY', roomAmount, knownAmount, budgetAmount, adultEstimate, familyTotal, scope: 'whole-stay-room-plus-listed-adult-meals', conditional, coverage: coverage.sort(), lines, food: {knownItems, knownAmount: foodKnown, budgetItems, budgetAmount, unknownAmounts, removedPackagePremium: sum(removedItems)}, errors: [], notices, summary};
}

/**
 * options: [{id, title?, quoteSlot:'A'|'B', mealPlan, mealPlanQuoteSlot?}].
 * mealPlan must be the unmodified planMeals/planDining result for this exact trip and party.
 * When package coverage or voucher redemption is used, mealPlanQuoteSlot must explicitly name
 * the quote used to build that meal plan. All coupon eligibility stays in planDining; this
 * module never deducts a face value or cost.discountAmount from the itemised spending again.
 */
export function comparePackages({quoteBook, party, options} = {}) {
  const errors = [];
  if (!quoteBook?.context || !quoteBook?.quotes) errors.push(issue('missing-quote-book', '请先选择本次酒店和入住日期'));
  if (!party || !Number.isInteger(party.adults) || party.adults < 1 || party.adults > 12 || !Number.isInteger(party.children) || party.children < 0 || party.children > 8) errors.push(issue('invalid-party', '请核对成人和儿童人数'));
  if (!Array.isArray(options) || options.length < 1 || options.length > 12) errors.push(issue('invalid-options', '请选择 1 至 12 份本次用餐方案'));
  const ids = new Set();
  for (const option of Array.isArray(options) ? options : []) {
    if (!option || typeof option.id !== 'string' || !option.id.trim() || ids.has(option.id) || !SLOTS.includes(option.quoteSlot)) errors.push(issue('invalid-option', '方案标识须唯一，并选择套餐 A 或 B'));
    ids.add(option?.id);
  }
  if (errors.length) return {status: 'invalid', currency: 'CNY', options: [], comparison: null, breakfastAttribution: null, notices: [], errors};
  const calculated = options.map(option => optionCost(option, quoteBook, party)), notices = termsNotices(quoteBook);
  let breakfastAttribution = null;
  try {breakfastAttribution = quoteAssessment(quoteBook);} catch {notices.push(issue('breakfast-attribution-unavailable', '早餐价差仍需在报价区完成独立核对'));}
  if (!breakfastAttribution?.comparable) notices.push(issue('cash-comparison-only', '这里比较整档套餐与所列用餐的现金支出，不把套餐差额归为早餐价值'));
  const comparable = calculated.length > 1 && calculated.every(option => option.adultEstimate !== null) && calculated.every(option => JSON.stringify(option.coverage) === JSON.stringify(calculated[0].coverage)) && calculated.every(option => option.demo === calculated[0].demo);
  let comparison = null;
  if (comparable) {
    const sorted = [...calculated].sort((a, b) => a.adultEstimate - b.adultEstimate), low = sorted[0], high = sorted.at(-1), difference = round(high.adultEstimate - low.adultEstimate);
    const estimate = calculated.some(option => option.conditional || option.budgetAmount > 0 || option.demo);
    comparison = {status: estimate ? 'budget-estimate' : 'confirmed-cash', scope: 'whole-stay-room-plus-listed-adult-meals', cheapestOptionId: sorted.filter(option => option.adultEstimate === low.adultEstimate).length === 1 ? low.id : null, difference, lowestAmount: low.adultEstimate, highestAmount: high.adultEstimate, summary: `${difference ? `${low.title}的${estimate ? '预算' : '现金支出'}比${high.title}少${estimate ? '约' : ''} ${yuan(difference)}` : '所列方案的成人口径金额相同'}${party.children ? '；均未含未核儿童餐费' : ''}。套餐条款与额外权益请一并衡量${calculated[0].demo ? '（示例）' : ''}。`};
  } else if (calculated.length > 1) {
    const unequalCoverage = calculated.some(option => JSON.stringify(option.coverage) !== JSON.stringify(calculated[0].coverage));
    notices.push(issue(unequalCoverage ? 'different-meal-coverage' : 'cash-comparison-incomplete', unequalCoverage ? '所选方案包含的餐次不同，请补齐相同用餐范围后再比较金额' : '存在待核金额、报价或示例与真实数据混用，暂不排名'));
  }
  return {status: calculated.some(option => option.status === 'blocked' || option.status === 'incomplete') ? 'incomplete' : calculated.some(option => option.status === 'estimate') ? 'estimate' : 'ready', currency: 'CNY', options: calculated, comparison, breakfastAttribution, notices, errors: []};
}
