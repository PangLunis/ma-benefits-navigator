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

/* ---------------------------------------------------------------------
   3) ROTATING BULLET LISTS — <ul class="rotator" data-interval="3800">
   Shows one item at a time to cut the amount of text on screen. Pauses on
   hover / keyboard focus / touch; dots jump to an item. Skipped entirely
   for prefers-reduced-motion (the list just stays a normal, full list).
   --------------------------------------------------------------------- */
(function () {
  "use strict";
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var lists = document.querySelectorAll(".rotator");
  var PHONE = window.matchMedia ? window.matchMedia("(max-width: 720px)") : { matches: false };
  Array.prototype.forEach.call(lists, function (ul) {
    var items = Array.prototype.slice.call(ul.children);
    if (items.length < 2) return;
    var mobileOnly = ul.getAttribute("data-mobile") === "1";   // long card sections rotate on phones only
    var interval = parseInt(ul.getAttribute("data-interval"), 10) || 3800;
    var idx = 0, timer = null, paused = false, on = false;

    var dots = document.createElement("div");
    dots.className = "rot-dots";
    dots.setAttribute("aria-label", "Show item");
    items.forEach(function (li, k) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", "Show point " + (k + 1) + " of " + items.length);
      b.addEventListener("click", function () { show(k); restart(); });
      dots.appendChild(b);
    });
    ul.parentNode.insertBefore(dots, ul.nextSibling);

    function fit() {
      // Height = tallest item, so the page never jumps as items change.
      ul.classList.remove("is-rotating");
      ul.style.height = "";
      var w = ul.getBoundingClientRect().width;
      var h = 0;
      ul.classList.add("is-rotating");
      items.forEach(function (li) { li.style.width = w + "px"; h = Math.max(h, li.getBoundingClientRect().height); li.style.width = ""; });
      ul.style.height = Math.ceil(h) + "px";
    }
    function show(k) {
      idx = (k + items.length) % items.length;
      items.forEach(function (li, j) { li.classList.toggle("is-active", j === idx); });
      Array.prototype.forEach.call(dots.children, function (d, j) {
        d.setAttribute("aria-current", j === idx ? "true" : "false");
      });
    }
    function tick() { if (!paused) show(idx + 1); }
    function restart() { clearInterval(timer); timer = setInterval(tick, interval); }
    function pause() { paused = true; }
    function resume() { paused = false; }
    function start() { if (on) return; on = true; dots.style.display = ""; fit(); show(idx); restart(); }
    function stop() {
      if (!on) return; on = false; clearInterval(timer);
      ul.classList.remove("is-rotating"); ul.style.height = "";
      items.forEach(function (li) { li.classList.remove("is-active"); });
      dots.style.display = "none";
    }
    function apply() { if (!mobileOnly || PHONE.matches) start(); else stop(); }

    [ul, dots].forEach(function (el) {
      el.addEventListener("mouseenter", pause);
      el.addEventListener("mouseleave", resume);
      el.addEventListener("focusin", pause);
      el.addEventListener("focusout", resume);
      el.addEventListener("touchstart", pause, { passive: true });
      el.addEventListener("touchend", function () { setTimeout(resume, 6000); }, { passive: true });
    });
    window.addEventListener("resize", function () { apply(); if (on) fit(); });

    dots.style.display = "none";
    apply();
  });
})();

/* ===================== Motion pass (2026-09-26) =====================
   Scroll reveals, count-up numbers, the "form fills itself" demo and the
   phone sticky CTA. Content is fully visible without JS; everything is
   instant (no motion) under prefers-reduced-motion. */
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasIO = "IntersectionObserver" in window;
  var root = document.documentElement;

  function countUp(el) {
    var to = parseFloat(el.getAttribute("data-to")), pre = el.getAttribute("data-prefix") || "";
    if (!to || reduce) { return; }
    var t0 = null, dur = 1200;
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + Math.round(to * e).toLocaleString("en-US");
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // ---- "We fill in the forms" demo ----
  var demoTimers = [];
  function demoReset(box) {
    demoTimers.forEach(clearTimeout); demoTimers = [];
    box.querySelectorAll(".fd-val").forEach(function (v) { v.textContent = ""; v.classList.remove("typing"); });
    box.querySelectorAll(".fd-box").forEach(function (b) { b.classList.remove("on"); });
    var st = box.querySelector(".fd-stamp"); if (st) st.classList.remove("on");
  }
  function demoFill(box, instant) {
    var items = box.querySelectorAll(".fd-val, .fd-box"), t = 300;
    items.forEach(function (it) {
      if (it.classList.contains("fd-box")) {
        if (instant) { it.classList.add("on"); return; }
        demoTimers.push(setTimeout(function () { it.classList.add("on"); }, t)); t += 380; return;
      }
      var txt = it.getAttribute("data-type") || "";
      if (instant) { it.textContent = txt; return; }
      (function (el, text, start) {
        demoTimers.push(setTimeout(function () { el.classList.add("typing"); }, start));
        for (var i = 1; i <= text.length; i++) {
          (function (j) { demoTimers.push(setTimeout(function () { el.textContent = text.slice(0, j); }, start + j * 55)); })(i);
        }
        demoTimers.push(setTimeout(function () { el.classList.remove("typing"); }, start + text.length * 55 + 120));
      })(it, txt, t);
      t += txt.length * 55 + 260;
    });
    var st = box.querySelector(".fd-stamp");
    if (st) { if (instant) st.classList.add("on"); else demoTimers.push(setTimeout(function () { st.classList.add("on"); }, t + 200)); }
  }

  var demo = document.querySelector(".formsdemo-band");
  if (!hasIO || reduce) {
    document.querySelectorAll(".reveal").forEach(function (s) { s.classList.add("in"); });
    if (demo) demoFill(demo, true);
  } else {
    root.classList.add("reveal-on");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var s = en.target;
        if (!s.classList.contains("in")) {
          s.classList.add("in");
          s.querySelectorAll(".count").forEach(countUp);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".reveal").forEach(function (s) { io.observe(s); });

    if (demo) {
      var playing = false;
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && !playing) { playing = true; demoReset(demo); demoFill(demo, false); }
          else if (!en.isIntersecting && playing) { playing = false; demoReset(demo); }
        });
      }, { threshold: 0.35 }).observe(demo.querySelector(".fd-paper") || demo);
    }
  }

  // ---- Sticky "Start the free check" on phones ----
  var sticky = document.querySelector(".sticky-cta");
  if (sticky && hasIO) {
    var heroCta = document.querySelector(".hero-cta"), finalCta = document.querySelector(".final-cta");
    var heroVisible = true, finalVisible = false;
    function upd() { sticky.classList.toggle("show", !heroVisible && !finalVisible); }
    if (heroCta) new IntersectionObserver(function (e) { heroVisible = e[0].isIntersecting; upd(); }).observe(heroCta);
    if (finalCta) new IntersectionObserver(function (e) { finalVisible = e[0].isIntersecting; upd(); }).observe(finalCta);
  }
})();
