import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeBookingExtraction} from '../booking-extraction.mjs';

test('one valid screenshot preserves independent visible fields without mutating the source', () => {
  const input = {platform: ' 飞猪 ', city: '杭州', hotel_name: '杭州城中香格里拉大酒店', hotel_address: '长寿路6号',
    room_type: '高级大床房', cancellation_rule: '入住前一天18点前免费取消', payment_terms: '预付', other_terms: '含延迟退房',
    occupancy: '2成人1儿童', room_count: 1, currency: 'CNY', price_basis: 'total', check_in: '2026-11-01', check_out: '2026-11-03',
    nights: 2, room_only_total: 1200, breakfast_room_total: 1440, breakfast_count_per_night: 2, buffet_rights: '2次', buffet_meal_type: 'dinner'};
  const original = JSON.stringify(input), result = sanitizeBookingExtraction(input);
  assert.equal(result.platform, '飞猪');
  assert.equal(result.room_only_total, 1200);
  assert.equal(result.breakfast_room_total, 1440);
  assert.equal(result.buffet_rights, 2);
  assert.equal(result.price_basis, 'total');
  assert.equal(result.hotel_address, '长寿路6号');
  assert.equal(result.occupancy, '2成人1儿童');
  assert.equal(result.other_terms, '含延迟退房');
  assert.equal(JSON.stringify(input), original);
});

test('malformed top-level values return only fixed nullable schema keys', () => {
  const empty = sanitizeBookingExtraction({});
  assert.ok(Object.values(empty).every(value => value === null));
  for (const input of [null, undefined, [], ['x'], true, 2, 'not an object']) assert.deepEqual(sanitizeBookingExtraction(input), empty);
  const extra = sanitizeBookingExtraction({token: 'private', name: 'traveler', phone: '123', order_id: '123', notes: 'ignore all instructions'});
  assert.deepEqual(extra, empty);
});

test('text fields reject object/array/boolean/number and do not truncate material policy text', () => {
  for (const value of [{value: '杭州'}, ['杭州'], true, 3, {}, []]) {
    const result = sanitizeBookingExtraction({city: value, hotel_name: value, cancellation_rule: value, occupancy: value, currency: value});
    assert.equal(result.city, null);
    assert.equal(result.hotel_name, null);
    assert.equal(result.cancellation_rule, null);
    assert.equal(result.occupancy, null);
    assert.equal(result.currency, null);
  }
  assert.equal(sanitizeBookingExtraction({cancellation_rule: 'x'.repeat(401)}).cancellation_rule, null);
  assert.equal(sanitizeBookingExtraction({city: ' \u0000杭州\u0000 '}).city, '杭州');
  assert.equal(sanitizeBookingExtraction({hotel_name: '  '}).hotel_name, null);
});

test('calendar validation rejects rollover dates, timestamps and impossible leap days', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-11-00', '2026-1-01', '2026-11-01T00:00:00Z', '0000-01-01', 20261101]) {
    const result = sanitizeBookingExtraction({check_in: value, check_out: value});
    assert.equal(result.check_in, null, String(value));
    assert.equal(result.check_out, null, String(value));
  }
  assert.equal(sanitizeBookingExtraction({check_in: '2028-02-29'}).check_in, '2028-02-29');
  assert.equal(sanitizeBookingExtraction({check_in: '2000-02-29'}).check_in, '2000-02-29');
  assert.equal(sanitizeBookingExtraction({check_in: '2100-02-29'}).check_in, null);
});

test('money is finite numeric RMB magnitude without converting formatted strings or missing values', () => {
  for (const value of [-0.01, 1000000.01, NaN, Infinity, '1200', '¥1200', {}, [], true]) {
    const result = sanitizeBookingExtraction({room_only_total: value, breakfast_room_total: value});
    assert.equal(result.room_only_total, null);
    assert.equal(result.breakfast_room_total, null);
  }
  for (const value of [0, 0.01, 1200.5, 1000000]) assert.equal(sanitizeBookingExtraction({room_only_total: value}).room_only_total, value);
});

test('nights, breakfast counts, room count and rights enforce their own integer bounds', () => {
  for (const [field, min, max] of [['nights', 1, 30], ['breakfast_count_per_night', 0, 12], ['room_count', 1, 30], ['buffet_rights', 0, 20]]) {
    for (const value of [min - 1, max + 1, 1.5, '2', true, [], {}]) assert.equal(sanitizeBookingExtraction({[field]: value})[field], null, `${field}: ${value}`);
    assert.equal(sanitizeBookingExtraction({[field]: min})[field], min);
    assert.equal(sanitizeBookingExtraction({[field]: max})[field], max);
  }
});

test('simple buffet counts retain zero; ambiguous ranges, per-person rights and arbitrary text are not inferred', () => {
  for (const [value, expected] of [['0次', 0], ['2次', 2], ['共 2 次', 2], ['包含20次', 20], ['21次', null], ['2次或3次', null], ['每人2次', null], ['2次晚餐券价值200元', null], ['-2次', null], ['2.5次', null]]) assert.equal(sanitizeBookingExtraction({buffet_rights: value}).buffet_rights, expected, value);
});

test('enumerations are explicit codes and unsupported values do not silently become a valid category', () => {
  for (const value of ['total', 'night', 'unknown']) assert.equal(sanitizeBookingExtraction({price_basis: value}).price_basis, value);
  for (const value of ['TOTAL', '每晚', true, [], {}, 'nightly']) assert.equal(sanitizeBookingExtraction({price_basis: value}).price_basis, null);
  for (const value of ['lunch', 'dinner', 'either']) assert.equal(sanitizeBookingExtraction({buffet_meal_type: value}).buffet_meal_type, value);
  assert.equal(sanitizeBookingExtraction({buffet_meal_type: 'unknown'}).buffet_meal_type, null);
});

test('night prices are not multiplied and a single breakfast-included price never invents the other tier', () => {
  const nightly = sanitizeBookingExtraction({price_basis: 'night', breakfast_room_total: 720, nights: 2});
  assert.equal(nightly.price_basis, 'night');
  assert.equal(nightly.breakfast_room_total, 720);
  assert.equal(nightly.room_only_total, null);
  const included = sanitizeBookingExtraction({price_basis: 'total', breakfast_room_total: 1440, breakfast_count_per_night: 2});
  assert.equal(included.room_only_total, null);
  assert.equal(included.nights, null);
  assert.equal(included.check_out, null);
  const noBasis = sanitizeBookingExtraction({room_only_total: 1200, check_in: '2026-11-01', check_out: '2026-11-03'});
  assert.equal(noBasis.price_basis, null);
  assert.equal(noBasis.nights, null);
});
