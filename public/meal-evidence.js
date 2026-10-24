// Adapt public reference data and explicit trip confirmations without upgrading old facts.
const MEALS = ['breakfast', 'lunch', 'dinner'];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const normalized = value => text(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const id = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1 && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const sourceKey = source => `${source.id || source.source_id || ''}|${source.url || ''}`;
const uniqueSources = values => [...new Map(values.filter(Boolean).map(source => [sourceKey(source), clone(source)])).values()];
const sourceIds = value => Array.isArray(value) ? value : typeof value === 'string' ? value.split('|').filter(Boolean) : [];

function weekdayToken(value) {
  const token = value.toLowerCase().replace(/^(?:星期|周)/, '');
  return ({mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7})[token] ?? null;
}

function weekdays(value) {
  if (Array.isArray(value)) return value.length && value.every(d => Number.isInteger(d) && d >= 1 && d <= 7) ? [...new Set(value)].sort() : null;
  const raw = text(value).normalize('NFKC').replace(/\s+/g, '');
  if (/^(daily|everyday|每日|每天)$/i.test(raw)) return [...ALL_DAYS];
  if (/^(weekend|weekends|周末)$/i.test(raw)) return [6, 7];
  if (!raw) return null;
  const result = [];
  for (const group of raw.split(/[,、，/&]+/)) {
    const parts = group.split(/(?:至|到|[-–—])/);
    if (parts.length > 2 || !parts.length) return null;
    const start = weekdayToken(parts[0]), end = weekdayToken(parts.at(-1));
    if (start === null || end === null) return null;
    if (parts.length === 1) result.push(start);
    else for (let d = start, n = 0; n < 7; n++, d = d % 7 + 1) {result.push(d); if (d === end) break;}
  }
  return [...new Set(result)].sort();
}

function sameHotel(left = {}, right = {}) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if(normalized(left.address)&&normalized(right.address)&&normalized(left.address)!==normalized(right.address))return false;
  const sameField = key => id(left[key]) && !/^manual-\d+$/.test(id(left[key])) && id(left[key]) === id(right[key]);
  if (['id', 'stableId', 'policyId', 'reviewed_id', 'hotel_id'].some(sameField)) return true;
  const leftEvidence = id(left.reviewed_id || left.evidenceHotelId || left.hotel_id);
  const rightEvidence = id(right.reviewed_id || right.evidenceHotelId || right.hotel_id);
  if (leftEvidence && rightEvidence && leftEvidence === rightEvidence) return true;
  return Boolean(normalized(left.name) && normalized(left.address) && normalized(left.name) === normalized(right.name) && normalized(left.address) === normalized(right.address));
}

function currentContext(hotel, checkIn, checkOut, confirmations) {
  const context = confirmations?.context;
  if (!context || !validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn || Date.parse(checkOut) - Date.parse(checkIn) > 30 * 86400000 || context.checkIn !== checkIn || context.checkOut !== checkOut || !sameHotel(hotel, context.hotel)) return null;
  return {hotel: {id: id(hotel.id) || null, name: text(hotel.name), address: text(hotel.address)}, checkIn, checkOut};
}

function coordinates(location) {
  if (typeof location !== 'string') return {longitude: null, latitude: null};
  const parts = location.split(',');
  if (parts.length !== 2 || parts.some(part => !part.trim())) return {longitude: null, latitude: null};
  const [longitude, latitude] = parts.map(Number);
  return Number.isFinite(longitude) && Math.abs(longitude) <= 180 && Number.isFinite(latitude) && Math.abs(latitude) <= 90 ? {longitude, latitude} : {longitude: null, latitude: null};
}

function apiRoute(place) {
  const route = place.route;
  if (!route || !finite(route.minutes) || route.minutes < 0 || route.minutes > 10000 || !finite(route.meters) || route.meters < 0 || !Number.isFinite(Date.parse(route.queried_at)) || route.source !== '高德步行路径规划 2.0') return {minutes: null, confirmed: false};
  return {minutes: route.minutes, meters: route.meters, confirmed: true, origin: 'walking_route_api', queriedAt: route.queried_at, source: route.source};
}

