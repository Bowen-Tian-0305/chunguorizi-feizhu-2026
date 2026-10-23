import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuoteBook, normalizeQuoteContext, matchQuoteContexts, setQuoteContext, putQuote, replaceQuote,
  removeQuote, confirmQuote, confirmComparison, resolveQuoteConflict, quoteAssessment,
  quoteInputFromExtraction, bindQuoteInputToContext, bindQuoteContext, editQuoteFields} from '../public/quote-context.js';

const stay = {city: '杭州', hotel: {id: 'flyai:101', name: '杭州城中香格里拉大酒店', address: '长寿路6号'}, checkIn: '2026-11-01', checkOut: '2026-11-03'};
const manual = id => ({id, kind: 'manual', label: '手动填写'});
const screenshot = id => ({id, kind: 'screenshot', label: '商品截图'});
const input = (total, context = stay, source = manual(String(total)), fields = {}) => ({context, source, fields: {total, roomType: '高级大床房', cancellation: '入住前一天18:00前免费取消', payment: '预付', priceBasis: 'total', currency: 'CNY', ...fields}});
function pair(source = manual('A')) {
  let book = createQuoteBook(stay);
  book = putQuote(book, 'A', input(1200, stay, source));
  book = putQuote(book, 'B', input(1440, stay, {...source, id: 'B'}, {breakfastCount: 2}));
  book = confirmQuote(confirmQuote(book, 'A'), 'B');
  return confirmComparison(book);
}
const codes = book => quoteAssessment(book).reasons.map(reason => reason.code);

test('confirmed A/B belong to one stay; matching selection preserves confirmation and input immutability', () => {
  const book = pair(), before = JSON.stringify(book);
  assert.equal(quoteAssessment(book).premium, 240);
  assert.equal(quoteAssessment(book).status, 'ready');
  const selectedAgain = setQuoteContext(book, {...stay, city: '杭州市', hotel: {...stay.hotel, name: '杭州城中香格里拉 大酒店'}});
  assert.deepEqual(selectedAgain, book);
  assert.equal(JSON.stringify(book), before);
  assert.equal(quoteAssessment(selectedAgain).comparable, true);
});

test('leaving demo for another hotel retires both prices; repeated selection cannot revive them', () => {
  const demo = pair({id: 'demo-A', kind: 'demo', label: '测试价'});
  assert.equal(quoteAssessment(demo).status, 'demo');
  const real = {...stay, hotel: {id: 'flyai:102', name: '杭州湖畔酒店', address: '湖滨路10号'}};
  const next = setQuoteContext(demo, real);
  assert.deepEqual(next.quotes, {A: null, B: null});
  assert.equal(next.comparisonConfirmation, null);
  assert.equal(next.retired.length, 2);
  assert.equal(setQuoteContext(next, stay).quotes.A, null);
  assert.equal(demo.quotes.A.fields.total.value, 1200);
});

test('explicit demo exit also clears demo quotes for the same physical hotel and dates', () => {
  const book = pair({id: 'demo', kind: 'demo'});
  const next = setQuoteContext(book, stay, {clearDemo: true});
  assert.equal(next.quotes.A, null);
  assert.equal(next.retired[0].reason, 'left-demo');
});

test('changing either date invalidates prices, rights and old comparison confirmation', () => {
  for (const changed of [{checkIn: '2026-11-02'}, {checkOut: '2026-11-04'}]) {
    const next = setQuoteContext(pair(), {...stay, ...changed});
    assert.equal(next.quotes.A, null);
    assert.equal(next.quotes.B, null);
    assert.equal(next.comparisonConfirmation, null);
    assert.equal(quoteAssessment(next).comparable, false);
  }
});

