// Quotes belong to one hotel and one stay. All functions are immutable and DOM free.
const SLOTS = ['A', 'B'];
const SOURCE_KINDS = new Set(['manual', 'screenshot', 'voice', 'product', 'demo', 'derived']);
const NUMBER_FIELDS = new Set(['total', 'breakfastCount', 'mealRights', 'roomCount']);
const TERMS = ['roomType', 'cancellation', 'payment', 'occupancy', 'roomCount', 'currency', 'priceBasis', 'otherTerms'];
const FIELDS = new Set(['total', 'breakfastCount', 'mealRights', 'mealRightType', ...TERMS]);
const LABELS = {total: '全程总价', roomType: '房型', cancellation: '退改政策', payment: '支付条件', occupancy: '入住人数', roomCount: '房间数', currency: '币种', priceBasis: '价格口径', otherTerms: '其他权益或条款', breakfastCount: '早餐份数', mealRights: '餐券次数', mealRightType: '餐券餐次'};
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).normalize('NFKC').trim() : '';
const normalized = value => text(value).replace(/\s+/g, '').toLowerCase();
const cityName = value => text(value).replace(/市$|特别行政区$/, '');
const equal = (a, b) => typeof a === 'number' || typeof b === 'number' ? a === b : normalized(a) === normalized(b);
const issue = (code, message, extra = {}) => ({code, message, ...extra});

function slotName(slot) {
  if (!SLOTS.includes(slot)) throw new TypeError('报价位置必须为 A 或 B');
  return slot;
}

function dateValue(value) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? timestamp : null;
}

/** Accepts {city, hotel:{id,name,address}, checkIn, checkOut}; never infers dates/city. */
export function normalizeQuoteContext(input = {}) {
  const hotel = input.hotel || {};
  return {
    city: cityName(input.city || hotel.city),
    hotel: {id: text(hotel.id), name: text(hotel.name), address: text(hotel.address)},
    checkIn: text(input.checkIn), checkOut: text(input.checkOut)
  };
}

function contextIssues(input) {
  const context = normalizeQuoteContext(input), reasons = [];
  if (!context.city) reasons.push(issue('missing-city', '报价缺少城市'));
  if (!context.hotel.id && !context.hotel.name) reasons.push(issue('missing-hotel', '报价缺少具体酒店名称或标识'));
  const start = dateValue(context.checkIn), end = dateValue(context.checkOut);
  if (start === null) reasons.push(issue('missing-check-in', '报价入住日期缺失或无效'));
  if (end === null) reasons.push(issue('missing-check-out', '报价退房日期缺失或无效'));
  if (start !== null && end !== null && (end <= start || end - start > 30 * 86400000)) reasons.push(issue('invalid-stay', '报价须为 1 至 30 晚的有效入住日期'));
  return reasons;
}

/** Full exact identity only; no fuzzy name or geographic proximity matching. */
export function matchQuoteContexts(left, right) {
  const a = normalizeQuoteContext(left), b = normalizeQuoteContext(right);
  const reasons = [...contextIssues(a).map(r => ({...r, side: 'left'})), ...contextIssues(b).map(r => ({...r, side: 'right'}))];
  if (a.city && b.city && normalized(a.city) !== normalized(b.city)) reasons.push(issue('city-mismatch', '报价与当前城市不一致'));
  if (a.hotel.id && b.hotel.id) {
    if (a.hotel.id !== b.hotel.id) reasons.push(issue('hotel-mismatch', '报价与当前酒店标识不一致'));
    // An unchanged stable ID is authoritative, while a contradictory branch address still blocks.
  } else if (a.hotel.name && b.hotel.name) {
    if (normalized(a.hotel.name) !== normalized(b.hotel.name)) reasons.push(issue('hotel-mismatch', '报价与当前具体酒店名称不一致'));
  } else if (!reasons.some(r => r.code === 'missing-hotel')) reasons.push(issue('hotel-unverified', '酒店标识与名称还不能对应，请确认具体酒店'));
  if (a.hotel.address && b.hotel.address && normalized(a.hotel.address) !== normalized(b.hotel.address)) reasons.push(issue('address-mismatch', '酒店地址不一致，请核对具体分店'));
  if (a.checkIn && b.checkIn && a.checkIn !== b.checkIn) reasons.push(issue('check-in-mismatch', '报价入住日期与当前行程不同'));
  if (a.checkOut && b.checkOut && a.checkOut !== b.checkOut) reasons.push(issue('check-out-mismatch', '报价退房日期与当前行程不同'));
  return {matches: reasons.length === 0, reasons};
}