function sourceRegistry(mealPolicy, evidence) {
  const registry = new Map();
  const groups = [mealPolicy?.sources, evidence?.sources, evidence?.hotel?.sources, ...list(evidence?.venues).map(v => v.sources), ...list(evidence?.venues).flatMap(v => list(v.services).map(s => s.sources))];
  for (const group of groups) for (const source of list(group)) {
    const sid = id(source.id || source.source_id);
    if (sid) registry.set(sid, clone(source));
  }
  return registry;
}

function references(record, registry) {
  return uniqueSources([...list(record?.sources), ...list(record?.sourceRefs), ...sourceIds(record?.sourceIds || record?.source_ids).map(sid => registry.get(sid) || {id: sid, url: null, title: null, assurance: 'source_details_unavailable'})]);
}

function referenceSchedule(record, meal, registry) {
  return {id: id(record.id || record.service_id), referenceId: id(record.id || record.service_id), meal, scope: meal, isoWeekdays: weekdays(record.weekdays ?? record.isoWeekdays ?? record.iso_weekdays), start: validTime(record.start || record.start_time) ? record.start || record.start_time : null, end: validTime(record.end || record.end_time) ? record.end || record.end_time : null, validFrom: record.validFrom || record.valid_from || null, validTo: record.validTo || record.valid_to || null, confirmed: false, tripConfirmed: false, assurance: record.assurance || 'historical_public_reference', readAt: record.readAt || null, sourceRefs: references(record, registry), origin: {type: 'public_reference', referenceId: id(record.id || record.service_id)}};
}

function referencePrice(record, meal, registry) {
  const rawAmount = record.amount ?? record.price;
  const amount = typeof rawAmount === 'string' && rawAmount.trim() ? Number(rawAmount) : rawAmount;
  if (!finite(amount) || amount < 0) return null;
  return {id: id(record.id || record.offer_id), referenceId: id(record.id || record.offer_id), amount, currency: record.currency || null, basis: ['per_person', 'per_adult_per_breakfast', 'per_adult_per_meal'].includes(record.basis || record.price_basis) ? 'per_adult_per_meal' : null, scope: meal, confirmed: false, tripConfirmed: false, automatic_quote_use: false, isFromPrice: record.isFromPrice === true || record.is_from_price === 'true', taxIncluded: record.taxInclusion === 'included' ? true : null, feesIncluded: record.serviceChargeInclusion === 'included' ? true : null, observedAt: record.readAt || record.price_observed_at || null, sourceRefs: references(record, registry), origin: {type: 'public_reference', referenceId: id(record.id || record.offer_id)}};
}

function blankMeal(schedules = []) {
  return {confirmed: false, confirmedDates: [], availabilityByDate: {}, dietaryByDate: {}, priceByDate: {}, available: null, schedules: clone(schedules), referenceSchedules: clone(schedules), proposedSchedules: clone(schedules), sourceRefs: uniqueSources(schedules.flatMap(s => s.sourceRefs)), tripConfirmed: false};
}

function confirmationDates(item, context, recordDates) {
  const dates = item.date ? [item.date] : item.dates ?? recordDates;
  if (dates !== undefined) return Array.isArray(dates) && dates.length && dates.every(date => validDate(date) && date >= context.checkIn && date <= context.checkOut) ? [...new Set(dates)].sort() : null;
  const result = [];
  for (let day = Date.parse(context.checkIn); day <= Date.parse(context.checkOut); day += 86400000) result.push(new Date(day).toISOString().slice(0, 10));
  return result;
}

function confirmationOrigin(record, context, ref) {
  return {type: ref ? 'user_confirmed_public_reference' : 'user_input', referenceId: ref?.referenceId || null, source: typeof record.source === 'string' ? record.source.slice(0, 300) : null, context: clone(context)};
}

