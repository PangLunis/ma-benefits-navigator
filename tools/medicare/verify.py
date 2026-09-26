"""Safety check: does the SITE's calculator (medicare-engine.js on the built data) match Medicare Plan Finder?

Runs the real product path - data/medicare/<year>/ + medicare-engine.js in node - against Plan Finder's own
full-year estimate for fixed drug lists, every Worcester County drug plan, one retail pharmacy.
Exit codes: 0 = PASS, 1 = FAIL (numbers disagree - do not publish), 2 = COULD NOT MEASURE (Plan Finder unreachable
or returned something unexpected - neither pass nor fail).

Politeness: one browser page, sequential requests, 6 s apart (~16 requests).
Usage: python3 tools/medicare/verify.py --year 2026 [--report out.json]
"""
import argparse, json, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NPI = "1558460915"          # CVS, 500 Grafton St, Worcester MA 01604
COUNTY = "Worcester"
SLEEP = 6
# (label, [(name prefix in drugs.json, per month: pills = count, others = packages)])
LISTS = [
    ("generics", [("lisinopril 10 MG Oral Tablet", 30), ("amLODIPine besylate 5 MG Oral Tablet", 30), ("metFORMIN HCl 500 MG Oral Tablet", 60)]),
    ("brands", [("Eliquis 5 MG Oral Tablet", 60), ("Jardiance 10 MG Oral Tablet", 30)]),
    ("insulin", [("Lantus 100 UNT/ML in 3 ML Pen Injector", 1), ("gabapentin 300 MG Oral Capsule", 90), ("furosemide 20 MG Oral Tablet", 30)]),
    ("non-pills", [("TRELEGY ELLIPTA 100 MCG / 62.5 MCG / 25 MCG", 1), ("latanoprost 0.005 % Ophthalmic Solution", 1), ("atorvastatin calcium 20 MG Oral Tablet", 30)]),
    # heavy brand use: reaches the yearly cap in Enhanced Alternative plans early in the year
    ("heavy", [("Eliquis 5 MG Oral Tablet", 60), ("TRELEGY ELLIPTA 100 MCG / 62.5 MCG / 25 MCG", 1), ("OZEMPIC 2 MG in 3 ML Pen Injector", 1), ("atorvastatin calcium 20 MG Oral Tablet", 30)]),
]
TOL_ABS, TOL_REL = 10.0, 0.10


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--year", type=int, required=True); ap.add_argument("--report")
    a = ap.parse_args()
    D = os.path.join(ROOT, "data", "medicare", str(a.year))
    pj = json.load(open(os.path.join(D, "plans.json"))); drugs = json.load(open(os.path.join(D, "drugs.json")))["drugs"]
    plans = pj["plans"]
    idxs = [i for i, p in enumerate(plans) if p.get("drug") and not p["snp"] and (COUNTY in p["counties"] or p["cat"] == "PDP")]
    byname = {}
    for d in drugs: byname.setdefault(d[1].lower(), d)
    rxdata = {}
    lists = []
    for label, items in LISTS:
        L = []
        for prefix, n in items:
            d = next((v for k, v in byname.items() if k.startswith(prefix.lower())), None)
            if not d: print(f"  (skipping {prefix}: not in drug list)"); continue
            if not d[3] and not d[4]: print(f"  (skipping {prefix}: package size not calibrated)"); continue
            rxf = json.load(open(os.path.join(D, "rx", d[0] + ".json"))); rxdata[d[0]] = rxf
            # the proxy NDC Plan Finder should price: most common NDC is not stored per row, so read it from the cache
            L.append({"rx": d[0], "name": d[1], "n": n, "pill": d[3], "units": 1 if d[3] else d[4], "ins": bool(d[5])})
        if L: lists.append((label, L))
    ndc = proxy_ndcs(a.year, {it["rx"] for _, L in lists for it in L})
    from playwright.sync_api import sync_playwright
    pf = {}
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(channel="chrome", headless=False)
            pg = b.new_context(viewport={"width": 1100, "height": 800}).new_page()
            pg.goto(f"https://www.medicare.gov/plan-compare/#/?lang=en&year={a.year}", wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(5000)
            for label, L in lists:
                pf[label] = []
                for i in range(0, len(idxs), 12):
                    batch = [plans[j]["id"].split("-") for j in idxs[i:i + 12]]
                    body = {"npis": [NPI], "lis": "LIS_NO_HELP", "full_year": True, "retailOnly": True,
                            "prescriptions": [{"ndc": ndc[it["rx"]], "frequency": "FREQUENCY_30_DAYS", "quantity": str(it["n"])} for it in L],
                            "plans": [{"contract_id": c, "contract_year": str(a.year), "plan_id": pl, "segment_id": str(int(sg))} for c, pl, sg in batch]}
                    res = pg.evaluate("""async (body)=>{const r=await fetch('/api/v1/data/plan-compare/drugs/cost',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body)}); return {status:r.status, text: await r.text()};}""", body)
                    if res["status"] != 200:
                        raise RuntimeError(f"Plan Finder HTTP {res['status']}")
                    pf[label] += json.loads(res["text"])["plans"]
                    time.sleep(SLEEP)
            b.close()
    except Exception as e:
        print(f"COULD NOT MEASURE: {e}"); sys.exit(2)
    if a.report: json.dump(pf, open(a.report + ".planfinder.json", "w"))   # raw Plan Finder answers, for offline A/B checks
    # our side: the site's engine in node
    jobs, keys = [], []
    idmap = {p["id"]: i for i, p in enumerate(plans)}
    for label, L in lists:
        for x in pf[label]:
            k = x["plan"]; pid = f'{k["contract_id"]}-{k["plan_id"]}-{str(k["segment_id"]).zfill(3)}'
            i = idmap[pid]; c = (x.get("costs") or [{}])[0]
            ds = []
            for it in L:
                rows = {r[0]: r for r in rxdata[it["rx"]]["p"]}
                ds.append({"rx": it["rx"], "qty": it["n"] * it["units"], "ins": it["ins"], "row": rows.get(i), "med": rxdata[it["rx"]]["m"]})
            jobs.append({"plan": plans[i], "drugs": ds, "pharm": "p" if c.get("preferred") else "s"})
            keys.append((label, pid, c))
    js = "const E=require(%s);const P=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(P.map(c=>E.estimate(c.plan,c.drugs,c.pharm).year)))" % json.dumps(os.path.join(ROOT, "medicare-engine.js"))
    out = subprocess.run(["node", "-e", js], input=json.dumps(jobs), capture_output=True, text=True)
    if out.returncode: print(out.stderr); sys.exit(2)
    ours = json.loads(out.stdout)
    report = {"year": a.year, "lists": {}, "pass": True}
    for label, _ in lists:
        R = [(pid, c.get("estimated_yearly_total"), o, plans[idmap[pid]]["prem"] or 0) for (lb, pid, c), o in zip(keys, ours) if lb == label]
        R = [r for r in R if r[1] is not None]
        if len(R) < 10: print(f"COULD NOT MEASURE: only {len(R)} plans returned for {label}"); sys.exit(2)
        within = sum(1 for _, f, o, _ in R if abs(f - o) <= max(TOL_ABS, TOL_REL * f))
        tot = lambda r, w: (r[1] if w == "pf" else r[2]) + 12 * r[3]
        tpf = sorted(R, key=lambda r: tot(r, "pf")); tus = sorted(R, key=lambda r: tot(r, "us"))
        top1 = tpf[0][0] == tus[0][0] or abs(tot(tpf[0], "pf") - tot(tus[0], "pf")) <= 25
        overlap = len({r[0] for r in tpf[:5]} & {r[0] for r in tus[:5]})
        ok = within >= 0.8 * len(R) and top1 and overlap >= 4
        report["lists"][label] = {"plans": len(R), "within_tol": within, "top1_ok": top1, "top5_overlap": overlap, "pass": ok}
        report["pass"] &= ok
        print(f"{label:<10} plans {len(R):>3}  within max(${TOL_ABS:.0f},{TOL_REL:.0%}): {within:>3}  cheapest same: {top1}  top-5 overlap {overlap}/5  -> {'PASS' if ok else 'FAIL'}")
    if a.report: json.dump(report, open(a.report, "w"), indent=1)
    print("VERIFY", "PASS" if report["pass"] else "FAIL")
    sys.exit(0 if report["pass"] else 1)


def proxy_ndcs(year, rxs):
    import collections, csv
    CACHE = os.path.join(ROOT, ".cache", "medicare")
    sd = sorted(os.path.join(CACHE, d) for d in os.listdir(CACHE) if d.startswith(f"spuf_{year}_"))[-1]
    c = collections.defaultdict(collections.Counter)
    for r in csv.DictReader(open(os.path.join(sd, "basic_drugs_formulary.txt"), encoding="latin-1"), delimiter="|"):
        if r["RXCUI"] in rxs: c[r["RXCUI"]][r["NDC"]] += 1
    return {rx: v.most_common(1)[0][0] for rx, v in c.items()}


if __name__ == "__main__":
    main()
