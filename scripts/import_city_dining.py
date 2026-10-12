"""Validate and package Kimi's latest public dining snapshot for the prototype."""

import csv
import json
from collections import defaultdict
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
ROOT = APP.parents[1]
COLLECTION = ROOT / "outputs/kimi-hangzhou-city-dining"
LATEST = json.loads((COLLECTION / "latest.json").read_text(encoding="utf-8"))
SOURCE = COLLECTION / LATEST["latest_batch"]

# Same branch and exactly the same street address. Keep the earlier record's ID.
ALIASES = {"F195": "F035", "F213": "F200", "F215": "F202", "F216": "F203"}


def read_table(name):
    with (SOURCE / f"{name}.csv").open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


tables = {name: read_table(name) for name in
          ("venues", "ranking_memberships", "dining_facts", "sources", "claims")}
id_columns = {"venues": "venue_id", "ranking_memberships": "membership_id",
              "dining_facts": "fact_id", "sources": "source_id", "claims": "claim_id"}
ids = {}
for name, rows in tables.items():
    values = [row[id_columns[name]] for row in rows]
    assert len(values) == len(set(values)), f"duplicate {name} ID"
    ids[name] = set(values)

for name, rows in tables.items():
    for row in rows:
        if row.get("venue_id"):
            assert row["venue_id"] in ids["venues"], (name, row)
        for source_id in filter(None, row.get("source_ids", "").split("|")):
            assert source_id in ids["sources"], (name, source_id)
        if name == "ranking_memberships":
            assert row["source_id"] in ids["sources"]
            assert not row["rank"] or row["rank"].isdigit()
        if name == "claims" and row["entity_table"] in ids:
            assert row["entity_id"] in ids[row["entity_table"]], row
            assert row["value"].strip(), row

raw_venues = {row["venue_id"]: row for row in tables["venues"]}
for alias, canonical in ALIASES.items():
    a, b = raw_venues[alias], raw_venues[canonical]
    assert a["address"] and a["address"] == b["address"], (alias, canonical)
    assert a["district"] == b["district"], (alias, canonical)


def canonical(venue_id):
    return ALIASES.get(venue_id, venue_id)


sources = {row["source_id"]: row for row in tables["sources"]}
membership_by_venue = defaultdict(list)
for row in tables["ranking_memberships"]:
    source = sources[row["source_id"]]
    membership_by_venue[canonical(row["venue_id"])].append({
        "category": row["ranking_category"],
        "year": row["ranking_year"],
        "district_page": row["district"],
        "display_order": int(row["display_order"]) if row["display_order"] else None,
        "platform_score_snapshot": row["platform_score"] or None,
        "platform_tags": row["platform_tags"],
        "source_url": source["url"],
        "source_title": source["title"],
    })

facts_by_venue = defaultdict(list)
for row in tables["dining_facts"]:
    if row["status"] != "verified":
        continue
    source_ids = [item for item in row["source_ids"].split("|") if item]
    facts_by_venue[canonical(row["venue_id"])].append({
        "field": row["field"], "value": row["value"],
        "meal_type": row["meal_type"], "price_basis": row["price_basis"],
        "source_url": sources[source_ids[0]]["url"] if source_ids else "",
        "note": row["validity_note"],
    })

conflicts = set()
for row in tables["claims"]:
    if row["entity_table"] == "venues" and row["status"] in {"unverified", "refuted", "conflicting", "disputed"}:
        conflicts.add(canonical(row["entity_id"]))

source_ids_by_venue = defaultdict(set)
for row in tables["venues"]:
    source_ids_by_venue[canonical(row["venue_id"])].update(filter(None, row["source_ids"].split("|")))

all_venues = []
excluded_closed = []
for row in tables["venues"]:
    if row["venue_id"] in ALIASES:
        continue
    if "暂停营业" in row["name"] or row["branch_name"] == "暂停营业":
        excluded_closed.append(row["venue_id"])
        continue
    venue_id = row["venue_id"]
    linked_sources = [sources[item] for item in sorted(source_ids_by_venue[venue_id])]
    all_venues.append({
        "id": venue_id, "name": row["name"], "branch": row["branch_name"],
        "district": row["district"] or "区县待核", "address": row["address"],
        "address_status": row["identity_status"],
        "has_conflict": venue_id in conflicts or row["identity_status"] == "name_ambiguous",
        "memberships": membership_by_venue[venue_id],
        "facts": facts_by_venue[venue_id],
        "sources": [{"url": item["url"], "title": item["title"],
                     "publisher": item["publisher"], "retrieved_at": item["retrieved_at"]}
                    for item in linked_sources],
    })

all_venues.sort(key=lambda item: (item["address_status"] != "address_confirmed",
                                  item["district"], item["name"]))
ranked = [item for item in all_venues if item["memberships"]]
snapshot = {
    "captured_at": LATEST["collected_date"],
    "source_batch": f"kimi-hangzhou-city-dining/{SOURCE.name}",
    "scope": "可读公开页和补充门店资料的历史快照，不是杭州餐馆全量或当前营业承诺",
    "raw_venue_count": len(tables["venues"]),
    "excluded_closed_ids": excluded_closed,
    "venue_count": len(all_venues),
    "address_confirmed_count": sum(item["address_status"] == "address_confirmed" for item in all_venues),
    "breakfast_evidence_count": sum(any(fact["field"] == "breakfast_served" for fact in item["facts"]) for item in all_venues),
    "ranking_entry_count": len(tables["ranking_memberships"]),
    "ranked_venue_count": len(ranked),
    "venues": all_venues,
}
ranking = {
    "captured_at": snapshot["captured_at"], "source_batch": snapshot["source_batch"],
    "scope": "高德公开榜单网页可见门店快照，不是杭州餐饮全量，也不是高德 App 完整榜单",
    "venue_count": len(ranked),
    "address_known_count": sum(item["address_status"] == "address_confirmed" for item in ranked),
    "ranking_entry_count": snapshot["ranking_entry_count"],
    "ranked": ranked,
}
(APP / "data/ranking.json").write_text(json.dumps(ranking, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
(APP / "public/city-dining.json").write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{SOURCE.name}: {len(all_venues)} distinct venues ({len(ranked)} ranked), "
      f"{snapshot['address_confirmed_count']} confirmed addresses, "
      f"{snapshot['breakfast_evidence_count']} breakfast evidence records")