function confirmedSchedule(record, item, context, meal, refs) {
  if (record?.confirmed !== true || record.meal && record.meal !== meal || record.scope && ![meal, 'meal_service', meal === 'breakfast' ? 'breakfast_meal_not_total_venue_hours' : meal].includes(record.scope)) return [];
  const ref = record.referenceId ? refs.find(r => r.referenceId === record.referenceId) : null;
  if (record.referenceId && !ref) return [];
  if (ref && ['start', 'end'].some(key => record[key] !== undefined && record[key] !== ref[key])) return [];
  const value = {...clone(ref || {}), ...clone(record)};
  const days = weekdays(record.isoWeekdays ?? record.iso_weekdays ?? ref?.isoWeekdays);
  if (!days || value.closed !== true && (!validTime(value.start) || !validTime(value.end) || value.end <= value.start)) return [];
  const from = value.validFrom || context.checkIn, to = value.validTo || context.checkOut;
  if (!validDate(from) || !validDate(to) || from > to || to < context.checkIn || from > context.checkOut) return [];
  const explicitDates = item.date ? [item.date] : item.dates ?? record.dates;
  const scopedDates = confirmationDates(item, context, record.dates);
  if (!scopedDates || explicitDates !== undefined && scopedDates.some(date => date < from || date > to || !days.includes(new Date(date + 'T00:00:00Z').getUTCDay() || 7))) return [];
  if (!scopedDates.some(date => date >= from && date <= to && days.includes(new Date(date + 'T00:00:00Z').getUTCDay() || 7))) return [];
  const ranges = explicitDates ? explicitDates.map(date => ({validFrom: date, validTo: date})) : [{validFrom: from < context.checkIn ? context.checkIn : from, validTo: to > context.checkOut ? context.checkOut : to}];
  return ranges.map(range => ({meal, scope: meal, isoWeekdays: days, start: value.closed === true ? null : value.start, end: value.closed === true ? null : value.end, closed: value.closed === true, ...range, confirmed: true, tripConfirmed: true, state: 'current_trip_user_confirmation', assurance: 'user_confirmed_for_current_trip', sourceRefs: clone(ref?.sourceRefs || []), origin: confirmationOrigin(record, context, ref)}));
}

function confirmedPrice(record, item, context, meal, refs) {
  if (record?.confirmed !== true) return null;
  const ref = record.referenceId ? refs.find(r => r.referenceId === record.referenceId) : null;
  if (record.referenceId && !ref || ref?.isFromPrice === true) return null;
  if (ref && record.amount !== undefined && record.amount !== ref.amount) return null;
  const value = {...clone(ref || {}), ...clone(record)};
  if (!finite(value.amount) || value.amount < 0 || value.amount > 1000000 || value.currency !== 'CNY' || value.basis !== 'per_adult_per_meal' || value.scope !== meal || value.isFromPrice === true || value.is_from_price === true || value.is_from_price === 'true') return null;
  let dates = confirmationDates(item, context, value.dates);
  if (!dates) return null;
  const from = value.validFrom || context.checkIn, to = value.validTo || context.checkOut;
  if (!validDate(from) || !validDate(to) || from > to) return null;
  dates = dates.filter(date => date >= from && date <= to);
  if (!dates.length) return null;
  const menuId = typeof record.menuId === 'string' && record.menuId.trim().length > 0 && record.menuId.trim().length <= 120 && !/[\x00-\x1f\x7f]/.test(record.menuId) ? record.menuId.trim() : null;
  return {amount: value.amount, menuId, currency: 'CNY', basis: 'per_adult_per_meal', scope: meal, confirmed: true, tripConfirmed: true, state: 'current_trip_user_confirmation', assurance: 'user_confirmed_for_current_trip', taxIncluded: record.taxIncluded === true ? true : record.taxIncluded === false ? false : null, feesIncluded: record.feesIncluded === true ? true : record.feesIncluded === false ? false : null, validFrom: context.checkIn, validTo: context.checkOut, dates, sourceRefs: clone(ref?.sourceRefs || []), origin: confirmationOrigin(record, context, ref)};
}

function confirmedDietary(record, context) {
  if (record?.confirmed !== true || !['contains', 'excludedIngredients', 'crossContactConfirmed'].some(key => Object.hasOwn(record, key))) return null;
  for (const key of ['contains', 'excludedIngredients']) if (record[key] !== undefined && (!Array.isArray(record[key]) || record[key].some(v => typeof v !== 'string' || !v.trim()))) return null;
  return {contains: clone(record.contains || []), excludedIngredients: clone(record.excludedIngredients || []), crossContactConfirmed: record.crossContactConfirmed === true, confirmed: true, tripConfirmed: true, origin: confirmationOrigin(record, context), sourceRefs: []};
}