export function createQuoteBook(context = {}) {
  return {context: normalizeQuoteContext(context), quotes: {A: null, B: null}, retired: [], comparisonConfirmation: null};
}

/** Retires stale quotes; choosing the same hotel/stay does not destroy an existing confirmation. */
export function setQuoteContext(book, context, {clearDemo = false} = {}) {
  const next = normalizeQuoteContext(context);
  const unchanged = JSON.stringify(next) === JSON.stringify(book.context) || matchQuoteContexts(book.context, next).matches;
  if (unchanged && !clearDemo) return clone(book);
  const result = {...clone(book), context: next, comparisonConfirmation: null};
  for (const slot of SLOTS) {
    const quote = result.quotes[slot];
    if (quote && (!matchQuoteContexts(quote.context, next).matches || clearDemo && quote.demo)) {
      result.retired.push({slot, reason: clearDemo && quote.demo ? 'left-demo' : 'context-changed', quote});
      result.quotes[slot] = null;
    }
  }
  result.retired = result.retired.slice(-20);
  return result;
}

function sourceRecord(input = {}) {
  if (!SOURCE_KINDS.has(input.kind) || !text(input.id)) throw new TypeError('报价来源需要唯一 id 与有效 kind');
  const result = {id: text(input.id), kind: input.kind, label: text(input.label)};
  if (input.originalSource) result.originalSource = sourceRecord(input.originalSource);
  return result;
}

function demoSource(source) {return source.kind === 'demo' || Boolean(source.originalSource && demoSource(source.originalSource));}

function makeQuote(slot, input) {
  const source = sourceRecord(input.source), fields = {}, invalidFields = [];
  for (const [key, value] of Object.entries(input.fields || {})) {
    if (!FIELDS.has(key) || value === null || value === undefined || value === '') continue;
    if (NUMBER_FIELDS.has(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || key !== 'total' && !Number.isInteger(value))) {
      invalidFields.push(key); continue;
    }
    if (!NUMBER_FIELDS.has(key) && typeof value !== 'string' && typeof value !== 'number') {
      invalidFields.push(key); continue;
    }
    fields[key] = {value: typeof value === 'string' ? text(value) : value, source, confirmed: source.kind === 'manual' || source.kind === 'demo', confirmations: []};
  }
  if (fields.total && !fields.priceBasis && ['manual', 'demo'].includes(source.kind)) fields.priceBasis = {value: 'total', source, confirmed: true, confirmations: []};
  return {slot, context: normalizeQuoteContext(input.context), contextEvidence: clone(input.contextEvidence || null), source, fields, invalidFields, conflicts: [], demo: demoSource(source)};
}

/** Adds one independent product/screenshot. Conflicting values are retained for explicit resolution. */
export function putQuote(book, slot, input) {
  slotName(slot);
  const incoming = makeQuote(slot, input), result = clone(book), current = result.quotes[slot];
  if (!current) result.quotes[slot] = incoming;
  else if (!matchQuoteContexts(current.context, incoming.context).matches) {
    const conflict = {field: 'context', existing: {value: current.context, source: current.source}, incoming: {value: incoming.context, source: incoming.source}, quote: incoming};
    if (!current.conflicts.some(item => item.field === 'context' && JSON.stringify(item.incoming) === JSON.stringify(conflict.incoming))) current.conflicts.push(conflict);
  } else {
    current.demo ||= incoming.demo;
    current.invalidFields = [...new Set([...current.invalidFields, ...incoming.invalidFields])];
    for (const [field, record] of Object.entries(incoming.fields)) {
      if (!current.fields[field]) current.fields[field] = record;
      else if (!equal(current.fields[field].value, record.value)) {
        if (!current.conflicts.some(item => item.field === field && equal(item.incoming.value, record.value) && item.incoming.source.id === record.source.id)) current.conflicts.push({field, existing: clone(current.fields[field]), incoming: record});
      } else {
        // Corroborating evidence does not replace original provenance, especially demo evidence.
        current.fields[field].confirmed ||= record.confirmed;
        const confirmations = current.fields[field].confirmations;
        if (!confirmations.some(item => item.id === record.source.id)) confirmations.push(record.source);
      }
    }
  }
  if (fingerprint(result) !== fingerprint(book)) result.comparisonConfirmation = null;
  return result;
}

