"""Parity: the browser engine (medicare-engine.js, run in node) must give the same yearly cost as the Python
reference estimator (tools/medicare_proto/estimator.py logic, re-implemented here on the built data) for random
drug lists across all drug plans. Also a control: a deliberately broken engine must FAIL this test."""
import json, os, random, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
Y = sys.argv[1] if len(sys.argv) > 1 else "2026"
D = os.path.join(ROOT, "data", "medicare", Y)
pj = json.load(open(os.path.join(D, "plans.json"))); drugs = json.load(open(os.path.join(D, "drugs.json")))["drugs"]
plans = pj["plans"]
pills = [d for d in drugs if d[3] == 1]
random.seed(7)
cases = []
for n in range(400):
    k = random.choice([1, 2, 3, 4, 6])
    lst = random.sample(pills, k)
    if random.random() < 0.3:
        ins = [d for d in drugs if d[5] == 1 and d[4]]
        if ins: lst.append(random.choice(ins))
    items = []
    for d in lst:
        rxf = json.load(open(os.path.join(D, "rx", d[0] + ".json")))
        qty = random.choice([30, 60, 90]) if d[3] else round((d[4] or 1) * random.choice([1, 2]), 2)
        items.append({"rx": d[0], "qty": qty, "ins": bool(d[5]), "rows": {r[0]: r for r in rxf["p"]}, "med": rxf["m"]})
    pi = random.choice([i for i, p in enumerate(plans) if p.get("drug")])
    cases.append({"plan": pi, "pharm": random.choice(["s", "p"]), "items": items})

def py_est(plan, items, pharm):
    ph0 = "p" if pharm == "p" else "s"; cap = plan.get("oop") or 2100
    ded = plan.get("ded") or 0; sded = plan.get("sd") or 0; troop = 0.0; total = 0.0; per = {}; ea = bool(plan.get("ea"))
    for it in items:
        r = it["row"]
        if r: per[it["rx"]] = dict(cov=True, tier=r[1], full=None if r[2] is None else r[2] * it["qty"])
        else: per[it["rx"]] = dict(cov=False, full=None if it["med"] is None else it["med"] * it["qty"])
    def share(c, full):
        if not c: return full
        t, a, mn, mx = c
        if t == 1: return min(a, full)
        if t == 2:
            v = a * full
            if mn: v = max(v, mn)
            if mx: v = min(v, mx)
            return min(v, full)
        return full
    order = sorted(items, key=lambda it: per[it["rx"]]["full"] or 0)
    for m in range(12):
        for it in order:
            x = per[it["rx"]]
            if x["full"] is None: continue
            if not x["cov"]: total += x["full"]; continue
            if troop >= cap: pay = 0.0
            else:
                c1 = plan.get("tiers", {}).get(str(x["tier"]))
                ph = "p" if (c1 and ph0 == "p" and c1.get("p")) else "s"
                if it["ins"]:
                    t = plan.get("ins", {}).get(str(x["tier"])) or plan.get("ins", {}).get("0")
                    opts = [35.0, x["full"]]
                    if t:
                        rr = t[ph] if (t[ph][0] is not None or t[ph][1] is not None) else t["s"]
                        if rr[0] is not None: opts.append(rr[0])
                        if rr[1] is not None: opts.append(rr[1] * x["full"])
                    pay = min(opts)
                elif c1 and c1["d"] and ded > 0:
                    pd = min(x["full"], ded); ded -= pd; rest = x["full"] - pd
                    pay = pd + (share(c1[ph], rest) if rest > 0 else 0)
                else:
                    pay = share(c1[ph], x["full"]) if c1 else x["full"]
                    if ded > 0: ded = max(0.0, ded - x["full"])
                cnt = pay
                if ea:
                    if it["ins"]: cnt = min(35.0, 0.25 * x["full"])
                    else:
                        sdp = min(x["full"], sded); sded -= sdp; cnt = sdp + 0.25 * (x["full"] - sdp)
                rem = cap - troop
                if cnt >= rem: pay = min(pay, rem); troop = cap
                else: troop += cnt
            total += pay
    return total

payload = []
for c in cases:
    plan = plans[c["plan"]]
    its = [dict(rx=it["rx"], qty=it["qty"], ins=it["ins"], row=it["rows"].get(c["plan"]), med=it["med"]) for it in c["items"]]
    c["py"] = py_est(plan, its, c["pharm"]); payload.append({"plan": plan, "drugs": its, "pharm": c["pharm"]})
def run_js(engine):
    js = f"""const E=require({json.dumps(engine)}); const P=JSON.parse(require('fs').readFileSync(0,'utf8'));
    console.log(JSON.stringify(P.map(c=>E.estimate(c.plan,c.drugs,c.pharm).year)));"""
    out = subprocess.run(["node", "-e", js], input=json.dumps(payload), capture_output=True, text=True)
    if out.returncode: raise SystemExit(out.stderr)
    return json.loads(out.stdout)
def compare(js, label):
    bad = [(i, c["py"], j) for i, (c, j) in enumerate(zip(cases, js)) if abs(c["py"] - j) > 0.01]
    print(f"{label}: {len(cases) - len(bad)}/{len(cases)} cases agree to the cent" + (f"; first mismatch {bad[0]}" if bad else ""))
    return not bad
ok = compare(run_js(os.path.join(ROOT, "medicare-engine.js")), "engine")
# control: flip the fill order in a copy of the engine -> must produce mismatches
src = open(os.path.join(ROOT, "medicare-engine.js")).read().replace("(per[a.rx].full || 0) - (per[b.rx].full || 0)", "(per[b.rx].full || 0) - (per[a.rx].full || 0)")
assert "(per[b.rx].full" in src, "control patch did not apply"
tmp = "/tmp/medicare-engine-broken.js"; open(tmp, "w").write(src)
ctrl = compare(run_js(tmp), "control (fill order reversed, must NOT all agree)")
print("PARITY", "PASS" if ok and not ctrl else "FAIL")
sys.exit(0 if ok and not ctrl else 1)
