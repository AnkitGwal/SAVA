/**
 * ============================================================
 *  POSTS LIST PAGE — controller  (/posts)
 * ============================================================
 * Filters (type, state, qualification, search, page) live in the URL, so
 * every filtered view can be shared and the back button works. Data:
 *   GET /api/posts?type&state&qualification&q&page&limit  -> list
 *   GET /api/home                                          -> filter options
 * Load order: sava-ui.js -> this file.
 */
(function () {
  "use strict";
  var fmt = window.savaFormat, esc = fmt.esc, api = window.savaApi;

  // [type, tab label, page heading]
  var TYPES = [
    ["", "All", "All posts"], ["job", "Jobs", "Latest Government Jobs"], ["result", "Results", "Results"],
    ["admit_card", "Admit Cards", "Admit Cards"], ["answer_key", "Answer Keys", "Answer Keys"],
    ["syllabus", "Syllabus", "Syllabus"], ["admission", "Admissions", "Admissions"]
  ];
  var BY = {};
  TYPES.forEach(function (t) { BY[t[0]] = t; });

  var KEYS = ["type", "state", "qualification", "q", "page"];
  var LIMIT = 20;
  var q = {};
  var inflight = null;

  function el(id) { return document.getElementById(id); }
  var list = el("postList"), pager = el("pager"), input = el("searchInput");

  // ---------------- URL state ----------------

  function readURL() {
    var p = new URLSearchParams(location.search);
    q = {};
    KEYS.forEach(function (k) { var v = p.get(k); if (v) q[k] = v; });
    if (!BY[q.type || ""]) delete q.type;
  }

  function query(withLimit) {
    var p = new URLSearchParams();
    KEYS.forEach(function (k) { if (q[k] && !(k === "page" && q[k] === "1")) p.set(k, q[k]); });
    if (withLimit) p.set("limit", LIMIT);
    return p.toString();
  }

  /** Apply filter changes (a falsy value removes the key), update the URL, reload. */
  function go(changes) {
    Object.keys(changes).forEach(function (k) { if (changes[k]) q[k] = String(changes[k]); else delete q[k]; });
    if (!("page" in changes)) delete q.page; // any filter change goes back to page 1
    var s = query(false);
    history.pushState(null, "", "/posts" + (s ? "?" + s : ""));
    sync();
    load();
  }

  // ---------------- Controls ----------------

  function ensureOption(sel, value) {
    if (value && !Array.prototype.some.call(sel.options, function (o) { return o.value === value; })) {
      sel.insertAdjacentHTML("beforeend", '<option value="' + esc(value) + '">' + esc(value) + "</option>");
    }
  }

  function sync() {
    var t = BY[q.type || ""];
    el("listTitle").textContent = t[2];
    el("crumbLabel").textContent = t[0] ? t[1] : "All posts";
    input.value = q.q || "";
    ensureOption(el("stateSel"), q.state);
    ensureOption(el("qualSel"), q.qualification);
    el("stateSel").value = q.state || "";
    el("qualSel").value = q.qualification || "";
    Array.prototype.forEach.call(el("typeTabs").children, function (a) {
      if (a.dataset.type === (q.type || "")) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
    });
    var bits = [q.state, q.qualification, q.q && '"' + q.q + '"'].filter(Boolean);
    document.title = t[2] + (bits.length ? " - " + bits.join(", ") : "") + " | SAVA";
  }

  function fillSelect(id, rows, label) {
    var s = el(id), cur = s.value;
    s.innerHTML = '<option value="">' + label + "</option>" + rows.map(function (r) {
      return '<option value="' + esc(r.name) + '">' + esc(r.name) + " (" + r.n + ")</option>";
    }).join("");
    s.value = cur;
  }

  el("typeTabs").innerHTML = TYPES.map(function (t) {
    var href = t[0] ? "/posts?type=" + t[0] : "/posts";
    var accent = t[0] ? "var(--t-" + t[0] + ")" : "var(--ink)";
    return '<a href="' + href + '" data-type="' + t[0] + '" style="--accent:' + accent + '">' + t[1] + "</a>";
  }).join("");

  el("typeTabs").addEventListener("click", function (e) {
    var a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    go({ type: a.dataset.type });
  });
  el("stateSel").addEventListener("change", function () { go({ state: this.value }); });
  el("qualSel").addEventListener("change", function () { go({ qualification: this.value }); });
  el("clearBtn").addEventListener("click", function () { go({ state: "", qualification: "", q: "" }); });
  el("searchForm").addEventListener("submit", function (e) { e.preventDefault(); go({ q: input.value.trim() }); });
  window.addEventListener("popstate", function () { readURL(); sync(); load(); });

  pager.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-page]");
    if (!b || b.disabled) return;
    go({ page: b.dataset.page });
    el("main").scrollIntoView({ behavior: "smooth" });
  });
  list.addEventListener("click", function (e) {
    if (e.target.closest("[data-clear]")) go({ state: "", qualification: "", q: "" });
    if (e.target.closest("[data-retry]")) load();
  });

  // ---------------- Render ----------------

  function rowHTML(p) {
    var left = p.last_date ? fmt.daysLeft(p.last_date) : null;
    var urgent = left !== null && left >= 0 && left <= 3;
    var dateText = "";
    if (left !== null) {
      dateText = left < 0 ? "Closed " + fmt.date(p.last_date)
        : "Last date " + fmt.date(p.last_date) + (left === 0 ? " (today)" : " (" + left + (left === 1 ? " day" : " days") + " left)");
    }
    return (
      '<li style="--accent:var(--t-' + esc(p.type) + ')"><a href="/post/' + encodeURIComponent(p.slug) + '">' +
        '<span class="sava-ls-title">' + esc(p.title) + (fmt.isNew(p.post_date) ? '<span class="sava-badge-new">New</span>' : "") + "</span>" +
        '<span class="sava-ls-meta"><span class="sava-tag">' + esc((BY[p.type] || [])[1] || p.type) + "</span>" +
          (p.organization ? "<span>" + esc(p.organization) + "</span>" : "") +
          (p.state ? "<span>" + esc(p.state) + "</span>" : "") +
          (p.vacancies ? "<span>" + fmt.count(p.vacancies) + " posts</span>" : "") +
          (dateText ? '<span class="' + (urgent ? "urgent" : "") + '">' + dateText + "</span>" : "") +
        "</span></a></li>"
    );
  }

  function btn(label, n, off) { return '<button type="button" data-page="' + n + '"' + (off ? " disabled" : "") + ">" + label + "</button>"; }

  function renderPager(page, pages) {
    if (pages <= 1) { pager.innerHTML = ""; return; }
    var from = Math.max(1, Math.min(page - 2, pages - 4)), to = Math.min(pages, from + 4);
    var h = btn("Previous", page - 1, page === 1);
    for (var i = from; i <= to; i++) h += '<button type="button" data-page="' + i + '"' + (i === page ? ' aria-current="page"' : "") + ">" + i + "</button>";
    pager.innerHTML = h + btn("Next", page + 1, page === pages);
  }

  function load() {
    if (inflight) inflight.abort();
    var mine = inflight = new AbortController();
    list.setAttribute("aria-busy", "true");
    list.innerHTML = '<li class="sava-skel"><i></i><i></i><i></i><i></i></li>';

    api("/api/posts?" + query(true), { signal: mine.signal }).then(function (d) {
      if (mine.signal.aborted) return;
      list.removeAttribute("aria-busy");
      if (!d || d.error) {
        list.innerHTML = '<li class="sava-empty">Could not load posts. <button type="button" data-retry>Try again</button></li>';
        pager.innerHTML = ""; el("listCount").textContent = "";
        return;
      }
      if (!d.items.length) {
        list.innerHTML = '<li class="sava-empty">No posts match these filters. <button type="button" data-clear>Clear filters</button></li>';
        pager.innerHTML = ""; el("listCount").textContent = "0 posts";
        return;
      }
      var first = (d.page - 1) * LIMIT + 1;
      el("listCount").textContent = "Showing " + fmt.count(first) + "-" + fmt.count(first + d.items.length - 1) + " of " + fmt.count(d.total);
      list.innerHTML = d.items.map(rowHTML).join("");
      renderPager(d.page, d.pages);
    });
  }

  // ---------------- Boot ----------------

  document.addEventListener("sava:ready", function () {
    readURL();
    sync();
    load();
    api("/api/home").then(function (d) {
      if (!d || d.error) return;
      fillSelect("stateSel", d.states, "All states");
      fillSelect("qualSel", d.quals, "Any qualification");
      sync();
    });
  });
})();