/** Explicit replace for a user choosing another product. Never call this to silently merge OCR. */
export function replaceQuote(book, slot, input) {
  slotName(slot);
  const result = clone(book);
  if (result.quotes[slot]) result.retired.push({slot, reason: 'user-replaced', quote: result.quotes[slot]});
  result.retired = result.retired.slice(-20);
  result.quotes[slot] = makeQuote(slot, input);
  result.comparisonConfirmation = null;
  return result;
}

export function removeQuote(book, slot) {
  slotName(slot);
  const result = clone(book);
  if (result.quotes[slot]) result.retired.push({slot, reason: 'user-removed', quote: result.quotes[slot]});
  result.retired = result.retired.slice(-20);
  result.quotes[slot] = null;
  result.comparisonConfirmation = null;
  return result;
}

/** Edits only the specified fields; automatic extraction remains pending until an explicit user confirmation. */
export function editQuoteFields(book, slot, patch, {source} = {}) {
  slotName(slot);
  const editSource = sourceRecord(source), result = clone(book);
  const created = !result.quotes[slot];
  const quote = result.quotes[slot] ||= makeQuote(slot, {context: book.context, fields: {}, source: editSource});
  for (const [field, value] of Object.entries(patch || {})) {
    if (!FIELDS.has(field)) continue;
    const previous = quote.fields[field];
    quote.conflicts = quote.conflicts.filter(conflict => conflict.field !== field);
    quote.invalidFields = quote.invalidFields.filter(key => key !== field);
    if (value === null || value === undefined || value === '') {delete quote.fields[field]; continue;}
    const nextSource = previous ? {...editSource, kind: 'derived', originalSource: previous.source} : editSource;
    const checked = makeQuote(slot, {context: quote.context, fields: {[field]: value}, source: nextSource});
    if (checked.invalidFields.includes(field)) {delete quote.fields[field]; quote.invalidFields.push(field); continue;}
    quote.fields[field] = {...checked.fields[field], confirmed: ['manual', 'demo'].includes(editSource.kind)};
    quote.demo ||= demoSource(nextSource);
  }
  // The manual input is explicitly labelled as the total for the stay; OCR basis is never inferred.
  if (created && quote.fields.total && !quote.fields.priceBasis && editSource.kind === 'manual') quote.fields.priceBasis = {value: 'total', source: editSource, confirmed: true, confirmations: []};
  if (fingerprint(result) !== fingerprint(book)) result.comparisonConfirmation = null;
  return result;
}

/** Confirming an OCR value retains its source; it never converts demo into a genuine quote. */
export function confirmQuote(book, slot, fields) {
  slotName(slot);
  const result = clone(book), quote = result.quotes[slot];
  if (!quote) return result;
  const selected = fields || Object.keys(quote.fields);
  for (const field of selected) if (quote.fields[field] && !quote.conflicts.some(item => item.field === field || item.field === 'context')) quote.fields[field].confirmed = true;
  if (fingerprint(result) !== fingerprint(book)) result.comparisonConfirmation = null;
  return result;
}

/** Each conflict must be explicitly kept or replaced. Context conflicts replace the whole product. */
export function resolveQuoteConflict(book, slot, index, choice) {
  slotName(slot);
  if (!['existing', 'incoming'].includes(choice)) throw new TypeError('必须选择保留现有值或采用新值');
  const result = clone(book), quote = result.quotes[slot], conflict = quote?.conflicts[index];
  if (!conflict) return result;
  if (conflict.field === 'context' && choice === 'incoming') return replaceQuote(book, slot, {context: conflict.quote.context, source: conflict.quote.source, fields: Object.fromEntries(Object.entries(conflict.quote.fields).map(([key, record]) => [key, record.value]))});
  if (conflict.field !== 'context' && choice === 'incoming') quote.fields[conflict.field] = {...conflict.incoming, confirmed: false};
  quote.conflicts.splice(index, 1);
  result.comparisonConfirmation = null;
  return result;
}

