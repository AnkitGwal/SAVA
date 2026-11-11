/**
 * ============================================================
 *  SAVA — shared UI helpers
 * ============================================================
 * Loaded before every page script (the counterpart of upms-ui.js).
 *
 *   window.savaApi(url, options)  -> Promise. Resolves with the parsed JSON
 *                                    for ANY answer the server sent (success
 *                                    data, or { error } on a 4xx / 5xx), and
 *                                    with null when the request never got a
 *                                    JSON answer (offline, aborted, bad body).
 *                                    Callers check:  !data  ||  data.error
 *   window.savaFormat             -> esc / date / count / daysLeft / isNew
 *   window.savaDebounce(fn, ms)   -> trailing-edge debounce
 *
 * Also wires the theme toggle (#themeBtn) on any page that has one, and
 * fires "sava:ready" on document once the DOM is parsed.
 *
 * Load order: sava-ui.js -> page script (e.g. home.js).
 */
(function () {
  "use strict";

  var MS_PER_DAY = 864e5;

  // ---------------------------------------------------------------
  // API
  // ---------------------------------------------------------------

  function savaApi(url, options) {
    var opts = options || {};
    var init = {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: {},
      signal: opts.signal
    };
    if (opts.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = opts.body;
    }
    return fetch(url, init)
      .then(function (res) { return res.json(); })
      .catch(function () { return null; });
  }

  // ---------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------

  var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
  }

  // The server sends DATE columns as plain "YYYY-MM-DD" strings (dateStrings: true).
  function toDate(value) {
    return new Date(String(value).slice(0, 10) + "T00:00:00");
  }

  function startOfToday() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function date(value) {
    return toDate(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  function count(value) {
    return Number(value).toLocaleString("en-IN");
  }

  /** Whole days from today until `value` — 0 means "today", negative means already passed. */
  function daysLeft(value) {
    return Math.ceil((toDate(value) - startOfToday()) / MS_PER_DAY);
  }

  /** True for a post dated today or within the previous two days. */
  function isNew(value) {
    return !!value && (startOfToday() - toDate(value)) / MS_PER_DAY <= 2;
  }

  // ---------------------------------------------------------------
  // Debounce
  // ---------------------------------------------------------------

  function savaDebounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  // ---------------------------------------------------------------
  // Theme toggle
  // ---------------------------------------------------------------

  function initTheme() {
    var btn = document.getElementById("themeBtn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("sava-theme", next); } catch (e) { /* private mode: ignore */ }
    });
  }

  // ---------------------------------------------------------------
  // Expose + ready
  // ---------------------------------------------------------------

  window.savaApi = savaApi;
  window.savaDebounce = savaDebounce;
  window.savaFormat = { esc: esc, date: date, count: count, daysLeft: daysLeft, isNew: isNew };

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    document.dispatchEvent(new CustomEvent("sava:ready"));
  });
})();