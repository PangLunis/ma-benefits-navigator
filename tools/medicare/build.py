"""Build Benefighter's Medicare plan-comparison data for Massachusetts from free public files.

Sources (all free, no key, no account):
  * CMS MA/PDP "Landscape" file ............ plans by county: premiums, deductible, MOOP, star ratings
      https://www.cms.gov/medicare/coverage/prescription-drug-coverage  (cyYYYY-landscape-*.zip)
  * CMS quarterly Prescription Drug Plan Formulary, Pharmacy Network, and Pricing files (SPUF)
      https://data.cms.gov/data.json  -> "Quarterly Prescription Drug Plan Formulary, ..." (SPUF_YYYY_*.zip)
      Read by HTTP range requests: only the members we need (the 2.4 GB pharmacy-network parts are skipped).
  * NLM RxNorm Current Prescribable Content (drug names; "without any licensing restrictions")
      https://download.nlm.nih.gov/rxnorm/RxNorm_full_prescribe_current.zip
  * US Census 2020 county subdivisions (Massachusetts town -> county)
      https://www2.census.gov/geo/docs/reference/codes2020/cousub/st25_ma_cousub2020.txt
  * data/medicare/pkg_units.json ........... units per package for non-pill drugs, calibrated against
      Medicare Plan Finder by tools/medicare/calibrate.py (pills are priced per pill and need none)

Output: data/medicare/<year>/plans.json, drugs.json, rx/<rxcui>.json  (+ data/medicare/index.json)

Usage:  python3 tools/medicare/build.py --year 2026
The build refuses to write if its own positive controls fail (see check()).
"""
import argparse, csv, io, json, os, re, statistics, sys, urllib.request, zipfile, collections, datetime, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "medicare")
CACHE = os.path.join(ROOT, ".cache", "medicare")
UA = {"User-Agent": "Mozilla/5.0 (Benefighter data build; +https://benefighter.com)"}
STATE = "MA"
# Defined standard Part D benefit: (deductible, annual out-of-pocket threshold) - CMS Rate Announcements
# (CY2027 announcement, April 6 2026, Table V-2: 2026 = $615 / $2,100; 2027 = $700 / $2,400).
STD = {2026: (615, 2100), 2027: (700, 2400)}
PDP_REGION = "02"          # Central New England (CT, MA, RI, VT)


# ------------------------------------------------------------------ download helpers
def get(url, dest=None):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if dest:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        open(dest, "wb").write(data)
    return data


def cached(url, name):
    p = os.path.join(CACHE, name)
    if not os.path.exists(p):
        print(f"  downloading {url}")
        get(url, p)
    return p


