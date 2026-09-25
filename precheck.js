/* =========================================================================
   Benefighter — minimal vanilla JS
   Two jobs only:
     1) The free 2-minute pre-check: turn answers into a rough, clearly-
        labeled estimate + a list of programs worth reviewing.
     2) A friendly submit handler for the "Start my check" form so the
        static preview doesn't do something confusing when opened directly.
   No frameworks, no external requests. Fails safe if elements are absent.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     1) PRE-CHECK
     Rough heuristic only. These figures are illustrative ranges pulled
     from the programs described on the page; they are NOT a determination.
     --------------------------------------------------------------------- */
  var form = document.getElementById("precheckForm");

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      runPrecheck();
    });
    form.addEventListener("reset", function () {
      var r = document.getElementById("pcResult");
      if (r) r.hidden = true;
    });
  }

  function val(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function runPrecheck() {
    var age = val("age");
    var ma = val("ma");
    var home = val("home");
    var income = val("income");
    var heat = val("heat");
    var vet = val("vet");

    var resultBox = document.getElementById("pcResult");
    var titleEl = document.getElementById("pcResultTitle");
    var leadEl = document.getElementById("pcResultLead");
    var estEl = document.getElementById("pcResultEst");
    var hitsEl = document.getElementById("pcResultHits");

    // Reveal the result region and move focus to it for screen-reader users.
    resultBox.hidden = false;
    hitsEl.innerHTML = "";

    // Not in MA — the honest answer is "we can't help here."
    if (ma === "no") {
      titleEl.textContent = "We focus on Massachusetts";
      leadEl.textContent =
        "These are Massachusetts programs, so we can only help residents of the Commonwealth. If the person is planning a move to Massachusetts, come back once they're settled — we'd be glad to help then.";
      estEl.textContent = "—";
      resultBox.focus();
      return;
    }

    // Build the list of likely-relevant programs + a rough $ range.
    var hits = [];
    var low = 0;
    var high = 0;

    var senior = age === "yes";
    var nearSenior = age === "near";
    var lowerIncome = income === "low";
    var midIncome = income === "mid";

    // Senior Circuit Breaker — homeowners & renters, income-tested.
    if ((senior || nearSenior) && (lowerIncome || midIncome)) {
      hits.push("Senior Circuit Breaker property-tax credit (refundable — and often amendable up to 3 prior years)");
      low += 700; high += 2820;
    }

    // Property-tax exemptions / deferral — owners, town by town.
    if (senior && home === "own") {
      hits.push("Local property-tax exemptions or deferral (Clause 41C / 41C½, 17D, and others — set by your town)");
      low += 500; high += 2000;
    }

    // Fuel Assistance + utility discount rate.
    if ((lowerIncome || midIncome) && (heat === "yes" || home === "rent" || home === "own")) {
      hits.push("Fuel Assistance (LIHEAP) and the discounted utility rate");
      low += 400; high += 1600;
    }

    // SNAP — income-tested; senior rules are more generous.
    if (lowerIncome) {
      hits.push("SNAP food benefits (senior eligibility rules are more generous than most expect)");
      low += 300; high += 2400;
    }

    // Medicare Savings Program + Extra Help — no asset test for MSP.
    if ((senior || nearSenior) && (lowerIncome || midIncome)) {
      hits.push("Medicare Savings Program (the state can pay the Part B premium — no asset test) plus Extra Help for drug costs");
      low += 1200; high += 2200;
    }

    // Veterans — Aid & Attendance, referred out free.
    if (vet === "yes") {
      hits.push("VA Aid & Attendance and veterans' property-tax exemptions (we flag these and connect you to a free, accredited Veterans Service Officer)");
      low += 1000; high += 3600;
    }

    // Lifeline / reduced-fare transit — broadly available to low-income seniors.
    if (senior && (lowerIncome || midIncome)) {
      hits.push("Lifeline phone/internet discount and reduced-fare senior transit");
      low += 120; high += 400;
    }

    // Nobody matched (e.g., under 60, higher income, owns, no vet).
    if (hits.length === 0) {
      titleEl.textContent = "A full review is the best way to be sure";
      leadEl.textContent =
        "Based on your quick answers, the biggest programs are income- or age-tested and may not be a fit right now — but town-level property-tax breaks and a handful of other programs still surprise people. A full $179 review checks everything against your exact situation, and it's money-back if we don't find at least $500/yr.";
      estEl.textContent = "$0–$500+";
      resultBox.focus();
      return;
    }

    // Normal result.
    titleEl.textContent = "Good news — there's likely money worth claiming";
    leadEl.textContent =
      "Based on your quick answers, these Massachusetts programs are worth a closer look. " +
      "A full review confirms eligibility for each, checks your town's specific rules, and prepares the paperwork.";
    estEl.textContent = "$" + fmt(low) + "–$" + fmt(high);

    hits.forEach(function (h) {
      var li = document.createElement("li");
      li.innerHTML =
        '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">' +
        '<circle cx="11" cy="11" r="11" fill="#1E4E3C"></circle>' +
        '<path d="M6.5 11.4l3 3L15.8 8" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"></path>' +
        "</svg><span></span>";
      li.querySelector("span").textContent = h;
      hitsEl.appendChild(li);
    });

    resultBox.focus();
  }

  function fmt(n) {
    // Round to a friendly hundred and add thousands separators.
    n = Math.round(n / 100) * 100;
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* ---------------------------------------------------------------------
     2) START FORM — friendly, no-backend handler for the static preview.
     --------------------------------------------------------------------- */
  var startForm = document.getElementById("startForm");
  if (startForm) {
    startForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = document.getElementById("startMsg");

      // Basic required-field check so the preview behaves like the real thing.
      var missing = [];
      ["name", "who", "email", "town"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && !el.value.trim()) missing.push(el);
      });

      if (missing.length) {
        missing[0].focus();
        if (msg) {
          msg.hidden = false;
          msg.style.background = "#F6E2D8";
          msg.style.borderColor = "#E3B7A4";
          msg.style.color = "#8A3C22";
          msg.textContent = "Please fill in your name, who it's for, your email, and the town before continuing.";
        }
        return;
      }

      if (msg) {
        msg.hidden = false;
        msg.style.background = "";
        msg.style.borderColor = "";
        msg.style.color = "";
        msg.textContent =
          "Thanks! This is a design preview, so nothing was sent — in the live version, we'd email your service agreement and secure payment link within one business day. No payment is collected at this step.";
        msg.focus && msg.focus();
      }
      startForm.querySelector('button[type="submit"]').textContent = "Submitted ✓";
    });
  }
})();