function fingerprint(book) {
  return JSON.stringify({context: book.context, quotes: book.quotes});
}

function knownTerm(record) {
  if (!record) return false;
  return !['', 'unknown', '未知', '未提供', '待确认', '待核对', '不详'].includes(normalized(record.value));
}

const RMB = new Set(['cny', 'rmb', '人民币', '¥', '￥']);
const TOTAL_BASIS = new Set(['total', 'stay-total', '全程', '全程总价', '入住全程']);
function sameTerm(field, left, right) {
  const a = normalized(left), b = normalized(right);
  if (field === 'currency' && RMB.has(a) && RMB.has(b)) return true;
  if (field === 'priceBasis' && TOTAL_BASIS.has(a) && TOTAL_BASIS.has(b)) return true;
  return equal(left, right);
}

/** No premium is exposed as comparable until context, product terms and user confirmations pass. */
export function quoteAssessment(book) {
  const reasons = [], a = book.quotes.A, b = book.quotes.B;
  for (const slot of SLOTS) {
    const quote = book.quotes[slot];
    if (!quote) {reasons.push(issue('missing-quote', `请补充${slot === 'A' ? '不含早' : '含早'}套餐报价`, {slot})); continue;}
    for (const reason of matchQuoteContexts(quote.context, book.context).reasons) reasons.push({...reason, slot});
    for (const field of quote.invalidFields) reasons.push(issue('invalid-field', `${LABELS[field]}格式无效，请重新核对`, {slot, field}));
    if (quote.conflicts.length) reasons.push(issue('conflict', `套餐 ${slot} 存在尚未处理的截图冲突`, {slot}));
    if (!quote.fields.total) reasons.push(issue('missing-price', `请补充套餐 ${slot} 的全程总价`, {slot}));
    else if (!quote.fields.total.confirmed) reasons.push(issue('unconfirmed-price', `请核对套餐 ${slot} 的识别价格`, {slot}));
    const basis = quote.fields.priceBasis;
    if (!knownTerm(basis)) reasons.push(issue('missing-price-basis', `请核对套餐 ${slot} 是每晚价格还是全程总价`, {slot, field: 'priceBasis'}));
    else if (!TOTAL_BASIS.has(normalized(basis.value))) reasons.push(issue('non-total-price', `套餐 ${slot} 的价格不是已确认的全程总价`, {slot, field: 'priceBasis'}));
    const currency = quote.fields.currency;
    if (knownTerm(currency) && !RMB.has(normalized(currency.value))) reasons.push(issue('unsupported-currency', `套餐 ${slot} 的币种需要先换算并确认`, {slot, field: 'currency'}));
  }
  if (a && b) {
    if (a.demo !== b.demo) reasons.push(issue('mixed-demo', '示例价格不能与真实报价混合比较'));
    const leftRights = a.fields.mealRights?.value, rightRights = b.fields.mealRights?.value;
    const hasLeftRights = typeof leftRights === 'number', hasRightRights = typeof rightRights === 'number';
    const differentRights = hasLeftRights && hasRightRights && leftRights !== rightRights;
    const unverifiedRights = leftRights > 0 && !hasRightRights || rightRights > 0 && !hasLeftRights;
    const differentMeals = leftRights > 0 && leftRights === rightRights && knownTerm(a.fields.mealRightType) && knownTerm(b.fields.mealRightType) && !equal(a.fields.mealRightType.value, b.fields.mealRightType.value);
    if (differentRights || unverifiedRights || differentMeals) reasons.push(issue('additional-benefits', '额外餐券权益不同或尚未核对，不能把价差全部算作早餐钱', {field: differentMeals ? 'mealRightType' : 'mealRights'}));
    for (const field of TERMS) {
      const left = a.fields[field], right = b.fields[field];
      if (knownTerm(left) && knownTerm(right) && !sameTerm(field, left.value, right.value)) reasons.push(issue('different-terms', `两份套餐的${LABELS[field]}不同，不能只按含早价差比较`, {field}));
    }
  }
  const blocking = reasons.length > 0;
  const confirmed = book.comparisonConfirmation?.fingerprint === fingerprint(book);
  if (!blocking && !confirmed) reasons.push(issue('unconfirmed-terms', '请确认同酒店、同日期、同房型及相同退改和支付条件'));
  const comparable = reasons.length === 0;
  return {comparable, status: comparable ? a.demo || b.demo ? 'demo' : 'ready' : reasons[0]?.code || 'incomplete', demo: Boolean(a?.demo || b?.demo), plain: a?.fields.total?.value ?? null, included: b?.fields.total?.value ?? null, premium: comparable ? b.fields.total.value - a.fields.total.value : null, reasons};
}

