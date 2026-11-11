/**
 * ============================================================
 *  POST DETAIL PAGE — controller  (/post/:slug)
 * ============================================================
 * GET /api/posts/:slug -> { post, related }. `post.details` carries the
 * structured sections the admin fills in:
 *   dates / fees / age  = [{ label, value, hl }]      fee_notes / how_to = [text]
 *   age_note = text     vacancy = [{ post, total, eligibility }]
 *   links    = [{ label, url, hl }]
 * Sections with no data are skipped, and the section navigation only lists
 * the sections that exist. Older posts without `details` still get a dates
 * block built from their post / last date, and their apply, notification and
 * official links are merged into "Important links".
 * Colour: <body> gets type-<type>, and post.css maps that to --accent.
 * Load order: sava-ui.js -> sava-content.js -> this file.
 */
(function () {
  "use strict";
  var fmt = window.savaFormat, esc = fmt.esc;

  var LIST = { job: "Jobs", result: "Results", admit_card: "Admit Cards", answer_key: "Answer Keys", syllabus: "Syllabus", admission: "Admissions" };
  var TAG = { job: "Job", result: "Result", admit_card: "Admit card", answer_key: "Answer key", syllabus: "Syllabus", admission: "Admission" };
  var APPLY = {
    job: "Apply online", result: "Check result", admit_card: "Download admit card",
    answer_key: "View answer key", syllabus: "View syllabus", admission: "Apply online"
  };

  // Paste your channel links between the quotes to show "Join" buttons under the title. Leave empty to hide them.
  var JOIN = { whatsapp: "", telegram: "" };

  var slug = decodeURIComponent(location.pathname.replace(/^\/post\//, "").replace(/\/+$/, ""));
  var current = null, toastTimer;

  function el(id) { return document.getElementById(id); }

  function toast(msg) {
    var t = el("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /** Only http(s) links and our own /uploads files are ever put into an href. */
  function safeUrl(u) {
    u = String(u || "").trim();
    return /^https?:\/\/\S+$/i.test(u) || /^\/uploads\/\S+$/.test(u) ? u : "";
  }

  function multiline(text) { return esc(text).replace(/\n/g, "<br>"); }


    /** The API sends `details` as the JSON text stored in the database; turn it into an object. */
  function parseDetails(raw) {
    if (!raw) return {};
    try {
      var d = typeof raw === "string" ? JSON.parse(raw) : raw;
      return d && typeof d === "object" ? d : {};
    } catch (e) { return {}; }
  }

  // ---------------------------------------------------------------
  // Saved posts (this browser only)
  // ---------------------------------------------------------------

  function saved() { try { return JSON.parse(localStorage.getItem("sava-saved") || "[]"); } catch (e) { return []; } }
  function isSaved() { return saved().indexOf(slug) > -1; }
  function toggleSaved(btn) {
    var list = saved(), i = list.indexOf(slug);
    if (i > -1) list.splice(i, 1); else list.push(slug);
    try { localStorage.setItem("sava-saved", JSON.stringify(list)); } catch (e) { /* private mode */ }
    btn.textContent = isSaved() ? "Saved" : "Save";
    btn.setAttribute("aria-pressed", String(isSaved()));
    toast(isSaved() ? "Saved on this device" : "Removed from saved");
  }

  // ---------------------------------------------------------------
  // Deadline + vacancy helpers
  // ---------------------------------------------------------------

  function deadline(d) {
    var n = fmt.daysLeft(d);
    if (n < 0) return { text: "Closed", cls: "closed" };
    if (n === 0) return { text: "Last day today", cls: "urgent" };
    return { text: n === 1 ? "1 day left" : n + " days left", cls: n <= 3 ? "urgent" : "" };
  }

  /** The vacancy total: the post's own number if set, otherwise the sum of the table when every row is numeric. */
  function vacancyTotal(p, rows) {
    if (p.vacancies) return Number(p.vacancies);
    var sum = 0;
    for (var i = 0; i < rows.length; i++) {
      var n = parseInt(String(rows[i].total).replace(/,/g, ""), 10);
      if (isNaN(n)) return 0;
      sum += n;
    }
    return rows.length ? sum : 0;
  }

  // ---------------------------------------------------------------
  // Links: apply / notification / official first, then the admin's own list
  // ---------------------------------------------------------------

  function buildLinks(p, d) {
    var out = [], seen = {};
    function add(label, url, hl) {
      url = safeUrl(url);
      if (!url || seen[url]) return;
      seen[url] = true;
      out.push({ label: label, url: url, hl: !!hl });
    }
    add(APPLY[p.type] || "Open link", p.apply_link, true);
    add("Download official notification", p.notification_pdf, false);
    add("Official website", p.official_link, false);
    (d.links || []).forEach(function (l) { add(l.label, l.url, l.hl); });
    return out;
  }

  function linksHTML(links) {
    return '<div class="sava-lks">' + links.map(function (l) {
      var file = /\.pdf($|\?)|^\/uploads\//i.test(l.url);
      return (
        '<a class="sava-lk' + (l.hl ? " hl" : "") + '" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' +
          "<span>" + esc(l.label) + '</span><span class="sava-lk-b">' + (file ? "Download" : "Open") + "</span></a>"
      );
    }).join("") + "</div>";
  }

  // ---------------------------------------------------------------
  // Section bodies
  // ---------------------------------------------------------------

  function datesHTML(rows) {
    return '<ul class="sava-tl">' + rows.map(function (r) {
      return "<li" + (r.hl ? ' class="hl"' : "") + "><span>" + esc(r.label) + "</span><b>" + esc(r.value || "-") + "</b></li>";
    }).join("") + "</ul>";
  }

  function tilesHTML(rows) {
    return '<div class="sava-tiles">' + rows.map(function (r) {
      return '<div class="sava-tile"><small>' + esc(r.label) + "</small><b>" + esc(r.value || "-") + "</b></div>";
    }).join("") + "</div>";
  }

  function notesHTML(lines) {
    return lines.length ? '<ul class="sava-notes">' + lines.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "";
  }

  function vacancyHTML(rows, total) {
    return (
      (total ? '<p class="sava-vt-total">Total vacancies: <b>' + fmt.count(total) + "</b></p>" : "") +
      '<table class="sava-vt"><thead><tr><th>Post name</th><th>Total post</th><th>Qualification / eligibility</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return (
          '<tr><td data-label="Post name"><b>' + esc(r.post) + "</b></td>" +
          '<td data-label="Total post">' + esc(r.total || "-") + "</td>" +
          '<td data-label="Eligibility">' + esc(r.eligibility || "-") + "</td></tr>"
        );
      }).join("") + "</tbody></table>"
    );
  }

  function stepsHTML(lines) {
    return '<ol class="sava-steps">' + lines.map(function (s) { return "<li><span>" + esc(s) + "</span></li>"; }).join("") + "</ol>";
  }

  /** Returns the sections that have data, in reading order: [{ id, label, title, html }]. */
  function buildSections(p, d, links, total) {
    var s = [];
    if (p.summary) s.push({ id: "info", label: "Overview", title: "Short information", html: '<p class="sava-sec-lead">' + multiline(p.summary) + "</p>" });

    var dates = d.dates && d.dates.length ? d.dates : [];
    if (!dates.length) {
      if (p.post_date) dates.push({ label: "Post date", value: fmt.date(p.post_date) });
      if (p.last_date) dates.push({ label: "Last date", value: fmt.date(p.last_date), hl: true });
    }
    if (dates.length) s.push({ id: "dates", label: "Dates", title: "Important dates", html: datesHTML(dates) });

    if ((d.fees && d.fees.length) || (d.fee_notes && d.fee_notes.length)) {
      s.push({ id: "fee", label: "Fee", title: "Application fee", html: (d.fees && d.fees.length ? tilesHTML(d.fees) : "") + notesHTML(d.fee_notes || []) });
    }
    if ((d.age && d.age.length) || d.age_note) {
      s.push({
        id: "age", label: "Age", title: "Age limit and relaxation",
        html: (d.age && d.age.length ? tilesHTML(d.age) : "") + (d.age_note ? '<p class="sava-notes-p">' + multiline(d.age_note) + "</p>" : "")
      });
    }
    if (d.vacancy && d.vacancy.length) s.push({ id: "vacancy", label: "Vacancy", title: "Vacancy details", html: vacancyHTML(d.vacancy, total) });
    if (d.how_to && d.how_to.length) s.push({ id: "how", label: "How to apply", title: "How to apply", html: stepsHTML(d.how_to) });
    if (links.length) s.push({ id: "links", label: "Links", title: "Important links", html: linksHTML(links) });
    if (p.content) s.push({ id: "more", label: "More details", title: "More details", html: '<div class="sava-prose">' + window.savaContent.render(p.content) + "</div>" });
    return s;
  }

  // ---------------------------------------------------------------
  // Hero
  // ---------------------------------------------------------------

  function glanceHTML(p, total) {
    var tiles = [];
    if (p.last_date) {
      var dl = deadline(p.last_date);
      tiles.push('<div><small>Last date</small><b>' + fmt.date(p.last_date) + '</b><em class="' + dl.cls + '">' + dl.text + "</em></div>");
    }
    if (total) tiles.push("<div><small>Vacancies</small><b>" + fmt.count(total) + "</b></div>");
    if (p.qualification) tiles.push("<div><small>Qualification</small><b>" + esc(p.qualification) + "</b></div>");
    if (p.post_date) tiles.push("<div><small>Posted</small><b>" + fmt.date(p.post_date) + "</b></div>");
    return tiles.length ? '<div class="sava-glance">' + tiles.join("") + "</div>" : "";
  }

  function joinHTML() {
    var a = [];
    if (safeUrl(JOIN.whatsapp)) a.push('<a href="' + esc(JOIN.whatsapp) + '" target="_blank" rel="noopener noreferrer"><i>W</i>WhatsApp</a>');
    if (safeUrl(JOIN.telegram)) a.push('<a href="' + esc(JOIN.telegram) + '" target="_blank" rel="noopener noreferrer"><i>T</i>Telegram</a>');
    return a.length ? '<div class="sava-join">' + a.join("") + "</div>" : "";
  }

  function renderHero(p, total) {
    var apply = safeUrl(p.apply_link), pdf = safeUrl(p.notification_pdf), site = safeUrl(p.official_link);
    var chips = [p.organization, p.state].filter(Boolean).map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("");

    el("hero").innerHTML =
      '<span class="sava-hero-tag">' + esc(TAG[p.type] || p.type) + "</span>" +
      "<h1>" + esc(p.title) + "</h1>" +
      '<p class="sava-hero-by">Posted <b>' + fmt.date(p.post_date) + "</b>" + (p.views ? " | " + fmt.count(p.views) + " views" : "") + "</p>" +
      (chips ? '<div class="sava-hero-meta">' + chips + "</div>" : "") +
      glanceHTML(p, total) +
      '<div class="sava-hero-cta">' +
        (apply ? '<a class="sava-btn sava-btn-primary" href="' + esc(apply) + '" target="_blank" rel="noopener noreferrer">' + esc(APPLY[p.type] || "Open link") + "</a>" : "") +
        (pdf ? '<a class="sava-btn" href="' + esc(pdf) + '" target="_blank" rel="noopener noreferrer">Notification PDF</a>' : "") +
        (site ? '<a class="sava-btn" href="' + esc(site) + '" target="_blank" rel="noopener noreferrer">Official website</a>' : "") +
        joinHTML() +
      "</div>";

    // Sticky apply bar for phones
    if (apply) {
      el("cta").innerHTML =
        '<a class="sava-btn sava-btn-primary" href="' + esc(apply) + '" target="_blank" rel="noopener noreferrer">' + esc(APPLY[p.type] || "Open link") + "</a>" +
        '<button class="sava-btn" type="button" data-act="share">Share</button>';
      el("cta").hidden = false;
      document.body.classList.add("has-cta");
    }

    el("crumbs").innerHTML =
      '<a href="/">Home</a><span aria-hidden="true">/</span><a href="/posts?type=' + esc(p.type) + '">' + esc(LIST[p.type] || "Posts") + '</a><span aria-hidden="true">/</span><span>' + esc(p.title) + "</span>";
  }

  // ---------------------------------------------------------------
  // Sections + navigation
  // ---------------------------------------------------------------

  function renderSections(list) {
    el("sections").innerHTML = list.map(function (s, i) {
      return '<section class="sava-sec" id="sec-' + s.id + '"><h2><span>' + (i + 1) + "</span>" + esc(s.title) + '</h2><div class="sava-sec-body">' + s.html + "</div></section>";
    }).join("") + '<p class="sava-pg-note">Confirm every date, fee and eligibility rule on the official notification before you apply. SAVA is not a government website.</p>';

    var nav = el("sn");
    if (list.length < 2) { nav.hidden = true; return; }
    nav.innerHTML = list.map(function (s) { return '<a href="#sec-' + s.id + '">' + esc(s.label) + "</a>"; }).join("");
    nav.hidden = false;
  }

  /** Reading progress bar, back-to-top button, and highlighting of the section being read. */
  function initScroll() {
    var bar = el("progress"), top = el("topBtn"), nav = el("sn");

    function onScroll() {
      var h = document.documentElement, max = h.scrollHeight - h.clientHeight;
      bar.style.width = (max > 0 ? Math.min((h.scrollTop / max) * 100, 100) : 0) + "%";
      top.hidden = h.scrollTop < 700;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    top.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

    if (!("IntersectionObserver" in window) || nav.hidden) return;
    var links = Array.prototype.slice.call(nav.querySelectorAll("a"));
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) {
          var on = a.getAttribute("href") === "#" + en.target.id;
          a.setAttribute("aria-current", String(on));
          if (on) nav.scrollLeft = a.offsetLeft - nav.clientWidth / 2 + a.clientWidth / 2; // keep the active chip in view on phones
        });
      });
    }, { rootMargin: "-130px 0px -65% 0px" });
    Array.prototype.forEach.call(el("sections").querySelectorAll(".sava-sec"), function (s) { io.observe(s); });
  }

  // ---------------------------------------------------------------
  // Sidebar: share + save, related posts, email alerts
  // ---------------------------------------------------------------

  function renderSide(related) {
    var url = location.href.split("#")[0];
    var text = encodeURIComponent(current.title + " - " + url);
    el("side").innerHTML =
      '<div class="sava-panel"><h2>Share or save</h2><div class="sava-share">' +
        '<a class="sava-btn" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=' + text + '">WhatsApp</a>' +
        '<a class="sava-btn" target="_blank" rel="noopener noreferrer" href="https://t.me/share/url?url=' + encodeURIComponent(url) + "&text=" + encodeURIComponent(current.title) + '">Telegram</a>' +
        '<button class="sava-btn" type="button" data-act="copy">Copy link</button>' +
        '<button class="sava-btn" type="button" data-act="save" aria-pressed="' + isSaved() + '">' + (isSaved() ? "Saved" : "Save") + "</button>" +
        '<button class="sava-btn" type="button" data-act="print">Print</button>' +
      "</div></div>" +
      (related.length
        ? '<div class="sava-panel"><h2>More ' + esc((LIST[current.type] || "posts").toLowerCase()) + '</h2><ul class="sava-related">' +
            related.map(function (r) {
              return '<li><a href="/post/' + encodeURIComponent(r.slug) + '">' + esc(r.title) + "</a><small>" + esc(r.organization || "") + "</small></li>";
            }).join("") + "</ul></div>"
        : "") +
      '<div class="sava-panel"><h2>Email alerts</h2><form class="sava-sub" id="subForm" novalidate>' +
        '<input id="subEmail" type="email" placeholder="you@example.com" autocomplete="email" aria-label="Email address" required />' +
        '<button class="sava-btn sava-btn-primary" type="submit">Subscribe</button><p class="sava-sub-msg" id="subMsg" role="status"></p></form></div>';
  }

  function copyLink() {
    (navigator.clipboard ? navigator.clipboard.writeText(location.href) : Promise.reject())
      .then(function () { toast("Link copied"); }, function () { toast("Could not copy. Copy it from the address bar."); });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b || !current) return;
    var act = b.dataset.act;
    if (act === "save") toggleSaved(b);
    if (act === "print") window.print();
    if (act === "copy") copyLink();
    if (act === "share") {
      if (navigator.share) navigator.share({ title: current.title, url: location.href }).catch(function () {});
      else copyLink();
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.id !== "subForm") return;
    e.preventDefault();
    var msg = el("subMsg"), input = el("subEmail");
    msg.textContent = "Subscribing...";
    window.savaApi("/api/subscribe", { method: "POST", body: JSON.stringify({ email: input.value.trim() }) }).then(function (d) {
      if (!d) { msg.textContent = "Could not reach the server. Try again."; return; }
      if (d.error) { msg.textContent = d.error; return; }
      msg.textContent = "Subscribed. You will get new notifications by email.";
      input.value = "";
    });
  });

  // ---------------------------------------------------------------
  // SEO: title, description, canonical, JobPosting data
  // ---------------------------------------------------------------

  function updateHead(p) {
    document.title = p.title + " | SAVA";
    var desc = (p.summary || p.title + (p.last_date ? ". Last date " + fmt.date(p.last_date) + "." : "")).replace(/\s+/g, " ");
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", desc.slice(0, 160));

    var canon = document.querySelector('link[rel="canonical"]') || document.head.appendChild(document.createElement("link"));
    canon.rel = "canonical";
    canon.href = location.origin + "/post/" + encodeURIComponent(p.slug);

    if (p.type === "job" && p.organization) {
      var ld = {
        "@context": "https://schema.org", "@type": "JobPosting", title: p.title, description: p.summary || p.title,
        datePosted: String(p.post_date).slice(0, 10), hiringOrganization: { "@type": "Organization", name: p.organization },
        employmentType: "FULL_TIME", directApply: false
      };
      if (p.last_date) ld.validThrough = String(p.last_date).slice(0, 10);
      if (p.state) ld.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", addressRegion: p.state, addressCountry: "IN" } };
      var s = document.createElement("script");
      s.type = "application/ld+json";
      s.textContent = JSON.stringify(ld);
      document.head.appendChild(s);
    }
  }

  // ---------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------

  function notFound(message) {
    document.body.classList.add("type-none");
    el("hero").innerHTML = "<h1>Post not found</h1><p>" + esc(message) + '</p><div class="sava-hero-cta"><a class="sava-btn sava-btn-primary" href="/posts">Browse all posts</a></div>';
    el("sn").hidden = true;
    document.title = "Post not found | SAVA";
  }

  function load() {
    window.savaApi("/api/posts/" + encodeURIComponent(slug)).then(function (data) {
      if (!data) { notFound("Could not reach the server. Check your connection and refresh."); return; }
      if (data.error) { notFound("This post may have been removed or the link is wrong."); return; }

      var p = current = data.post;
      var d = parseDetails(p.details);
      var total = vacancyTotal(p, d.vacancy || []);
      var links = buildLinks(p, d);

      document.body.classList.add("type-" + p.type);
      renderHero(p, total);
      renderSections(buildSections(p, d, links, total));
      renderSide(data.related || []);
      initScroll();
      updateHead(p);
    });
  }

  document.addEventListener("sava:ready", load);
})();