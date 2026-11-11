/**
 * ============================================================
 *  HOME PAGE — controller
 * ============================================================
 * One call to GET /api/home (cached 60s on the server) feeds the whole
 * page: ticker, qualification / category / state chips, the closing-soon
 * board, one list per post type, and the most-read list. The server
 * decides what is published and what counts as "closing soon"; this file
 * only renders what it is given.
 *
 * Search suggestions come from GET /api/posts?q=... — public, published
 * posts only. Subscribing posts to /api/subscribe.
 *
 * Load order: sava-ui.js -> this file.
 */
(function () {
  var fmt = window.savaFormat;
  var esc = fmt.esc;

  // [post type, column heading] — order here is the order on the page.
  var TYPES = [
    ["job", "Latest Jobs"],
    ["result", "Results"],
    ["admit_card", "Admit Cards"],
    ["answer_key", "Answer Keys"],
    ["syllabus", "Syllabus"],
    ["admission", "Admissions"]
  ];
  var TYPE_LABEL = {};
  TYPES.forEach(function (t) { TYPE_LABEL[t[0]] = t[1]; });

  var CLOSING_WINDOW_DAYS = 10; // must match INTERVAL in getHomeData() on the server
  var searchInput = el("searchInput");
  var suggestBox = el("suggestBox");
  var suggestCtl = null;

  function el(id) { return document.getElementById(id); }

  // ---------------------------------------------------------------
  // Small render helpers
  // ---------------------------------------------------------------

  function accent(type) { return 'style="--accent:var(--t-' + type + ')"'; }

  function postHref(post) { return "/post/" + encodeURIComponent(post.slug); }

  function listUrl(params) { return "/posts?" + new URLSearchParams(params).toString(); }

  function leftText(days) {
    if (days <= 0) return "Last day today";
    return days === 1 ? "1 day left" : days + " days left";
  }

  // ---------------------------------------------------------------
  // Category columns
  // ---------------------------------------------------------------

  function postItemHTML(p) {
    var left = p.last_date ? fmt.daysLeft(p.last_date) : null;
    var urgent = left !== null && left >= 0 && left <= 3;
    return (
      '<li><a href="' + postHref(p) + '">' +
        '<span class="sava-hm-list-title">' + esc(p.title) + (fmt.isNew(p.post_date) ? '<span class="sava-badge-new">New</span>' : "") + "</span>" +
        '<span class="sava-hm-list-meta">' +
          (p.organization ? "<span>" + esc(p.organization) + "</span>" : "") +
          (p.vacancies ? "<span>" + fmt.count(p.vacancies) + " posts</span>" : "") +
          (p.last_date ? '<span class="' + (urgent ? "urgent" : "") + '">Last date ' + fmt.date(p.last_date) + "</span>" : "") +
        "</span>" +
      "</a></li>"
    );
  }

  function renderColumns(lists) {
    el("columnsGrid").innerHTML = TYPES.map(function (t) {
      var type = t[0];
      var items = lists[type] || [];
      return (
        '<section class="sava-hm-col" id="sec-' + type + '" ' + accent(type) + ">" +
          "<header><h2>" + t[1] + '</h2><a href="' + listUrl({ type: type }) + '">View all</a></header>' +
          (items.length
            ? '<ul class="sava-hm-list">' + items.map(function (p) { return postItemHTML(p); }).join("") + "</ul>"
            : '<p class="sava-empty sava-hm-col-empty">Nothing posted here yet.</p>') +
        "</section>"
      );
    }).join("");
  }

  function showSkeleton() {
    el("columnsGrid").innerHTML = TYPES.map(function (t) {
      return '<section class="sava-hm-col" ' + accent(t[0]) + ' aria-hidden="true"><div class="sava-skel"><i></i><i></i><i></i><i></i></div></section>';
    }).join("");
  }

  // ---------------------------------------------------------------
  // Closing-soon board
  // ---------------------------------------------------------------

  function renderClosing(items) {
    el("closingList").innerHTML = items.length
      ? items.map(function (p) {
          var days = Math.max(fmt.daysLeft(p.last_date), 0);
          var fill = Math.round(((CLOSING_WINDOW_DAYS - Math.min(days, CLOSING_WINDOW_DAYS)) / CLOSING_WINDOW_DAYS) * 100);
          return (
            '<li><a href="' + postHref(p) + '">' + esc(p.title) + "</a>" +
              '<div class="sava-hm-closing-row"><span>' + esc(p.organization || "") + '</span><span class="sava-hm-closing-left">' + leftText(days) + "</span></div>" +
              '<div class="sava-hm-meter" aria-hidden="true"><i style="width:' + Math.max(fill, 6) + '%"></i></div>' +
            "</li>"
          );
        }).join("")
      : '<li><p class="sava-empty">No job applications close in the next ' + CLOSING_WINDOW_DAYS + " days.</p></li>";
  }

  // ---------------------------------------------------------------
  // Ticker
  // ---------------------------------------------------------------

  function renderTicker(items) {
    if (!items.length) { el("ticker").hidden = true; return; }
    var links = items.map(function (p) { return '<a href="' + postHref(p) + '">' + esc(p.title) + "</a>"; }).join("");
    el("tickerInner").innerHTML = links + links; // duplicated so the scroll loop is seamless
  }

  // ---------------------------------------------------------------
  // Chips: qualification, category, state, most-read
  // ---------------------------------------------------------------

  function chipHTML(param, row) {
    var params = {};
    params[param] = row.name;
    return '<a class="sava-chip" href="' + listUrl(params) + '">' + esc(row.name) + " <b>" + row.n + "</b></a>";
  }

  function renderChips(d) {
    el("qualChips").innerHTML = d.quals.map(function (c) { return chipHTML("qualification", c); }).join("");

    el("typeLinks").innerHTML = TYPES.map(function (t) {
      return '<a href="' + listUrl({ type: t[0] }) + '" ' + accent(t[0]) + ">" + t[1] + "<small>" + (d.counts[t[0]] || 0) + "</small></a>";
    }).join("");

    el("stateChips").innerHTML = d.states.length
      ? d.states.map(function (s) { return chipHTML("state", s); }).join("")
      : '<p class="sava-empty">States appear here once posts are added.</p>';

    el("trendingList").innerHTML = d.trending.length
      ? d.trending.map(function (p) { return '<li><a href="' + postHref(p) + '">' + esc(p.title) + "</a></li>"; }).join("")
      : '<li class="sava-hm-ranked-empty"><p class="sava-empty">Popular posts will show here.</p></li>';
  }

  // ---------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------

  function render(d) {
    renderTicker(d.ticker);
    renderChips(d);
    renderClosing(d.closing);
    renderColumns(d.lists);
  }

  function load() {
    showSkeleton();
    return window.savaApi("/api/home").then(function (data) {
      if (!data || data.error) {
        el("columnsGrid").innerHTML = '<p class="sava-empty">Could not load updates. <button type="button" id="retryBtn">Try again</button></p>';
        el("retryBtn").addEventListener("click", load);
        return;
      }
      render(data);
    });
  }

  // ---------------------------------------------------------------
  // Live search suggestions
  // ---------------------------------------------------------------

  function hideSuggestions() {
    if (suggestCtl) suggestCtl.abort();
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
  }

  function fetchSuggestions() {
    var term = searchInput.value.trim();
    if (term.length < 2) { hideSuggestions(); return; }

    if (suggestCtl) suggestCtl.abort();
    suggestCtl = new AbortController();

    window.savaApi("/api/posts?limit=6&q=" + encodeURIComponent(term), { signal: suggestCtl.signal }).then(function (data) {
      if (!data || data.error) return; // aborted or offline: keep the last list
      suggestBox.innerHTML = data.items.length
        ? data.items.map(function (p) {
            return (
              '<li><a href="' + postHref(p) + '">' + esc(p.title) +
                "<small>" + esc(TYPE_LABEL[p.type] || "") + (p.organization ? " - " + esc(p.organization) : "") + "</small></a></li>"
            );
          }).join("")
        : '<li class="sava-suggest-none">No match. Try a shorter word.</li>';
      suggestBox.hidden = false;
    });
  }

  var debouncedSuggest = window.savaDebounce(fetchSuggestions, 250);

  searchInput.addEventListener("input", function () {
    if (searchInput.value.trim().length < 2) hideSuggestions();
    debouncedSuggest();
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape") hideSuggestions();
    if (e.key === "ArrowDown") {
      var first = suggestBox.querySelector("a");
      if (first) first.focus();
      e.preventDefault();
    }
  });

  suggestBox.addEventListener("keydown", function (e) {
    var links = Array.prototype.slice.call(suggestBox.querySelectorAll("a"));
    var i = links.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      var next = links[Math.min(i + 1, links.length - 1)];
      if (next) next.focus();
      e.preventDefault();
    }
    if (e.key === "ArrowUp") {
      (i <= 0 ? searchInput : links[i - 1]).focus();
      e.preventDefault();
    }
    if (e.key === "Escape") { hideSuggestions(); searchInput.focus(); }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest("#searchForm")) hideSuggestions();
  });

  // The mobile tab bar's "Search" jumps to the top, then focuses the box.
  el("tabSearch").addEventListener("click", function () {
    setTimeout(function () { searchInput.focus(); }, 250);
  });

  // ---------------------------------------------------------------
  // Subscribe
  // ---------------------------------------------------------------

  el("subForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = el("subMsg");
    var emailInput = el("subEmail");
    msg.textContent = "Subscribing...";

    window.savaApi("/api/subscribe", {
      method: "POST",
      body: JSON.stringify({ email: emailInput.value.trim() })
    }).then(function (data) {
      if (!data) { msg.textContent = "Could not reach the server. Check your connection and try again."; return; }
      if (data.error) { msg.textContent = data.error; return; }
      msg.textContent = "Subscribed. You will get new notifications by email.";
      emailInput.value = "";
    });
  });

  // ---------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------

  document.addEventListener("sava:ready", load);
})();