/** Called only after the user explicitly confirms the comparison conditions. */
export function confirmComparison(book, confirmed = true) {
  const result = clone(book);
  result.comparisonConfirmation = null;
  if (!confirmed) return result;
  const assessment = quoteAssessment(result);
  if (assessment.reasons.every(reason => reason.code === 'unconfirmed-terms')) result.comparisonConfirmation = {fingerprint: fingerprint(result)};
  return result;
}

/** Adapter for /api/extract. No visible context is filled from the current selection. */
export function quoteInputFromExtraction(extracted = {}, {slot, source} = {}) {
  slotName(slot);
  const fields = {};
  const mapping = {room_type: 'roomType', cancellation_policy: 'cancellation', cancellation_rule: 'cancellation', payment_terms: 'payment', other_terms: 'otherTerms', occupancy: 'occupancy', room_count: 'roomCount', currency: 'currency', price_basis: 'priceBasis', breakfast_count_per_night: 'breakfastCount', buffet_rights: 'mealRights', buffet_meal_type: 'mealRightType'};
  for (const [key, field] of Object.entries(mapping)) if (extracted[key] !== undefined && extracted[key] !== null) fields[field] = extracted[key];
  const price = slot === 'A' ? extracted.room_only_total : extracted.breakfast_room_total;
  if (price !== undefined && price !== null) fields.total = price;
  return {context: {city: extracted.city, hotel: {name: extracted.hotel_name, address: extracted.hotel_address}, checkIn: extracted.check_in, checkOut: extracted.check_out}, fields, source};
}

/** Only call after the user confirms missing screenshot context. Known contradictions are never filled over. */
export function bindQuoteInputToContext(input, context) {
  const original = normalizeQuoteContext(input.context), target = normalizeQuoteContext(context);
  const reasons = matchQuoteContexts(original, target).reasons.filter(reason => !['missing-city', 'missing-hotel', 'missing-check-in', 'missing-check-out', 'hotel-unverified'].includes(reason.code));
  reasons.push(...contextIssues(target));
  // A screenshot carrying a wrong or impossible date must be corrected, not silently treated as missing.
  for (const key of ['checkIn', 'checkOut']) if (original[key] && dateValue(original[key]) === null) reasons.push(issue('invalid-screenshot-date', '截图日期无效，请先重新核对截图', {field: key}));
  if (reasons.length) return {ok: false, input: clone(input), reasons};
  return {ok: true, input: {...clone(input), context: target, contextEvidence: {original, confirmedBy: 'user'}}, reasons: []};
}

/** Explicitly binds missing quote context after a user action; never overrides a known contradiction. */
export function bindQuoteContext(book, slot, context, {confirmed = false} = {}) {
  slotName(slot);
  const result = clone(book), quote = result.quotes[slot];
  if (!confirmed || !quote) return result;
  const bound = bindQuoteInputToContext({context: quote.context}, context);
  if (!bound.ok) return result;
  quote.context = bound.input.context;
  quote.contextEvidence = bound.input.contextEvidence;
  quote.originalContext = clone(bound.input.contextEvidence.original);
  quote.bindingConfirmation = {confirmed: true, by: 'user'};
  result.comparisonConfirmation = null;
  return result;
}
