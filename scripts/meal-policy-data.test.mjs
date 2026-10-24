import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const outputUrl = new URL('data/hotel_meal_policies.json', root);
const data = JSON.parse(readFileSync(outputUrl, 'utf8'));
const hotel = (id) => data.hotels.find((h) => h.policyId === id);
const allFacts = (h) => [...h.publishedBreakfastWindows, ...h.adultPrices, ...h.childRules, ...h.notes];
const sourceIds = new Set(data.sources.map((s) => s.id));

test('hotel data rebuilds from repository inputs regardless of cwd', () => {
  const before = readFileSync(outputUrl);
  for (const input of data.inputs) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(input.file, root))).digest('hex'), input.sha256);
    assert.ok(!input.file.includes('..') && !input.file.startsWith('/'));
  }
  execFileSync('python3', [fileURLToPath(new URL('scripts/build_meal_policies.py', root))], { cwd: '/tmp', encoding: 'utf8' });
  assert.deepEqual(readFileSync(outputUrl), before);
});

test('facts keep specific hotel identities, real sources and observation dates', () => {
  assert.equal(data.hotels.length, 15);
  assert.equal(new Set(data.hotels.map((h) => h.policyId)).size, 15);
  assert.equal(sourceIds.size, data.sources.length);
  assert.ok(hotel('HD04').name.includes('城中香格里拉'));
  assert.ok(hotel('HD13').name.includes('香格里拉饭店'));
  assert.equal(hotel('HD25').evidenceHotelId, null);
  assert.ok(hotel('HD05').name.includes('JW'));
  assert.ok(hotel('HD09').name.includes('武林万怡'));
  for (const source of data.sources) {
    assert.ok(['https:', 'http:'].includes(new URL(source.url).protocol));
    assert.match(source.readAt, /^2026-10-(?:10|11|12|23)$/);
    assert.ok(source.assurance);
    assert.equal(source.tripConfirmed, false);
  }
  const factIds = [];
  for (const h of data.hotels) {
    assert.equal(h.tripConfirmed, false);
    for (const fact of [...allFacts(h), ...h.compatiblePublishedWindows, ...h.conflicts]) {
      if (fact.id) factIds.push(fact.id);
      assert.equal(fact.tripConfirmed, false);
      for (const sid of fact.sourceIds ?? []) assert.ok(sourceIds.has(sid), sid);
    }
  }
  assert.equal(new Set(factIds).size, factIds.length);
});

test('retail prices keep unit, taxes, fees, snapshot scope and never become a trip quote', () => {
  for (const h of data.hotels) for (const p of h.adultPrices) {
    assert.ok(Number.isFinite(p.amount) && p.amount >= 0);
    assert.equal(p.currency, 'CNY');
    assert.equal(p.basis, 'per_adult_per_breakfast');
    assert.equal(p.taxInclusion, 'unknown');
    assert.equal(p.serviceChargeInclusion, 'unknown');
    assert.equal(p.snapshot, true);
    assert.ok(p.scope && p.assurance && p.readAt);
    assert.equal(p.validFrom, null);
    assert.equal(p.validTo, null);
    assert.equal(p.automaticQuoteUse, false);
  }
  assert.ok(hotel('HD04').adultPrices.some((p) => p.amount === 194 && p.readAt === '2026-10-23'));
  assert.deepEqual(hotel('HD25').adultPrices, []); // Child112 is not proof of an adult price.
});

test('Sunday uncertainty at JW and MoMo remains scoped and gets no invented common interval', () => {
  for (const pid of ['HD05', 'HD09']) {
    const h = hotel(pid);
    assert.ok(h.publishedBreakfastWindows.some((w) => w.weekdays?.includes(7))); // old daily snapshot retained
    assert.ok(!h.compatiblePublishedWindows.some((w) => w.weekdays.includes(7)));
    assert.ok(h.compatiblePublishedWindows.some((w) => w.weekdays.includes(1) && w.start === '06:30'));
    assert.ok(h.conflicts.some((c) => c.weekdays?.includes(7) && c.timeScope === null));
  }
  assert.ok(hotel('HD09').notes.some((n) => n.kind === 'restaurant.closed' && n.value === true));
});

test('West Lake Holiday Inn keeps both weekend ends and isolates only the disputed later interval', () => {
  const h = hotel('HD08');
  assert.ok(h.publishedBreakfastWindows.some((w) => w.readAt === '2026-10-23' && w.weekdays.includes(6) && w.end === '10:30'));
  assert.ok(h.publishedBreakfastWindows.some((w) => w.readAt === '2026-10-23' && w.weekdays.includes(6) && w.end === '10:00'));
  assert.equal(h.compatiblePublishedWindows.find((w) => w.weekdays.includes(6)).end, '10:00');
  assert.deepEqual(h.conflicts.find((c) => c.id === 'HD08:L:weekend-end').timeScope, { start: '10:00', end: '10:30' });
});

