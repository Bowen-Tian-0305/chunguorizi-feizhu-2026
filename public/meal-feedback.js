// Local trip feedback. Contains no persistence or network calls.
const MEALS = ['breakfast', 'lunch', 'dinner'];
const clone = value => JSON.parse(JSON.stringify(value));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}
function tripContext(value) {
  const hotel = value?.hotel;
  const name = text(hotel?.name, 200), address = text(hotel?.address, 400);
  const checkIn = date(value?.checkIn), checkOut = date(value?.checkOut);
  if (!name || !address || !checkIn || !checkOut || checkOut <= checkIn || (Date.parse(checkOut) - Date.parse(checkIn)) / 86400000 > 30) return null;
  return {hotel: {id: text(hotel.id, 120), name, address}, checkIn, checkOut};
}
const sameContext = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const before = (entry, slot) => entry.date < slot.date || entry.date === slot.date && MEALS.indexOf(entry.meal) < MEALS.indexOf(slot.meal);

export function createMealFeedback(context) {
  const normalized = tripContext(context);
  if (!normalized) throw new TypeError('请先确认酒店、分店地址和入住日期');
  return {version: 1, context: normalized, records: []};
}

function validateEntry(entry, context, today) {
  const errors = [];
  if (!date(today)) errors.push('记录日期无效');
  const id = text(entry?.id, 120), candidateId = text(entry?.candidateId, 120);
  if (!id || !candidateId) errors.push('请选择本次吃过的具体门店');
  if (!date(entry?.date) || entry.date < context.checkIn || entry.date > context.checkOut || entry.date > today || !MEALS.includes(entry?.meal)) errors.push('只记录本次旅行已经发生的餐次');
  if (!['liked', 'neutral', 'disliked', null, undefined].includes(entry?.taste)) errors.push('请选择实际口味感受');
  if (!['all', 'some', 'none', null, undefined].includes(entry?.partyAcceptance)) errors.push('请选择同行人的实际接受程度');
  const waitMinutes = entry?.waitMinutes ?? null;
  if (waitMinutes !== null && (!Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > 600)) errors.push('等位时间应为0到600分钟');
  const spend = entry?.actualSpend ?? null;
  if (spend !== null && (!spend || typeof spend.amount !== 'number' || !Number.isFinite(spend.amount) || spend.amount < 0 || spend.amount > 1000000 || spend.currency !== 'CNY' || spend.basis !== 'party_total' || !Number.isInteger(spend.adults) || spend.adults < 1 || spend.adults > 12 || !Number.isInteger(spend.children) || spend.children < 0 || spend.children > 8)) errors.push('实付需填写人民币全桌金额及实际同行人数');
  if (errors.length) return {errors};
  return {errors, entry: {id, candidateId, date: entry.date, meal: entry.meal, taste: entry.taste ?? null, partyAcceptance: entry.partyAcceptance ?? null, waitMinutes, actualSpend: spend === null ? null : {amount: spend.amount, currency: 'CNY', basis: 'party_total', adults: spend.adults, children: spend.children}, recordedOn: today}};
}

/** Caller keeps state in the current browser session. Unknown/private input fields are discarded. */
export function saveMealFeedback(state, entry, {context, now = Date.now()} = {}) {
  const current = tripContext(context);
  if (!current || !state || state.version !== 1 || !sameContext(state.context, current) || !Array.isArray(state.records)) return {ok: false, errors: ['酒店或行程已变化，请为本次旅行重新记录'], state};
  const today = Number.isFinite(now) ? new Date(now + 8 * 3600000).toISOString().slice(0, 10) : null;
  if (!today) return {ok: false, errors: ['记录时间无效'], state};
  const checked = validateEntry(entry, current, today);
  if (checked.errors.length) return {ok: false, errors: checked.errors, state};
  const existing = state.records.find(record => record.id === checked.entry.id);
  if (existing && ['candidateId', 'date', 'meal'].some(key => existing[key] !== checked.entry[key])) return {ok: false, errors: ['这条记录属于另一餐，请另建记录'], state};
  const records = state.records.filter(record => record.id !== checked.entry.id);
  if (!existing && records.length >= 90) return {ok: false, errors: ['本次旅行的反馈记录已满，请先整理已有记录'], state};
  records.push(checked.entry);
  return {ok: true, errors: [], state: {version: 1, context: clone(current), records: clone(records)}};
}

/** Rank only after feasibility filtering. Locked positions and feasibility classes are preserved. */
export function rankWithMealFeedback(candidates, {state, context, slot} = {}) {
  const current = tripContext(context);
  const valid = current && state?.version === 1 && sameContext(state.context, current) && Array.isArray(state.records) && date(slot?.date) && MEALS.includes(slot?.meal) && slot.date >= current.checkIn && slot.date <= current.checkOut;
  const records = valid ? state.records.filter(record => !validateEntry(record, current, record.recordedOn).errors.length && before(record, slot)) : [];
  const ranked = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const own = records.filter(record => record.candidateId === candidate.id).sort((a, b) => a.date.localeCompare(b.date) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal)).at(-1);
    let score = 0; const reasons = [];
    if (own) {
      if (own.taste === 'liked') {score += 2; reasons.push('本次旅行上次在这家吃得合口味');}
      if (own.taste === 'disliked') {score -= 3; reasons.push('上次口味不太合适，优先看看其他店');}
      if (own.partyAcceptance === 'all') {score++; reasons.push('上次同行人都能接受');}
      if (own.partyAcceptance === 'none') {score -= 2; reasons.push('上次同行人接受度较低');}
      if (own.waitMinutes >= 30) {score -= own.waitMinutes >= 60 ? 2 : 1; reasons.push(`上次记录等位${own.waitMinutes}分钟，本次等位仍需确认`);}
    }
    return {...clone(candidate), feedback: {score, reasons, previousActualSpend: own?.actualSpend ? clone(own.actualSpend) : null, priceNotice: own?.actualSpend ? '上次实付仅供回顾，不是本次菜单价或预算' : null}, _feedbackIndex: index};
  });
  const category = item => item.state === 'eligible' ? 0 : ['excluded', 'blocked', 'locked-conflict'].includes(item.state) ? 2 : 1;
  const movable = ranked.filter(item => !item.locked).sort((a, b) => category(a) - category(b) || b.feedback.score - a.feedback.score || a._feedbackIndex - b._feedbackIndex);
  let position = 0;
  return ranked.map(item => {
    const result = item.locked ? item : movable[position++];
    delete result._feedbackIndex;
    return result;
  });
}
