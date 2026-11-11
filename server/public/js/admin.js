/**
 * ============================================================
 *  ADMIN PANEL — controller  (/admin)
 * ============================================================
 * Sign in, dashboard stats, post table with filters, create/edit dialog,
 * publish toggle, delete, password change. The editor also fills the
 * structured page sections stored in the post's `details` column:
 *   dates, fees, fee_notes, age, age_note, vacancy, how_to, links
 * Every route is guarded by requireAdmin on the server; a 401 answer
 * sends the person back to the sign-in form.
 * Load order: sava-ui.js -> sava-content.js -> this file.
 */
(function () {
  "use strict";
  var fmt = window.savaFormat, esc = fmt.esc, api = window.savaApi;

  var TYPES = { job: "Job", result: "Result", admit_card: "Admit card", answer_key: "Answer key", syllabus: "Syllabus", admission: "Admission" };
  // Plain form fields, by their `name` in admin.html. Missing ones are skipped, never fatal.
  var FIELDS = ["title", "type", "organization", "state", "qualification", "vacancies", "post_date", "last_date", "summary", "content", "apply_link", "official_link", "notification_pdf"];
  var LIMIT = 15;
  var st = { page: 1, q: "", type: "", status: "" };
  var editingId = null, toastTimer;

  function el(id) { return document.getElementById(id); }
  var form = el("postForm"), editor = el("editor"), pwDialog = el("pwDialog");

  function field(name) { return form.elements[name] || null; }

  function toast(msg) {
    var t = el("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2400);
  }

  /** True when `d` is a usable answer; otherwise shows why and returns false. */
  function ok(d) {
    if (!d) { toast("Could not reach the server. Check your connection."); return false; }
    if (d.error) {
      if (/sign in/i.test(d.error)) show(false); else toast(d.error);
      return false;
    }
    return true;
  }

  function show(loggedIn) {
    el("loginView").hidden = loggedIn;
    el("appView").hidden = !loggedIn;
    el("adminTools").hidden = !loggedIn;
    if (loggedIn) { loadStats(); loadPosts(); } else el("loginEmail").focus();
  }

  // ---------------- Sign in / out / password ----------------

  el("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    el("loginErr").textContent = "";
    api("/api/admin/login", { method: "POST", body: JSON.stringify({ email: el("loginEmail").value, password: el("loginPass").value }) }).then(function (d) {
      if (!d) { el("loginErr").textContent = "Could not reach the server."; return; }
      if (d.error) { el("loginErr").textContent = d.error; return; }
      el("loginPass").value = "";
      show(true);
    });
  });

  el("logoutBtn").addEventListener("click", function () { api("/api/admin/logout", { method: "POST" }).then(function () { show(false); }); });

  el("pwBtn").addEventListener("click", function () { el("pwErr").textContent = ""; el("pwForm").reset(); pwDialog.showModal(); });
  el("pwCancel").addEventListener("click", function () { pwDialog.close(); });
  el("pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    api("/api/admin/password", { method: "POST", body: JSON.stringify({ current: el("pwCur").value, next: el("pwNew").value }) }).then(function (d) {
      if (!d) { el("pwErr").textContent = "Could not reach the server."; return; }
      if (d.error) { el("pwErr").textContent = d.error; return; }
      pwDialog.close();
      toast("Password changed");
    });
  });

  // ---------------- Stats ----------------

  function loadStats() {
    api("/api/admin/stats").then(function (d) {
      if (!ok(d)) return;
      var cards = [["Published", d.published], ["Drafts", d.drafts], ["Total views", d.views], ["Subscribers", d.subscribers]];
      el("stats").innerHTML = cards.map(function (c) { return "<div><b>" + fmt.count(c[1] || 0) + "</b><span>" + c[0] + "</span></div>"; }).join("");
    });
  }

  // ---------------- Table ----------------

  function rowHTML(p) {
    var live = p.status === "published";
    return (
      "<tr><td><b>" + esc(p.title) + "</b><small>" + esc(p.organization || "") + "</small></td>" +
      "<td>" + esc(TYPES[p.type] || p.type) + "</td>" +
      '<td><span class="sava-pill ' + esc(p.status) + '">' + (live ? "Published" : "Draft") + "</span></td>" +
      "<td>" + (p.last_date ? fmt.date(p.last_date) : "-") + "</td>" +
      '<td><div class="sava-ad-actions">' +
        '<button type="button" data-act="edit" data-id="' + p.id + '">Edit</button>' +
        '<button type="button" data-act="toggle" data-id="' + p.id + '">' + (live ? "Unpublish" : "Publish") + "</button>" +
        (live ? '<a href="/post/' + encodeURIComponent(p.slug) + '" target="_blank" rel="noopener">View</a>' : "") +
        '<button type="button" class="danger" data-act="delete" data-id="' + p.id + '" data-title="' + esc(p.title) + '">Delete</button>' +
      "</div></td></tr>"
    );
  }

  function btn(label, n, off) { return '<button type="button" data-page="' + n + '"' + (off ? " disabled" : "") + ">" + label + "</button>"; }

  function renderPager(page, pages) {
    var pg = el("pager");
    if (pages <= 1) { pg.innerHTML = ""; return; }
    var from = Math.max(1, Math.min(page - 2, pages - 4)), to = Math.min(pages, from + 4);
    var h = btn("Previous", page - 1, page === 1);
    for (var i = from; i <= to; i++) h += '<button type="button" data-page="' + i + '"' + (i === page ? ' aria-current="page"' : "") + ">" + i + "</button>";
    pg.innerHTML = h + btn("Next", page + 1, page === pages);
  }

  function loadPosts() {
    var p = new URLSearchParams({ page: st.page, limit: LIMIT });
    if (st.q) p.set("q", st.q);
    if (st.type) p.set("type", st.type);
    if (st.status) p.set("status", st.status);
    api("/api/admin/posts?" + p).then(function (d) {
      if (!ok(d)) return;
      el("rows").innerHTML = d.items.length
        ? d.items.map(rowHTML).join("")
        : '<tr><td colspan="5" class="sava-empty">No posts yet. Choose New post to add the first one.</td></tr>';
      renderPager(d.page, d.pages);
    });
  }

  function refresh() { loadStats(); loadPosts(); }

  el("adQ").addEventListener("input", window.savaDebounce(function () { st.q = el("adQ").value.trim(); st.page = 1; loadPosts(); }, 300));
  el("adType").addEventListener("change", function () { st.type = this.value; st.page = 1; loadPosts(); });
  el("adStatus").addEventListener("change", function () { st.status = this.value; st.page = 1; loadPosts(); });
  el("pager").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-page]");
    if (b && !b.disabled) { st.page = Number(b.dataset.page); loadPosts(); }
  });

  el("rows").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var id = b.dataset.id;
    if (b.dataset.act === "edit") openEditor(id);
    if (b.dataset.act === "toggle") toggleStatus(id);
    if (b.dataset.act === "delete" && confirm('Delete "' + b.dataset.title + '"? This cannot be undone.')) {
      api("/api/admin/posts/" + id, { method: "DELETE" }).then(function (d) { if (ok(d)) { toast("Deleted"); refresh(); } });
    }
  });

  /** The PUT route validates the whole form, so fetch the full post and send it back with the new status. */
  function toggleStatus(id) {
    api("/api/admin/posts/" + id).then(function (post) {
      if (!ok(post)) return;
      post.status = post.status === "published" ? "draft" : "published";
      api("/api/admin/posts/" + id, { method: "PUT", body: JSON.stringify(post) }).then(function (d) {
        if (ok(d)) { toast(post.status === "published" ? "Published" : "Moved to drafts"); refresh(); }
      });
    });
  }

  // ---------------- Page sections: repeating rows ----------------

  // rows = id of the container in admin.html; cols = [field key, placeholder]
  var REPS = {
    dates:   { rows: "datesRows",   cols: [["label", "Label"], ["value", "Date / value"]], hl: true },
    fees:    { rows: "feesRows",    cols: [["label", "Category"], ["value", "Amount"]] },
    age:     { rows: "ageRows",     cols: [["label", "Label"], ["value", "Value"]] },
    vacancy: { rows: "vacancyRows", cols: [["post", "Post name"], ["total", "Total"], ["eligibility", "Eligibility"]] },
    links:   { rows: "linksRows",   cols: [["label", "Link title"], ["url", "https://..."]], hl: true }
  };

  // "Add typical rows" buttons.
  var PRESETS = {
    dates: [{ label: "Application Begin" }, { label: "Last Date for Apply Online", hl: true }, { label: "Last Date Pay Exam Fee" }, { label: "Exam Date" }, { label: "Admit Card Available" }],
    fees: [{ label: "General / Other State" }, { label: "OBC / EWS / SC / ST" }],
    age: [{ label: "Minimum Age" }, { label: "Maximum Age" }],
    links: [{ label: "Apply Online", hl: true }, { label: "Download Notification" }, { label: "Official Website" }]
  };

  function parseDetails(raw) {
    if (!raw) return {};
    try { var d = typeof raw === "string" ? JSON.parse(raw) : raw; return d && typeof d === "object" ? d : {}; } catch (e) { return {}; }
  }

  function repRow(key, row) {
    var r = REPS[key];
    return '<div class="sava-ad-r" style="--n:' + r.cols.length + '">' +
      r.cols.map(function (c) { return '<input data-k="' + c[0] + '" placeholder="' + esc(c[1]) + '" aria-label="' + esc(c[1]) + '" value="' + esc(row[c[0]] || "") + '" />'; }).join("") +
      (r.hl ? '<label class="sava-ad-hl" title="Show this row highlighted on the post page"><input type="checkbox" data-hl' + (row.hl ? " checked" : "") + " /><span>Highlight</span></label>" : "") +
      '<button type="button" data-del aria-label="Remove row">&times;</button></div>';
  }

  function container(key) { return el(REPS[key].rows); }

  function isBlank(rowEl) {
    return Array.prototype.every.call(rowEl.querySelectorAll("input[data-k]"), function (i) { return !i.value.trim(); });
  }

  function setRows(key, rows) {
    container(key).innerHTML = (rows && rows.length ? rows : [{}]).map(function (r) { return repRow(key, r); }).join("");
  }

  function addRows(key, rows) {
    var box = container(key);
    Array.prototype.forEach.call(box.querySelectorAll(".sava-ad-r"), function (r) { if (isBlank(r)) r.remove(); });
    box.insertAdjacentHTML("beforeend", rows.map(function (r) { return repRow(key, r); }).join(""));
    var last = box.lastElementChild;
    if (last) { var inp = last.querySelector("input"); if (inp) inp.focus(); }
  }

  form.addEventListener("click", function (e) {
    var add = e.target.closest("[data-add]"), preset = e.target.closest("[data-preset]"), del = e.target.closest("[data-del]");
    if (add && REPS[add.dataset.add]) addRows(add.dataset.add, [{}]);
    if (preset && PRESETS[preset.dataset.preset]) addRows(preset.dataset.preset, PRESETS[preset.dataset.preset]);
    if (del) {
      var row = del.closest(".sava-ad-r"), box = row.parentNode;
      row.remove();
      if (!box.children.length) {
        var key = Object.keys(REPS).filter(function (k) { return REPS[k].rows === box.id; })[0];
        if (key) setRows(key, []);
      }
    }
  });

  function fillDetails(post) {
    var d = post ? parseDetails(post.details) : {};
    Object.keys(REPS).forEach(function (k) { setRows(k, Array.isArray(d[k]) ? d[k] : []); });
    [["fee_notes", d.fee_notes], ["how_to", d.how_to], ["age_note", d.age_note]].forEach(function (p) {
      var f = field(p[0]);
      if (f) f.value = Array.isArray(p[1]) ? p[1].join("\n") : (p[1] || "");
    });
  }

  function collectDetails() {
    var d = {};
    Object.keys(REPS).forEach(function (key) {
      var first = REPS[key].cols[0][0];
      d[key] = Array.prototype.map.call(container(key).querySelectorAll(".sava-ad-r"), function (row) {
        var o = {};
        Array.prototype.forEach.call(row.querySelectorAll("input[data-k]"), function (i) { o[i.dataset.k] = i.value.trim(); });
        var hl = row.querySelector("[data-hl]");
        if (hl) o.hl = hl.checked;
        return o;
      }).filter(function (o) { return o[first]; });
    });
    ["fee_notes", "how_to"].forEach(function (k) {
      var f = field(k);
      d[k] = f ? f.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean) : [];
    });
    d.age_note = field("age_note") ? field("age_note").value.trim() : "";
    return d;
  }

  // ---------------- Editor ----------------

  function setPreview(on) {
    el("preview").hidden = !on;
    el("contentBox").hidden = on;
    el("previewBtn").textContent = on ? "Edit" : "Preview";
    if (on) el("preview").innerHTML = window.savaContent.render(el("contentBox").value) || '<p class="sava-empty">Nothing to preview yet.</p>';
  }

  function fillForm(post) {
    FIELDS.forEach(function (f) {
      var c = field(f);
      if (!c) return;
      c.value = post && post[f] != null ? String(post[f]).slice(0, f.indexOf("date") > -1 ? 10 : undefined) : "";
    });
    fillDetails(post);
  }

  function openEditor(id) {
    editingId = id || null;
    el("formErr").textContent = "";
    el("editorTitle").textContent = id ? "Edit post" : "New post";
    setPreview(false);
    if (!id) {
      fillForm(null);
      editor.showModal();
      editor.scrollTop = 0;
      if (field("title")) field("title").focus();
      return;
    }
    api("/api/admin/posts/" + id).then(function (post) {
      if (!ok(post)) return;
      fillForm(post);
      editor.showModal();
      editor.scrollTop = 0;
    });
  }

  el("newBtn").addEventListener("click", function () { openEditor(null); });
  el("cancelBtn").addEventListener("click", function () { editor.close(); });
  el("previewBtn").addEventListener("click", function () { setPreview(el("preview").hidden); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var body = {};
    FIELDS.forEach(function (f) { var c = field(f); if (c) body[f] = c.value; });
    body.details = collectDetails();
    body.status = (e.submitter && e.submitter.dataset.status) || "draft";
    el("formErr").textContent = "";

    api(editingId ? "/api/admin/posts/" + editingId : "/api/admin/posts", { method: editingId ? "PUT" : "POST", body: JSON.stringify(body) }).then(function (d) {
      if (!d) { el("formErr").textContent = "Could not reach the server. Your changes are still here."; return; }
      if (d.error) {
        if (/sign in/i.test(d.error)) { editor.close(); show(false); } else el("formErr").textContent = d.error;
        return;
      }
      editor.close();
      toast(body.status === "published" ? "Published" : "Saved as draft");
      refresh();
    });
  });

  // PDF / image upload. savaApi always sends JSON, so the multipart request uses fetch directly.
  el("pdfFile").addEventListener("change", function () {
    var file = this.files[0], input = this;
    if (!file) return;
    var data = new FormData();
    data.append("file", file);
    el("formErr").textContent = "Uploading...";
    fetch("/api/admin/upload", { method: "POST", body: data, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (d) {
        input.value = "";
        if (!d || d.error) { el("formErr").textContent = (d && d.error) || "Upload failed. Try again."; return; }
        field("notification_pdf").value = d.url;
        el("formErr").textContent = "";
        toast("File uploaded");
      });
  });

  // ---------------- Boot ----------------

  document.addEventListener("sava:ready", function () {
    api("/api/admin/session").then(function (d) { show(!!(d && d.loggedIn)); });
  });
})();