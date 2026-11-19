#!/usr/bin/env python3
"""
Step 1 — Prove the Recycle! API works for your own address.

Usage:
    pip install requests
    python step1_my_address.py --postcode 1180 --street "Rue Example" --number 12

Outputs:
  - the resolved zipcode ID and street ID (you'll reuse these later)
  - every collection in the next 365 days, per fraction
  - a derived weekly pattern per fraction (what the map will eventually store)
"""

import argparse
import json
from collections import defaultdict
from datetime import datetime, timedelta

import requests

BASE = "https://api.fostplus.be/recyclecms/app/v1"

# This value is public: it ships inside recycleapp.be's JavaScript bundle.
# If it ever stops working, open recycleapp.be with DevTools > Network,
# look at the request to /access-token and copy the new x-secret header.
X_SECRET = (
    "Op2tDi2pBmh1wzeC5TaN2U3knZan7ATcfOQgxh4vqC0mDKmnPP2qzoQusmInpglfIkxx8SZras"
    "Bqi5zgMSvyHggK9j6xCQNQ8xwPFY2o03GCcQfcXVOyKsvGWLze7iwcfcgk2Ujpl0dmrt3hSJMC"
    "DqzAlvTrsvAEiaSzC9hKRwhijQAFHuFIhJssnHtDSB76vnFQeTCCvwVB27DjSVpDmq8fWQKEmj"
    "EncdLqIsRnfxLcOjGIVwX5V0LBntVbeiBvcjyKF2nQ08rIxqHHGXNJ6SbnAmTgsPTg7k6Ejqa7"
    "dVfTmGtEPdftezDbuEc8DdK66KDecqnxwOOPSJIN0zaJ6k2Ye2tgMSxxf16gxAmaOUqHS0i7dt"
    "G5PgPSINti3qlDdw6DTKEPni7X0rxM"
)

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def get_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "x-secret": X_SECRET,
        "x-consumer": "recycleapp.be",
        "User-Agent": "",
        "Authorization": "",
    })
    r = s.get(f"{BASE}/access-token")
    r.raise_for_status()
    s.headers["Authorization"] = r.json()["accessToken"]
    return s


def find_zipcode(s: requests.Session, postcode: str) -> dict:
    r = s.get(f"{BASE}/zipcodes", params={"q": postcode})
    r.raise_for_status()
    items = [i for i in r.json()["items"] if i.get("available", True)]
    if not items:
        raise SystemExit(f"No zipcode found for {postcode}")
    return items[0]


def find_street(s: requests.Session, zipcode_id: str, street: str) -> dict:
    # The search chokes on abbreviations with '.', search on the last part
    q = street.split(".")[-1].strip()
    r = s.post(f"{BASE}/streets", params={"q": q, "zipcodes": zipcode_id})
    r.raise_for_status()
    items = r.json()["items"]
    if not items:
        raise SystemExit(f"No street match for '{street}'")
    for item in items:
        if item["name"].lower().strip() == street.lower().strip():
            return item
    print(f"[warn] no exact match, using first result: {items[0]['name']}")
    return items[0]


def get_collections(s, zipcode_id, street_id, number, days=365) -> list:
    now = datetime.now()
    params = {
        "zipcodeId": zipcode_id,
        "streetId": street_id,
        "houseNumber": number,
        "fromDate": now.strftime("%Y-%m-%d"),
        "untilDate": (now + timedelta(days=days)).strftime("%Y-%m-%d"),
        "size": 200,
    }
    r = s.get(f"{BASE}/collections", params=params)
    r.raise_for_status()
    return r.json()["items"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--postcode", required=True)
    ap.add_argument("--street", required=True)
    ap.add_argument("--number", required=True)
    args = ap.parse_args()

    s = get_session()

    zc = find_zipcode(s, args.postcode)
    print(f"zipcode : {zc['id']}  ({zc['city']['name']['fr'] if isinstance(zc.get('city'), dict) else args.postcode})")

    st = find_street(s, zc["id"], args.street)
    print(f"street  : {st['id']}  ({st['name']})\n")

    items = get_collections(s, zc["id"], st["id"], args.number)

    per_fraction = defaultdict(list)
    for item in items:
        if item.get("type") != "collection":
            continue
        if "exception" in item and "replacedBy" in item.get("exception", {}):
            continue
        date = datetime.strptime(item["timestamp"], "%Y-%m-%dT%H:%M:%S.000Z").date()
        name = item["fraction"]["name"].get("fr") or item["fraction"]["name"].get("en")
        per_fraction[name].append(date)

    print("=== Upcoming collections (next 4 per fraction) ===")
    for name, dates in sorted(per_fraction.items()):
        upcoming = ", ".join(d.isoformat() for d in sorted(dates)[:4])
        print(f"  {name:<30} {upcoming}")

    print("\n=== Derived weekly pattern (this is what the map will store) ===")
    pattern = {}
    for name, dates in sorted(per_fraction.items()):
        days = sorted({d.weekday() for d in dates})
        # crude frequency check: weekly vs. less often
        n_weeks = max((max(dates) - min(dates)).days / 7, 1)
        freq = "weekly" if len(dates) / n_weeks > 0.9 else "biweekly/other"
        pattern[name] = {"days": [WEEKDAYS[d] for d in days], "freq": freq}
        print(f"  {name:<30} {','.join(WEEKDAYS[d] for d in days):<12} ({freq})")

    with open("my_address_raw.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print("\nRaw API response saved to my_address_raw.json — inspect it to see the full schema.")


if __name__ == "__main__":
    main()