test('screenshots for a different city, branch or date never become comparable after a checkbox', () => {
  const mismatches = [
    [{...stay, city: '上海'}, 'city-mismatch'],
    [{...stay, hotel: {name: '杭州香格里拉饭店'}}, 'hotel-mismatch'],
    [{...stay, hotel: {...stay.hotel, address: '北山街78号'}}, 'address-mismatch'],
    [{...stay, checkIn: '2026-11-02'}, 'check-in-mismatch'],
    [{...stay, checkOut: '2026-11-04'}, 'check-out-mismatch']
  ];
  for (const [context, code] of mismatches) {
    let book = putQuote(pair(), 'A', input(1000, context, screenshot(code)));
    book = confirmComparison(confirmQuote(book, 'A'));
    assert.equal(book.quotes.A.fields.total.value, 1200);
    assert.equal(book.quotes.A.conflicts[0].field, 'context');
    assert.equal(quoteAssessment(book).comparable, false);
    const adopted = resolveQuoteConflict(book, 'A', 0, 'incoming');
    assert.equal(adopted.quotes.A.fields.total.value, 1000);
    assert.ok(codes(adopted).includes(code));
  }
});

test('hotel matching never strips meaningful Chinese characters or guesses a nearby branch', () => {
  const withoutId = value => ({...stay, hotel: {name: value}});
  assert.equal(matchQuoteContexts(withoutId('杭州同心酒店'), withoutId('杭州同心大饭店')).matches, false);
  assert.equal(matchQuoteContexts(withoutId('杭州酒店（西湖店）'), withoutId('杭州酒店(西湖店)')).matches, true);
  assert.equal(matchQuoteContexts(withoutId('杭州酒店（西湖店）'), withoutId('杭州酒店（城西店）')).matches, false);
  assert.equal(matchQuoteContexts({...stay, hotel: {id: '1'}}, {...stay, hotel: {id: '2'}}).matches, false);
});

test('missing screenshot context is pending and requires explicit confirmation; known contradictions cannot bind', () => {
  const extracted = {room_only_total: 1200, price_basis: 'total'};
  const quote = quoteInputFromExtraction(extracted, {slot: 'A', source: screenshot('missing')});
  let book = putQuote(createQuoteBook(stay), 'A', quote);
  assert.ok(codes(book).includes('missing-hotel'));
  assert.ok(codes(book).includes('missing-check-in'));
  assert.equal(bindQuoteContext(book, 'A', stay).quotes.A.context.hotel.name, '');
  const bound = bindQuoteContext(book, 'A', stay, {confirmed: true});
  assert.equal(bound.quotes.A.context.hotel.name, stay.hotel.name);
  assert.equal(bound.quotes.A.contextEvidence.confirmedBy, 'user');
  assert.equal(bound.quotes.A.contextEvidence.original.hotel.name, '');
  assert.equal(bound.quotes.A.fields.total.source.kind, 'screenshot');
  assert.equal(bound.quotes.A.fields.total.confirmed, false);
  assert.equal(book.quotes.A.context.hotel.name, '');
  const wrong = {...quote, context: {...stay, city: '上海'}};
  assert.equal(bindQuoteInputToContext(wrong, stay).ok, false);
});

test('an impossible screenshot date cannot be bound by pretending it was missing', () => {
  assert.equal(matchQuoteContexts({...stay, checkIn: '2026-02-30'}, stay).matches, false);
  const invalid = bindQuoteInputToContext(input(500, {...stay, checkIn: '2026-02-30'}, screenshot('bad-date')), stay);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.reasons.some(item => item.code === 'invalid-screenshot-date'));
  assert.equal(matchQuoteContexts({...stay, checkOut: stay.checkIn}, stay).matches, false);
  assert.equal(matchQuoteContexts({...stay, checkOut: '2026-12-15'}, stay).matches, false);
});

