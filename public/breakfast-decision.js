// Package premiums are paid for the entire stay, even when fewer breakfasts are used.
export function compareBreakfast({plain, included, adults, children, count, days, nights, budget, comparable}) {
  if (!Number.isInteger(nights) || nights < 1 || nights > 30 || !Number.isInteger(adults) || adults < 1 || adults > 12 ||
      !Number.isInteger(days) || days < 0 || days > nights || !Number.isInteger(children) || children < 0 || children > 8)
    return {status: 'invalid'};
  const validPrice = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!validPrice(plain) || !validPrice(included)) return {status: 'missing-price'};
  const premium = included - plain;
  if (premium < 0) return {status: 'negative-premium', premium};
  if (!comparable) return {status: 'different-terms', premium};
  if (days === 0) return {status: 'unused', premium};
  if (!Number.isInteger(count) || count < 1 || count > 12) return {status: 'missing-count', premium};
  if (count < adults) return {status: 'short-count', premium};
  const perUse = premium / (days * adults);
  const threshold = perUse;
  const validBudget = validPrice(budget);
  const outsideUsed = validBudget ? budget * adults * days : null;
  // On mornings without package breakfast, both options still need an outside meal.
  const outsideAll = validBudget ? budget * adults * nights : null;
  const packageAll = validBudget ? premium + budget * adults * (nights - days) : null;
  const saving = validBudget ? outsideAll - packageAll : null;
  const minimumDays = !validBudget ? null : premium === 0 ? 1 : budget === 0 ? null : Math.ceil(premium / (budget * adults));
  return {status: children ? 'children-unknown' : validBudget ? 'ready' : 'missing-budget',
    premium, perUse, threshold, outsideUsed, outsideAll, packageAll, saving, minimumDays,
    scenarios: Array.from({length: nights}, (_, index) => ({days: index + 1, perUse: premium / ((index + 1) * adults)}))};
}

export function breakfastDates(checkIn, checkOut) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) return [];
  const start = new Date(checkIn + 'T12:00:00');
  const end = new Date(checkOut + 'T12:00:00');
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return [];
  const dates = [];
  for (const next = new Date(start); dates.length < 31;) {
    next.setDate(next.getDate() + 1);
    if (next > end) break;
    dates.push([next.getFullYear(), String(next.getMonth() + 1).padStart(2, '0'), String(next.getDate()).padStart(2, '0')].join('-'));
  }
  return dates.length > 30 ? [] : dates;
}
