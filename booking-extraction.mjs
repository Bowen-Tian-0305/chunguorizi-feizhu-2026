// Validate one model response without deriving missing dates, prices, nights or benefits.
const STRING_LIMITS = {
  platform: 60, city: 40, hotel_name: 160, hotel_address: 240, room_type: 160,
  cancellation_rule: 400, payment_terms: 240, other_terms: 600, occupancy: 120, currency: 16
};
const NUMBER_LIMITS = {
  room_only_total: [0, 1_000_000, false], breakfast_room_total: [0, 1_000_000, false],
  nights: [1, 30, true], breakfast_count_per_night: [0, 12, true],
  buffet_rights: [0, 20, true], room_count: [1, 30, true]
};

function boundedString(value, max) {
  if (typeof value !== 'string') return null;
  const result = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  // Truncating a cancellation condition could drop its exception and change the meaning.
  return result && result.length <= max ? result : null;
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return null;
  const timestamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? value : null;
}

function boundedNumber(value, [min, max, integer]) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? value : null;
}

function rightsCount(value) {
  if (typeof value !== 'string') return value;
  // Accept a simple usage count only, not a range, "每人2次" or an ambiguous sentence.
  const match = value.trim().match(/^(?:共|含|包含)?\s*(\d{1,2})\s*次$/);
  return match ? Number(match[1]) : null;
}

/**
 * Input: the parsed top-level JSON object from one screenshot.
 * Output: a fresh fixed-key fields object. Invalid/missing values are null; extra keys are dropped.
 * price_basis is total | night | unknown | null. A night price stays a night price; no multiplication,
 * missing-price copying, date arithmetic, currency conversion or inferred confirmation occurs here.
 */
export function sanitizeBookingExtraction(extracted) {
  const raw = extracted && typeof extracted === 'object' && !Array.isArray(extracted) ? extracted : {};
  const fields = {};
  for (const [key, max] of Object.entries(STRING_LIMITS)) fields[key] = boundedString(raw[key], max);
  for (const [key, range] of Object.entries(NUMBER_LIMITS)) fields[key] = boundedNumber(key === 'buffet_rights' ? rightsCount(raw[key]) : raw[key], range);
  fields.check_in = calendarDate(raw.check_in);
  fields.check_out = calendarDate(raw.check_out);
  fields.buffet_meal_type = ['lunch', 'dinner', 'either'].includes(raw.buffet_meal_type) ? raw.buffet_meal_type : null;
  fields.price_basis = ['total', 'night', 'unknown'].includes(raw.price_basis) ? raw.price_basis : null;
  return fields;
}