test('A and B preserve independent screenshot provenance; prices do not auto-confirm', () => {
  const fields = {city: '杭州市', hotel_name: stay.hotel.name, check_in: stay.checkIn, check_out: stay.checkOut,
    room_only_total: 1200, breakfast_room_total: 1440, room_type: '高级大床房', cancellation_rule: '不可取消', other_terms: '含延迟退房', price_basis: 'total'};
  let book = createQuoteBook(stay);
  book = putQuote(book, 'A', quoteInputFromExtraction(fields, {slot: 'A', source: screenshot('image-1')}));
  book = putQuote(book, 'B', quoteInputFromExtraction(fields, {slot: 'B', source: screenshot('image-2')}));
  assert.equal(book.quotes.A.fields.total.value, 1200);
  assert.equal(book.quotes.B.fields.total.value, 1440);
  assert.equal(book.quotes.A.fields.cancellation.value, '不可取消');
  assert.equal(book.quotes.B.fields.otherTerms.value, '含延迟退房');
  assert.equal(confirmComparison(book).comparisonConfirmation, null);
  book = confirmComparison(confirmQuote(confirmQuote(book, 'A'), 'B'));
  assert.equal(quoteAssessment(book).comparable, true);
  assert.equal(book.quotes.A.fields.total.source.id, 'image-1');
  assert.equal(book.quotes.B.fields.total.source.id, 'image-2');
});

test('multiple screenshots keep conflicting values and require an explicit choice', () => {
  const existing = pair(screenshot('first'));
  const conflict = putQuote(existing, 'A', input(900, stay, screenshot('second')));
  assert.equal(conflict.quotes.A.fields.total.value, 1200);
  assert.equal(conflict.quotes.A.conflicts.length, 1);
  assert.equal(conflict.quotes.A.conflicts[0].incoming.value, 900);
  assert.equal(quoteAssessment(conflict).comparable, false);
  const kept = confirmComparison(resolveQuoteConflict(conflict, 'A', 0, 'existing'));
  assert.equal(quoteAssessment(kept).plain, 1200);
  assert.equal(quoteAssessment(kept).comparable, true);
  const adopted = resolveQuoteConflict(conflict, 'A', 0, 'incoming');
  assert.equal(adopted.quotes.A.fields.total.value, 900);
  assert.equal(adopted.quotes.A.fields.total.confirmed, false);
  assert.equal(adopted.quotes.A.fields.total.source.id, 'second');
  assert.equal(quoteAssessment(confirmComparison(adopted)).comparable, false);
  assert.equal(existing.quotes.A.conflicts.length, 0);
});

test('differing room, cancellation, payment or other benefits block a simple breakfast premium', () => {
  for (const fields of [{roomType: '湖景大床房'}, {cancellation: '不可取消'}, {payment: '到店付'}, {occupancy: '3成人'}, {roomCount: 2}, {otherTerms: '仅含接机'}]) {
    let book = pair();
    if (fields.otherTerms) book = replaceQuote(book, 'A', input(1200, stay, manual('A'), {otherTerms: '含接送机'}));
    if (fields.occupancy) book = replaceQuote(book, 'A', input(1200, stay, manual('A'), {occupancy: '2成人'}));
    if (fields.roomCount) book = replaceQuote(book, 'A', input(1200, stay, manual('A'), {roomCount: 1}));
    book = replaceQuote(book, 'B', input(1440, stay, manual('B'), fields));
    book = confirmComparison(book);
    assert.ok(codes(book).includes('different-terms'));
    assert.equal(quoteAssessment(book).premium, null);
  }
});

test('per-night, unknown or missing screenshot price basis cannot be presented as total', () => {
  for (const basis of ['night', 'unknown', undefined]) {
    let book = pair();
    book = replaceQuote(book, 'B', input(720, stay, screenshot('basis'), {priceBasis: basis}));
    book = confirmComparison(confirmQuote(book, 'B'));
    assert.equal(quoteAssessment(book).comparable, false);
    assert.ok(codes(book).some(code => ['non-total-price', 'missing-price-basis'].includes(code)));
  }
});

