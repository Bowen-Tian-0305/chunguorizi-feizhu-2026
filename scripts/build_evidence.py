#!/usr/bin/env python3
"""Validate and bundle the reviewed CSV evidence for the local app."""

import csv
import json
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ROOT.parent
BASE = OUTPUTS / 'kimi-hangzhou-data' / 'final'
CITY = OUTPUTS / 'kimi-hangzhou-city-food' / 'final'
SUPPLEMENT = OUTPUTS / 'kimi-hangzhou-city-food' / 'supplement'
TABLES = ('hotels', 'venues', 'meal_services', 'offers', 'hotel_venue_links', 'sources', 'claims')
KEYS = {'hotels': 'hotel_id', 'venues': 'venue_id', 'meal_services': 'service_id',
        'offers': 'offer_id', 'sources': 'source_id', 'claims': 'claim_id',
        'hangzhou_food_guide': 'guide_id'}


def load_table(folder, table):
    path = folder / f'{table}.csv'
    if not path.exists():
        return []
    with path.open(encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


parser = argparse.ArgumentParser()
parser.add_argument('--include-city', action='store_true', help='Merge both audited city-food batches')
args = parser.parse_args()
if args.include_city and (not CITY.exists() or not SUPPLEMENT.exists()):
    raise SystemExit('Both audited city-food directories are required')

data = {table: load_table(BASE, table) for table in TABLES}
# 2026-10-11 酒店深采审计：MS703 记录的是 Coffee Garden 全日营业时段，
# 原库误标为早餐供应。产品证据中撤下该餐次及关联旧 claim，待新早餐政策核验后再接入。
data['meal_services'] = [row for row in data['meal_services'] if row['service_id'] != 'MS703']
data['claims'] = [row for row in data['claims'] if row['claim_id'] not in {'C058', 'C059'}]
data['hangzhou_food_guide'] = []
city_claims = []
if args.include_city:
    for folder in (CITY, SUPPLEMENT):
        for table in ('venues', 'meal_services', 'sources', 'claims', 'hangzhou_food_guide'):
            rows = load_table(folder, table)
            data[table].extend(rows)
            if table == 'claims':
                city_claims.extend(rows)

errors = []
ids = {}
for table, key in KEYS.items():
    values = [row[key] for row in data[table]]
    if len(values) != len(set(values)):
        errors.append(f'{table}: duplicate {key}')
    ids[table] = set(values)

by_id = {table: {row[key]: row for row in data[table]}
         for table, key in KEYS.items()}

for table, rows in data.items():
    for line, row in enumerate(rows, 2):
        for column, target in (('hotel_id', 'hotels'), ('venue_id', 'venues'),
                               ('service_id', 'meal_services')):
            if table != target and column in row and row[column] and row[column] not in ids[target]:
                errors.append(f'{table}:{line}: missing {target} {row[column]}')
        for source_id in row.get('source_ids', '').split('|'):
            if source_id and source_id not in ids['sources']:
                errors.append(f'{table}:{line}: missing source {source_id}')
        if table == 'claims':
            entity = row['entity_type']
            if entity not in data or not data[entity]:
                errors.append(f'claims:{line}: unknown entity type {entity}')
            elif row['field'] not in data[entity][0]:
                errors.append(f'claims:{line}: unknown field {entity}.{row["field"]}')
            elif entity in KEYS and row['entity_id'] not in ids[entity]:
                errors.append(f'claims:{line}: missing entity {row["entity_id"]}')
            if row in city_claims and entity in by_id and row['entity_id'] in by_id[entity]:
                actual = by_id[entity][row['entity_id']].get(row['field'])
                if row['value'] != actual:
                    errors.append(f'claims:{line}: city claim {row["claim_id"]} value differs from {entity}.{row["field"]}')
        if table == 'sources' and not row.get('url', '').startswith(('https://', 'http://')):
            errors.append(f'sources:{line}: URL must use HTTP(S)')

if errors:
    raise SystemExit('\n'.join(errors[:50]))

destination = ROOT / 'data' / 'evidence.json'
destination.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps({key: len(value) for key, value in data.items()}, ensure_ascii=False))