function confirmMeal(target, candidateId, meal, items, context, priceRefs, notes) {
  const priceRecords = [], dietRecords = [], schedules = [];
  for (const item of items.filter(i => i.candidateId === candidateId && i.meal === meal)) {
    const dates = confirmationDates(item, context);
    if (!dates) continue;
    if (item.confirmed === true) {
      target.confirmed = true;
      for (const date of dates) target.availabilityByDate[date] = item.available !== false;
      target.confirmedDates = Object.keys(target.availabilityByDate).sort();
      target.available = new Set(Object.values(target.availabilityByDate)).size === 1 ? Object.values(target.availabilityByDate)[0] : null;
      target.supplyOrigin = confirmationOrigin(item, context);
    }
    for (const record of list(item.schedules)) schedules.push(...confirmedSchedule(record, item, context, meal, [...target.referenceSchedules, ...target.proposedSchedules, ...list(target.publishedSchedules)]));
    const price = confirmedPrice(item.price, item, context, meal, priceRefs);
    if (price) priceRecords.push(price);
    const diet = confirmedDietary(item.dietary, context);
    const dietaryDates = confirmationDates(item, context, item.dietary?.dates);
    if (diet && dietaryDates) dietRecords.push({...diet, dates: dietaryDates});
  }
  if (schedules.length) {target.schedules = schedules; target.tripConfirmed = true; target.confirmationContext = clone(context);}
  let price = null;
  if (priceRecords.length) {
    const distinct = new Set(priceRecords.map(p => JSON.stringify([p.amount, p.taxIncluded, p.feesIncluded, p.menuId])));
    if (distinct.size === 1) {
      price = clone(priceRecords[0]);
      price.dates = [...new Set(priceRecords.flatMap(p => p.dates))].sort();
    } else notes.push({code: 'different-date-prices', candidateId, meal, message: '分日菜单价不同，金额需按各日核对，暂不合并为统一单价。'});
  }
  for (const date of confirmationDates({}, context)) {
    const dayPrices = priceRecords.filter(p => p.dates.includes(date));
    const priceValues = new Set(dayPrices.map(p => JSON.stringify([p.amount, p.taxIncluded, p.feesIncluded, p.menuId])));
    if (priceValues.size === 1) target.priceByDate[date] = clone(dayPrices[0]);
    const dayDiet = dietRecords.filter(d => d.dates.includes(date));
    const dietValues = new Set(dayDiet.map(d => JSON.stringify([d.contains, d.excludedIngredients, d.crossContactConfirmed])));
    if (dietValues.size === 1) target.dietaryByDate[date] = clone(dayDiet[0]);
    else if (dietValues.size > 1) notes.push({code: 'conflicting-diet-confirmations', candidateId, meal, date, message: '当天的忌口确认内容不一致，请重新核对。'});
  }
  // A per-date dietary fact is never emitted as a global guarantee.
  if (dietRecords.length === 1 && dietRecords[0].dates.length === confirmationDates({}, context).length) target.dietary = clone(dietRecords[0]);
  target.dietaryConfirmations = dietRecords;
  target.priceConfirmations = priceRecords;
  return price;
}

