/**
 * SAVA — post content renderer (shared by post.js and the admin preview).
 * Admin text format:  "## Heading", "- bullet", rows with "|" become a table,
 * "**bold**", bare https:// links are linked. Everything is HTML-escaped first,
 * so nothing an admin types can inject markup.
 *   window.savaContent.render(text) -> safe HTML string
 * Load order: sava-ui.js -> sava-content.js -> page script.
 */
(function () {
  "use strict";
  var esc = window.savaFormat.esc;

  function inline(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function table(lines) {
    var rows = lines.map(function (l) {
      return l.split("|").map(function (c) { return c.trim(); }).filter(function (c, i, a) { return c || (i > 0 && i < a.length - 1); });
    });
    var head = "<tr>" + rows[0].map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr>";
    var body = rows.slice(1).map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("");
    return '<div class="sava-table-wrap"><table><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }

  function render(text) {
    var out = [];
    String(text || "").replace(/\r/g, "").split(/\n{2,}/).forEach(function (block) {
      var lines = block.split("\n").filter(function (l) { return l.trim(); });
      if (!lines.length) return;
      if (/^##\s/.test(lines[0])) { out.push("<h3>" + inline(lines[0].slice(3).trim()) + "</h3>"); lines = lines.slice(1); }
      if (!lines.length) return;
      if (lines.every(function (l) { return /^[-*]\s/.test(l.trim()); })) {
        out.push("<ul>" + lines.map(function (l) { return "<li>" + inline(l.trim().slice(2)) + "</li>"; }).join("") + "</ul>");
      } else if (lines.length > 1 && lines.every(function (l) { return l.indexOf("|") > -1; })) {
        out.push(table(lines));
      } else {
        out.push("<p>" + lines.map(inline).join("<br>") + "</p>");
      }
    });
    return out.join("");
  }

  window.savaContent = { render: render };
})();