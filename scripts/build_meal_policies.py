#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build public hotel facts from repository snapshots, without network or credentials."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
INPUTS = ['hotel_policy.json', 'hotel_breakfast_official.json', 'evidence.json', 'fixtures/hotel_meal_official_2026-10-23.json']
RAW = {name: json.loads((DATA / name).read_text()) for name in INPUTS}
POLICY = RAW['hotel_policy.json']
OFFICIAL = RAW['hotel_breakfast_official.json']
EVIDENCE = RAW['evidence.json']
LIVE = RAW[INPUTS[-1]]
HOTELS = {'HD04': 'H09', 'HD05': 'H02', 'HD07': 'H04', 'HD08': 'H13', 'HD09': 'H06', 'HD13': 'H07', 'HD14': 'H03', 'HD16': 'H05', 'HD19': 'H12', 'HD20': 'H17', 'HD21': 'H18', 'HD22': 'H19', 'HD23': 'H20', 'HD24': 'H01', 'HD25': None}
DAYS = {'daily': list(range(1, 8)), '每日': list(range(1, 8)), 'Mon-Fri': [1, 2, 3, 4, 5], 'Mon-Sat': [1, 2, 3, 4, 5, 6], 'Sat-Sun': [6, 7], '周一至周五': [1, 2, 3, 4, 5], '周六至周日': [6, 7]}
sources = {}


def add_source(sid, url, title, publisher, kind, read_at, assurance, method='existing_repository_snapshot'):
    sources[sid] = {'id': sid, 'url': url, 'title': title, 'publisher': publisher, 'kind': kind, 'readAt': read_at, 'assurance': assurance, 'readMethod': method, 'tripConfirmed': False}
    return sid


def legacy_source(sid):
    src = next(s for s in EVIDENCE['sources'] if s['source_id'] == sid)
    return add_source('E:' + sid, src['url'], src['title'], src['publisher'], src['source_type'], src['retrieved_at'] or None, 'official_snapshot_not_live_rechecked')


for src in LIVE['sources']:
    add_source('L:' + src['source_id'], src['url'], src['title'], src['publisher'], src['source_type'], src['checked_on'], 'official_page_observed', src['access_method'])


def evidence_meta(source_ids, read_at, assurance, scope, *, weekdays=None):
    return {'sourceIds': source_ids, 'readAt': read_at, 'assurance': assurance, 'scope': scope, 'weekdays': weekdays, 'validFrom': None, 'validTo': None, 'snapshot': True, 'tripConfirmed': False}


def window(wid, start, end, weekdays, meta, *, restaurant=None):
    return dict(meta, id=wid, start=start, end=end, weekdays=weekdays, restaurant=restaurant)


def normalize_child_predicate(rule):
    raw = rule['raw_rule']
    def predicate(measure, low=None, high=None, li=None, hi=None, uncertain=None):
        return {'measure': measure, 'min': low, 'max': high, 'minInclusive': li, 'maxInclusive': hi, 'uncertainEqualities': uncertain or []}
    if rule['measure'] == 'age_years':
        low = re.match(r'^(\d+)岁及以下儿童', raw)
        if low:
            return predicate('completed_age_years', 0, int(low[1]), True, True)
        span = re.match(r'^(\d+)-(\d+)岁儿童', raw)
        if span:
            return predicate('completed_age_years', int(span[1]), int(span[2]), True, True)
    if rule['measure'] == 'height_m':
        low = re.match(r'^(\d+(?:\.\d+)?)米以下儿童', raw)
        if low:
            high = float(low[1])
            return predicate('height_m', high=high, uncertain=[high])
        span = re.match(r'^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)米以下儿童', raw)
        if span:
            a, b = float(span[1]), float(span[2])
            return predicate('height_m', a, b, uncertain=[a, b])
        high = re.match(r'^(\d+(?:\.\d+)?)米及以上儿童', raw)
        if high:
            return predicate('height_m', float(high[1]), li=True)
    return None


def price(pid, amount, meta, *, basis='per_adult_per_breakfast', from_price=False, tax='unknown', service='unknown'):
    return dict(meta, id=pid, amount=amount, currency='CNY', basis=basis, isFromPrice=from_price, taxInclusion=tax, serviceChargeInclusion=service, automaticQuoteUse=False)


def camelize(value):
    if isinstance(value, list):
        return [camelize(x) for x in value]
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            name = re.sub(r'_([a-z])', lambda m: m[1].upper(), key)
            result[name] = 'L:' + child if key == 'source_id' else camelize(child)
        return result
    return value