/**
 * Pure adapter; no requests, storage writes, count inference or room/voucher entitlement.
 * `mealPolicy` is one hotel from data/hotel_meal_policies.json, with its `sources` attached.
 * `evidence` accepts /api/evidence/:id {hotel,venues:[{services,sources}],offers}, or the
 * repository shape {venues,meal_services,sources,offers}. `places` are current /api/nearby
 * POIs. Only actual /api/route payloads (minutes,meters,queried_at,source) confirm walking.
 *
 * Confirmation example (each dimension is independent):
 * {context:{hotel:{id:'supplier-hotel-id',name:'具体酒店',address:'完整地址'},
 *   checkIn:'2026-11-01',checkOut:'2026-11-03'},items:[
 *  {candidateId:'hotel-breakfast',meal:'breakfast',confirmed:true,
 *   schedules:[{confirmed:true,isoWeekdays:[1,2],start:'07:00',end:'10:00'}]},
 *  {candidateId:'poi-id',meal:'lunch',confirmed:true,
 *   schedules:[{confirmed:true,isoWeekdays:[1],start:'11:00',end:'14:00'}],
 *   price:{confirmed:true,amount:45,currency:'CNY',basis:'per_adult_per_meal',
 *     scope:'lunch',taxIncluded:true,feesIncluded:true},
 *   dietary:{confirmed:true,contains:[],excludedIngredients:['花生'],crossContactConfirmed:true}}
 * ]}
 * Item.confirmed confirms supply only. Schedules/prices/dietary require their own true.
 * A schedule/price may instead select `referenceId` from that candidate/meal's public
 * references; unknown references and inconsistent literal overrides are rejected. Explicit
 * new values are labelled user_input; a checkbox without values cannot confirm snapshots.
 * Optional item.date (preferred) or item.dates/schedule.dates/price.dates limits confirmation.
 * Per-meal confirmedDates/availabilityByDate, priceByDate and dietaryByDate preserve days;
 * consumers must select the requested date, never apply a dated fact to the whole stay.
 * Future per-date prices remain in priceConfirmations; incompatible prices never collapse
 * into one unit price. Existing public conflicts remain alongside confirmationContext.
 */