test('Canopy keeps render variant evidence and does not promise a06:00 breakfast', () => {
  const h = hotel('HD25');
  assert.ok(h.publishedBreakfastWindows.some((w) => w.readAt === '2026-10-23' && w.start === '06:00'));
  assert.ok(h.publishedBreakfastWindows.some((w) => w.readAt === '2026-10-23' && w.start === '06:30'));
  assert.ok(h.compatiblePublishedWindows.every((w) => w.start === '06:30'));
  assert.deepEqual(h.conflicts.find((c) => c.id === 'HD25:L:start').timeScope, { start: '06:00', end: '06:30' });
  assert.ok(data.sources.some((s) => s.id === 'L:L07' && s.readMethod.includes('cached_render_variant')));
  assert.ok(h.notes.some((n) => n.kind === 'restaurant.general_hours' && n.value.end === '23:00'));
  assert.ok(h.publishedBreakfastWindows.every((w) => w.end !== '23:00'));
});

test('child retail rules preserve ambiguous height equalities and counterintuitive non-free branch price', () => {
  const shortChild = hotel('HD20').childRules.find((r) => r.kind === 'retail_child_price' && r.predicate.max === 1.2);
  assert.equal(shortChild.amount, 30);
  assert.equal(shortChild.predicate.maxInclusive, null);
  assert.deepEqual(shortChild.predicate.uncertainEqualities, [1.2]);
  const heightBand = hotel('HD19').childRules.find((r) => r.predicate?.min === 1.2 && r.predicate?.max === 1.4);
  assert.equal(heightBand.amount, 28);
  assert.deepEqual(heightBand.predicate.uncertainEqualities, [1.2, 1.4]);
  assert.ok(heightBand.rawRule.includes('1.2'));
  assert.equal(heightBand.conditions.currentBookingMatch, 'unknown');
});

test('Shangri-La child member benefit is separate from retail, with complete age and guest conditions', () => {
  const h = hotel('HD04');
  assert.ok(h.childRules.some((r) => r.kind === 'retail_child_price' && r.predicate?.min === 6 && r.amount === 97));
  const free = h.childRules.find((r) => r.id.endsWith('SG_FREE_UNDER6'));
  assert.equal(free.predicate.max, 6);
  assert.equal(free.predicate.maxInclusive, true);
  assert.equal(free.conditions.circleMember, true);
  assert.equal(free.conditions.diningWithAdult, true);
  assert.equal(free.conditions.guestStatus, 'registered_in_house');
  assert.equal(free.conditions.maxFreeChildrenPerRoom, 2);
  assert.equal(free.conditions.currentBookingMatch, 'unknown');
  assert.equal(free.automaticQuoteUse, false);
  const older = h.childRules.find((r) => r.id.endsWith('SG_OLDER_CHILD_HALF'));
  assert.deepEqual([older.predicate.min, older.predicate.minInclusive, older.predicate.max, older.predicate.maxInclusive], [6, false, 12, false]);
  assert.equal(older.benefit.ratio, 0.5);
});

test('Holiday Inn age evidence, fallback height and conflicting rate conditions remain distinct', () => {
  const h = hotel('HD08');
  const child = h.childRules.find((r) => r.programId === 'IHG_KIDS_EAT_FREE_GREATER_CHINA');
  assert.equal(child.conditions.childAgeWithValidProof.maxYears, 12);
  assert.equal(child.conditions.childAgeWithValidProof.maxInclusive, true);
  assert.equal(child.conditions.whenNoAcceptedAgeProof.maxHeightM, 1.4);
  assert.equal(child.conditions.whenNoAcceptedAgeProof.hotelMeasurementOrAcceptanceRequired, true);
  assert.equal(child.conditions.registeredHotelGuest, true);
  assert.equal(child.conditions.adultOriginalPriceBreakfastOrBreakfastCoveredInRoomRate, true);
  assert.equal(child.conditions.currentBookingMatch, 'unknown');
  assert.equal(child.conditions.languageVariants.length, 2);
  for (const version of child.conditions.languageVariants) assert.ok(sourceIds.has(version.sourceId));
  assert.ok(child.ambiguities.length > 0);
  assert.ok(h.conflicts.some((c) => c.field === 'child_program_rate_and_count_eligibility'));
  assert.ok(!hotel('HD20').childRules.some((r) => r.programId === child.programId)); // Holiday Inn Express is separate.
});

test('common intervals retain proof and no data record creates trip entitlement or a voucher', () => {
  for (const h of data.hotels) {
    const facts = new Map(allFacts(h).filter((f) => f.id).map((f) => [f.id, f]));
    for (const w of h.compatiblePublishedWindows) {
      assert.equal(w.currentStayGuarantee, false);
      assert.ok(w.start < w.end);
      assert.ok(w.factIds.length > 0);
      for (const id of w.factIds) assert.ok(facts.has(id), id);
    }
    for (const child of h.childRules) assert.equal(child.automaticQuoteUse, false);
  }
  const family = hotel('HD16').childRules.find((r) => r.kind === 'conditional_program_description');
  assert.equal(family.amount, null);
  assert.equal(family.conditions.exactOfferMatch, 'unknown');
  assert.equal(data.stats.currentBookingEntitlements, 0);
  assert.equal(data.stats.redeemableVouchers, 0);
  assert.ok(!('vouchers' in data) && !('userPackages' in data));
});
