#!/usr/bin/env python3
"""Build data/hud_limits.json: HUD FY2026 income limits for every Massachusetts city/town.

Source: HUD USER "FY 2026 Income Limits" (Section8-FY26.xlsx), https://www.huduser.gov/portal/datasets/il.html
  l50_1..8 = Very Low Income (50% of area median) by household size 1-8  -> RAFT ("less than 50% of your
             city/town's Area Median Income")
  l80_1..8 = Low Income (80%)                                           -> public housing / vouchers
HUD's site refuses plain downloads (HTTP 202 challenge); download the xlsx in a browser, then:
  uv run --with openpyxl python tools/build_hud_limits.py path/to/Section8-FY26.xlsx
"""
import json, re, sys, datetime, pathlib
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
ALIAS = {"manchester by the sea": ["manchesterbythesea", "manchester"], "north attleborough": ["north attleboro", "north attleborough town ci"]}   # HUD truncates "North Attleborough Town city"

def key(s):
    s = str(s).strip()
    while re.search(r"\s+(town|city)$", s, flags=re.I):          # HUD writes e.g. "Agawam Town city", "Barnstable Town city"
        s = re.sub(r"\s+(town|city)$", "", s, flags=re.I)
    s = s.lower().replace("-", " ")
    return re.sub(r"[^a-z ]", "", s).replace("  ", " ").strip()

def main(xlsx):
    wb = openpyxl.load_workbook(xlsx, read_only=True)
    ws = wb["Section8-FY26"]; rows = ws.iter_rows(values_only=True); hdr = list(next(rows)); H = {h: i for i, h in enumerate(hdr)}
    hud = {}
    for r in rows:
        if r and r[H["stusps"]] == "MA":
            hud[key(r[H["county_town_name"]])] = {"area": r[H["hud_area_name"]],
                                                   "l50": [int(r[H[f"l50_{i}"]]) for i in range(1, 9)],
                                                   "l80": [int(r[H[f"l80_{i}"]]) for i in range(1, 9)]}
    towns = json.loads((ROOT / "data" / "towns.json").read_text())["towns"]
    out, missing = {}, []
    for t in towns:
        k = key(t); cands = [k] + ALIAS.get(k, [])
        hit = next((hud[c] for c in cands if c in hud), None)
        if hit: out[t] = hit
        else: missing.append(t)
    if missing:
        sys.exit(f"towns with no HUD row: {missing}")
    doc = {"meta": {"source": "HUD USER FY 2026 Income Limits, Section8-FY26.xlsx (https://www.huduser.gov/portal/datasets/il.html)",
                    "fields": "l50 = 50% of area median (very low income), l80 = 80% (low income); index 0..7 = household size 1..8",
                    "built": datetime.date.today().isoformat(), "towns": len(out)},
           "towns": out}
    (ROOT / "data" / "hud_limits.json").write_text(json.dumps(doc, separators=(",", ":")))
    print(f"wrote data/hud_limits.json: {len(out)} towns")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Section8-FY26.xlsx")
