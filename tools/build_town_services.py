#!/usr/bin/env python3
"""
build_town_services.py -- regenerate data/town_services.json

A town-by-town directory of WHERE a Massachusetts resident applies for the
town-dependent senior programs, for all 351 municipalities, built ONLY from
official / agency-published sources. Nothing is filled from memory: a value is
either parsed from a source below or it is null.

RUN (from the repo root):

    uv run --with curl_cffi python3 tools/build_town_services.py

  mass.gov answers some datacenter/VPN addresses with 403 "Not allowed" or
  stalled bodies. If that happens, re-run from a residential connection.

  Options: --out PATH, --cache-dir DIR, --no-cache, --delay SECONDS (default 3.5).
  Responses are cached per day in ~/.cache/benefighter-town-services/<date>/ so a
  re-run the same day resumes instead of re-fetching 351 locator pages.
  Exit code: 0 = built and all positive controls passed; 1 = built but a control
  or a coverage floor failed (JSON still written, see "qa"); 2 = a required source
  could not be fetched (nothing written).

SOURCES (all fetched sequentially, one request at a time, >= --delay apart):

  towns  Canonical 351 names + DOR codes: DLS Gateway "Property Tax Exemption
         Clauses Adopted" report (municipality selector)
         https://dls-gw.dor.state.ma.us/reports/rdpage.aspx?rdreport=localoptions.propertytax

  fuel   EOHLC "Resource Locator By Community" (the HEAP provider locator that
         mass.gov links from "Apply for Home Energy Assistance (HEAP)"):
         https://hedfuel.azurewebsites.net/  -- ASP.NET postback, one per town;
         we read the "Fuel Assistance / LIHEAP" row (name, address, phones).
         Referenced from https://www.mass.gov/how-to/apply-for-home-energy-assistance-heap
         The locator publishes NO websites. fuel.url comes from the agency list on
         page 3 of EOHLC's "FY 2026 Cold Relief Brochure" (an image in the PDF, so the
         23 addresses are transcribed in FUEL_AGENCY_SITES below, matched to the
         locator's agency name, and each one is fetched at build time; the result is
         recorded as fuel.url_check):
         https://www.mass.gov/doc/fy-2026-cold-relief-brochure-0/download

  asap   MassGIS / Executive Office of Aging & Independence feature service
         behind mass.gov's ASAP map (one polygon per town / Boston neighborhood):
         https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/ASAP_Shared_Web_Map_WFL1/FeatureServer/0
         Cross-checked against the list on
         https://www.mass.gov/info-details/find-your-regional-aging-services-access-point-asap

  coa    Massachusetts Councils on Aging (MCOA) statewide directory:
         https://mcoaonline.org/coa-directory/
         Cross-checked against the AGE "Councils on Aging" layer embedded in
         https://www.mass.gov/info-details/find-your-local-council-on-aging :
         https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/Councils_on_Aging/MapServer/0
         (That layer truncates multi-word town names to the first word -- "West",
         "New", "North" -- and has at least one record carrying another town's
         phone/address, so it is used only to confirm phones and to supply a
         website when MCOA has none AND both sources agree on the phone.)

  shine  mass.gov "Find a SHINE Counselor Near You" towns-by-regional-office CSV
         (the CSV link is discovered from the page each run, since its path is dated):
         https://www.mass.gov/info-details/find-a-shine-counselor-near-you

  rta    mass.gov / MassDOT "Public transportation in Massachusetts" -- RTA member
         cities and towns table, plus the MBTA THE RIDE service-area sentences:
         https://www.mass.gov/info-details/public-transportation-in-massachusetts

  cpa    DLS Gateway "Local Option CPA" report (CSV export) -- the report mass.gov's
         Community Preservation Act page calls "Report showing all communities that
         have adopted the CPA":
         https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=Local_Option_CPA
         plus MassGIS "CPA Towns by Year Adopted" for the ballot election date:
         https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/CPA_Towns_by_year_adopted/MapServer/0

VALUE CONVENTIONS (three states, never two):
  null      -> the source does not cover this town, or it could not be fetched
               (which one is recorded under qa.unmeasured / qa.not_in_source)
  []        -> rta only: the source's complete member list does not include the town
  adopted:false -> cpa only: the town is absent from DLS's complete adopted list

Name variants seen in sources are mapped to DLS spelling through the explicit
ALIASES table below; every alias use is recorded in qa.alias_uses.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import html as htmllib
import io
import json
import os
import re
import sys
import time
from pathlib import Path

try:
    from curl_cffi import requests as cffi_requests
except ImportError:  # pragma: no cover
    sys.exit("curl_cffi is required: uv run --with curl_cffi python3 tools/build_town_services.py")

# --------------------------------------------------------------------------- #
# Source URLs
# --------------------------------------------------------------------------- #
URL_DLS_TOWNS = "https://dls-gw.dor.state.ma.us/reports/rdpage.aspx?rdreport=localoptions.propertytax"
URL_HED = "https://hedfuel.azurewebsites.net/"
URL_HEAP_PAGE = "https://www.mass.gov/how-to/apply-for-home-energy-assistance-heap"
URL_ASAP_LAYER = ("https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/"
                  "ASAP_Shared_Web_Map_WFL1/FeatureServer/0")
URL_ASAP_PAGE = "https://www.mass.gov/info-details/find-your-regional-aging-services-access-point-asap"
URL_MCOA = "https://mcoaonline.org/coa-directory/"
URL_COA_PAGE = "https://www.mass.gov/info-details/find-your-local-council-on-aging"
URL_COA_LAYER = ("https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/"
                 "Councils_on_Aging/MapServer/0")
URL_SHINE_PAGE = "https://www.mass.gov/info-details/find-a-shine-counselor-near-you"
URL_RTA_PAGE = "https://www.mass.gov/info-details/public-transportation-in-massachusetts"
URL_DLS_CPA = "https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=Local_Option_CPA"
URL_DLS_CPA_CSV = ("https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=LocalOptions.Local_Option_CPA"
                   "&rdReportFormat=CSV&rdExportTableID=TblLocalOptionsCPA&rdExportFilename=LocalOptionsCPA")
URL_CPA_LAYER = ("https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/"
                 "CPA_Towns_by_year_adopted/MapServer/0")

# Spelling variants used by the sources -> DLS spelling. Keys are lower-case.
ALIASES = {
    "manchester-by-the-sea": "Manchester By The Sea",
    "manchester": "Manchester By The Sea",     # ASAP + AGE COA layers
    "tyngsboro": "Tyngsborough",               # mass.gov ASAP list
    "attleborough": "Attleboro",               # mass.gov ASAP list
    "north attleboro": "North Attleborough",   # mass.gov RTA table
    "merrimack": "Merrimac",                   # mass.gov ASAP list
    "gay head": "Aquinnah",                    # mass.gov ASAP list (former name)
    "lunenberg": "Lunenburg",                  # SHINE CSV
    "leydon": "Leyden",                        # MCOA directory
}

# Positive controls: must resolve, or the build is flagged (exit 1).
CONTROLS = {
    "Methuen": {"fuel": True, "asap": True},
    "Ashland": {"fuel": True, "asap": True},
    "Boston": {"fuel_contains": "Action for Boston Community Development", "asap_min": 2},
}
# EOHLC FY 2026 Cold Relief Brochure, p.3 "Energy Assistance Agencies" -- websites as
# printed (the brochure omits the scheme). (brochure no., regex on locator name, site)
FUEL_AGENCY_SITES = [
    ("1a/1b", r"Action for Boston Community Development|\(ABCD", "www.bostonabcd.org"),
    ("2", r"^Action,? Inc", "www.actioninc.org"),
    ("3", r"Berkshire Community Action|\(BCAC\)", "www.bcacinc.org"),
    ("4", r"^Community Action,? Inc|\(CAI\)", "www.communityactioninc.org"),
    ("5", r"City of Cambridge", "www.cambridgema.gov/DHSP"),
    ("6", r"Inter-?City|\(CAPIC\)", "www.capicinc.org"),
    ("7", r"Citizens for Citizens|\(CFC\)", "www.cfcinc.org"),
    ("8", r"Community Teamwork|\(CTI\)", "www.commteam.org"),
    ("9", r"Community Action Pioneer Valley", "www.communityaction.us"),
    ("10", r"Greater Lawrence Community Action|\(GLCAC\)", "www.glcac.org"),
    ("11", r"Housing Assistance Corporation|\(HAC\)", "www.haconcapecod.org"),
    ("12", r"^LEO\b|Lynn Economic Opportunity", "www.leoinc.org"),
    ("13", r"Making Opportunity Count|\(MOC\)", "www.mocinc.org"),
    ("14", r"North Shore Community Action|\(NSCAP\)", "www.nscap.org"),
    ("15", r"People Acting in Community|\(PACE\)", "www.paceinfo.org"),
    ("16", r"Quincy Community Action|\(QCAP\)", "www.qcap.org"),
    ("17", r"Springfield Partners|\(SPCA\)", "www.springfieldpartnersinc.com"),
    ("18", r"^Self Help|\(SHI\)", "www.selfhelpinc.org"),
    ("19", r"South Middlesex Opportunity|\(SMOC\)", "www.smoc.org"),
    ("20", r"City of Springfield", "www.springfield-ma.gov"),
    ("21", r"South Shore Community Action|\(SSCAC\)", "www.sscac.org"),
    ("22", r"Valley Opportunity Council|\(VOC\)", "www.valleyopp.com"),
    ("23", r"Worcester Community Action|\(WCAC\)", "www.wcac.net"),
]
URL_COLD_RELIEF = "https://www.mass.gov/doc/fy-2026-cold-relief-brochure-0/download"
COVERAGE_FLOOR = 0.90   # any of fuel/asap/coa/shine/cpa below this share -> exit 1


class FetchError(RuntimeError):
    pass


# --------------------------------------------------------------------------- #
# Polite, cached, sequential fetcher
# --------------------------------------------------------------------------- #
class Fetcher:
    def __init__(self, cache_dir: Path | None, delay: float):
        self.s = cffi_requests.Session(impersonate="chrome")
        self.cache_dir = cache_dir
        self.delay = delay
        self._last = 0.0
        self.log: list[dict] = []
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def _key(self, method: str, url: str, data) -> Path | None:
        if not self.cache_dir:
            return None
        h = hashlib.sha1(f"{method} {url} {json.dumps(data, sort_keys=True, default=str)}".encode()).hexdigest()
        return self.cache_dir / h

    def _wait(self):
        gap = time.monotonic() - self._last
        if gap < self.delay:
            time.sleep(self.delay - gap)

    def fetch(self, url: str, method: str = "GET", data=None, cache: bool = True,
              expect: str | None = None, session=None) -> bytes:
        """Return body bytes for a 200 response, else raise FetchError.
        `expect` is a substring the body must contain (guards against a 200 that
        is really a block page)."""
        key = self._key(method, url, data) if cache else None
        if key and key.exists():
            body = key.read_bytes()
            self.log.append({"url": url, "method": method, "status": "cache", "bytes": len(body)})
            return body
        sess = session or self.s
        last_err = None
        for attempt, backoff in enumerate((0, 10, 30)):
            if backoff:
                time.sleep(backoff)
            self._wait()
            try:
                if method == "POST":
                    r = sess.post(url, data=data, timeout=90)
                else:
                    r = sess.get(url, timeout=90)
                self._last = time.monotonic()
            except Exception as e:  # timeout / connection
                self._last = time.monotonic()
                last_err = f"{type(e).__name__}: {str(e)[:160]}"
                self.log.append({"url": url, "method": method, "status": "error", "error": last_err})
                continue
            body = r.content
            self.log.append({"url": url, "method": method, "status": r.status_code, "bytes": len(body)})
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}"
                continue
            if expect and expect.encode() not in body:
                last_err = f"HTTP 200 but body lacks {expect!r} ({len(body)} bytes)"
                continue
            if key:
                key.write_bytes(body)
            return body
        raise FetchError(f"{method} {url}: {last_err}")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def text_of(fragment: str) -> str:
    t = re.sub(r"<[^>]+>", " ", fragment)
    return re.sub(r"\s+", " ", htmllib.unescape(t)).strip()


def digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")[:10]


def norm_org(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower().replace("&", "and").replace(", inc", "").replace(" inc", ""))


def norm_url(u: str | None) -> str:
    return re.sub(r"^(https?://)?(www\.)?", "", (u or "").strip().lower()).rstrip("/")


class Resolver:
    """Map a source's spelling of a place to the DLS municipality name."""

    def __init__(self, names: list[str]):
        self.names = names
        self.by_lower = {n.lower(): n for n in names}
        self.alias_uses: dict[str, str] = {}

    def __call__(self, raw: str | None) -> str | None:
        if not raw:
            return None
        k = re.sub(r"\s+", " ", raw.replace("\xa0", " ")).strip().lower()
        if k in self.by_lower:
            return self.by_lower[k]
        if k in ALIASES:
            self.alias_uses[raw.strip()] = ALIASES[k]
            return ALIASES[k]
        return None