compiled = []
for item in POLICY['hotels']:
    pid = item['id']
    if pid not in HOTELS:
        continue
    eid = HOTELS[pid]
    hotel = {'policyId': pid, 'evidenceHotelId': eid, 'name': item['name'], 'address': item['address'], 'tripConfirmed': False, 'publishedBreakfastWindows': [], 'compatiblePublishedWindows': [], 'adultPrices': [], 'childRules': [], 'conflicts': [], 'notes': [], 'unknowns': ['current_booking_breakfast_people_and_use_count', 'current_stay_exception_dates', 'allergen_and_cross_contact_safety']}
    policy_sid = add_source('P:' + pid, item['policies'][0]['source']['url'], item['policies'][0]['source']['title'], item['source_platform'], 'public_hotel_policy_snapshot', item['collected_at'], 'public_policy_snapshot_not_live_rechecked')
    for i, entry in enumerate(item['policies']):
        meta = evidence_meta([policy_sid], item['collected_at'], 'public_policy_snapshot_not_live_rechecked', 'general_retail_breakfast_policy', weekdays=DAYS.get(entry['weekdays']))
        if entry['start_time'] and entry['end_time']:
            hotel['publishedBreakfastWindows'].append(window(f'{pid}:policy:hours:{i}', entry['start_time'], entry['end_time'], meta['weekdays'], meta))
        if entry['adult_price'] is not None:
            hotel['adultPrices'].append(price(f'{pid}:policy:adult:{i}', entry['adult_price'], meta))
    for i, entry in enumerate(item['child_rules']):
        predicate = normalize_child_predicate(entry)
        meta = evidence_meta([policy_sid], item['collected_at'], 'public_policy_snapshot_not_live_rechecked', 'retail_child_breakfast_not_room_package')
        hotel['childRules'].append(dict(meta, id=f'{pid}:policy:child:{i}', kind='retail_child_price', predicate=predicate, amount=entry['price'], currency='CNY', basis='per_child_per_breakfast', rawRule=entry['raw_rule'], conditions={'currentBookingMatch': 'unknown', 'membershipRequirement': 'unknown', 'adultAccompanimentRequirement': 'unknown'}, ambiguities=['height_boundary_equality_not_explicit'] if predicate and predicate['uncertainEqualities'] else [], automaticQuoteUse=False))
    if eid:
        hotel_venues = {v['venue_id']: v for v in EVIDENCE['venues'] if v['hotel_id'] == eid}
        for service in EVIDENCE['meal_services']:
            if service['venue_id'] not in hotel_venues or service['meal_type'] != 'breakfast':
                continue
            sids = [legacy_source(sid) for sid in service['source_ids'].split('|')]
            read_at = max((sources[sid]['readAt'] for sid in sids if sources[sid]['readAt']), default=None)
            meta = evidence_meta(sids, read_at, 'official_snapshot_not_live_rechecked', 'specific_hotel_restaurant', weekdays=DAYS.get(service['weekdays']))
            if service['start_time'] and service['end_time']:
                hotel['publishedBreakfastWindows'].append(window(f"{pid}:evidence:{service['service_id']}", service['start_time'], service['end_time'], meta['weekdays'], meta, restaurant=hotel_venues[service['venue_id']]['name']))
    for official in OFFICIAL['hotels']:
        if official['policy_id'] != pid:
            continue
        sid = add_source('O:' + pid, official['source_url'], official['restaurant'] + ' 官方补充', None, 'hotel_official', OFFICIAL['checked_at'], 'official_snapshot_not_live_rechecked')
        meta = evidence_meta([sid], OFFICIAL['checked_at'], 'official_snapshot_not_live_rechecked', 'specific_hotel_restaurant')
        hotel['notes'].append(dict(meta, kind='official_restaurant_description', text=official['summary'], familyNote=official['family_note'], rawHours=official['hours']))
        if pid == 'HD16':
            extra = add_source('O:HD16:family', official['extra_source_url'], 'Four Seasons Family Getaway', 'Four Seasons', 'specific_official_offer', OFFICIAL['checked_at'], 'official_snapshot_not_live_rechecked')
            hotel['childRules'].append(dict(evidence_meta([extra], OFFICIAL['checked_at'], 'official_snapshot_not_live_rechecked', 'specific_official_family_offer_not_user_entitlement'), id='HD16:official:family-description', kind='conditional_program_description', predicate=None, amount=None, currency='CNY', basis='unknown', summary=official['family_note'], conditions={'exactOfferMatch': 'unknown', 'applicableDates': 'unknown', 'useCount': 'unknown', 'currentBookingMatch': 'unknown'}, ambiguities=['specific_offer_only_do_not_apply_to_other_rates'], automaticQuoteUse=False))
    compiled.append(hotel)