test('equivalent RMB/total labels are compatible; foreign currencies are blocked', () => {
  let book = replaceQuote(pair(), 'B', input(1440, stay, manual('B'), {currency: '人民币', priceBasis: '全程总价'}));
  assert.equal(quoteAssessment(confirmComparison(book)).comparable, true);
  book = replaceQuote(book, 'B', input(1440, stay, manual('B'), {currency: 'USD'}));
  assert.ok(codes(confirmComparison(book)).includes('unsupported-currency'));
});

test('confirming or corroborating demo prices never makes them genuine; mixed provenance is blocked', () => {
  let book = pair({id: 'sample', kind: 'demo'});
  book = putQuote(book, 'A', input(1200, stay, manual('typed-same-price')));
  book = confirmComparison(confirmQuote(book, 'A'));
  assert.equal(quoteAssessment(book).status, 'demo');
  assert.equal(book.quotes.A.fields.total.source.kind, 'demo');
  const derived = replaceQuote(book, 'A', input(1199, stay, {id: 'edited-demo', kind: 'derived', originalSource: {id: 'sample', kind: 'demo'}}));
  assert.equal(derived.quotes.A.demo, true);
  const mixed = replaceQuote(book, 'B', input(1440, stay, manual('real')));
  assert.ok(codes(confirmComparison(mixed)).includes('mixed-demo'));
});

test('edited prices require renewed comparison confirmation; invalid numbers never enter calculations', () => {
  const book = pair();
  const edited = replaceQuote(book, 'A', input(1100));
  assert.equal(edited.comparisonConfirmation, null);
  assert.equal(quoteAssessment(edited).comparable, false);
  assert.equal(quoteAssessment(confirmComparison(edited)).premium, 340);
  for (const total of [-1, NaN, Infinity, '1200']) {
    const invalid = replaceQuote(book, 'A', input(total));
    assert.equal(invalid.quotes.A.fields.total, undefined);
    assert.ok(codes(invalid).includes('invalid-field'));
  }
  assert.equal(removeQuote(book, 'A').quotes.A, null);
  assert.equal(book.quotes.A.fields.total.value, 1200);
});

test('incomplete contexts are not guessed from the current UI selection', () => {
  const normalized = normalizeQuoteContext({hotel: {name: '某酒店'}});
  assert.equal(normalized.city, '');
  assert.equal(normalized.checkIn, '');
  const input = quoteInputFromExtraction({room_only_total: 0}, {slot: 'A', source: screenshot('free')});
  assert.equal(input.context.checkIn, undefined);
  assert.equal(input.fields.total, 0);
  assert.equal(input.fields.priceBasis, undefined);
});

test('editing one field keeps untouched OCR evidence and requires renewed comparison confirmation', () => {
  const original = pair(screenshot('ocr-A'));
  let edited = editQuoteFields(original, 'A', {total: 1100}, {source: manual('price-edit')});
  assert.equal(edited.quotes.A.fields.total.value, 1100);
  assert.equal(edited.quotes.A.fields.total.source.kind, 'derived');
  assert.equal(edited.quotes.A.fields.total.source.originalSource.id, 'ocr-A');
  assert.equal(edited.quotes.A.fields.total.confirmed, true);
  assert.equal(edited.quotes.A.fields.roomType.source.kind, 'screenshot');
  assert.equal(edited.quotes.A.fields.roomType.source.id, 'ocr-A');
  assert.equal(edited.comparisonConfirmation, null);
  assert.equal(quoteAssessment(confirmComparison(edited)).premium, 340);
  edited = editQuoteFields(edited, 'A', {total: ''}, {source: manual('clear-price')});
  assert.equal(edited.quotes.A.fields.total, undefined);
  assert.equal(quoteAssessment(confirmComparison(edited)).comparable, false);
  assert.equal(original.quotes.A.fields.total.value, 1200);
});