export function buildMealEvidence({hotel = {}, mealPolicy = null, evidence = null, places = [], checkIn, checkOut, confirmations = null} = {}) {
  hotel = hotel && typeof hotel === 'object' ? hotel : {};
  const sourceNotes = [], registry = sourceRegistry(mealPolicy, evidence);
  const policy = mealPolicy && sameHotel(hotel, mealPolicy) ? mealPolicy : null;
  if (mealPolicy && !policy) sourceNotes.push({code: 'policy-hotel-mismatch', message: '酒店公开政策未匹配到当前具体分店，暂不采用。'});
  const context = currentContext(hotel, checkIn, checkOut, confirmations);
  if (list(confirmations?.items).length && !context) sourceNotes.push({code: 'confirmation-context-mismatch', message: '酒店或入住日期已变化，请为当前行程重新核实供餐信息。'});
  const items = context ? list(confirmations?.items) : [];
  const published = list(policy?.publishedBreakfastWindows).map(w => referenceSchedule(w, 'breakfast', registry));
  const proposed = list(policy?.compatiblePublishedWindows).map(w => referenceSchedule(w, 'breakfast', registry));
  const safeReferences = proposed.length ? proposed : published;
  const hotelBreakfast = {...blankMeal(safeReferences), id: 'hotel-breakfast', name: `${text(hotel.name) || '酒店'}早餐`, publishedSchedules: published, proposedSchedules: proposed, conflicts: list(policy?.conflicts).filter(c => c.field === 'breakfast_service_availability').map(c => ({...clone(c), isoWeekdays: weekdays(c.weekdays), timeScope: {start: c.timeScope?.start || null, end: c.timeScope?.end || null}, tripConfirmed: false, sourceRefs: references(c, registry)})), priceReferences: list(policy?.adultPrices).map(p => referencePrice(p, 'breakfast', registry)).filter(Boolean), childRuleReferences: clone(list(policy?.childRules))};
  if (context) hotelBreakfast.price = confirmMeal(hotelBreakfast, 'hotel-breakfast', 'breakfast', items, context, hotelBreakfast.priceReferences, sourceNotes);

  const evidenceId = id(hotel.reviewed_id || hotel.evidenceHotelId || policy?.evidenceHotelId);
  const payloadMatches = evidence?.hotel && sameHotel(hotel, evidence.hotel);
  const selectedEvidenceId = evidenceId || (payloadMatches ? id(evidence.hotel.hotel_id) : '');
  const venues = list(evidence?.venues), services = list(evidence?.meal_services || evidence?.services);
  const servicesFor = venue => [...list(venue.services), ...services.filter(s => s.venue_id === venue.venue_id)].filter((s, i, arr) => arr.findIndex(t => (t.service_id || t.id) === (s.service_id || s.id) && t.meal_type === s.meal_type) === i);
  const priceRefsFor = (venueId, meal, mealServices) => list(evidence?.offers).filter(o => o.venue_id === venueId && mealServices.some(s => s.service_id === o.service_id && s.meal_type === meal)).map(o => referencePrice(o, meal, registry)).filter(Boolean);

  function adaptPlace(place, venue, onSite = false) {
    const candidateId = onSite ? id(venue.venue_id) : id(place.id);
    const mealServices = venue ? servicesFor(venue) : [];
    const point = onSite ? {longitude: finite(hotel.longitude) ? hotel.longitude : null, latitude: finite(hotel.latitude) ? hotel.latitude : null} : coordinates(place.location);
    const candidate = {id: candidateId, name: text(onSite ? venue.name : place.name), address: text(onSite ? venue.address : place.address), ...point, onSite, route: onSite ? {minutes: 0, confirmed: true, origin: 'hotel_on_site_venue'} : apiRoute(place), meals: {}, prices: {}, pricesByDate: {}, priceReferences: {}, sourceRefs: uniqueSources([...references(venue, registry), ...references(place.curated_match, registry), ...references(place, registry), ...mealServices.flatMap(s => references(s, registry))]), localSpecialty: mealServices.some(s => Boolean(text(s.local_specialties)) && !/^(unknown|未知)$/i.test(text(s.local_specialties)))};
    for (const meal of MEALS) {
      const relevant = mealServices.filter(s => s.meal_type === meal);
      const refs = relevant.map(s => referenceSchedule(s, meal, registry));
      const target = blankMeal(refs);
      target.hasPublishedEvidence = relevant.length > 0 || list(place.curated_match?.meal_types).includes(meal);
      if (refs.some(s => !s.isoWeekdays)) sourceNotes.push({code: 'meal-weekdays-unknown', candidateId, meal, message: '这家具体门店的供餐日期尚未公开，不能默认每日供应。'});
      const prices = priceRefsFor(venue?.venue_id, meal, relevant);
      candidate.priceReferences[meal] = prices;
      const confirmed = context ? confirmMeal(target, candidateId, meal, items, context, prices, sourceNotes) : null;
      candidate.meals[meal] = target;
      candidate.pricesByDate[meal] = target.priceByDate;
      if (confirmed) candidate.prices[meal] = confirmed;
    }
    candidate.breakfast = candidate.meals.breakfast;
    candidate.price = candidate.prices.breakfast || null;
    candidate.priceByDate = candidate.breakfast.priceByDate;
    return candidate;
  }

  const groupedPlaces = new Map();
  for (const place of list(places)) if (id(place?.id) && text(place?.name)) {
    const key = id(place.id);
    if (!groupedPlaces.has(key)) groupedPlaces.set(key, []);
    groupedPlaces.get(key).push(place);
  }
  const candidates = [];
  for (const [key, group] of groupedPlaces) {
    const signatures = new Set(group.map(p => JSON.stringify([normalized(p.name), normalized(p.address), p.location])));
    if (signatures.size !== 1) {sourceNotes.push({code: 'ambiguous-place-id', candidateId: key, message: '候选编号对应多个分店信息，请先确认具体门店。'}); continue;}
    const place = group[0], venueId = id(place.venue_id || place.curated_match?.venue_id);
    const venue = venues.find(v => venueId && id(v.venue_id) === venueId) || venues.find(v => !venueId && normalized(place.name) && normalized(place.address) && normalized(place.name) === normalized(v.name) && normalized(place.address) === normalized(v.address));
    candidates.push(adaptPlace(place, venue));
  }
  const hotelMeals = selectedEvidenceId ? venues.filter(v => id(v.hotel_id) === selectedEvidenceId && servicesFor(v).some(s => ['lunch', 'dinner'].includes(s.meal_type))).map(venue => adaptPlace({}, venue, true)) : [];
  return {hotelBreakfast, candidates, hotelMeals, sourceNotes};
}