by_id = {h['policyId']: h for h in compiled}
for live in LIVE['hotels']:
    hotel = by_id[live['hotel_id']]
    fact_ids = set()
    for fact in live['facts']:
        fid = fact['fact_id']
        fact_ids.add(fid)
        meta = evidence_meta(['L:' + x for x in fact['source_ids']], fact['checked_on'], 'official_page_observed', fact['scope'], weekdays=fact['applicable_dates']['iso_weekdays'])
        if fact['field'] == 'breakfast.schedule':
            hotel['publishedBreakfastWindows'].append(window(fid, fact['value']['start'], fact['value']['end'], meta['weekdays'], meta, restaurant=live['restaurant']))
        elif fact['field'] == 'breakfast.adult_retail_price':
            v = fact['value']
            hotel['adultPrices'].append(price(fid, v['amount'], meta, from_price=v['is_from_price'], tax=v['tax_inclusion'], service=v['service_charge_inclusion']))
        else:
            hotel['notes'].append(dict(meta, id=fid, kind=fact['field'], value=fact['value'], summary=fact['evidence_summary']))
    for interval in live['compatible_published_windows']:
        origin = [next(f for f in live['facts'] if f['fact_id'] == fid) for fid in interval['fact_ids']]
        sids = sorted({'L:' + sid for f in origin for sid in f['source_ids']})
        hotel['compatiblePublishedWindows'].append(dict(evidence_meta(sids, LIVE['checked_on'], 'derived_common_official_published_interval', 'published_reference_not_stay_guarantee', weekdays=interval['iso_weekdays']), id=f"{live['hotel_id']}:compatible:{len(hotel['compatiblePublishedWindows'])}", start=interval['start'], end=interval['end'], factIds=interval['fact_ids'], derivation='intersection_of_cited_published_windows', currentStayGuarantee=False))
    for conflict in live['blocking_conflicts']:
        refs = [f for f in live['facts'] if f['fact_id'] in conflict['fact_ids']]
        sids = sorted({'L:' + sid for f in refs for sid in f['source_ids']})
        time_scope = {'start': '10:00', 'end': '10:30'} if live['hotel_id'] == 'HD08' else {'start': '06:00', 'end': '06:30'} if live['hotel_id'] == 'HD25' else None
        hotel['conflicts'].append({'id': conflict['conflict_id'], 'field': 'breakfast_service_availability', 'type': conflict['type'], 'weekdays': conflict['iso_weekdays'], 'timeScope': time_scope, 'dateScope': {'kind': 'published_weekly_schedule', 'validFrom': None, 'validTo': None}, 'sourceIds': sids, 'factIds': conflict['fact_ids'], 'reason': conflict['reason'], 'action': 'require_confirmation_for_affected_time', 'readAt': LIVE['checked_on'], 'tripConfirmed': False})
    hotel['unknowns'].extend(live['unknowns'])

for program in LIVE['programs']:
    sids = ['L:' + x for x in program['source_ids']]
    for pid in program['hotel_ids']:
        hotel = by_id[pid]
        meta = evidence_meta(sids, program['checked_on'], 'official_page_observed', 'conditional_program_not_current_booking_entitlement')
        if program.get('rules'):
            for rule in program['rules']:
                age = rule['age_years']
                predicate = {'measure': 'completed_age_years', 'min': age.get('min', 0), 'max': age.get('max'), 'minInclusive': age.get('min_inclusive', True), 'maxInclusive': age.get('max_inclusive'), 'uncertainEqualities': []}
                conditions = dict(camelize(program['prerequisites']), guestStatus=rule['guest_status'], currentBookingMatch='unknown', ageInputRequirement=program['age_input_requirement'])
                for original, dest in [('max_free_children_per_room', 'maxFreeChildrenPerRoom'), ('extra_child_after_free_slots', 'extraChildAfterFreeSlots')]:
                    if original in rule:
                        conditions[dest] = rule[original]
                hotel['childRules'].append(dict(meta, id=pid + ':program:' + rule['rule_id'], kind='conditional_program', predicate=predicate, benefit=rule['benefit'], conditions=conditions, ambiguities=[], programId=program['program_id'], automaticQuoteUse=False))
        else:
            conditions = camelize(program['common_prerequisites'])
            conditions.update(languageVariants=camelize(program['language_variants']), currentBookingMatch='unknown', ageInputRequirement=program['age_input_requirement'])
            hotel['childRules'].append(dict(meta, id=pid + ':program:' + program['program_id'], kind='conditional_program', predicate=None, benefit=program['benefit'], conditions=conditions, ambiguities=program['unresolved'], programId=program['program_id'], automaticQuoteUse=False))
            hotel['conflicts'].append({'id': pid + ':program:language-versions', 'field': 'child_program_rate_and_count_eligibility', 'type': 'official_language_version_difference', 'weekdays': None, 'timeScope': None, 'dateScope': {'kind': 'conditional_program', 'validFrom': None, 'validTo': None}, 'sourceIds': sids, 'factIds': [], 'reason': '集团中英文大中华区条款的房价与人数限制不一致，保留两版；本次房价及人数须确认。', 'action': 'confirm_rate_plan_and_allowed_child_count', 'readAt': program['checked_on'], 'tripConfirmed': False})

