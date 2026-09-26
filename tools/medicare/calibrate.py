"""Calibrate "units per package" for non-pill drugs against Medicare Plan Finder.

Why: CMS prices every drug per *billing unit* (a pill, a mL, a gram, a blister...). For pills that is obvious; for an
inhaler it is not (an Ellipta inhaler is billed as 60 blisters, a metered-dose inhaler in grams). Plan Finder asks
people for a number of *packages*, so we ask Plan Finder once what 1 package of each drug costs in a plan and divide
by that plan's unit cost from the CMS pricing file. The ratio = billing units per package.

Politeness: one browser page, sequential requests, SLEEP seconds apart, 25 drugs per request.
Output: data/medicare/pkg_units.json  {ndc: units_per_package}   (merged; existing entries kept)

Usage: python3 tools/medicare/calibrate.py --year 2026 [--limit N]
Requires Playwright + Google Chrome (headed: Plan Finder is a browser app).
"""
import argparse, collections, csv, json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "medicare")
CACHE = os.path.join(ROOT, ".cache", "medicare")
SLEEP = 6
BATCH = 25
NPI = "1558460915"   # a large retail pharmacy in Worcester (CVS, Grafton St) - any in-network retail pharmacy works


def load(year):
    sd = [os.path.join(CACHE, d) for d in os.listdir(CACHE) if d.startswith(f"spuf_{year}_")]
    sd = sorted(sd)[-1]
    rows = lambda f: csv.DictReader(open(os.path.join(sd, f), encoding="latin-1"), delimiter="|")
    pj = json.load(open(os.path.join(OUT, str(year), "plans.json")))
    drug_ids = {p["id"] for p in pj["plans"] if p.get("drug")}
    pinfo = {}
    for r in rows("plan_information.txt"):
        k = f'{r["CONTRACT_ID"]}-{r["PLAN_ID"]}-{r["SEGMENT_ID"]}'
        if k in drug_ids: pinfo.setdefault(k, r["FORMULARY_ID"])
    forms = set(pinfo.values())
    formulary = collections.defaultdict(dict)
    for r in rows("basic_drugs_formulary.txt"):
        if r["FORMULARY_ID"] in forms: formulary[r["FORMULARY_ID"]][r["RXCUI"]] = r["NDC"]
    price = {}
    for r in rows("pricing_file.txt"):
        k = f'{r["CONTRACT_ID"]}-{r["PLAN_ID"]}-{r["SEGMENT_ID"]}'
        if k in pinfo and r["DAYS_SUPPLY"] == "30": price[(k, r["NDC"])] = float(r["UNIT_COST"])
    return pinfo, formulary, price


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--year", type=int, required=True); ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    todo = json.load(open(os.path.join(CACHE, f"uncalibrated_{a.year}.json")))
    pinfo, formulary, price = load(a.year)
    pku_path = os.path.join(OUT, "pkg_units.json")
    pku = json.load(open(pku_path)) if os.path.exists(pku_path) else {}
    # for each drug: the most common proxy NDC, and a plan that prices exactly that NDC
    job = collections.defaultdict(list)          # plan -> [(rx, ndc, unit_cost)]
    plan_rank = collections.Counter(k for k in pinfo for rx in formulary[pinfo[k]])
    for rx in todo:
        ndcs = collections.Counter(formulary[f][rx] for f in set(pinfo.values()) if rx in formulary[f])
        if not ndcs: continue
        ndc = ndcs.most_common(1)[0][0]
        if ndc in pku: continue
        cands = [k for k in pinfo if formulary[pinfo[k]].get(rx) == ndc and (k, ndc) in price]
        if not cands: continue
        k = max(cands, key=lambda k: plan_rank[k])
        job[k].append((rx, ndc, price[(k, ndc)]))
    work = [(k, items[i:i + BATCH]) for k, items in job.items() for i in range(0, len(items), BATCH)]
    if a.limit: work = work[:a.limit]
    print(f"{sum(len(v) for v in job.values())} drugs to calibrate in {len(work)} requests (~{len(work)*SLEEP//60+1} min)")
    from playwright.sync_api import sync_playwright
    got = 0
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=False)
        pg = b.new_context(viewport={"width": 1100, "height": 800}).new_page()
        pg.goto(f"https://www.medicare.gov/plan-compare/#/?lang=en&year={a.year}", wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_timeout(5000)
        for n, (k, items) in enumerate(work):
            c, pl, sg = k.split("-")
            body = {"npis": [NPI], "prescriptions": [{"ndc": ndc, "frequency": "FREQUENCY_30_DAYS", "quantity": "1"} for _, ndc, _ in items],
                    "lis": "LIS_NO_HELP", "plans": [{"contract_id": c, "contract_year": str(a.year), "plan_id": pl, "segment_id": str(int(sg))}],
                    "full_year": False, "retailOnly": True}
            res = pg.evaluate("""async (body)=>{const r=await fetch('/api/v1/data/plan-compare/drugs/cost',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)}); return {status:r.status, text: await r.text()};}""", body)
            if res["status"] != 200:
                print(f"  request {n+1}: HTTP {res['status']} - stopping (could not measure the rest)"); break
            d = json.loads(res["text"])
            costs = {x["ndc"]: x for pl_ in d.get("plans", []) for cc in pl_.get("costs", []) for x in cc.get("drug_costs", [])}
            for rx, ndc, uc in items:
                x = costs.get(ndc)
                if x and x.get("full_cost") and uc > 0 and not x.get("default_price_used"):
                    pku[ndc] = round(x["full_cost"] / uc, 2); got += 1
            print(f"  request {n+1}/{len(work)}: {sum(1 for _,ndc,_ in items if ndc in pku)}/{len(items)} calibrated", flush=True)
            json.dump(pku, open(pku_path, "w"), indent=0, sort_keys=True)
            time.sleep(SLEEP)
        b.close()
    print(f"calibrated {got}; pkg_units.json now has {len(pku)} entries")


if __name__ == "__main__":
    main()
