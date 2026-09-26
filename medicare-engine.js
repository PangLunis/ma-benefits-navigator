/* Benefighter Medicare plan cost engine — runs entirely on the person's device.
   Data: data/medicare/<year>/plans.json, drugs.json, rx/<rxcui>.json (built by tools/medicare/build.py
   from CMS's public plan files). Checked against Medicare Plan Finder (tools/medicare/verify.py).

   Model (matches Plan Finder's full-year estimate):
   - 12 monthly 30-day retail fills starting in January.
   - Each month, the cheapest drug is filled first (this decides which fill crosses the deductible).
   - Tiers where the deductible applies: full plan price until the deductible is used up; the fill that
     crosses it pays the rest of the deductible plus the normal cost share on the remainder.
   - After that: the tier's copay (never more than the drug's price) or coinsurance (with any min/max).
   - Insulin: the plan's insulin cost share, never more than $35 a month, no deductible.
   - Covered drugs stop costing anything once the yearly cap (plan.oop) is reached; Enhanced Alternative plans
     reach it on standard-benefit cost sharing, not on what you actually paid (see the cap counter).
   - A drug the plan doesn't cover: full price (median plan price), not counted toward the deductible or cap.
*/
(function (root) {
  "use strict";

  // Medicare negotiated prices that start January 1, 2027 (CMS fact sheet, IPAY 2027): 30-day price vs 2024 list price.
  const NEGOTIATED_2027 = [
    ["Ozempic|Rybelsus|Wegovy", "Ozempic, Rybelsus, Wegovy", 274, 959],
    ["Trelegy", "Trelegy Ellipta", 175, 654],
    ["Xtandi", "Xtandi", 7004, 13480],
    ["Pomalyst", "Pomalyst", 8650, 21744],
    ["Ofev", "Ofev", 6350, 12622],
    ["Ibrance", "Ibrance", 7871, 15741],
    ["Linzess", "Linzess", 136, 539],
    ["Calquence", "Calquence", 8600, 14228],
    ["Austedo", "Austedo / Austedo XR", 4093, 6623],
    ["Breo", "Breo Ellipta", 67, 397],
    ["Xifaxan", "Xifaxan", 1000, 2696],
    ["Vraylar", "Vraylar", 770, 1376],
    ["Tradjenta", "Tradjenta", 78, 488],
    ["Janumet", "Janumet / Janumet XR", 80, 526],
    ["Otezla", "Otezla / Otezla XR", 1650, 4722]
  ];
  function negotiated2027(name) {
    for (const [re, label, mfp, list] of NEGOTIATED_2027) {
      if (new RegExp("\\b(" + re + ")\\b", "i").test(name)) return { label, mfp, list };
    }
    return null;
  }

  function share(c, full) {
    if (!c) return full;
    const [t, a, mn, mx] = c;
    if (t === 1) return Math.min(a, full);
    if (t === 2) {
      let v = a * full;
      if (mn) v = Math.max(v, mn);
      if (mx) v = Math.min(v, mx);
      return Math.min(v, full);
    }
    return full;
  }

  function insShare(plan, tier, ph, full) {
    const t = (plan.ins || {})[String(tier)] || (plan.ins || {})["0"];
    const opts = [35, full];
    if (t) {
      const r = (t[ph] && (t[ph][0] != null || t[ph][1] != null)) ? t[ph] : t.s;
      if (r && r[0] != null) opts.push(r[0]);
      if (r && r[1] != null) opts.push(r[1] * full);
    }
    return Math.min.apply(null, opts);
  }

  /* drugs: [{rx, qty (billing units per month), ins (bool), row (this plan's row from rx file or null), med (median unit price)}]
     Returns {year, months[12], per: {rx: {covered, tier, full, first, later, flags, ql}}} */
  function estimate(plan, drugs, pharm) {
    const ph = pharm === "p" ? "p" : "s";
    const cap = plan.oop || 2100;
    const ea = !!plan.ea;                 // Enhanced Alternative plan (see "cap counter" below)
    let dedLeft = plan.ded || 0, stdDedLeft = plan.sd || 0, troop = 0, total = 0;
    const months = new Array(12).fill(0);
    const per = {};
    for (const d of drugs) {
      const r = d.row;
      if (r) {
        const unit = r[2];
        per[d.rx] = { covered: true, tier: r[1], unit, full: unit != null ? unit * d.qty : null, flags: r[3] || 0, ql: r[4] || null };
      } else {
        per[d.rx] = { covered: false, full: d.med != null ? d.med * d.qty : null };
      }
    }
    const order = drugs.slice().sort((a, b) => (per[a.rx].full || 0) - (per[b.rx].full || 0));
    for (let m = 0; m < 12; m++) {
      for (const d of order) {
        const x = per[d.rx];
        if (x.full == null) continue;
        let pay;
        if (!x.covered) {
          pay = x.full;                                   // off-formulary: full price, outside the deductible and cap
        } else if (troop >= cap) {
          pay = 0;                                        // past the yearly cap: $0
        } else {
          const c1 = (plan.tiers || {})[String(x.tier)];
          const p2 = (c1 && ph === "p" && c1.p) ? "p" : "s";
          if (d.ins) {
            pay = insShare(plan, x.tier, p2, x.full);
          } else if (c1 && c1.d && dedLeft > 0) {
            const pd = Math.min(x.full, dedLeft); dedLeft -= pd;
            const rest = x.full - pd;
            pay = pd + (rest > 0 ? share(c1[p2], rest) : 0);
          } else {
            pay = c1 ? share(c1[p2], x.full) : x.full;
            if (dedLeft > 0) dedLeft = Math.max(0, dedLeft - x.full);   // a no-deductible tier's cost still counts toward the deductible
          }
          // Cap counter. Basic plans count what you pay. Enhanced Alternative plans count what the STANDARD Part D
          // benefit would have charged for the fill (deductible, then 25%; insulin 25% up to $35) - matches
          // Medicare Plan Finder month by month, which is why a $42-copay inhaler reaches the cap by October.
          let cnt = pay;
          if (ea) {
            if (d.ins) cnt = Math.min(35, 0.25 * x.full);
            else { const sdp = Math.min(x.full, stdDedLeft); stdDedLeft -= sdp; cnt = sdp + 0.25 * (x.full - sdp); }
          }
          const rem = cap - troop;
          if (cnt >= rem) { pay = Math.min(pay, rem); troop = cap; } else troop += cnt;
        }
        total += pay; months[m] += pay;
        if (m === 0) x.first = pay;
        if (m === 11) x.later = pay;
      }
    }
    return { year: total, months, per, troop, capReached: troop >= cap - 0.005 };
  }

  const api = { estimate, share, negotiated2027, NEGOTIATED_2027 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MedEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