# Unrechecked hotels retain only historical reference windows. Never invent weekdays.
live_ids = {h['hotel_id'] for h in LIVE['hotels']}
for hotel in compiled:
    if hotel['policyId'] in live_ids:
        continue
    intervals = {}
    for day in range(1, 8):
        candidates = [w for w in hotel['publishedBreakfastWindows'] if w['weekdays'] and day in w['weekdays']]
        if not candidates:
            continue
        start, end = max(w['start'] for w in candidates), min(w['end'] for w in candidates)
        if start >= end:
            continue
        key = (start, end, tuple(w['id'] for w in candidates))
        intervals.setdefault(key, []).append(day)
    for (start, end, ids), weekdays in intervals.items():
        origins = [w for w in hotel['publishedBreakfastWindows'] if w['id'] in ids]
        sids = sorted({s for w in origins for s in w['sourceIds']})
        read_at = max((w['readAt'] for w in origins if w['readAt']), default=None)
        hotel['compatiblePublishedWindows'].append(dict(evidence_meta(sids, read_at, 'derived_common_historical_interval', 'historical_reference_not_stay_guarantee', weekdays=weekdays), id=hotel['policyId'] + ':compatible:' + str(len(hotel['compatiblePublishedWindows'])), start=start, end=end, factIds=list(ids), derivation='intersection_of_cited_published_windows', currentStayGuarantee=False))

by_id['HD04']['conflicts'].append({'id': 'HD04:child:retail-versus-circle', 'field': 'child_breakfast_pricing_scope', 'type': 'scope_difference', 'weekdays': None, 'timeScope': None, 'dateScope': {'kind': 'different_eligibility_contexts', 'validFrom': None, 'validTo': None}, 'sourceIds': ['P:HD04', 'L:L01', 'L:L02'], 'factIds': ['HD04:policy:child:1', 'HD04:program:SG_FREE_UNDER6'], 'reason': '通用单买价和会员住店儿童餐计划属于不同条件；不能无条件采用最便宜档。', 'action': 'match_all_program_conditions_before_applying', 'readAt': LIVE['checked_on'], 'tripConfirmed': False})
for item in LIVE.get('additional_conflicts', []):
    by_id['HD04']['conflicts'].append({'id': item['conflict_id'], 'field': 'dinner_service_weekdays', 'type': 'within_page_conflict', 'weekdays': [1, 2, 3], 'timeScope': {'start': '17:00', 'end': '21:00'}, 'dateScope': {'kind': 'published_weekly_schedule', 'validFrom': None, 'validTo': None}, 'sourceIds': ['L:' + s for s in item['source_ids']], 'factIds': [], 'reason': '菜单价格段写每日晚餐，营业时段仅周四至日；不是已确认可用的晚餐权益。', 'action': 'confirm_service_before_scheduling', 'readAt': LIVE['checked_on'], 'tripConfirmed': False})

for hotel in compiled:
    hotel['unknowns'] = sorted(set(hotel['unknowns']))
    # Avoid carrying arbitrary unused source records into the public payload.
used = set()


def gather(value):
    if isinstance(value, dict):
        used.update(value.get('sourceIds', []))
        if value.get('sourceId'):
            used.add(value['sourceId'])
        for child in value.values():
            gather(child)
    elif isinstance(value, list):
        for child in value:
            gather(child)


gather(compiled)
output = {
    'schemaVersion': '1.0.0', 'preparedAt': LIVE['checked_on'], 'timezone': 'Asia/Shanghai',
    'datePolicy': 'Read dates are observations, not validity dates or stay confirmations.',
    'timeScopeConvention': 'start_inclusive_end_exclusive',
    'inputs': [{'file': 'data/' + name, 'sha256': hashlib.sha256((DATA / name).read_bytes()).hexdigest()} for name in INPUTS],
    'sources': [sources[sid] for sid in sorted(used)], 'hotels': compiled,
    'stats': {
        'hotels': len(compiled), 'officiallyRecheckedHotels': len(live_ids),
        'hotelsWithSnapshotAdultPrice': sum(bool(h['adultPrices']) for h in compiled),
        'publishedBreakfastWindows': sum(len(h['publishedBreakfastWindows']) for h in compiled),
        'compatiblePublishedWindows': sum(len(h['compatiblePublishedWindows']) for h in compiled),
        'childRuleRecords': sum(len(h['childRules']) for h in compiled),
        'conflictRecords': sum(len(h['conflicts']) for h in compiled),
        'tripConfirmedHotels': 0, 'currentBookingEntitlements': 0, 'redeemableVouchers': 0,
    },
}
(DATA / 'hotel_meal_policies.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(output['stats'], ensure_ascii=False, indent=2))
