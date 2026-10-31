/* Help bar reading options (2026-10-29): larger text and high contrast.
   Loaded in <head> so a saved choice applies before the page paints (no flash).
   Choices are kept in this browser only (localStorage), never sent anywhere.
   - bf_text:     "0" normal, "1" larger, "2" largest
   - bf_contrast: "1" high contrast on
   On the free check page (html[data-page="check"]) text size is handled by check.js
   (body.lg / body.xl), which reads and writes the same bf_text key. */
(function () {
  var root = document.documentElement;
  var isCheck = root.getAttribute("data-page") === "check";

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function put(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function level() { var n = parseInt(get("bf_text") || "0", 10); return n >= 0 && n <= 2 ? n : 0; }

  function applySize(n) {
    root.classList.remove("bf-t1", "bf-t2");
    if (n && !isCheck) root.classList.add("bf-t" + n);
  }
  function applyContrast(on) {
    if (on) root.classList.add("bf-hc"); else root.classList.remove("bf-hc");
  }
  function sync() {
    var hc = root.classList.contains("bf-hc"), n = level();
    var b = document.querySelectorAll("[data-bf-hc]");
    for (var i = 0; i < b.length; i++) {
      b[i].setAttribute("aria-pressed", hc ? "true" : "false");
      b[i].textContent = hc ? "Normal colors" : "High contrast";
    }
    var dn = document.querySelectorAll('[data-bf-size="-1"]'), up = document.querySelectorAll('[data-bf-size="1"]');
    for (var j = 0; j < dn.length; j++) dn[j].disabled = n === 0;
    for (var k = 0; k < up.length; k++) up[k].disabled = n === 2;
  }

  // Before first paint
  root.classList.add("js");   // lets the CSS fold the options behind the Aa button on phones (no JS = always shown)
  applySize(level());
  applyContrast(get("bf_contrast") === "1");

  document.addEventListener("DOMContentLoaded", function () {
    var hcb = document.querySelectorAll("[data-bf-hc]");
    for (var i = 0; i < hcb.length; i++) {
      hcb[i].addEventListener("click", function () {
        var on = !root.classList.contains("bf-hc");
        put("bf_contrast", on ? "1" : "0");
        applyContrast(on); sync();
      });
    }
    var more = document.querySelectorAll(".hb-more");
    for (var m = 0; m < more.length; m++) {
      more[m].addEventListener("click", function () {
        var bar = this.closest(".helpbar"), open = !bar.classList.contains("open");
        bar.classList.toggle("open", open);
        this.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }
    var sb = document.querySelectorAll("[data-bf-size]");
    for (var j = 0; j < sb.length; j++) {
      sb[j].addEventListener("click", function () {
        var n = Math.max(0, Math.min(2, level() + parseInt(this.getAttribute("data-bf-size"), 10)));
        put("bf_text", String(n));
        applySize(n); sync();
      });
    }
    sync();
  });
})();