test('manual edits create a slot in current context and never launder existing demo prices', () => {
  const created = editQuoteFields(createQuoteBook(stay), 'A', {total: 999}, {source: manual('create')});
  assert.deepEqual(created.quotes.A.context, normalizeQuoteContext(stay));
  assert.equal(created.quotes.A.fields.priceBasis.value, 'total');
  const demo = pair({id: 'demo', kind: 'demo'});
  const edited = editQuoteFields(demo, 'A', {total: 1100}, {source: manual('edit')});
  assert.equal(edited.quotes.A.demo, true);
  assert.equal(edited.quotes.A.fields.total.source.originalSource.kind, 'demo');
  assert.equal(quoteAssessment(confirmComparison(edited)).status, 'demo');
});

test('manual correction resolves that field conflict while leaving a hotel conflict blocked', () => {
  let book = putQuote(pair(), 'A', input(900, stay, screenshot('price')));
  book = putQuote(book, 'A', input(800, {...stay, city: '上海'}, screenshot('wrong-city')));
  const corrected = editQuoteFields(book, 'A', {total: 1150}, {source: manual('fix-price')});
  assert.equal(corrected.quotes.A.fields.total.value, 1150);
  assert.equal(corrected.quotes.A.conflicts.length, 1);
  assert.equal(corrected.quotes.A.conflicts[0].field, 'context');
  assert.equal(quoteAssessment(confirmComparison(corrected)).comparable, false);
});

test('voice edits remain unconfirmed even when replacing a previously confirmed manual price', () => {
  const book = pair();
  const voice = editQuoteFields(book, 'A', {total: 1100}, {source: {id: 'voice-change', kind: 'voice', label: '口述待核对'}});
  assert.equal(voice.quotes.A.fields.total.confirmed, false);
  assert.equal(voice.quotes.A.fields.total.source.kind, 'derived');
  assert.equal(voice.quotes.A.fields.total.source.originalSource.kind, 'manual');
  assert.equal(voice.quotes.A.fields.roomType.confirmed, true);
  assert.deepEqual(voice.quotes.A.context, normalizeQuoteContext(stay));
  assert.equal(quoteAssessment(confirmComparison(voice)).comparable, false);
  assert.ok(codes(voice).includes('unconfirmed-price'));
  assert.equal(quoteAssessment(confirmComparison(confirmQuote(voice, 'A'))).comparable, true);
});

test('different or one-sided positive dining rights cannot be attributed entirely to breakfast', () => {
  for (const [left, right] of [[0, 1], [1, 0], [1, 2], [undefined, 1], [1, undefined]]) {
    let book = pair();
    book = replaceQuote(book, 'A', input(1200, stay, manual('A'), {mealRights: left}));
    book = replaceQuote(book, 'B', input(1440, stay, manual('B'), {mealRights: right}));
    const assessment = quoteAssessment(confirmComparison(book));
    assert.equal(assessment.comparable, false, `${left}/${right}`);
    assert.equal(assessment.premium, null);
    assert.ok(assessment.reasons.some(reason => reason.code === 'additional-benefits'));
  }
});

test('equal positive dining counts with different known meals remain incomparable; equal benefits can pass', () => {
  let book = pair();
  book = replaceQuote(book, 'A', input(1200, stay, manual('A'), {mealRights: 1, mealRightType: 'lunch'}));
  book = replaceQuote(book, 'B', input(1440, stay, manual('B'), {mealRights: 1, mealRightType: 'dinner'}));
  assert.ok(codes(confirmComparison(book)).includes('additional-benefits'));
  book = replaceQuote(book, 'B', input(1440, stay, manual('B'), {mealRights: 1, mealRightType: 'lunch'}));
  assert.equal(quoteAssessment(confirmComparison(book)).comparable, true);
  book = replaceQuote(book, 'A', input(1200, stay, manual('A'), {mealRights: 0, mealRightType: 'lunch'}));
  book = replaceQuote(book, 'B', input(1440, stay, manual('B'), {mealRights: 0, mealRightType: 'dinner'}));
  assert.equal(quoteAssessment(confirmComparison(book)).comparable, true);
});