class HTTPRange(io.RawIOBase):
    """Seekable file over HTTP range requests, so zipfile can read one member of a 2.5 GB zip."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=UA), timeout=60)
        self.size = int(r.headers["Content-Length"])
        if (r.headers.get("Accept-Ranges") or "").lower() != "bytes":
            raise SystemExit(f"server does not support range requests: {url}")
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, wh=0):
        self.pos = off if wh == 0 else (self.pos + off if wh == 1 else self.size + off)
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        end = min(self.size, self.pos + n) - 1
        h = dict(UA, Range=f"bytes={self.pos}-{end}")
        b = urllib.request.urlopen(urllib.request.Request(self.url, headers=h), timeout=120).read()
        self.pos += len(b)
        return b
    def readinto(self, buf):
        d = self.read(len(buf)); buf[:len(d)] = d; return len(d)


def money(s):
    s = str(s or "").replace("$", "").replace(",", "").strip()
    try: return float(s)
    except ValueError: return None


# ------------------------------------------------------------------ source discovery
def landscape_url(year):
    html = get("https://www.cms.gov/medicare/coverage/prescription-drug-coverage").decode("utf-8", "replace")
    hits = sorted(set(re.findall(rf'/files/zip/cy{year}-landscape-(\d{{6}})\.zip', html)))
    if not hits:
        raise SystemExit(f"CY{year} landscape file is not posted on the CMS page yet")
    return f"https://www.cms.gov/files/zip/cy{year}-landscape-{hits[-1]}.zip", hits[-1]


def spuf_url(year):
    d = json.loads(get("https://data.cms.gov/data.json"))
    for ds in d["dataset"]:
        if ds.get("title", "").startswith("Quarterly Prescription Drug Plan Formulary"):
            dists = [x for x in ds.get("distribution", []) if f"SPUF_{year}_" in (x.get("downloadURL") or "")]
            if not dists:
                raise SystemExit(f"no SPUF_{year} quarterly file on data.cms.gov yet")
            dists.sort(key=lambda x: x["downloadURL"])
            return dists[-1]["downloadURL"]
    raise SystemExit("quarterly SPUF dataset not found in data.cms.gov catalog")


# ------------------------------------------------------------------ parsers
def read_landscape(path, year):
    z = zipfile.ZipFile(path)
    member = [n for n in z.namelist() if n.lower().endswith(".csv")][0]
    rows = csv.DictReader(io.TextIOWrapper(z.open(member), encoding="utf-8-sig", errors="replace"))
    plans = {}
    for r in rows:
        if r["State Territory Abbreviation"] != STATE or r["Contract Year"] != str(year):
            continue
        k = f'{r["Contract ID"]}-{r["Plan ID"].zfill(3)}-{r["Segment ID"].zfill(3)}'
        p = plans.setdefault(k, {
            "n": r["Plan Name"].strip(), "org": r["Organization Marketing Name"].strip(),
            "cat": r["Contract Category Type"], "type": r["Plan Type"],
            "snp": r["SNP Type"] if r["Special Needs Plan (SNP) Indicator"] == "Yes" else "",
            "ben": r["Drug Benefit Type"],
            "dprem": money(r["Part D Total Premium"]), "cprem": money(r["Monthly Consolidated Premium (Part C + D)"]),
            "ded": money(r["Annual Part D Deductible Amount"]), "oop": money(r["Part D Out-of-Pocket (OOP) Threshold"]),
            "moop": money(r["In-Network Maximum Out-of-Pocket (MOOP) Amount"]),
            "stars": money(r["Overall Star Rating"]) if r["Overall Star Rating"][:1].isdigit() else None,
            "dstars": money(r["Part D Summary Star Rating"]) if r["Part D Summary Star Rating"][:1].isdigit() else None,
            "counties": []})
        c = r["County Name"]
        if c not in p["counties"]:
            p["counties"].append(c)
    return plans


def spuf_members(url, year):
    """Extract the small SPUF tables (and a MA-filtered pricing table) into the cache. Returns dir."""
    d = os.path.join(CACHE, f"spuf_{year}_" + os.path.basename(url).replace(".zip", ""))
    done = os.path.join(d, ".done")
    if os.path.exists(done):
        return d
    os.makedirs(d, exist_ok=True)
    outer = zipfile.ZipFile(io.BufferedReader(HTTPRange(url), buffer_size=8 << 20))
    want = ("plan information", "basic drugs formulary", "beneficiary cost", "insulin beneficiary cost", "geographic locator", "pricing file")
    for info in outer.infolist():
        low = info.filename.lower()
        if "pharmacy networks" in low or "sample" in low or not any(low.startswith(w) for w in want):
            continue
        print(f"  reading {info.filename} ({info.compress_size/1e6:.0f} MB)")
        tmp = os.path.join(d, "inner.zip")
        with outer.open(info) as src, open(tmp, "wb") as dst:
            shutil.copyfileobj(src, dst, 8 << 20)
        inner = zipfile.ZipFile(tmp)
        for m in inner.infolist():
            key = next(w for w in want if low.startswith(w)).replace(" ", "_")
            with inner.open(m) as src, open(os.path.join(d, key + ".txt"), "wb") as dst:
                shutil.copyfileobj(src, dst, 8 << 20)
        os.remove(tmp)
    open(done, "w").write(url)
    return d


def pipe_rows(path):
    return csv.DictReader(open(path, encoding="latin-1"), delimiter="|")


# ------------------------------------------------------------------ main build
def build(year):
    os.makedirs(CACHE, exist_ok=True)
    print("1/6 landscape")
    lurl, lstamp = landscape_url(year)
    land = read_landscape(cached(lurl, os.path.basename(lurl)), year)

    print("2/6 formulary + pricing (SPUF)")
    surl = spuf_url(year)
    sd = spuf_members(surl, year)
    geo = {r["COUNTY_CODE"]: r for r in pipe_rows(os.path.join(sd, "geographic_locator.txt"))}
    ma_codes = {c for c, r in geo.items() if r["STATENAME"] == "Massachusetts"}
    pinfo = {}
    for r in pipe_rows(os.path.join(sd, "plan_information.txt")):
        if r["COUNTY_CODE"] in ma_codes or r["PDP_REGION_CODE"].strip().zfill(2) == PDP_REGION:
            k = f'{r["CONTRACT_ID"]}-{r["PLAN_ID"]}-{r["SEGMENT_ID"]}'
            pinfo.setdefault(k, {"form": r["FORMULARY_ID"], "ded": money(r["DEDUCTIBLE"]), "prem": money(r["PREMIUM"])})
    forms = {p["form"] for p in pinfo.values()}
    formulary = collections.defaultdict(dict)
    for r in pipe_rows(os.path.join(sd, "basic_drugs_formulary.txt")):
        if r["FORMULARY_ID"] in forms:
            flags = (1 if r["PRIOR_AUTHORIZATION_YN"] == "Y" else 0) | (2 if r["STEP_THERAPY_YN"] == "Y" else 0) | (4 if r["QUANTITY_LIMIT_YN"] == "Y" else 0)
            ql = [int(float(r["QUANTITY_LIMIT_AMOUNT"])), int(float(r["QUANTITY_LIMIT_DAYS"]))] if flags & 4 and r["QUANTITY_LIMIT_AMOUNT"].strip() and r["QUANTITY_LIMIT_DAYS"].strip() else None
            formulary[r["FORMULARY_ID"]][r["RXCUI"]] = (int(r["TIER_LEVEL_VALUE"]), r["NDC"], flags, ql)
    segs = set(pinfo)
    price = {}
    for r in pipe_rows(os.path.join(sd, "pricing_file.txt")):
        k = f'{r["CONTRACT_ID"]}-{r["PLAN_ID"]}-{r["SEGMENT_ID"]}'
        if k in segs and r["DAYS_SUPPLY"] == "30":
            price[(k, r["NDC"])] = float(r["UNIT_COST"])
    cost = collections.defaultdict(dict)
    for r in pipe_rows(os.path.join(sd, "beneficiary_cost.txt")):
        k = f'{r["CONTRACT_ID"]}-{r["PLAN_ID"]}-{r["SEGMENT_ID"]}'
        if k in segs and r["DAYS_SUPPLY"] == "1":
            def cs(t, a, mn, mx):
                t = int(r[t]); return None if t == 0 else [t, float(r[a] or 0), money(r[mn]) or 0, money(r[mx]) or 0]
            cost[k][(int(r["COVERAGE_LEVEL"]), int(r["TIER"]))] = {
                "s": cs("COST_TYPE_NONPREF", "COST_AMT_NONPREF", "COST_MIN_AMT_NONPREF", "COST_MAX_AMT_NONPREF"),
                "p": cs("COST_TYPE_PREF", "COST_AMT_PREF", "COST_MIN_AMT_PREF", "COST_MAX_AMT_PREF"),
                "d": 1 if r["DED_APPLIES_YN"] == "Y" else 0, "sp": 1 if r["TIER_SPECIALTY_YN"] == "Y" else 0}
    ins = collections.defaultdict(dict)
    for r in pipe_rows(os.path.join(sd, "insulin_beneficiary_cost.txt")):
        k = f'{r["CONTRACT_ID"]}-{r["PLAN_ID"]}-{r["SEGMENT_ID"]}'
        if k in segs and r["DAYS_SUPPLY"] == "1":
            t = int(r["TIER"]) if r["TIER"].strip().isdigit() else 0
            ins[k][t] = {"s": [money(r["copay_amt_nonpref_insln"]), money(r["coin_amt_nonpref_insln"])],
                         "p": [money(r["copay_amt_pref_insln"]), money(r["coin_amt_pref_insln"])]}

    print("3/6 drug names (RxNorm)")
    rxz = zipfile.ZipFile(cached("https://download.nlm.nih.gov/rxnorm/RxNorm_full_prescribe_current.zip", "rxnorm_prescribe.zip"))
    member = [n for n in rxz.namelist() if n.endswith("RXNCONSO.RRF")][0]
    allrx = set().union(*[set(f) for f in formulary.values()])
    nm = collections.defaultdict(dict)
    for line in io.TextIOWrapper(rxz.open(member), encoding="utf-8"):
        a = line.split("|")
        if a[0] in allrx and a[11] == "RXNORM" and a[12] in ("PSN", "SCD", "SBD", "GPCK", "BPCK", "SY"):
            nm[a[0]].setdefault(a[12], a[14])

    print("4/6 towns -> counties (Census)")
    cz = get("https://www2.census.gov/geo/docs/reference/codes2020/cousub/st25_ma_cousub2020.txt").decode("latin-1")
    town_county = {}
    for r in csv.DictReader(io.StringIO(cz), delimiter="|"):
        n = re.sub(r"\s+(town|city|Town city|Town)$", "", r["COUSUBNAME"]).strip()
        if n.startswith("County subdivisions"): continue
        town_county[n.lower().replace("-", " ")] = r["COUNTYNAME"].replace(" County", "")
    towns = json.load(open(os.path.join(ROOT, "data", "towns.json")))["towns"]
    t2c = {}
    for t in towns:
        c = town_county.get(t.lower().replace("-", " "))
        if c: t2c[t] = c

    print("5/6 package units")
    pku_path = os.path.join(OUT, "pkg_units.json")
    raw = json.load(open(pku_path)) if os.path.exists(pku_path) else {}
    fda = fda_packages()
    pku = {ndc: snap(r, fda.get(ndc)) for ndc, r in raw.items()}

    print("6/6 writing")
    # ---- plans (only plans in the landscape; Part D details from SPUF where the plan has drug coverage)
    plan_ids = sorted(land)
    idx = {k: i for i, k in enumerate(plan_ids)}
    plans_out = []
    for k in plan_ids:
        L = land[k]; P = pinfo.get(k)
        e = {"id": k, "n": L["n"], "org": L["org"], "cat": L["cat"], "type": L["type"], "snp": L["snp"],
             "prem": L["cprem"] if L["cprem"] is not None else L["dprem"], "dprem": L["dprem"],
             "moop": L["moop"], "stars": L["stars"], "dstars": L["dstars"], "counties": sorted(L["counties"])}
        if P:
            e["drug"] = 1
            e["ded"] = P["ded"] if P["ded"] is not None else L["ded"]
            e["oop"] = L["oop"]
            e["sd"] = STD[year][0]                      # standard-benefit deductible (for the cap counter below)
            if L["ben"] == "Enhanced Alternative": e["ea"] = 1   # progress toward the cap counts standard-benefit cost sharing
            tiers = {}
            for (lvl, t), c in cost[k].items():
                if lvl == 1: tiers[str(t)] = c
            e["tiers"] = tiers
            e["ins"] = {str(t): v for t, v in ins.get(k, {}).items()}
        plans_out.append(e)
    # ---- per-drug files
    ydir = os.path.join(OUT, str(year))
    rxdir = os.path.join(ydir, "rx")
    if os.path.isdir(rxdir): shutil.rmtree(rxdir)
    os.makedirs(rxdir)
    drugs_out = []
    nfiles = 0
    for rx in sorted(allrx, key=int):
        rows, ndcs, units = [], collections.Counter(), []
        for k, P in pinfo.items():
            if k not in idx: continue
            f = formulary[P["form"]].get(rx)
            if not f: continue
            tier, ndc, flags, ql = f
            u = price.get((k, ndc))
            rows.append([idx[k], tier, round(u, 4) if u is not None else None, flags] + ([ql] if ql else []))
            ndcs[ndc] += 1
            if u is not None: units.append(u)
        if not rows: continue
        ndc = ndcs.most_common(1)[0][0]
        names = nm.get(rx, {})
        disp = names.get("PSN") or names.get("SCD") or names.get("SBD") or names.get("BPCK") or names.get("GPCK") or rx
        alt = names.get("SBD") or names.get("SCD") or ""
        pill = bool(re.search(r"\b(Tablet|Capsule)\b", disp, re.I)) and not re.search(r"Inhal|Pack\b|\{", disp, re.I)
        med = statistics.median(units) if units else None
        pk = None if pill else pku.get(ndc)
        json.dump({"rx": rx, "p": rows, "m": round(med, 4) if med else None}, open(os.path.join(rxdir, rx + ".json"), "w"), separators=(",", ":"))
        nfiles += 1
        d = [rx, disp]
        if alt and alt.lower() != disp.lower(): d.append(alt)
        else: d.append("")
        d.append(1 if pill else 0)
        d.append(pk if pk else None)          # units per package (non-pills); None = not calibrated yet
        d.append(1 if re.search(r"insulin|Lantus|Humalog|Novolog|Levemir|Tresiba|Toujeo|Basaglar|Semglee|Humulin|Novolin|Admelog|Apidra|Fiasp|Lyumjev|Rezvoglar|Afrezza", disp + " " + alt, re.I) else 0)
        drugs_out.append(d)
    drugs_out.sort(key=lambda d: d[1].lower())
    meta = {"year": year, "built": datetime.date.today().isoformat(), "state": STATE,
            "sources": {"landscape": lurl, "spuf": surl, "rxnorm": "RxNorm Current Prescribable Content (NLM)",
                        "counties": "US Census 2020 county subdivisions"},
            "counts": {"plans": len(plans_out), "drug_plans": sum(1 for p in plans_out if p.get("drug")), "drugs": len(drugs_out),
                       "towns_mapped": len(t2c)}}
    plans_json = {"meta": meta, "plans": plans_out, "towns": t2c}
    check(plans_json, drugs_out, rxdir, year)
    json.dump(plans_json, open(os.path.join(ydir, "plans.json"), "w"), separators=(",", ":"))
    json.dump({"meta": meta, "drugs": drugs_out}, open(os.path.join(ydir, "drugs.json"), "w"), separators=(",", ":"))
    idxp = os.path.join(OUT, "index.json")
    ix = json.load(open(idxp)) if os.path.exists(idxp) else {"years": {}}
    ix["years"][str(year)] = meta
    json.dump(ix, open(idxp, "w"), indent=1)
    uncal = sorted({d[0] for d in drugs_out if not d[3] and not d[4]})
    json.dump(uncal, open(os.path.join(CACHE, f"uncalibrated_{year}.json"), "w"))
    print(json.dumps(meta["counts"]), f"| rx files {nfiles} | non-pill drugs without package units: {len(uncal)}")


def fda_packages():
    """NDC (11-digit) -> FDA package description, e.g. '5 SYRINGE in 1 CARTON / 3 mL in 1 SYRINGE'."""
    z = zipfile.ZipFile(cached("https://www.accessdata.fda.gov/cder/ndctext.zip", "fda_ndctext.zip"))
    out = {}
    for r in csv.DictReader(io.TextIOWrapper(z.open("package.txt"), encoding="latin-1"), delimiter="\t"):
        try:
            a, b, c = r["NDCPACKAGECODE"].split("-")
            out[a.zfill(5) + b.zfill(4) + c.zfill(2)] = r["PACKAGEDESCRIPTION"]
        except ValueError:
            pass
    return out


def snap(ratio, desc):
    """Calibrated ratio = (Plan Finder's price for 1 package) / (CMS unit price). Both prices drift, so the ratio is
    near - not exactly - the real billing units per package. Snap it to a package size the FDA listing supports
    (5 pens x 3 mL -> 15), else to a whole number."""
    if ratio is None: return None
    cands = set()
    if desc:
        nums = [float(x) for x in re.findall(r"(?:^|/)\s*([\d.]+)\s", desc) if x.strip(".")]
        prod = 1.0
        for x in nums:
            cands.add(x); prod *= x; cands.add(prod)
    best = min(cands, key=lambda c: abs(c - ratio) / c) if cands else None
    if best and abs(best - ratio) / best <= 0.25:
        return round(best, 3)
    if 0.8 <= ratio <= 1.25: return 1
    return round(ratio) if ratio >= 3 else round(ratio * 2) / 2


def check(pj, drugs, rxdir, year):
    """Positive controls: fail loudly rather than publish a half-built dataset."""
    P = pj["plans"]; fails = []
    def need(cond, msg):
        if not cond: fails.append(msg)
    worc = [p for p in P if "Worcester" in p["counties"] and p.get("drug") and not p["snp"]]
    need(len(worc) >= 20, f"Worcester County has only {len(worc)} non-SNP drug plans")
    need(sum(1 for p in P if p["cat"] == "PDP") >= 5, "fewer than 5 stand-alone drug plans (PDP)")
    need(len(pj["towns"]) >= 350, f'only {len(pj["towns"])} of 351 towns mapped to a county')
    need(all(p.get("tiers") for p in P if p.get("drug")), "a drug plan has no cost-sharing tiers")
    # a very common drug must be priced in nearly every drug plan
    names = {d[1].lower(): d[0] for d in drugs}
    lis = next((rx for n, rx in names.items() if n.startswith("lisinopril 10 mg oral tablet")), None)
    need(lis is not None, "lisinopril 10 MG Oral Tablet missing from the drug list")
    if lis:
        rows = json.load(open(os.path.join(rxdir, lis + ".json")))["p"]
        dp = sum(1 for p in P if p.get("drug"))
        priced = sum(1 for r in rows if r[2] is not None)
        need(priced >= 0.9 * dp, f"lisinopril priced in only {priced} of {dp} drug plans")
    need(len(drugs) >= 3000, f"only {len(drugs)} drugs")
    if fails:
        raise SystemExit("BUILD CHECK FAILED - nothing written:\n  " + "\n  ".join(fails))
    print("  checks passed")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=datetime.date.today().year)
    build(ap.parse_args().year)
