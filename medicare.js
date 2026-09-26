/* Benefighter — Medicare plan comparison page (UI). Math lives in medicare-engine.js.
   Everything runs on this device; the only requests are for our own static data files. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = x => "$" + Math.round(x).toLocaleString();
  const money2 = x => "$" + (Math.round(x * 100) / 100).toFixed(2);
  const KEY = "bf_med_v1";
  const remembering = () => { try { return localStorage.getItem("bf_remember") !== "0"; } catch (e) { return false; } };

  let YEARS = [], Y = null, PREV = null;     // Y = year shown; PREV = prior year (for "what changes for you")
  const DATA = {};                            // year -> {plans, towns, drugs, rx:{}}
  let S = { town: "", cur: "", pharm: "s", drugs: [] };   // drugs: [{rx, q}] q = months-supply choice
  try { if (remembering()) Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  const save = () => { try { if (remembering()) localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  // ---------- data
  const getJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
  function loadYear(y) {
    if (DATA[y]) return Promise.resolve(DATA[y]);
    return Promise.all([getJSON(`data/medicare/${y}/plans.json`), getJSON(`data/medicare/${y}/drugs.json`)]).then(([p, d]) => {
      DATA[y] = { plans: p.plans, towns: p.towns, meta: p.meta, drugs: d.drugs, byRx: Object.fromEntries(d.drugs.map(x => [x[0], x])), rx: {} };
      return DATA[y];
    });
  }
  function rxRows(y, rx) {
    const D = DATA[y];
    if (D.rx[rx]) return Promise.resolve(D.rx[rx]);
    return getJSON(`data/medicare/${y}/rx/${rx}.json`).then(j => { D.rx[rx] = { m: j.m, by: Object.fromEntries(j.p.map(r => [r[0], r])) }; return D.rx[rx]; })
      .catch(() => (D.rx[rx] = { m: null, by: {} }));
  }

  // ---------- drug names & quantities
  const UNIT_WORD = { MG: "mg", MCG: "mcg", ML: "mL", UNT: "units", ACTUAT: "puffs", HR: "hr" };
  function pretty(n) { return String(n).replace(/\b(MG|MCG|ML|UNT|ACTUAT|HR)\b/g, m => UNIT_WORD[m]); }
  const PILL_Q = [[30, "1 a day"], [60, "2 a day"], [90, "3 a day"], [120, "4 a day"], [15, "½ a day"], [45, "1½ a day"], [4, "1 a week"]];
  const PKG_Q = [[1, "1 a month"], [2, "2 a month"], [3, "3 a month"], [0.5, "1 every 2 months"], [1 / 3, "1 every 3 months"]];
  function unitWord(name) {
    if (/Pen Injector|Auto-Injector|Prefilled Syringe|Cartridge/i.test(name)) return "box";
    if (/Inhal|Ellipta|HandiHaler|Respimat/i.test(name)) return "inhaler";
    if (/Nasal|Spray/i.test(name)) return "bottle";
    if (/Ophthalmic|Otic|Drops/i.test(name)) return "bottle";
    if (/Cream|Ointment|Gel|Lotion/i.test(name)) return "tube";
    if (/Transdermal|Patch/i.test(name)) return "box";
    return "package";
  }
  // billing units per month for a chosen quantity
  function units(d, q) {
    if (!d) return null;
    if (d[3]) return q;                      // pills: q = pills per month
    if (d[4] == null) return null;           // package size not known -> cost can't be estimated
    return q * d[4];                         // packages per month x units per package
  }
  function qOptions(d, q) {
    const list = d[3] ? PILL_Q : PKG_Q;
    const w = d[3] ? "" : unitWord(d[1]);
    return list.map(([v, l]) => `<option value="${v}"${Math.abs(v - q) < 1e-6 ? " selected" : ""}>${d[3] ? l : l.replace(/^(\S+)/, "$1 " + w)}</option>`).join("");
  }

  // ---------- step 1/2: town and current plan
  function countyOf(town) {
    const D = DATA[Y]; if (!D || !town) return null;
    const k = town.trim().toLowerCase();
    const hit = Object.keys(D.towns).find(t => t.toLowerCase() === k);
    return hit ? { town: hit, county: D.towns[hit] } : null;
  }
  function plansIn(y, county) {
    return DATA[y].plans.map((p, i) => [p, i]).filter(([p]) => p.cat === "PDP" || p.counties.includes(county));
  }
  function fillPlans() {
    const c = countyOf(S.town);
    $("countyline").textContent = c ? `${c.town} is in ${c.county} County.` : (S.town ? "We couldn't match that town — pick it from the list." : "");
    const sel = $("curplan");
    if (!c) { sel.innerHTML = '<option value="">Pick your town first</option>'; return; }
    const ps = plansIn(CY(), c.county).sort((a, b) => a[0].n.localeCompare(b[0].n));   // the plan they have NOW (prior year once next year's data is out)
    const opt = ([p]) => `<option value="${esc(p.id)}"${p.id === S.cur ? " selected" : ""}>${esc(p.n)}</option>`;
    sel.innerHTML = '<option value="">I don\'t have one / not sure</option>' +
      '<optgroup label="Drug plans (Part D)">' + ps.filter(([p]) => p.cat === "PDP").map(opt).join("") + "</optgroup>" +
      '<optgroup label="Medicare Advantage plans">' + ps.filter(([p]) => p.cat !== "PDP").map(opt).join("") + "</optgroup>";
  }

  // ---------- step 3: drugs
  let searchIdx = null;
  function search(q) {
    const D = DATA[Y]; if (!D) return [];
    if (!searchIdx) searchIdx = D.drugs.map(d => [d, (d[1] + " " + d[2]).toLowerCase()]);
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length || q.trim().length < 3) return [];
    const hits = searchIdx.filter(([, s]) => toks.every(t => s.includes(t))).map(([d]) => d);
    const t0 = toks[0];
    hits.sort((a, b) => (b[1].toLowerCase().startsWith(t0) - a[1].toLowerCase().startsWith(t0)) || (b[3] - a[3]) || a[1].length - b[1].length);
    return hits.slice(0, 12);
  }
  function renderSugg() {
    const q = $("dq").value;
    const hits = search(q);
    $("sugg").innerHTML = hits.map(d => `<li><button type="button" data-rx="${d[0]}">${esc(pretty(d[1]))}${d[2] && d[2].toLowerCase() !== d[1].toLowerCase() ? `<br><span class="fine">${esc(pretty(d[2]))}</span>` : ""}</button></li>`).join("");
  }
  function addDrug(rx) {
    if (S.drugs.some(x => x.rx === rx)) return;
    const d = DATA[Y].byRx[rx];
    S.drugs.push({ rx, q: d[3] ? 30 : 1 });
    $("dq").value = ""; $("sugg").innerHTML = "";
    renderDrugs(); save();
  }
  function renderDrugs() {
    const D = DATA[Y];
    $("dlist").innerHTML = S.drugs.map((x, i) => {
      const d = D.byRx[x.rx];
      if (!d) return `<li><span class="dn">Drug ${esc(x.rx)}</span> <span class="fine">isn't in ${Y} plan lists.</span><button class="rm" data-i="${i}">Remove</button></li>`;
      const note = (!d[3] && d[4] == null) ? `<span class="fine">We can show coverage for this one, but not its price yet.</span>` : "";
      return `<li><span class="dn">${esc(pretty(d[1]))}</span><div class="row"><label>How much: <select data-i="${i}">${qOptions(d, x.q)}</select></label><button class="rm" type="button" data-i="${i}">Remove</button></div>${note}</li>`;
    }).join("");
  }

  // ---------- compare
  function drugInputs(y, plan, idx) {
    const D = DATA[y];
    return S.drugs.map(x => {
      const d = D.byRx[x.rx], rr = D.rx[x.rx] || { by: {}, m: null };
      const u = units(d, x.q);
      return { rx: x.rx, qty: u == null ? 0 : u, noPrice: u == null, ins: !!(d && d[5]), row: rr.by[idx] || null, med: rr.m };
    });
  }
  function score(y, pair) {
    const [plan, idx] = pair;
    const ds = drugInputs(y, plan, idx);
    const est = MedEngine.estimate(plan, ds.filter(d => !d.noPrice), S.pharm);
    const flags = { nc: 0, pa: 0, st: 0, ql: 0, np: 0, ncUnpriced: 0 };
    ds.forEach(d => {
      if (!d.row) { flags.nc++; if (d.noPrice || d.med == null) flags.ncUnpriced++; }
      else { if (d.row[3] & 1) flags.pa++; if (d.row[3] & 2) flags.st++; if (d.row[3] & 4) flags.ql++; if (d.row[2] == null) flags.np++; }
      if (d.noPrice) flags.np++;
    });
    return { plan, idx, est, prem: plan.prem || 0, total: 12 * (plan.prem || 0) + est.year, flags, ds };
  }
  function planCard(y, r, isCur) {
    const p = r.plan, D = DATA[y];
    const kind = p.cat === "PDP" ? "Drug plan only (with Original Medicare)" : "Medicare Advantage (" + esc(p.type) + ")";
    const tags = [];
    if (isCur) tags.push('<span class="tag good">Your current plan</span>');
    if (r.flags.nc) tags.push(`<span class="tag bad">${r.flags.nc} not covered</span>`);
    if (r.flags.pa) tags.push(`<span class="tag warn">${r.flags.pa} need prior approval</span>`);
    if (r.flags.st) tags.push(`<span class="tag warn">${r.flags.st} step therapy</span>`);
    if (r.flags.ql) tags.push(`<span class="tag">${r.flags.ql} quantity limit</span>`);
    if (r.flags.np) tags.push(`<span class="tag">${r.flags.np} price unknown</span>`);
    if (p.stars) tags.push(`<span class="tag">★ ${p.stars} stars</span>`);
    if (p.moop) tags.push(`<span class="tag">Medical out-of-pocket max ${money(p.moop)}</span>`);
    if (r.est.capReached) tags.push(`<span class="tag">Reaches the ${money(p.oop || 0)} yearly drug cap — $0 after that</span>`);
    const rows = r.ds.map(d => {
      const dd = D.byRx[d.rx], x = r.est.per[d.rx];
      const nm = esc(pretty(dd ? dd[1] : d.rx));
      if (d.noPrice) return `<tr><td>${nm}</td><td>${d.row ? "Tier " + d.row[1] : "Not covered"}</td><td class="r">—</td><td class="r">—</td></tr>`;
      if (!x || !x.covered) return `<tr><td>${nm}</td><td><b>Not covered</b></td><td class="r" colspan="2">full price ~${x && x.full != null ? money(x.full) : "?"}/mo</td></tr>`;
      const lim = [(x.flags & 1) && "prior approval", (x.flags & 2) && "step therapy", (x.flags & 4) && ("quantity limit" + (x.ql ? ` (${x.ql[0]} per ${x.ql[1]} days)` : ""))].filter(Boolean).join(", ");
      return `<tr><td>${nm}${lim ? `<br><span class="fine">${lim}</span>` : ""}</td><td>Tier ${x.tier}</td><td class="r">${x.first != null ? money2(x.first) : "—"}</td><td class="r">${x.later != null ? money2(x.later) : "—"}</td></tr>`;
    }).join("");
    return `<div class="plan${isCur ? " cur" : ""}"><div class="top"><div class="pn">${esc(p.n)}</div><div class="tot">${money(r.total)}/yr</div></div>
      <div class="sub">${kind} · premium ${money2(r.prem)}/mo · your drugs ~${money(r.est.year)}/yr · drug deductible ${money(p.ded || 0)}</div>
      <div class="tags">${tags.join("")}</div>
      <details><summary>Your drugs in this plan</summary>
        <table class="dt"><tr><th>Drug</th><th>Tier</th><th class="r">January</th><th class="r">December</th></tr>${rows}</table>
        <p class="fine">Monthly cost at a ${S.pharm === "p" ? "preferred" : "standard"} pharmacy. January is higher when the deductible applies.</p>
      </details></div>`;
  }

  function watchouts(y, cur, curRes) {
    const D = DATA[y];
    const h = [];
    h.push(`<div class="watch"><h3>What changes for everyone in 2027</h3><ul>
      <li>The drug deductible can go up to <b>$700</b> (it's $615 in 2026). Some plans charge less or none.</li>
      <li>The most anyone pays for covered drugs in a year goes up to <b>$2,400</b> (it's $2,100 in 2026).</li>
      <li>You can switch plans for 2027 from <b>October 15 to December 7, 2026</b>. The new plan starts January 1.</li>
      <li>If you're in a Medicare Advantage plan, you also get <b>one change between January 1 and March 31</b>.</li>
      <li>In Massachusetts, Medigap plans can't turn you down or charge more because of your health.</li></ul>
      <p class="fine">Sources: CMS 2027 Rate Announcement (April 6, 2026); Medicare &amp; You 2027; Massachusetts Division of Insurance rules.</p></div>`);
    const neg = S.drugs.map(x => D.byRx[x.rx]).filter(Boolean).map(d => [d, MedEngine.negotiated2027(d[1] + " " + d[2])]).filter(([, n]) => n);
    if (neg.length) {
      h.push(`<div class="watch"><h3>Your drugs with lower Medicare prices from January 1, 2027</h3><ul>${neg.map(([d, n]) => `<li><b>${esc(n.label)}</b> — Medicare negotiated about <b>${money(n.mfp)}</b> for 30 days (the list price was ${money(n.list)}). That lowers what you pay while you're in the deductible, and for plans that charge a percentage.</li>`).join("")}</ul>
      <p class="fine">Source: CMS, negotiated prices for 2027 (Medicare Drug Price Negotiation Program).</p></div>`);
    }
    if (cur && curRes) {
      const items = [];
      curRes.ds.forEach(d => {
        const dd = D.byRx[d.rx], nm = esc(pretty(dd ? dd[1] : d.rx));
        if (!d.row) items.push(`<li><b>${nm}</b> isn't on your plan's drug list — ask the plan about an exception, or compare plans that cover it.</li>`);
        else {
          if (d.row[3] & 1) items.push(`<li><b>${nm}</b> needs <b>prior approval</b> — your doctor has to get the plan's OK.</li>`);
          if (d.row[3] & 2) items.push(`<li><b>${nm}</b> has <b>step therapy</b> — the plan may want you to try a cheaper drug first.</li>`);
          if (d.row[1] >= 4) items.push(`<li><b>${nm}</b> is on tier ${d.row[1]}, one of the plan's more expensive tiers — check it in the plan's 2027 letter.</li>`);
        }
      });
      h.push(`<div class="watch"><h3>Watch-outs in your plan: ${esc(cur.n)}</h3>${items.length ? `<ul>${items.join("")}</ul>` : "<p>None of your drugs has a coverage problem or restriction in this plan in 2026.</p>"}
        <p>With your drugs, this plan comes to about <b>${money(curRes.total)}</b> for ${y} (premium + drugs).</p></div>`);
    }
    h.push(`<div class="watch"><h3>Check your plan's letter</h3><p>Every plan mails an <b>"Annual Notice of Change"</b> in September. It lists what changes on January 1. Look for these five things:</p><ul>
      <li>The <b>monthly premium</b> for 2027.</li><li>The <b>drug deductible</b>.</li>
      <li><b>Each of your drugs</b>: still covered? same tier? any new prior approval or limits?</li>
      <li>Whether your <b>pharmacy</b> is still in the network — and still "preferred".</li>
      <li>For Medicare Advantage: whether your <b>doctors and hospitals</b> are still in the network.</li></ul>
      <p class="fine">No letter? Call the plan — the number is on your card.</p>
      <p><button type="button" class="btn btn-ghost" id="ics">📅 Add an Oct 15 reminder to compare plans</button></p></div>`);
    h.push(`<div class="watch"><h3>If you pick a drug plan (Part D)</h3><p>A drug plan covers only drugs. People who choose one usually keep Original Medicare and may add a Medigap plan for medical costs. In Massachusetts in 2026, Medigap <b>Core</b> runs about $143–$196 a month and <b>Supplement 1A</b> about $233–$272, depending on the insurer.</p><p class="fine">Source: Massachusetts Division of Insurance, Medicare Supplement plans offered in 2026.</p></div>`);
    return h.join("");
  }

  function diffSection(cur, r26, r27) {
    // "What changes for you in 2027" — needs 2027 plan data and the same plan ID in both years.
    if (!r27) return `<div class="watch"><h3>Your plan in 2027</h3><p>${esc(cur.n)} isn't in Medicare's 2027 list under the same plan number. It may be ending or merging — your plan's letter will say what happens.</p></div>`;
    const lines = [];
    const dp = r27.prem - r26.prem, dd = (r27.plan.ded || 0) - (r26.plan.ded || 0), dt = r27.total - r26.total;
    lines.push(`<li>Premium: ${money2(r26.prem)} → <b>${money2(r27.prem)}</b> a month${dp ? ` (${dp > 0 ? "+" : "−"}${money2(Math.abs(dp))})` : ""}</li>`);
    lines.push(`<li>Drug deductible: ${money(r26.plan.ded || 0)} → <b>${money(r27.plan.ded || 0)}</b>${dd ? ` (${dd > 0 ? "+" : "−"}${money(Math.abs(dd))})` : ""}</li>`);
    r27.ds.forEach((d, i) => {
      const a = r26.ds[i], nm = esc(pretty((DATA[Y].byRx[d.rx] || [d.rx, d.rx])[1]));
      if (a && a.row && !d.row) lines.push(`<li><b>${nm}</b>: covered in 2026, <b>not covered in 2027</b>.</li>`);
      else if (a && !a.row && d.row) lines.push(`<li><b>${nm}</b>: newly covered in 2027.</li>`);
      else if (a && a.row && d.row) {
        if (a.row[1] !== d.row[1]) lines.push(`<li><b>${nm}</b>: tier ${a.row[1]} → <b>tier ${d.row[1]}</b>.</li>`);
        if (!(a.row[3] & 1) && (d.row[3] & 1)) lines.push(`<li><b>${nm}</b>: now needs prior approval.</li>`);
        if (!(a.row[3] & 2) && (d.row[3] & 2)) lines.push(`<li><b>${nm}</b>: now has step therapy.</li>`);
      }
    });
    return `<div class="watch"><h3>What changes for you in 2027: ${esc(cur.n)}</h3><ul>${lines.join("")}</ul>
      <p>Premium + your drugs: about ${money(r26.total)} in 2026 → <b>${money(r27.total)}</b> in 2027 (${dt >= 0 ? "+" : "−"}${money(Math.abs(dt))}).</p></div>`;
  }

  const CY = () => PREV || Y;
  let FILTER = "all", SHOW = 10;
  function compare() {
    const c = countyOf(S.town);
    if (!c) { $("res").innerHTML = '<p class="hint">Pick your town first.</p>'; $("town").focus(); return; }
    if (!S.drugs.length) { $("res").innerHTML = '<p class="hint">Add at least one drug — or, with no drugs, plans are ranked by premium alone.</p>'; }
    const years = [Y].concat(PREV ? [PREV] : []);
    Promise.all(years.flatMap(y => S.drugs.map(x => rxRows(y, x.rx)))).then(() => {
      const pairs = plansIn(Y, c.county).filter(([p]) => p.drug && (!p.snp || p.id === S.cur));
      // Rank by yearly cost. A plan that doesn't cover one of your drugs whose price we can't estimate goes after
      // plans that cover everything (otherwise the missing drug would look free).
      const res = pairs.map(pr => score(Y, pr)).sort((a, b) => (a.flags.ncUnpriced > 0) - (b.flags.ncUnpriced > 0) || a.total - b.total);
      const cur = S.cur ? DATA[CY()].plans.find(p => p.id === S.cur) : null;
      const curRes = cur ? res.find(r => r.plan.id === cur.id) || null : null;   // same plan number in the year shown
      let h = `<h2>Plans in ${esc(c.county)} County for ${Y}, cheapest first</h2>`;
      const best = res[0];
      if (best) {
        h += `<div class="summary"><div>Lowest yearly cost for your drugs:</div><div class="big">${esc(best.plan.n)} — ${money(best.total)}</div>
          <div class="fine">Premium ${money2(best.prem)}/mo + about ${money(best.est.year)} for your drugs.</div>`;
        if (curRes) {
          const cheaper = res.filter(r => r.total < curRes.total - 1).length;
          h += `<p style="margin:.6em 0 0">Your current plan: <b>${money(curRes.total)}</b>. ${cheaper ? `<b>${cheaper}</b> plan${cheaper > 1 ? "s" : ""} would cost less — up to <b>${money(curRes.total - best.total)}</b> a year less.` : "It's already the lowest-cost plan for your drugs."}</p>`;
        } else if (cur && !cur.drug) {
          h += `<p style="margin:.6em 0 0">Your current plan (${esc(cur.n)}) doesn't include drug coverage.</p>`;
        }
        h += `</div>`;
      }
      h += `<div class="filters" role="group" aria-label="Plan type"><button type="button" data-f="all" aria-pressed="${FILTER === "all"}">All plans</button><button type="button" data-f="pdp" aria-pressed="${FILTER === "pdp"}">Drug plans only</button><button type="button" data-f="ma" aria-pressed="${FILTER === "ma"}">Medicare Advantage</button></div>`;
      const shown = res.filter(r => FILTER === "all" || (FILTER === "pdp" ? r.plan.cat === "PDP" : r.plan.cat !== "PDP"));
      if (curRes && !shown.slice(0, SHOW).includes(curRes) && shown.includes(curRes)) h += `<p class="fine" style="margin:4px 0">Your current plan (it ranks #${res.indexOf(curRes) + 1} of ${res.length}):</p>` + planCard(Y, curRes, true) + `<p class="fine" style="margin:10px 0 4px">Lowest-cost plans for your drugs:</p>`;
      h += shown.slice(0, SHOW).map(r => planCard(Y, r, cur && r.plan.id === cur.id)).join("");
      if (shown.length > SHOW) h += `<button type="button" class="more" id="more">Show all ${shown.length} plans</button>`;
      h += `<h2>What to look out for in 2027</h2>`;
      if (PREV && cur && cur.drug) {
        const old = DATA[PREV].plans.findIndex(p => p.id === cur.id);
        const r26 = old >= 0 ? score(PREV, [DATA[PREV].plans[old], old]) : null;
        if (r26) h += diffSection(cur, r26, curRes);
      }
      h += watchouts(Y, cur, curRes);
      $("res").innerHTML = h;
      $("res").querySelectorAll("[data-f]").forEach(b => b.onclick = () => { FILTER = b.dataset.f; SHOW = 10; compare(); });
      const m = $("more"); if (m) m.onclick = () => { SHOW = 999; compare(); };
      const ics = $("ics"); if (ics) ics.onclick = downloadICS;
    });
  }

  function downloadICS() {
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Benefighter//Medicare//EN", "BEGIN:VEVENT",
      "UID:medicare-oe-2026@benefighter.com", "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
      "DTSTART;VALUE=DATE:20261015", "DTEND;VALUE=DATE:20261016",
      "SUMMARY:Compare Medicare plans for 2027 (open enrollment starts)",
      "DESCRIPTION:Open enrollment runs Oct 15 - Dec 7. Compare plans at benefighter.com/medicare.html or call SHINE free at (800) 243-4636.",
      "BEGIN:VALARM", "TRIGGER:-PT0M", "ACTION:DISPLAY", "DESCRIPTION:Compare Medicare plans", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" })); a.download = "medicare-open-enrollment.ics";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- wiring
  function wire() {
    const D = DATA[Y];
    $("towns").innerHTML = Object.keys(D.towns).sort().map(t => `<option value="${esc(t)}">`).join("");
    $("town").value = S.town || "";
    $("town").addEventListener("input", () => { S.town = $("town").value; const c = countyOf(S.town); if (c) S.town = c.town; fillPlans(); save(); });
    $("curplan").addEventListener("change", () => { S.cur = $("curplan").value; save(); });
    $("dq").addEventListener("input", renderSugg);
    $("sugg").addEventListener("click", e => { const b = e.target.closest("button[data-rx]"); if (b) addDrug(b.dataset.rx); });
    $("dlist").addEventListener("change", e => { const s = e.target.closest("select[data-i]"); if (s) { S.drugs[+s.dataset.i].q = parseFloat(s.value); save(); } });
    $("dlist").addEventListener("click", e => { const b = e.target.closest("button.rm"); if (b) { S.drugs.splice(+b.dataset.i, 1); renderDrugs(); save(); } });
    const setPh = v => { S.pharm = v; $("ph-s").setAttribute("aria-pressed", v === "s"); $("ph-p").setAttribute("aria-pressed", v === "p"); save(); };
    $("ph-s").onclick = () => setPh("s"); $("ph-p").onclick = () => setPh("p"); setPh(S.pharm || "s");
    $("go").onclick = () => { SHOW = 10; compare(); $("res").scrollIntoView({ behavior: "smooth", block: "start" }); };
    fillPlans(); renderDrugs();
  }

  getJSON("data/medicare/index.json").then(ix => {
    YEARS = Object.keys(ix.years).map(Number).sort();
    Y = YEARS[YEARS.length - 1]; PREV = YEARS.includes(Y - 1) ? Y - 1 : null;
    return Promise.all([loadYear(Y)].concat(PREV ? [loadYear(PREV)] : []));
  }).then(() => {
    const m = DATA[Y].meta;
    $("yearnote").innerHTML = Y >= 2027
      ? `Showing <b>${Y}</b> plans from Medicare's files (updated ${esc(m.built)}).`
      : `Showing <b>${Y}</b> plans. <b>2027 plans</b> appear here when Medicare publishes them (around October 15). Until then, use this to see what your drugs cost now and what to watch for.`;
    wire();
  }).catch(e => { $("yearnote").textContent = "Plan data couldn't load. Please try again later."; console.error(e); });
})();
