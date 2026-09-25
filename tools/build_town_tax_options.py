#!/usr/bin/env python3
"""
build_town_tax_options.py -- regenerate data/town_tax_options.json from the
Massachusetts Division of Local Services (DLS) Gateway "Local Options" reports.

README
======

WHAT IT BUILDS
  data/town_tax_options.json: one record per municipality (all 351, keyed by
  the name exactly as DLS spells it, e.g. "Manchester By The Sea",
  "North Attleborough"), showing which senior/veteran property-tax relief
  options DLS has ON RECORD for that town.

HOW TO RUN (stdlib only, no dependencies)
    uv run python3 tools/build_town_tax_options.py
  dls-gw answers some datacenter/VPN addresses with an AWS WAF challenge
  (HTTP 202, empty body, header `x-amzn-waf-action: challenge`, seen 2026-09-25).
  The script detects that and stops with COULD-NOT-MEASURE instead of writing
  anything. Re-run from a residential connection.
  Options: --cache-dir DIR (keep raw CSVs), --from-cache DIR (rebuild offline
  from a previous cache), --delay SECONDS (default 5; requests are sequential).

SOURCES (all public, free; DLS Data Analytics and Resources Bureau)
  Each report is a Logi Analytics page. The script GETs the page (to get a
  session + the municipality checkbox list), then POSTs the report's own
  "Export" action with rdReportFormat=CSV and every municipality selected.
  [PT]  Property Tax Exemption Clauses Adopted
        https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=localoptions.propertytax
  [LO]  Adopted Local Options Relating to Property Tax  ("self-reported and
        only shows the current unexpired data", per the report itself)
        https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=localoptions.localoptions
  [CPA] Local Option CPA (Community Preservation Act adoption)
        https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=Local_Option_CPA
  [DEF] Exemption Clause 18A & 41A Tax Deferrals (counts granted per FY)
        https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=Exemptions.TaxDeferrals

FIELD MEANINGS  (the same text is written into the JSON under "fields")
  null  = the source does not show it (NOT "not adopted").
  false = the source affirmatively shows "no" (rare: only cpa_listed and
          cpa_blended can be false).
  *_on_file = the value as filed with DLS. Towns change these by local vote
          and DLS's copy is often stale -- see "spot_checks" in the JSON:
          the 41C AMOUNT matched the town's own current documents in only
          3 of 7 checked towns. Never show *_on_file amounts as "you get $X".

  dor_code                        [PT] DLS 3-digit municipality code
  elderly_exemption_clause        [PT] elderly clause DLS shows as accepted:
                                  "41C", "41B", "41C 1/2" (raw)
  elderly_exemption_clause_adopted[PT] adoption date/year as DLS shows it (raw)
  clause_41c_adopted              [PT] true if DLS shows Clause 41C
  clause_41c_half_adopted         [PT] true if DLS shows Clause 41C 1/2
  clause_41c_options_on_file      [PT] true if any "Clause 41C Options"
                                  column (St.2002 c.184 s.51) is filled
  clause_41c_age_on_file          [PT] qualifying age filed (65-70); statute
                                  default is 70. 0/blank -> null
  clause_41c_amount_on_file       [PT] exemption $ filed (statute base $500,
                                  option allows up to +100% = $1,000)
  clause_41c_income_limit_single_on_file / _married_on_file
  clause_41c_asset_limit_single_on_file  / _married_on_file
                                  [PT] limits as filed at option adoption.
                                  Towns that later accepted Clause 41D (CPI
                                  indexing -- not in any DLS report) have
                                  higher current limits.
  clause_41c_units_excluded_on_file [PT] "# of units excluded (multi-family
                                  homes only)"
  clause_41c_options_raw          [PT] the 7 raw option cells, for audit
  surviving_spouse_clause         [PT] "17", "17C", "17C 1/2" or "17D"
  surviving_spouse_clause_adopted [PT] raw date
  clause_37a_blind_adopted        [PT] true if DLS shows a 37A adoption date
  clause_37a_blind_adopted_date   [PT] raw date
  state_reimb_cap_clause17_dollars [PT] "Clause 17 cap (if applicable)". Per
                                  the DLS Cherry Sheet Manual, state
                                  reimbursement for 17C/17C1/2/17D "cannot
                                  exceed the amount reimbursed under Clause
                                  17". A state-aid cap, NOT a resident benefit.
  state_reimb_cap_clause41_count  [PT] "Clause 41 Exemption Cap": number of
                                  41B/41C exemptions the state reimburses
                                  (capped at the last Clause 41 count, Cherry
                                  Sheet Manual). NOT a resident benefit.
  residential_exemption_pct       [LO] residential exemption % (not senior)
  senior_means_tested_exemption   [LO] true if "Senior Means Tested Exemption
                                  Granted" = Yes (home-rule, e.g. Sudbury)
  billing_cycle                   [LO] Quarterly / Semi-Annual / Preliminary
                                  Semi-Annual
  cpa_listed                      [CPA] true if the town appears in DLS's CPA
                                  report, false if it does not (a statement
                                  about the report, not proof of rejection)
  cpa_adopted                     [CPA] true if a CPA adoption year is shown
  cpa_year_adopted, cpa_surcharge_pct  [CPA]
  cpa_exempt_low_income_and_senior [CPA] "Low Income Exemption" = G.L. c.44B
                                  s.3(e)(1): property of a person who would
                                  qualify for low-income housing or low/
                                  moderate-income senior housing
  cpa_exempt_first_100k_residential   [CPA] "Residential Assessed Value"
  cpa_exempt_first_100k_commercial_industrial [CPA]
  cpa_blended                     [CPA] Y/N as shown
  deferral_41a_latest_fy          [DEF] latest fiscal year in the report
  deferral_41a_count_latest_fy, deferral_41a_dollars_latest_fy
                                  [DEF] Clause 41A deferrals granted that FY
  deferral_41a_count_last5fy      [DEF] sum over the latest 5 FYs reported
  (41A deferral itself is available in every town by statute; DLS does not
   publish each town's local income limit or interest rate.)

  NOT IN ANY PUBLIC DLS REPORT (null for every town; need town sources):
  senior_work_off_5k_adopted, veteran_work_off_5n_adopted,
  additional_exemption_5c_half_adopted, clause_41d_cpi_indexing_adopted,
  deferral_41a_local_income_limit, deferral_41a_interest_rate,
  clause_17d_cola_adopted, clause_22_local_increase_adopted,
  tax_aid_fund_60_3d_adopted, clause_56_guard_exemption_adopted.
  Towns DO file these with DLS ("Notification of Acceptance of Local Option
  Statutes" forms) but DLS does not publish them in a report.

EXIT CODES
  0 written; 2 a positive control failed (nothing written); 3 COULD NOT
  MEASURE (fetch blocked/failed; nothing written).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import http.cookiejar
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://dls-gw.dor.state.ma.us/reports/"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 "
      "(Benefighter data refresh; sequential, low-rate)")
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO, "data", "town_tax_options.json")

REPORTS = {
    "propertytax": dict(
        page="localoptions.propertytax", export="LocalOptions.PropertyTax",
        table="tblLO_PropTax", filename="LO_PropTaxExemptions",
        title="Property Tax Exemption Clauses Adopted"),
    "localoptions": dict(
        page="localoptions.localoptions", export="LocalOptions.localoptions",
        table="TblLocalOptions", filename="LocalOptionsPropTaxRelated",
        title="Adopted Local Options Relating to Property Tax"),
    "cpa": dict(
        page="Local_Option_CPA", export="LocalOptions.Local_Option_CPA",
        table="TblLocalOptionsCPA", filename="LocalOptionsCPA",
        title="Local Option CPA"),
    "deferrals": dict(
        page="Exemptions.TaxDeferrals", export="Exemptions.TaxDeferrals",
        table="tblTaxDeferrals", filename="TaxDeferrals",
        title="Exemption Clause 18A & 41A Tax Deferrals",
        lists=("iclYear", "iclClause"), last_n_years=5),
}

# Manual spot checks of DLS "on file" values against each town's own current
# documents, done 2026-09-25 when this dataset was first built. They are the
# evidence for the staleness caveat, carried forward verbatim (not re-checked
# by the script). Re-do a few whenever the dataset is refreshed.
SPOT_CHECKS = {
    "checked": "2026-09-25",
    "summary": ("41C age on file matched the town's own document in 6 of 7 "
                "towns; 41C amount on file matched in only 3 of 7. DLS option "
                "data is a lower bound and often stale. Stoneham's document "
                "was generic, so it is excluded from the counts."),
    "towns": {
        "Methuen": {"dls": "41C adopted 5/6/1987; no 41C options on file",
                    "town": "age 65 (methuen.gov/168/Exemptions-Information); "
                            "council resolution text raises 41C from $750 to "
                            "$1,000 (methuen.gov/DocumentCenter/View/2163)",
                    "age_match": False, "amount_match": False},
        "Boston": {"dls": "age 65, amount $500",
                   "town": "age 65, $1,000 in FY2027 plus up to $1,000 more "
                           "(boston.gov/departments/assessing/elderly-exemption-41c)",
                   "age_match": True, "amount_match": False},
        "Agawam": {"dls": "no 41C options on file (so statute: 70, $500)",
                   "town": "age 70, $1,000 (agawam.ma.us/223)",
                   "age_match": True, "amount_match": False},
        "Amherst": {"dls": "age 65, amount $600",
                    "town": "age 65, $1,000 (amherstma.gov DocumentCenter 603, FY2016 sheet)",
                    "age_match": True, "amount_match": False},
        "Acton": {"dls": "age 65, amount $1,000",
                  "town": "age 65, 'up to $2,000' (FY26 tax relief packet; "
                          "likely 41C + 5C1/2, not verified)",
                  "age_match": True, "amount_match": True},
        "Southborough": {"dls": "age 65, amount $1,000",
                         "town": "age 65, $1,000 + 5C1/2 adopted 2020 "
                                 "(southboroughma.gov DocumentCenter 309, FY2027)",
                         "age_match": True, "amount_match": True},
        "Gardner": {"dls": "no 41C options on file",
                    "town": "age 70, $500 (gardner-ma.gov DocumentCenter 1278, FY2023)",
                    "age_match": True, "amount_match": True},
    },
}

NOT_AVAILABLE = {
    "senior_work_off_5k_adopted": "Senior property-tax work-off abatement, G.L. c.59 s.5K",
    "veteran_work_off_5n_adopted": "Veteran property-tax work-off abatement, G.L. c.59 s.5N",
    "additional_exemption_5c_half_adopted": "Optional additional exemption up to +100%, G.L. c.59 s.5C1/2",
    "clause_41d_cpi_indexing_adopted": "Clause 41D: annual CPI increase of 41C income/asset limits",
    "deferral_41a_local_income_limit": "Clause 41A deferral: locally adopted income limit",
    "deferral_41a_interest_rate": "Clause 41A deferral: locally adopted interest rate",
    "clause_17d_cola_adopted": "Clause 17D annual COLA (CPI) acceptance",
    "clause_22_local_increase_adopted": "Local increase of Clause 22 veteran exemptions",
    "tax_aid_fund_60_3d_adopted": "Voluntary tax-aid fund for elderly/disabled, G.L. c.60 s.3D",
    "clause_56_guard_exemption_adopted": "Clause 56 National Guard / reservist exemption",
}


class CouldNotMeasure(Exception):
    pass


# ---------------------------------------------------------------- fetching --

def _opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def _open(op, url, data=None, tries=3):
    """One request, retried slowly. Returns (status, headers, bytes).
    A WAF challenge or a transport failure is COULD-NOT-MEASURE, never 'no data'."""
    last = None
    for attempt in range(tries):
        if attempt:
            time.sleep(20 * attempt)  # slow, sequential retry
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with op.open(req, timeout=120) as r:
                body = r.read()
                waf = r.headers.get("x-amzn-waf-action")
                if waf or r.status == 202 or not body:
                    last = (f"HTTP {r.status}, {len(body)} bytes, "
                            f"x-amzn-waf-action={waf!r} -- AWS WAF challenge / empty "
                            f"response for THIS client IP (us, not them)")
                    continue
                return r.status, r.headers, body
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = f"{type(e).__name__}: {e}"
    raise CouldNotMeasure(f"{url}\n    {last}\n    Re-run from a residential connection.")


def _checkbox_values(html, name):
    out = []
    for tag in re.findall(r'<input\b[^>]*>', html, flags=re.I):
        if re.search(r'\bname="%s"' % re.escape(name), tag):
            m = re.search(r'\bvalue="([^"]*)"', tag)
            if m:
                out.append(m.group(1))
    return out


def fetch_report(key, delay):
    spec = REPORTS[key]
    op = _opener()
    status, _, body = _open(op, BASE + "rdPage.aspx?rdReport=" + spec["page"])
    html = body.decode("utf-8", "replace")
    m = re.search(r"Data current as of\s*(?:<[^>]+>\s*)*(\d{1,2}/\d{1,2}/\d{4})", html)
    as_of = m.group(1) if m else None
    munis = _checkbox_values(html, "iclMuni")
    if len(munis) < 351:
        raise CouldNotMeasure(f"{key}: page listed {len(munis)} municipalities (<351); "
                              f"report layout changed or page incomplete")
    form = [("iclMuni", v) for v in munis]
    for lst in spec.get("lists", ()):
        vals = _checkbox_values(html, lst)
        if not vals:
            raise CouldNotMeasure(f"{key}: no values for selector {lst}")
        if lst == "iclYear" and spec.get("last_n_years"):
            vals = sorted(vals, reverse=True)[: spec["last_n_years"]]
        form += [(lst, v) for v in vals]
    time.sleep(delay)
    url = (BASE + "rdPage.aspx?" + urllib.parse.urlencode({
        "rdReport": spec["export"], "rdReportFormat": "CSV",
        "rdExportTableID": spec["table"], "rdExportFilename": spec["filename"]}))
    _, _, csv_bytes = _open(op, url, data=urllib.parse.urlencode(form).encode())
    text = csv_bytes.decode("utf-8-sig", "replace")
    if not text.startswith('"DOR Code","Municipality"'):
        raise CouldNotMeasure(f"{key}: export did not return the expected CSV "
                              f"(first bytes: {text[:120]!r})")
    return text, as_of


# ----------------------------------------------------------------- parsing --

def _s(v):
    v = (v or "").strip()
    return v or None


def _int(v):
    v = _s(v)
    if v is None:
        return None
    v = v.replace(",", "").replace("$", "").replace("%", "")
    try:
        return int(float(v))
    except ValueError:
        return None


def _pos(v):
    """int > 0, else None (DLS uses 0 for 'this option item not changed')."""
    n = _int(v)
    return n if n and n > 0 else None


def _rows(text):
    rows = list(csv.reader(io.StringIO(text)))
    return rows[0], rows[1:]


def build(raw, as_of, fetched):
    hdr, pt_rows = _rows(raw["propertytax"])
    expect = ["DOR Code", "Municipality", "Date Adopted Clause 37A Blind Exemption",
              "Surviving Spouse Exemption Clause Adopted", "Clause 17 cap (if applicable)",
              "Date Adopted", "Elderly Person Exemption Clause Adopted", "Date Adopted",
              "41C Age", "41C Amount", "41C Income if Single", "41C Income if Married",
              "41C Assets if Single", "41C Assets if Married"]
    if [h.strip() for h in hdr[:14]] != expect or len(hdr) < 16:
        raise SystemExit(f"propertytax: column layout changed -- refusing to guess.\n{hdr}")
    towns = {}
    for r in pt_rows:
        name = r[1].strip()
        opts = r[8:15]
        on_file = any(_s(x) for x in opts)
        elder = _s(r[6])
        t = {
            "dor_code": r[0].strip(),
            "elderly_exemption_clause": elder,
            "elderly_exemption_clause_adopted": _s(r[7]),
            "clause_41c_adopted": True if elder == "41C" else None,
            "clause_41c_half_adopted": True if elder == "41C 1/2" else None,
            "clause_41c_options_on_file": True if on_file else None,
            "clause_41c_age_on_file": _pos(r[8]),
            "clause_41c_amount_on_file": _pos(r[9]),
            "clause_41c_income_limit_single_on_file": _pos(r[10]),
            "clause_41c_income_limit_married_on_file": _pos(r[11]),
            "clause_41c_asset_limit_single_on_file": _pos(r[12]),
            "clause_41c_asset_limit_married_on_file": _pos(r[13]),
            "clause_41c_units_excluded_on_file": _pos(r[14]),
            "clause_41c_options_raw": dict(zip(
                ["age", "amount", "income_single", "income_married",
                 "assets_single", "assets_married", "units_excluded"],
                [x.strip() for x in opts])) if on_file else None,
            "surviving_spouse_clause": _s(r[3]),
            "surviving_spouse_clause_adopted": _s(r[5]),
            "clause_37a_blind_adopted": True if _s(r[2]) else None,
            "clause_37a_blind_adopted_date": _s(r[2]),
            "state_reimb_cap_clause17_dollars": _int(r[4]),
            "state_reimb_cap_clause41_count": _int(r[15]),
        }
        towns[name] = t

    # Adopted local options
    hdr, lo_rows = _rows(raw["localoptions"])
    col = {h.strip(): i for i, h in enumerate(hdr)}
    for need in ("Municipality", "Senior Means Tested Exemption Granted",
                 "Residential Exemption Percentage", "Billing Cycle"):
        if need not in col:
            raise SystemExit(f"localoptions: column {need!r} missing -- layout changed")
    extra_lo = []
    for r in lo_rows:
        name = r[col["Municipality"]].strip()
        if name not in towns:
            extra_lo.append(name)  # e.g. Devens (not one of the 351)
            continue
        t = towns[name]
        t["residential_exemption_pct"] = _int(r[col["Residential Exemption Percentage"]])
        t["senior_means_tested_exemption"] = (
            True if _s(r[col["Senior Means Tested Exemption Granted"]]) == "Yes" else None)
        t["billing_cycle"] = _s(r[col["Billing Cycle"]])

    # CPA
    hdr, cpa_rows = _rows(raw["cpa"])
    col = {h.strip(): i for i, h in enumerate(hdr)}
    cpa = {r[col["Municipality"]].strip(): r for r in cpa_rows}
    for name, t in towns.items():
        r = cpa.get(name)
        t["cpa_listed"] = r is not None
        if r is None:
            for k in ("cpa_adopted", "cpa_year_adopted", "cpa_surcharge_pct",
                      "cpa_exempt_low_income_and_senior", "cpa_exempt_first_100k_residential",
                      "cpa_exempt_first_100k_commercial_industrial", "cpa_blended"):
                t[k] = None
            continue
        yr = _int(r[col["Year Adopted"]])
        pct = _s(r[col["Percent Adopted"]])
        blended = _s(r[col["Is Blended CPA"]])
        t["cpa_adopted"] = True if yr else None
        t["cpa_year_adopted"] = yr
        t["cpa_surcharge_pct"] = float(pct) if pct else None
        t["cpa_exempt_low_income_and_senior"] = True if _s(r[col["Low Income Exemption"]]) else None
        t["cpa_exempt_first_100k_residential"] = True if _s(r[col["Residential Assessed Value"]]) else None
        t["cpa_exempt_first_100k_commercial_industrial"] = (
            True if _s(r[col["Commercial Industrial Exemption"]]) else None)
        t["cpa_blended"] = {"Y": True, "N": False}.get(blended)
    extra_cpa = sorted(set(cpa) - set(towns))

    # 41A deferrals granted
    hdr, d_rows = _rows(raw["deferrals"])
    col = {h.strip(): i for i, h in enumerate(hdr)}
    by_town = {}
    fys = set()
    for r in d_rows:
        if _s(r[col["Clause"]]) != "41A":
            continue
        fy = _int(r[col["Fiscal Year"]])
        fys.add(fy)
        by_town.setdefault(r[col["Municipality"]].strip(), {})[fy] = (
            _int(r[col["# Deferrals Granted"]]), _int(r[col["Tax Dollars Deferred"]]))
    latest = max(fys) if fys else None
    for name, t in towns.items():
        d = by_town.get(name, {})
        cur = d.get(latest)
        t["deferral_41a_latest_fy"] = latest if cur else None
        t["deferral_41a_count_latest_fy"] = cur[0] if cur else None
        t["deferral_41a_dollars_latest_fy"] = cur[1] if cur else None
        t["deferral_41a_count_last5fy"] = (
            sum(v[0] or 0 for v in d.values()) if d else None)

    for name, t in towns.items():
        for k in NOT_AVAILABLE:
            t[k] = None

    odd = sorted(n for n, t in towns.items()
                 if t["clause_41c_options_on_file"] and t["elderly_exemption_clause"] != "41C")
    return towns, {"extra_in_localoptions": extra_lo, "extra_in_cpa": extra_cpa,
                   "deferral_fys": sorted(f for f in fys if f),
                   "41c_options_on_file_but_clause_not_41C": odd}


FIELDS = {
    "dor_code": "[PT] DLS 3-digit municipality code.",
    "elderly_exemption_clause": "[PT] 'Elderly Person Exemption Clause Adopted' as DLS shows it: '41C', '41B' or '41C 1/2'.",
    "elderly_exemption_clause_adopted": "[PT] its adoption date/year, raw (DLS mixes '1987' and '5/6/1987').",
    "clause_41c_adopted": "[PT] true if DLS shows Clause 41C. null otherwise (NOT proof it was not adopted).",
    "clause_41c_half_adopted": "[PT] true if DLS shows Clause 41C 1/2 (income tracks the Circuit Breaker). null otherwise.",
    "clause_41c_options_on_file": "[PT] true if any 'Clause 41C Options' column (St.2002 c.184 s.51: lower age to 65, raise amount up to +100%, raise income/asset limits) is filled. null = none on file with DLS; Methuen shows why that is NOT proof of none.",
    "clause_41c_age_on_file": "[PT] qualifying age on file (statute default 70). 0/blank -> null. Matched the town's own document in 6 of 7 spot checks.",
    "clause_41c_amount_on_file": "[PT] exemption $ on file (statute $500; option up to $1,000). STALE: matched the town's own document in only 3 of 7 spot checks. Do not show as the resident's amount.",
    "clause_41c_income_limit_single_on_file": "[PT] gross-receipts limit filed with the 41C options (single). Towns with Clause 41D (not in DLS) index this to CPI, so current limits are higher.",
    "clause_41c_income_limit_married_on_file": "[PT] same, married.",
    "clause_41c_asset_limit_single_on_file": "[PT] whole-estate limit filed with the 41C options (single). Same 41D caveat.",
    "clause_41c_asset_limit_married_on_file": "[PT] same, married.",
    "clause_41c_units_excluded_on_file": "[PT] '# of units excluded (multi-family homes only)'.",
    "clause_41c_options_raw": "[PT] the 7 raw 41C option cells (0 = item not changed), for audit.",
    "surviving_spouse_clause": "[PT] 'Surviving Spouse Exemption Clause Adopted': '17C', '17C 1/2' or '17D' (raw).",
    "surviving_spouse_clause_adopted": "[PT] its adoption date/year, raw.",
    "clause_37a_blind_adopted": "[PT] true if DLS shows a Clause 37A (blind, $500) adoption date. null otherwise.",
    "clause_37a_blind_adopted_date": "[PT] raw date.",
    "state_reimb_cap_clause17_dollars": "[PT] 'Clause 17 cap (if applicable)': the STATE REIMBURSEMENT cap for 17C/17C1/2/17D ('cannot exceed the amount reimbursed under Clause 17', DLS Cherry Sheet Manual). Not a resident benefit; do not display.",
    "state_reimb_cap_clause41_count": "[PT] 'Clause 41 Exemption Cap': NUMBER of 41B/41C exemptions the state reimburses (capped at the last Clause 41 count, Cherry Sheet Manual). Not a resident benefit; do not display.",
    "residential_exemption_pct": "[LO] residential exemption % (not senior-specific). null = not shown.",
    "senior_means_tested_exemption": "[LO] true if 'Senior Means Tested Exemption Granted' = Yes (home-rule means-tested senior exemption, e.g. Sudbury). null otherwise.",
    "billing_cycle": "[LO] 'Quarterly', 'Semi-Annual' or 'Preliminary Semi-Annual'.",
    "cpa_listed": "[CPA] true if the town appears in DLS's CPA report; false if it does not (a statement about the report).",
    "cpa_adopted": "[CPA] true if an adoption year is shown. null if not listed or listed without a year (e.g. Andover).",
    "cpa_year_adopted": "[CPA] adoption year.",
    "cpa_surcharge_pct": "[CPA] CPA surcharge percent (e.g. 3.0).",
    "cpa_exempt_low_income_and_senior": "[CPA] true if 'Low Income Exemption' adopted: G.L. c.44B s.3(e)(1), property of a person who would qualify for low-income housing or low/moderate-income senior housing. null otherwise.",
    "cpa_exempt_first_100k_residential": "[CPA] true if 'Residential Assessed Value' ($100,000 of residential value exempt from the surcharge) adopted. null otherwise.",
    "cpa_exempt_first_100k_commercial_industrial": "[CPA] true if the commercial/industrial exemption is adopted. null otherwise.",
    "cpa_blended": "[CPA] 'Is Blended CPA' Y/N.",
    "deferral_41a_latest_fy": "[DEF] fiscal year the two fields below describe (the latest FY in the report).",
    "deferral_41a_count_latest_fy": "[DEF] Clause 41A deferrals granted that FY, as reported to DLS. 41A deferral exists in every town by statute; 0 means none granted, not 'unavailable'.",
    "deferral_41a_dollars_latest_fy": "[DEF] tax dollars deferred that FY.",
    "deferral_41a_count_last5fy": "[DEF] total 41A deferrals granted over the latest 5 FYs reported.",
}
FIELDS.update({k: "NOT IN ANY PUBLIC DLS REPORT -- null for every town. " + v
               for k, v in NOT_AVAILABLE.items()})


def controls(towns):
    """Positive controls: facts known to be true that the extraction MUST show."""
    fails = []
    def need(cond, msg):
        if not cond:
            fails.append(msg)
    need(len(towns) == 351, f"expected 351 municipalities, got {len(towns)}")
    b, m, s = towns.get("Boston", {}), towns.get("Methuen", {}), towns.get("Sudbury", {})
    need(b.get("residential_exemption_pct"), "Boston residential exemption not seen")
    need(m.get("clause_41c_adopted") is True, "Methuen Clause 41C not seen")
    need(s.get("senior_means_tested_exemption") is True, "Sudbury means-tested exemption not seen")
    need(b.get("cpa_adopted") is True, "Boston CPA not seen")
    need(b.get("deferral_41a_count_latest_fy") is not None, "Boston 41A deferral row not seen")
    return fails


def coverage(towns):
    out = {}
    for f in FIELDS:
        vals = [t.get(f) for t in towns.values()]
        out[f] = {"non_null": sum(v is not None for v in vals),
                  "true": sum(v is True for v in vals),
                  "false": sum(v is False for v in vals)}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--cache-dir", help="save raw CSVs + meta here")
    ap.add_argument("--from-cache", help="rebuild from a previous --cache-dir (no network)")
    ap.add_argument("--delay", type=float, default=5.0, help="seconds between requests")
    a = ap.parse_args()
    fetched = dt.date.today().isoformat()

    raw, as_of = {}, {}
    if a.from_cache:
        meta = json.load(open(os.path.join(a.from_cache, "meta.json")))
        fetched, as_of = meta["fetched"], meta["as_of"]
        for k in REPORTS:
            raw[k] = open(os.path.join(a.from_cache, k + ".csv"), encoding="utf-8").read()
    else:
        try:
            for i, k in enumerate(REPORTS):
                if i:
                    time.sleep(a.delay)
                print(f"fetching {k} ...", flush=True)
                raw[k], as_of[k] = fetch_report(k, a.delay)
                print(f"  {k}: {raw[k].count(chr(10))} lines, data current as of {as_of[k]}")
        except CouldNotMeasure as e:
            print(f"COULD NOT MEASURE -- nothing written.\n  {e}", file=sys.stderr)
            return 3
        if a.cache_dir:
            os.makedirs(a.cache_dir, exist_ok=True)
            for k, v in raw.items():
                open(os.path.join(a.cache_dir, k + ".csv"), "w", encoding="utf-8").write(v)
            json.dump({"fetched": fetched, "as_of": as_of},
                      open(os.path.join(a.cache_dir, "meta.json"), "w"), indent=1)

    towns, extras = build(raw, as_of, fetched)
    fails = controls(towns)
    if fails:
        print("POSITIVE CONTROL FAILED -- extraction is wrong, nothing written:", file=sys.stderr)
        for f in fails:
            print("  -", f, file=sys.stderr)
        return 2

    cov = coverage(towns)
    n = len(towns)
    for f, c in cov.items():
        # by design: identifiers, the not-in-DLS fields (always null), and
        # deferral counts (DLS lists every town, 0 = none granted)
        if f in NOT_AVAILABLE or f in ("dor_code", "billing_cycle", "cpa_listed") \
                or f.startswith("deferral_41a_"):
            continue
        if c["non_null"] in (0, n):
            print(f"WARN {f}: {c['non_null']}/{n} non-null -- check the instrument")
    pos = sum(1 for t in towns.values() if (t["deferral_41a_count_last5fy"] or 0) > 0)
    print(f"towns with >0 Clause 41A deferrals in last 5 FY: {pos}/{n}")
    if pos in (0, n):
        print("WARN deferral counts are 0% or 100% -- check the instrument")

    doc = {
        "source": {
            "publisher": "Massachusetts Department of Revenue, Division of Local Services, Data Analytics and Resources Bureau (databank@dor.state.ma.us)",
            "reports": {k: {"title": v["title"],
                            "url": BASE + "rdPage.aspx?rdReport=" + v["page"],
                            "data_current_as_of": as_of.get(k)} for k, v in REPORTS.items()},
            "method": "Logi report CSV export (rdReportFormat=CSV) with all municipalities selected; tools/build_town_tax_options.py",
            "tags": "[PT]=propertytax [LO]=localoptions [CPA]=cpa [DEF]=deferrals",
        },
        "fetched": fetched,
        "as_of": ("Each DLS report prints 'Data current as of <date>' = "
                  + ", ".join(f"{k} {v}" for k, v in as_of.items())
                  + ". That appears to be the page-render date, not a data vintage; "
                  "the underlying records are whatever towns have filed with DLS."),
        "caveats": [
            "null means the source does not show it -- never read null as 'not adopted'.",
            "The Adopted Local Options report says: 'This information is self-reported and only shows the current unexpired data'.",
            "41C option values (*_on_file) are what the town filed with DLS and are often stale; see spot_checks. Methuen (age 65, $1,000) shows NO 41C options in DLS.",
            "Senior work-off (5K), veterans work-off (5N), 5C1/2 additional exemption, 41D CPI indexing, 41A local income limit/interest rate, 17D COLA, 22 increases and c.60 s.3D funds are NOT in any public DLS report.",
            "Devens appears in two DLS reports but is not one of the 351 municipalities; excluded.",
        ],
        "spot_checks": SPOT_CHECKS,
        "fields": FIELDS,
        "not_available_from_dls": NOT_AVAILABLE,
        "coverage": cov,
        "build_notes": extras,
        "towns": dict(sorted(towns.items())),
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, a.out)
    print(f"wrote {a.out}: {len(towns)} municipalities")
    return 0


if __name__ == "__main__":
    sys.exit(main())
