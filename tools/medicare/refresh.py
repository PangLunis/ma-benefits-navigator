"""Scheduled refresh for the Medicare plan data (Ryan, 2026-09-26: "rebuild each quarter with a safety check").

Runs daily; does real work only when CMS has posted a new file (new landscape stamp or new SPUF quarterly file).
For each year that has data (this year and, once CMS posts it, next year):
  1. build.py      - download + rebuild data/medicare/<year>/ (refuses to write if its own checks fail)
  2. calibrate.py  - package sizes for any new non-pill drug (Plan Finder, slow and polite)
  3. build.py      - rebuild with the new package sizes
  4. parity.py     - the page's engine must equal the reference math to the cent (and a broken copy must not)
  5. verify.py     - the page's numbers must match Medicare Plan Finder (PASS / FAIL / COULD NOT MEASURE)
Only if 4 and 5 PASS is the new data committed. It is pushed to the live site only when PUBLISH is on
(off until the Oct 15, 2026 launch); otherwise it goes to the medicare-2027 branch and Ryan gets a text.
Any FAIL or COULD NOT MEASURE: nothing is committed, the previous data stays, and Ryan gets a text saying which.
"""
import datetime, json, os, subprocess, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PY = sys.executable
PW_PY = os.environ.get("BF_PLAYWRIGHT_PY", sys.executable)        # a Python that has Playwright installed
NOTIFY = os.environ.get("BF_NOTIFY_CMD", "")                      # command that texts the owner; message on stdin
PUBLISH = os.path.exists(os.path.join(ROOT, "tools", "medicare", "PUBLISH"))   # touch this file at launch
BRANCH = "main" if PUBLISH else "medicare-2027"
LOG = []


def say(msg):
    LOG.append(msg); print(msg, flush=True)


def text_ryan(msg):
    if not NOTIFY:
        say("(no BF_NOTIFY_CMD set - message not sent)"); return
    try:
        subprocess.run(NOTIFY, shell=True, input=msg, text=True, timeout=60)
    except Exception as e:
        say(f"(could not send text: {e})")


def run(cmd, py=PY):
    say("$ " + " ".join(cmd))
    r = subprocess.run([py] + cmd, cwd=ROOT, capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-6:]
    for t in tail: say("   " + t)
    return r.returncode


def sources_changed(year):
    ix = os.path.join(ROOT, "data", "medicare", "index.json")
    old = (json.load(open(ix))["years"].get(str(year), {}) if os.path.exists(ix) else {}).get("sources", {})
    sys.path.insert(0, os.path.join(ROOT, "tools", "medicare"))
    import build
    try:
        lurl, _ = build.landscape_url(year); surl = build.spuf_url(year)
    except SystemExit as e:
        return None, str(e)                 # not posted yet
    new = {"landscape": lurl, "spuf": surl}
    return (new["landscape"] != old.get("landscape") or new["spuf"] != old.get("spuf")), new


def main():
    today = datetime.date.today()
    years = [today.year, today.year + 1]
    changed_years = []
    for y in years:
        ch, info = sources_changed(y)
        if ch is None: say(f"{y}: not posted yet ({info})"); continue
        if ch: changed_years.append(y); say(f"{y}: new CMS files -> {info}")
        else: say(f"{y}: unchanged")
    if not changed_years:
        say("nothing to do"); return 0
    cur = subprocess.run(["git", "branch", "--show-current"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if cur != BRANCH:   # runs in its own git worktree that stays on BRANCH; never switch branches under someone's edits
        text_ryan(f"Medicare data refresh skipped: its worktree is on '{cur}', expected '{BRANCH}'."); return 2
    results = {}
    for y in changed_years:
        st = "PASS"
        if run(["tools/medicare/build.py", "--year", str(y)]): st = "FAIL (build checks)"
        elif run(["tools/medicare/calibrate.py", "--year", str(y)], py=PW_PY): st = "COULD NOT MEASURE (calibration)"
        elif run(["tools/medicare/build.py", "--year", str(y)]): st = "FAIL (rebuild)"
        elif run(["tools/medicare/parity.py", str(y)]): st = "FAIL (engine parity)"
        else:
            rc = run(["tools/medicare/verify.py", "--year", str(y)], py=PW_PY)
            st = {0: "PASS", 1: "FAIL (does not match Medicare Plan Finder)", 2: "COULD NOT MEASURE (Plan Finder)"}.get(rc, f"FAIL (rc {rc})")
        results[y] = st
    ok = [y for y, s in results.items() if s == "PASS"]
    bad = {y: s for y, s in results.items() if s != "PASS"}
    if bad:
        subprocess.run(["git", "checkout", "-q", "--", "data/medicare"], cwd=ROOT)     # keep the previous, verified data
        subprocess.run(["git", "clean", "-fdq", "data/medicare"], cwd=ROOT)
    if ok and not bad:
        subprocess.run(["git", "add", "data/medicare"], cwd=ROOT)
        subprocess.run(["git", "commit", "-qm", f"Medicare data refresh {', '.join(map(str, ok))} (verified vs Plan Finder)"], cwd=ROOT)
        subprocess.run(["git", "push", "-q", "origin", BRANCH], cwd=ROOT)
    lines = [f"Medicare data refresh ({today}):"] + [f"- {y}: {s}" for y, s in results.items()]
    if bad: lines.append("Nothing was published; the site keeps the last verified data.")
    elif not PUBLISH: lines.append(f"Saved to the {BRANCH} branch (not live until launch).")
    else: lines.append("Live on benefighter.com.")
    if 2027 in ok and not PUBLISH: lines.append("2027 plan data is in and matches Medicare's Plan Finder — ready to launch when you say.")
    text_ryan("\n".join(lines))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