# --------------------------------------------------------------------------- #
# Source loaders
# --------------------------------------------------------------------------- #
def load_dls_towns(F: Fetcher) -> list[tuple[str, str]]:
    s = F.fetch(URL_DLS_TOWNS, expect="iclMuni").decode("utf-8", "replace")
    pairs = re.findall(r'name="iclMuni"[^>]*value="(\d+)"\s*/><span>([^<]+)</span>', s)
    pairs = [(c, n.strip()) for c, n in pairs]
    if len(pairs) != 351 or len({n for _, n in pairs}) != 351:
        raise FetchError(f"DLS municipality list parsed {len(pairs)} entries, expected 351")
    return pairs


def _hed_hidden(page: str) -> dict:
    return dict(re.findall(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"', page))


def parse_hed_fuel(page: str) -> list[dict] | None:
    """Return the Fuel Assistance / LIHEAP entries on a locator result page, or
    None if the section is absent (-> could not measure)."""
    page = re.sub(r"(?s)<!--.*?-->", "", page)       # the page ships commented-out duplicates
    i = page.find('id="ctl00_MainContent_lblFAL"')
    if i < 0:
        return None
    sec = page[i:page.find("</table>", i)]
    items: dict[tuple, dict] = {}
    for rep, ctl, fld, val in re.findall(
            r'id="ctl00_MainContent_(Repeater\d+)_(ctl\d+)_lbl(\w+)"[^>]*>(.*?)</span>', sec, re.S):
        items.setdefault((rep, ctl), {})[fld] = text_of(val)
    out = []
    for it in items.values():
        name = it.get("Firm") or ""
        if not name:
            continue
        phones = [it[k] for k in sorted(it) if k.startswith("Phone") and it[k]]
        addr_parts = [it.get("Firm2"), it.get("Address1"), it.get("Address2")]
        street = ", ".join(p for p in addr_parts if p)
        city_line = " ".join(p for p in [(it.get("Town") or "") + ",", it.get("State") or "", it.get("Zip") or ""] if p.strip(", "))
        m = re.match(r"^\s*([\d()\-.\s]{10,16}\d)", phones[0]) if phones else None
        out.append({
            "agency": name,
            "phone": m.group(1).strip() if m else (phones[0] if phones else None),
            "phones": phones,
            "address": ", ".join(p for p in [street, city_line.strip()] if p) or None,
            "url": None,
        })
    return out


def load_fuel(F: Fetcher, towns: list[str], R: "Resolver") -> tuple[dict, dict]:
    """Returns ({town: [entries]} , {town: reason}) -- second dict = unmeasured."""
    sess = cffi_requests.Session(impersonate="chrome")
    first = F.fetch(URL_HED, cache=False, expect="lstTown", session=sess).decode("utf-8", "replace")
    opts = re.findall(r'<option(?: selected="selected")? value="(-?\d+)">([^<]+)</option>', first)
    name2id = {R(htmllib.unescape(n)): v for v, n in opts if v != "-1"}
    name2id.pop(None, None)
    missing = [t for t in towns if t not in name2id]
    n_opts = sum(1 for v, _ in opts if v != "-1")
    if n_opts != 351 or missing:
        raise FetchError(f"HED locator lists {n_opts} communities; DLS names absent: {missing}")
    page = first
    result, unmeasured = {}, {}
    for n, town in enumerate(towns, 1):
        body, err = None, None
        key = F._key("POST", URL_HED, {"town": town})   # cache on the town, not the viewstate
        if key and key.exists():
            body = key.read_text("utf-8", "replace")
        else:
            for attempt in range(2):
                data = dict(_hed_hidden(page))
                data["__EVENTTARGET"] = "ctl00$MainContent$lstTown"
                data["__EVENTARGUMENT"] = ""
                data["ctl00$MainContent$lstTown"] = name2id[town]
                try:
                    body = F.fetch(URL_HED, method="POST", data=data, cache=False,
                                   expect="lstTown", session=sess).decode("utf-8", "replace")
                    break
                except FetchError as e:
                    err, body = str(e), None
                    # viewstate may have gone stale: fresh session + fresh form, retry once
                    sess = cffi_requests.Session(impersonate="chrome")
                    try:
                        page = F.fetch(URL_HED, cache=False, expect="lstTown", session=sess).decode("utf-8", "replace")
                    except FetchError:
                        pass
        if body is None:
            unmeasured[town] = err or "no response"
            continue
        sel = re.search(r'<option selected="selected" value="(-?\d+)">', body)
        if not sel or sel.group(1) != name2id[town]:
            unmeasured[town] = "locator response did not echo the requested town"
            continue
        entries = parse_hed_fuel(body)
        if entries is None:
            unmeasured[town] = "locator page had no Fuel Assistance / LIHEAP section"
            continue
        if key and not key.exists():
            key.write_text(body, "utf-8")
        result[town] = entries
        page = body
        if n % 25 == 0:
            print(f"  fuel: {n}/{len(towns)}", file=sys.stderr, flush=True)
    return result, unmeasured


def arcgis_all(F: Fetcher, layer_url: str, fields: str = "*") -> list[dict]:
    feats, offset = [], 0
    while True:
        q = (f"{layer_url}/query?where=1%3D1&outFields={fields}&returnGeometry=false"
             f"&resultOffset={offset}&resultRecordCount=1000&orderByFields=OBJECTID&f=json")
        d = json.loads(F.fetch(q, expect="features"))
        if "error" in d:
            raise FetchError(f"{layer_url}: {d['error']}")
        batch = [f["attributes"] for f in d.get("features", [])]
        feats += batch
        if not d.get("exceededTransferLimit") or not batch:
            return feats
        offset += len(batch)


def load_asap_page(F: Fetcher) -> list[dict]:
    s = F.fetch(URL_ASAP_PAGE, expect="Areas served").decode("utf-8", "replace")
    blocks = re.split(r'<h3 id="\d+-[^"]*">', s)[1:]
    out = []
    phone_re = re.compile(r"\(?\d{3}\)?[\s.-]*\d{3}\s*-\s*\d{4}")
    for b in blocks:
        name = re.sub(r"^\d+\.\s*", "", text_of(b[:b.find("</h3>")]))
        areas_m = re.search(r"Areas served:\s*</strong>\s*(.*?)</p>", b, re.S)
        if not areas_m:
            continue
        href = re.search(r'Web:.*?href="([^"]+)"', b, re.S)
        paras = [text_of(re.sub(r"(?i)<br\s*/?>", ", ", p))
                 for p in re.findall(r"(?s)<p[^>]*>(.*?)</p>", b[:areas_m.start()])]
        paras = [p for p in paras if p and not p.startswith("Web:")]
        phones = [re.sub(r"\s*-\s*", "-", m) for p in paras for m in phone_re.findall(p)]
        addr = ", ".join(p for p in paras if not phone_re.search(p))
        areas_txt = text_of(areas_m.group(1))
        boston_nbhd = areas_txt.lower().startswith("boston neighborhoods of")
        areas_txt = re.sub(r"(?i)^boston neighborhoods of\s*", "", areas_txt)
        out.append({"name": name, "url": href.group(1) if href else None,
                    "phone": phones[0] if phones else None, "address": addr or None,
                    "boston_neighborhoods": boston_nbhd,
                    "areas": [a.strip() for a in re.split(r",\s*|\s+and\s+", areas_txt) if a.strip()]})
    if len(out) < 20:
        raise FetchError(f"mass.gov ASAP page parsed only {len(out)} ASAP blocks")
    return out


def load_mcoa(F: Fetcher) -> list[dict]:
    s = F.fetch(URL_MCOA, expect="TELEPHONE").decode("utf-8", "replace")
    tables = re.findall(r"(?s)<table.*?</table>", s)
    if not tables:
        raise FetchError("MCOA directory: no table")
    rows = re.findall(r"(?s)<tr[^>]*>(.*?)</tr>", max(tables, key=len))
    header = [text_of(c) for c in re.findall(r"(?s)<t[dh][^>]*>(.*?)</t[dh]>", rows[0])]
    want = ["REGION", "COA", "TOWN", "ADDRESS", "CITY", "ST", "ZIP", "TELEPHONE", "WEBSITE"]
    if header != want:
        raise FetchError(f"MCOA directory header changed: {header}")
    out = []
    for r in rows[1:]:
        cells = re.findall(r"(?s)<t[dh][^>]*>(.*?)</t[dh]>", r)
        if len(cells) != 9:
            continue
        vals = [text_of(c) for c in cells]
        href = re.search(r'href="([^"]+)"', cells[8])
        rec = dict(zip(want, vals))
        web = href.group(1) if href else rec["WEBSITE"]
        rec["WEBSITE"] = web if web and re.match(r"(?i)^(https?://|www\.)", web) else None
        out.append(rec)
    return out


def load_shine(F: Fetcher) -> tuple[str, list[dict]]:
    s = F.fetch(URL_SHINE_PAGE, expect="SHINE").decode("utf-8", "replace")
    m = re.search(r'href="(https://www\.mass\.gov/files/csv/[^"]+\.csv)"', s)
    if not m:
        raise FetchError("SHINE page: no CSV link found")
    csv_url = htmllib.unescape(m.group(1))
    body = F.fetch(csv_url, expect="SHINE Regional Office").decode("utf-8-sig", "replace")
    rows = list(csv.DictReader(io.StringIO(body)))
    if not rows or set(rows[0]) != {"City or Town", "Phone", "SHINE Regional Office"}:
        raise FetchError(f"SHINE CSV columns changed: {list(rows[0]) if rows else None}")
    return csv_url, rows


def load_rta(F: Fetcher) -> tuple[list[dict], dict]:
    s = F.fetch(URL_RTA_PAGE, expect="Member Cities and Towns").decode("utf-8", "replace")
    i = s.find("Member Cities and Towns")
    t = s[s.rfind("<table", 0, i):s.find("</table>", i)]
    rtas = []
    for row in re.findall(r"(?s)<tr[^>]*>(.*?)</tr>", t):
        tds = re.findall(r"(?s)<td[^>]*>(.*?)</td>", row)
        if len(tds) != 2:
            continue
        paras = [text_of(p) for p in re.findall(r"(?s)<p[^>]*>(.*?)</p>", tds[0])] or [text_of(tds[0])]
        href = re.search(r'href="([^"]+)"', tds[0])
        name = paras[0]
        abbr = re.search(r"\(([A-Za-z]+)\)\s*$", name)
        phones = [p for p in paras[1:] if re.search(r"\d{3}.*\d{4}|WRTA", p) and "www" not in p.lower()]
        members_txt = re.sub(r"\([^)]*\)", "", text_of(tds[1]))
        rtas.append({"name": name, "abbr": abbr.group(1) if abbr else None,
                     "url": href.group(1) if href else None,
                     "phone": "; ".join(phones) or None,
                     "members_raw": [m.strip() for m in members_txt.split(",") if m.strip()]})
    if len(rtas) != 15:
        raise FetchError(f"RTA table parsed {len(rtas)} authorities, expected 15")
    page_txt = text_of(s)
    ride = {}
    m = re.search(r"Service area - (.*?)\s+In addition, partial RIDE coverage is available in (.*?)\s+The RIDE", page_txt)
    if m:
        ride = {"full": [x.strip() for x in re.split(r",\s*(?:and\s+)?", m.group(1)) if x.strip()],
                "partial": [x.strip() for x in re.split(r",\s*(?:and\s+)?", m.group(2)) if x.strip()]}
    return rtas, ride


def load_cpa(F: Fetcher, dls_names: list[str]) -> list[dict]:
    # The CSV export is a POST carrying the municipality selection, like the page's Export button.
    F.fetch(URL_DLS_CPA, cache=False, expect="iclMuni")
    body = F.fetch(URL_DLS_CPA_CSV, method="POST", data=[("iclMuni", ",".join(dls_names))],
                   expect="Year Adopted").decode("utf-8-sig", "replace")
    rows = list(csv.DictReader(io.StringIO(body)))
    if not rows or "Municipality" not in rows[0]:
        raise FetchError("DLS CPA CSV: unexpected columns")
    return rows


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def build(F: Fetcher) -> tuple[dict, int]:
    today = dt.date.today().isoformat()
    sources: dict[str, dict] = {}
    qa: dict = {"unmeasured": {}, "not_in_source": {}, "cross_checks": {}, "notes": []}

    dls = load_dls_towns(F)
    names = [n for _, n in dls]
    code = {n: c for c, n in dls}
    R = Resolver(names)
    sources["towns"] = {"url": URL_DLS_TOWNS, "publisher": "MA DOR Division of Local Services", "records": len(dls)}
    towns = {n: {"dor_code": code[n], "fuel": None, "asap": None, "coa": None, "shine": None,
                 "rta": None, "mbta_the_ride": None, "cpa": None} for n in names}

    # ---------------- ASAP (MassGIS layer, per-town polygons) ---------------
    asap_page = load_asap_page(F)
    boston_nbhds = {a.lower() for blk in asap_page if blk["boston_neighborhoods"] for a in blk["areas"]} - {"boston"}
    feats = arcgis_all(F, URL_ASAP_LAYER)
    sources["asap"] = {"url": URL_ASAP_LAYER, "page": URL_ASAP_PAGE,
                       "publisher": "Executive Office of Aging & Independence / MassGIS", "records": len(feats)}
    asap_by_town: dict[str, dict[str, dict]] = {}
    unplaced = []
    for f in feats:
        area = (f.get("AREAS_SERVED") or "").strip()
        town = R(area)
        nbhd = None
        if town is None and area.lower() in boston_nbhds:
            town, nbhd = "Boston", area
        if town is None:
            unplaced.append(area)
            continue
        if town == "Boston" and nbhd is None:
            nbhd = "Boston"
        name = (f.get("AGING_SERVICES_ACCESS_POINT") or "").strip()
        rec = asap_by_town.setdefault(town, {}).setdefault(name, {
            "name": name, "phone": (f.get("ASAP_PHONE_NUMBER") or "").strip() or None,
            "url": (f.get("ASAP_WEBSITE") or "").strip() or None,
            "address": (f.get("ASAP_ADDRESS") or "").strip() or None})
        if nbhd:
            rec.setdefault("areas", []).append(nbhd)
    # Contact details: prefer the mass.gov page (the human-facing list) when the
    # organisation matches; the layer supplies the town assignment. Differences
    # between the two are reported, not silently merged.
    page_by_org = {norm_org(b["name"]): b for b in asap_page}
    contact_diffs = {}
    for town, recs in asap_by_town.items():
        lst = sorted(recs.values(), key=lambda r: r["name"])
        for r in lst:
            if "areas" in r:
                r["areas"] = sorted(set(r["areas"]))
            pg = page_by_org.get(norm_org(r["name"]))
            if not pg:
                continue
            for fld in ("phone", "address", "url"):
                lv, pv = r.get(fld), pg.get(fld)
                if pv and lv != pv:
                    same = {"phone": digits, "url": norm_url}.get(fld, norm_org)(lv) == \
                           {"phone": digits, "url": norm_url}.get(fld, norm_org)(pv)
                    if not same:
                        contact_diffs.setdefault(r["name"], {})[fld] = {"layer": lv, "page": pv}
                    r[fld] = pv
            r["contact_source"] = "mass.gov ASAP page"
        towns[town]["asap"] = lst
    qa["cross_checks"]["asap_contact_layer_vs_page"] = contact_diffs
    qa["notes"].append(f"ASAP layer features not mapped to a municipality (villages, ignored): {sorted(unplaced)}")
    # cross-check vs mass.gov page list
    page_map: dict[str, set] = {}
    for blk in asap_page:
        for a in blk["areas"]:
            t = R(a) or ("Boston" if a.lower() in boston_nbhds else None)
            if t:
                page_map.setdefault(t, set()).add(norm_org(blk["name"]))
    agree = disagree = 0
    diffs = []
    for t in names:
        gis = {norm_org(r["name"]) for r in (towns[t]["asap"] or [])}
        pg = page_map.get(t, set())
        if not gis or not pg:
            if gis or pg:
                diffs.append({"town": t, "layer": sorted(gis), "page": sorted(pg)})
            continue
        if gis == pg:
            agree += 1
        else:
            disagree += 1
            diffs.append({"town": t, "layer": sorted(gis), "page": sorted(pg)})
    qa["cross_checks"]["asap_layer_vs_massgov_page"] = {"agree": agree, "disagree": disagree, "diffs": diffs}

    # ---------------- COA (MCOA directory, AGE layer cross-check) ----------
    mcoa = load_mcoa(F)
    sources["coa"] = {"url": URL_MCOA, "publisher": "Massachusetts Councils on Aging (MCOA)", "records": len(mcoa),
                      "cross_check": URL_COA_LAYER, "cross_check_page": URL_COA_PAGE}
    unplaced = []
    for r in mcoa:
        t = R(r["TOWN"])
        if t is None:
            unplaced.append(r["TOWN"])
            continue
        addr = ", ".join(p for p in [r["ADDRESS"], " ".join(x for x in [r["CITY"] + ",", r["ST"], r["ZIP"]] if x.strip(", "))] if p.strip(", "))
        towns[t]["coa"] = {"name": r["COA"] or None, "phone": r["TELEPHONE"] or None,
                           "address": addr or None, "url": r["WEBSITE"], "url_source": "MCOA" if r["WEBSITE"] else None}
    if unplaced:
        qa["notes"].append(f"MCOA rows not mapped to a municipality: {unplaced}")
    age = arcgis_all(F, URL_COA_LAYER)
    sources["coa"]["cross_check_records"] = len(age)

    def age_towns(a: dict) -> list[str]:
        reg = (a.get("REGION_SERVED") or "").strip()
        t = R(reg)
        if t:
            return [t]
        if reg.lower() in boston_nbhds or any(R(p) is None and p.lower() in boston_nbhds for p in re.split(r",\s*", reg)):
            return ["Boston"]
        parts = [p for p in re.split(r",\s*(?:and\s+)?|\s+and\s+", reg) if p]
        if len(parts) > 1 and all(R(p) for p in parts):
            return [R(p) for p in parts]
        loc = re.sub(r"(?i)\s*(senior center|council on aging|coa)\s*$", "", (a.get("LOCATION_NAME") or "").strip())
        if R(loc) and R(loc).lower().startswith(reg.lower()):   # truncated region ("West") + full name in LOCATION_NAME
            return [R(loc)]
        hy = [R(p) for p in loc.split("-")]
        if len(hy) > 1 and all(hy):
            return hy
        return []

    by_town_age: dict[str, list[dict]] = {}
    unresolved = []
    for a in age:
        ts = age_towns(a)
        if not ts:
            unresolved.append(a.get("LOCATION_NAME"))
        for t in ts:
            by_town_age.setdefault(t, []).append(a)
    # An AGE record whose phone is another town's MCOA phone is misattributed
    # (e.g. a "New Marlborough" point carrying Marlborough's phone and address).
    agency_phone = {digits(b["phone"]): b["name"] for b in asap_page if digits(b["phone"])}
    mcoa_phone_owner: dict[str, set] = {}      # regional COAs legitimately share one number
    for t in names:
        if towns[t]["coa"] and digits(towns[t]["coa"]["phone"]):
            mcoa_phone_owner.setdefault(digits(towns[t]["coa"]["phone"]), set()).add(t)

    def age_loc(a: dict) -> dict:
        return {"name": (a.get("LOCATION_NAME") or "").strip(),
                "phone": (a.get("PHONE_NUMBER") or "").strip() or None,
                "address": ", ".join(x for x in [(a.get("ADDRESS") or "").strip(), (a.get("CITY") or "").strip()] if x) or None,
                "url": (a.get("WEBSITE") or "").strip() or None}

    match = mismatch = 0
    mism, url_filled, phone_filled, misattributed = [], [], [], []
    for t in names:
        c = towns[t]["coa"]
        recs = []
        for a in by_town_age.get(t, []):
            owners = mcoa_phone_owner.get(digits(a.get("PHONE_NUMBER")), set())
            if not owners and digits(a.get("PHONE_NUMBER")) in agency_phone:
                owners = {"ASAP: " + agency_phone[digits(a.get("PHONE_NUMBER"))]}
            if owners and t not in owners:
                misattributed.append({"town": t, "record": a.get("LOCATION_NAME"),
                                      "phone": (a.get("PHONE_NUMBER") or "").strip(),
                                      "phone_belongs_to": sorted(owners)})
            else:
                recs.append(a)
        if not c or not recs:
            continue
        d_m = digits(c["phone"])
        if not d_m and len(recs) == 1 and digits(recs[0].get("PHONE_NUMBER")):
            c["phone"], c["phone_source"] = (recs[0].get("PHONE_NUMBER") or "").strip(), "AGE layer (MCOA row has no phone)"
            d_m = digits(c["phone"])
            phone_filled.append(t)
        same = [a for a in recs if d_m and digits(a.get("PHONE_NUMBER")) == d_m]
        if same:
            match += 1
            if not c["url"]:
                w = (same[0].get("WEBSITE") or "").strip()
                if w:
                    c["url"], c["url_source"] = w, "AGE layer (phone agrees with MCOA)"
                    url_filled.append(t)
        else:
            mismatch += 1
            mism.append({"town": t, "mcoa_phone": c["phone"], "age_layer": [age_loc(a) for a in recs]})
        others = [age_loc(a) for a in recs if digits(a.get("PHONE_NUMBER")) != d_m]
        if others:
            # other senior-center locations (or a different listed number) for the same town,
            # as published by AGE. Shown alongside -- never replacing -- the MCOA entry.
            c["other_locations"] = others
            c["other_locations_source"] = "AGE Councils on Aging layer"
    qa["cross_checks"]["coa_mcoa_vs_age_layer"] = {"phone_agree": match, "phone_disagree": mismatch,
                                                  "disagreements": mism, "age_records_unresolved": unresolved,
                                                  "age_records_misattributed": misattributed,
                                                  "phones_filled_from_age_layer": phone_filled,
                                                  "urls_filled_from_age_layer": url_filled}

    # ---------------- SHINE -------------------------------------------------
    csv_url, shine_rows = load_shine(F)
    sources["shine"] = {"url": URL_SHINE_PAGE, "csv": csv_url, "publisher": "Executive Office of Aging & Independence",
                        "records": len(shine_rows)}
    sub = []
    for r in shine_rows:
        raw = r["City or Town"].strip()
        rec = {"office": r["SHINE Regional Office"].strip(), "phone": r["Phone"].strip() or None}
        t = R(raw)
        if t:
            towns[t]["shine"] = rec
            continue
        m = re.match(r"^(.*?)\s*\(([^)]+)\)$", raw)        # "Hyannis (Barnstable)" -- parent given by the source
        if m and R(m.group(2)):
            sub.append((R(m.group(2)), m.group(1), rec))
        else:
            qa["notes"].append(f"SHINE row not mapped to a municipality: {raw!r} -> {rec}")
    for t, area, rec in sub:
        base = towns[t]["shine"]
        if base and (rec["office"], rec["phone"]) == (base["office"], base["phone"]):
            continue
        tgt = base if base else None
        if tgt is None:
            qa["notes"].append(f"SHINE sub-area {area} ({t}) has no town-level row")
            continue
        tgt.setdefault("sub_areas", []).append({"area": area, **rec})

    # ---------------- RTA ---------------------------------------------------
    rtas, ride = load_rta(F)
    sources["rta"] = {"url": URL_RTA_PAGE, "publisher": "MassDOT / MassMobility", "records": len(rtas)}
    for t in names:
        towns[t]["rta"] = []
    for a in rtas:
        for m in a["members_raw"]:
            t = R(m)
            if not t:
                qa["notes"].append(f"RTA member not mapped: {m!r} ({a['abbr']})")
                continue
            if all(x["name"] != a["name"] for x in towns[t]["rta"]):
                towns[t]["rta"].append({"name": a["name"], "abbr": a["abbr"], "url": a["url"], "phone": a["phone"]})
    if ride.get("full"):
        for t in names:
            towns[t]["mbta_the_ride"] = "none"
        for kind in ("full", "partial"):
            for m in ride[kind]:
                t = R(m)
                if t:
                    towns[t]["mbta_the_ride"] = kind
                else:
                    qa["notes"].append(f"THE RIDE area not mapped: {m!r}")
    else:
        qa["unmeasured"]["mbta_the_ride"] = "service-area sentence not found on the page"

    # ---------------- CPA ---------------------------------------------------
    cpa_rows = load_cpa(F, names)
    try:
        gis = {(a.get("TOWN") or "").strip().lower(): a
               for a in arcgis_all(F, URL_CPA_LAYER, "TOWN,ELEC_DATE,ELEC_YEAR")}
    except FetchError as e:
        gis = {}
        qa["unmeasured"]["cpa_election_date"] = str(e)
    sources["cpa"] = {"url": URL_DLS_CPA, "export": URL_DLS_CPA_CSV, "publisher": "MA DOR Division of Local Services",
                      "records": len(cpa_rows), "election_date_source": URL_CPA_LAYER,
                      "note": ("'year' is DLS's 'Year Adopted' column, which can differ from the ballot election "
                               "year (e.g. Boston: DLS 2018, election 11/8/2016); 'election_date' is from MassGIS "
                               "(layer last updated 2024, so recent adopters have none).")}
    for t in names:
        towns[t]["cpa"] = {"adopted": False}
    listed_blank = []
    for r in cpa_rows:
        t = R(r["Municipality"])
        if not t:
            qa["notes"].append(f"CPA row not mapped: {r['Municipality']!r}")
            continue
        yr = (r.get("Year Adopted") or "").strip()
        g = gis.get(t.lower()) or gis.get("manchester" if t == "Manchester By The Sea" else "")
        ed = (g or {}).get("ELEC_DATE")
        if not yr:
            listed_blank.append(t)
            towns[t]["cpa"] = {"adopted": False,
                               "note": "listed in the DLS report with a blank year and surcharge"
                                       + ("; MassGIS shows no adoption election" if g is not None and not ed else "")}
            continue
        towns[t]["cpa"] = {"adopted": True, "year": int(yr) if yr.isdigit() else yr,
                           "surcharge_pct": (r.get("Percent Adopted") or "").strip() or None,
                           "low_income_exemption": bool((r.get("Low Income Exemption") or "").strip()),
                           "election_date": ed or None}
    qa["cross_checks"]["cpa_listed_with_blank_year"] = listed_blank

    # ---------------- Fuel (EOHLC locator, 351 postbacks) -------------------
    fuel, fuel_unmeasured = load_fuel(F, names, R)
    sources["fuel"] = {"url": URL_HED, "page": URL_HEAP_PAGE,
                       "publisher": "Executive Office of Housing and Livable Communities (EOHLC)",
                       "records": len(fuel),
                       "note": ("Agency name/address/phones from the locator; url from the FY2026 Cold Relief "
                                "Brochure agency list (transcribed), reachability in fuel.url_check.")}
    for t, entries in fuel.items():
        if not entries:
            qa["not_in_source"].setdefault("fuel", []).append(t)
            continue
        rec = dict(entries[0])
        if len(entries) > 1:
            rec["also"] = entries[1:]
        towns[t]["fuel"] = rec
    if fuel_unmeasured:
        qa["unmeasured"]["fuel"] = fuel_unmeasured
    # websites: match each distinct locator agency to the brochure table, then check each site once
    site_check: dict[str, dict] = {}
    unmatched_agencies = set()
    for t in names:
        for rec in [towns[t]["fuel"]] + ((towns[t]["fuel"] or {}).get("also") or []):
            if not rec:
                continue
            hits = [row for row in FUEL_AGENCY_SITES if re.search(row[1], rec["agency"], re.I)]
            if len(hits) != 1:
                unmatched_agencies.add(rec["agency"])
                continue
            printed = hits[0][2]
            if printed not in site_check:
                chk = {"printed": printed, "brochure_no": hits[0][0], "url": None, "status": None}
                for scheme in ("https://", "http://"):
                    try:
                        F.fetch(scheme + printed, cache=True)
                        chk["url"], chk["status"] = scheme + printed, "200"
                        break
                    except FetchError as e:
                        chk["status"] = str(e)[-120:]
                site_check[printed] = chk
            chk = site_check[printed]
            rec["url"] = chk["url"] or "https://" + printed
            rec["url_check"] = "reachable (HTTP 200)" if chk["url"] else "COULD NOT VERIFY: " + (chk["status"] or "")
    sources["fuel"]["websites"] = URL_COLD_RELIEF
    qa["cross_checks"]["fuel_agency_websites"] = {"checked": site_check,
                                                 "locator_agencies_without_brochure_match": sorted(unmatched_agencies)}

    # ---------------- Coverage + controls -----------------------------------
    for fld in ("asap", "coa", "shine"):
        miss = [t for t in names if not towns[t][fld]]
        if miss:
            qa["not_in_source"][fld] = miss
    cov = {
        "fuel": sum(1 for t in names if towns[t]["fuel"]),
        "asap": sum(1 for t in names if towns[t]["asap"]),
        "coa": sum(1 for t in names if towns[t]["coa"]),
        "coa_with_url": sum(1 for t in names if towns[t]["coa"] and towns[t]["coa"].get("url")),
        "shine": sum(1 for t in names if towns[t]["shine"]),
        "rta_member": sum(1 for t in names if towns[t]["rta"]),
        "mbta_the_ride_full_or_partial": sum(1 for t in names if towns[t]["mbta_the_ride"] in ("full", "partial")),
        "cpa_measured": sum(1 for t in names if towns[t]["cpa"] is not None),
        "cpa_adopted": sum(1 for t in names if (towns[t]["cpa"] or {}).get("adopted")),
    }
    qa["coverage_of_351"] = cov
    qa["alias_uses"] = R.alias_uses

    ok = True
    ctl_out = {}
    for t, rule in CONTROLS.items():
        rec = towns[t]
        res = {}
        if rule.get("fuel"):
            res["fuel"] = bool(rec["fuel"])
        if rule.get("asap"):
            res["asap"] = bool(rec["asap"])
        if "fuel_contains" in rule:
            res["fuel_contains"] = bool(rec["fuel"]) and rule["fuel_contains"] in rec["fuel"]["agency"]
        if "asap_min" in rule:
            res["asap_min"] = len(rec["asap"] or []) >= rule["asap_min"]
        ctl_out[t] = res
        ok &= all(res.values())
    qa["controls"] = ctl_out
    for fld in ("fuel", "asap", "coa", "shine", "cpa_measured"):
        if cov[fld] < COVERAGE_FLOOR * 351:
            qa["notes"].append(f"COVERAGE FLOOR FAILED: {fld} = {cov[fld]}/351")
            ok = False
        if cov[fld] == 351 and fld in ("fuel", "asap"):
            pass  # a real 351/351 is expected for statewide-by-design programs; controls above guard the instrument
    for s in sources.values():
        s["retrieved"] = today
    return {"fetched": today, "sources": sources, "qa": qa, "towns": towns}, (0 if ok else 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    repo = Path(__file__).resolve().parent.parent
    ap.add_argument("--out", default=str(repo / "data" / "town_services.json"))
    ap.add_argument("--cache-dir", default=str(Path.home() / ".cache" / "benefighter-town-services"))
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--delay", type=float, default=3.5, help="seconds between requests (default 3.5)")
    a = ap.parse_args()
    cache = None if a.no_cache else Path(a.cache_dir) / dt.date.today().isoformat()
    F = Fetcher(cache, a.delay)
    try:
        doc, rc = build(F)
    except FetchError as e:
        print(f"COULD NOT MEASURE -- required source failed: {e}", file=sys.stderr)
        print(json.dumps(F.log[-5:], indent=1), file=sys.stderr)
        return 2
    doc["qa"]["requests"] = {"total": len(F.log),
                             "non_200": [x for x in F.log if x["status"] not in (200, "cache")]}
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", "utf-8")
    os.replace(tmp, out)
    print(json.dumps({"out": str(out), "coverage_of_351": doc["qa"]["coverage_of_351"],
                      "controls": doc["qa"]["controls"], "exit": rc}, indent=1))
    return rc


if __name__ == "__main__":
    sys.exit(main())
