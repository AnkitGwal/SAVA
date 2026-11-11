/**
 * SAVA — server/app.js
 * =====================================================================
 * Express + MySQL. Every route lives in this file; pages are plain HTML
 * files in public/html that fetch all of their data from the /api routes below.
 *
 * Run:  npm run dev   (no .env file — every setting has its default
 *       right here in this file, same as UPMS app.js)
 *
 * Sections: SETUP -> DATABASE + SESSIONS -> HELPERS -> STATIC FILES ->
 *           PUBLIC API -> ADMIN AUTH -> ADMIN POSTS -> FALLBACKS -> START
 */
const express = require("express");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const bcrypt = require("bcrypt");
const mysql = require("mysql2/promise");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

// =====================================================================
// SETUP
// =====================================================================

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";
// Public address used in sitemap.xml / robots.txt — change it to the real domain when you go live.
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

// Same layout as UPMS: everything the browser loads lives under server/public/
//   public/html/*.html   public/css/*.css   public/js/*.js
const PUBLIC_DIR = path.join(__dirname, "public");
const HTML_DIR = path.join(PUBLIC_DIR, "html");
const CSS_DIR = path.join(PUBLIC_DIR, "css");
const JS_DIR = path.join(PUBLIC_DIR, "js");
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (IS_PROD) app.set("trust proxy", 1);
app.disable("x-powered-by");

if (process.env.CLIENT_ORIGIN) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
}
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// =====================================================================
// DATABASE + SESSIONS
// =====================================================================

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "Ankit@1207#", // type your MariaDB / MySQL password between the quotes
  database: process.env.DB_NAME || "sava",
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true // DATE columns stay plain "YYYY-MM-DD" strings — the front end formats them itself (see savaFormat.date)
});

app.use(
  session({
    name: "sava.sid",
    secret: process.env.SESSION_SECRET || "sava-dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    store: new MySQLStore({ createDatabaseTable: true }, pool),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PROD, // true only behind HTTPS, otherwise the browser drops the cookie
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }
  })
);

// =====================================================================
// HELPERS
// =====================================================================

/** Wraps an async route handler so a rejected promise becomes a clean 500
 *  instead of hanging the request or crashing the process. Harmless on
 *  Express 5 (which already does this) and required on Express 4. */
function asyncHandler(fn) {
  return (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: "Unexpected server error." });
    });
}

const POST_TYPES = ["job", "result", "admit_card", "answer_key", "syllabus", "admission"];
const POST_LIST_COLS = "id, title, slug, type, organization, state, qualification, vacancies, last_date, post_date";

// Everything an admin can set from the post form. `slug` is deliberately
// absent: it is generated once at creation and never changes, so links
// that have already been published and indexed never break.
// const POST_EDITABLE_FIELDS = [
//   "title", "type", "organization", "state", "qualification", "vacancies",
//   "last_date", "post_date", "summary", "content",
//   "apply_link", "official_link", "notification_pdf", "status"
// ];


const POST_EDITABLE_FIELDS = [
  "title", "type", "organization", "state", "qualification", "vacancies",
  "last_date", "post_date", "summary", "content", "details",
  "apply_link", "official_link", "notification_pdf", "status"
];

const isUrl = (v) => /^https?:\/\/\S+$/i.test(v);

const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const isLink = (v) => isUrl(v) || /^\/uploads\/\S+$/.test(v);



/** Cleans the admin's page sections (dates, fees, age, vacancy, steps, links).
 *  Accepts an object or a JSON string; returns { value } (JSON string or null) or { error }. */
function cleanDetails(raw) {
  let d = raw;
  if (typeof d === "string") {
    if (!d.trim()) return { value: null };
    try { d = JSON.parse(d); } catch { return { error: "Page sections are not valid." }; }
  }
  if (!d || typeof d !== "object") return { value: null };

  const rows = (list, max, fn) => (Array.isArray(list) ? list.slice(0, max).map(fn).filter(Boolean) : []);
  const pairs = (list, max) =>
    rows(list, max, (r) => (r && clip(r.label, 120) ? { label: clip(r.label, 120), value: clip(r.value, 200), hl: !!r.hl } : null));
  const lines = (list, max) => (Array.isArray(list) ? list.slice(0, max).map((s) => clip(s, 400)).filter(Boolean) : []);

  const links = [];
  for (const l of Array.isArray(d.links) ? d.links.slice(0, 25) : []) {
    const label = clip(l?.label, 120);
    const url = clip(l?.url, 500);
    if (!label && !url) continue;
    if (!label || !isLink(url)) return { error: `Link "${label || url}" needs a title and a full http:// or https:// address.` };
    links.push({ label, url, hl: !!l.hl });
  }

  const out = {
    dates: pairs(d.dates, 30),
    fees: pairs(d.fees, 20),
    fee_notes: lines(d.fee_notes, 15),
    age: pairs(d.age, 10),
    age_note: clip(d.age_note, 300),
    vacancy: rows(d.vacancy, 40, (r) =>
      r && clip(r.post, 200) ? { post: clip(r.post, 200), total: clip(r.total, 30), eligibility: clip(r.eligibility, 600) } : null
    ),
    how_to: lines(d.how_to, 30),
    links
  };
  const empty = Object.values(out).every((v) => (Array.isArray(v) ? !v.length : !v));
  return { value: empty ? null : JSON.stringify(out) };
}



/** Today as "YYYY-MM-DD" in the SERVER's local time. toISOString() would
 *  give the UTC date, which is "yesterday" in India before 05:30 IST. */
function today() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function slugify(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "post";
}

async function uniqueSlug(title) {
  const base = slugify(title);
  let slug = base;
  let i = 1;
  while (true) {
    const [rows] = await pool.query(`SELECT id FROM posts WHERE slug = ?`, [slug]);
    if (!rows.length) return slug;
    slug = `${base}-${++i}`;
  }
}

/** An empty string from a cleared form input must become SQL NULL, not
 *  the literal string "" — MySQL rejects "" for DATE / INT columns. */
function normalizePostField(field, value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (field === "vacancies") return Number(trimmed);
  return trimmed;
}


/** Validates + normalizes an admin post form. Returns { data } or { error }. */
function validatePost(body) {
  const data = {};
  POST_EDITABLE_FIELDS.forEach((f) => { data[f] = normalizePostField(f, body[f]); });
  data.status = data.status === "published" ? "published" : "draft";

  const det = cleanDetails(body.details);
  if (det.error) return { error: det.error };
  data.details = det.value;
  if (data.summary && data.summary.length > 2000) return { error: "Short information must be 2000 characters or fewer." };

  if (!data.title) return { error: "Title is required." };
  if (!POST_TYPES.includes(data.type)) return { error: "Choose a valid post type." };
  if (data.vacancies !== null && !(Number.isInteger(data.vacancies) && data.vacancies >= 0)) {
    return { error: "Vacancies must be a whole number." };
  }
  for (const k of ["last_date", "post_date"]) {
    if (data[k] && !/^\d{4}-\d{2}-\d{2}$/.test(data[k])) {
      return { error: `${k.replace("_", " ")} must be in YYYY-MM-DD format.` };
    }
  }
  for (const k of ["apply_link", "official_link"]) {
    if (data[k] && !isUrl(data[k])) return { error: `${k.replace("_", " ")} must start with http:// or https://` };
  }
  if (data.notification_pdf && !(isUrl(data.notification_pdf) || data.notification_pdf.startsWith("/uploads/"))) {
    return { error: "Notification PDF must be an uploaded file or a full link." };
  }
  if (!data.post_date) data.post_date = today();
  return { data };
}

/** Builds the WHERE-clause fragment + params for a post list query. The
 *  public site passes publishedOnly = true, so drafts can never leak
 *  through ?status=draft; only the admin list may filter by status. */
function postFilter(query, publishedOnly) {
  const conditions = [];
  const params = [];

  if (publishedOnly) conditions.push("status = 'published'");
  else if (["draft", "published"].includes(query.status)) { conditions.push("status = ?"); params.push(query.status); }

  if (POST_TYPES.includes(query.type)) { conditions.push("type = ?"); params.push(query.type); }
  if (query.state) { conditions.push("state = ?"); params.push(String(query.state)); }
  if (query.qualification) { conditions.push("qualification = ?"); params.push(String(query.qualification)); }
  if (query.q) {
    const like = "%" + String(query.q).trim().replace(/[\\%_]/g, "\\$&") + "%";
    conditions.push("(title LIKE ? OR organization LIKE ?)");
    params.push(like, like);
  }
  return { clause: conditions.length ? conditions.join(" AND ") : "1 = 1", params };
}

async function pagedPosts(query, publishedOnly) {
  const limit = Math.min(Math.max(parseInt(query.limit) || 20, 1), 50);
  const page = Math.max(parseInt(query.page) || 1, 1);
  const filter = postFilter(query, publishedOnly);

  const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM posts WHERE ${filter.clause}`, filter.params);
  const [items] = await pool.query(
    `SELECT ${POST_LIST_COLS}, status FROM posts WHERE ${filter.clause}
      ORDER BY post_date DESC, id DESC LIMIT ? OFFSET ?`,
    [...filter.params, limit, (page - 1) * limit]
  );
  return { items, total: n, page, pages: Math.max(Math.ceil(n / limit), 1) };
}

// Home page data is cached for 60s so a traffic spike doesn't hammer MySQL.
// Every admin write calls bustHomeCache() so new posts appear immediately.
let homeCache = { at: 0, data: null };
const bustHomeCache = () => { homeCache.at = 0; };

async function getHomeData() {
  if (homeCache.data && Date.now() - homeCache.at < 60_000) return homeCache.data;

  const [[ticker], [closing], [trending], [counts], [states], [quals], ...typeResults] = await Promise.all([
    pool.query(`SELECT id, title, slug, type FROM posts WHERE status = 'published' ORDER BY post_date DESC, id DESC LIMIT 12`),
    pool.query(
      `SELECT ${POST_LIST_COLS} FROM posts
        WHERE status = 'published' AND type = 'job'
          AND last_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 10 DAY)
        ORDER BY last_date ASC LIMIT 6`
    ),
    pool.query(
      `SELECT id, title, slug, type, views FROM posts
        WHERE status = 'published' AND post_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY views DESC, id DESC LIMIT 8`
    ),
    pool.query(`SELECT type, COUNT(*) AS n FROM posts WHERE status = 'published' GROUP BY type`),
    pool.query(
      `SELECT state AS name, COUNT(*) AS n FROM posts
        WHERE status = 'published' AND state IS NOT NULL GROUP BY state ORDER BY n DESC LIMIT 40`
    ),
    pool.query(
      `SELECT qualification AS name, COUNT(*) AS n FROM posts
        WHERE status = 'published' AND qualification IS NOT NULL GROUP BY qualification ORDER BY n DESC LIMIT 10`
    ),
    ...POST_TYPES.map((t) =>
      pool.query(
        `SELECT ${POST_LIST_COLS} FROM posts WHERE status = 'published' AND type = ?
          ORDER BY post_date DESC, id DESC LIMIT 12`,
        [t]
      )
    )
  ]);

  const data = {
    ticker,
    closing,
    trending,
    counts: Object.fromEntries(counts.map((c) => [c.type, c.n])),
    states,
    quals,
    lists: Object.fromEntries(POST_TYPES.map((t, i) => [t, typeResults[i][0]]))
  };
  homeCache = { at: Date.now(), data };
  return data;
}

// =====================================================================
// STATIC FILES + PAGES
// =====================================================================
//
// /public/css and /public/js are accepted too, so either style of
// <link> / <script> path works. Page routes only send an HTML file —
// every piece of data comes from the /api routes below.

app.use(["/css", "/public/css"], express.static(CSS_DIR));
app.use(["/js", "/public/js"], express.static(JS_DIR));
// Uploads are public on purpose: they are the notification PDFs readers download.
app.use("/uploads", express.static(UPLOAD_DIR, { setHeaders: (res) => res.set("X-Content-Type-Options", "nosniff") }));

const sendPage = (name) => (req, res) =>
  res.sendFile(path.join(HTML_DIR, name), (err) => {
    if (!err || res.headersSent) return;
    console.error(`Cannot send public/html/${name}:`, err.message);
    res.status(err.code === "ENOENT" ? 404 : 500).type("text").send(
      err.code === "ENOENT" ? `public/html/${name} has not been created yet.` : "Could not load this page."
    );
  });

app.get("/", sendPage("index.html"));
app.get("/post/:slug", sendPage("post.html"));
app.get("/posts", sendPage("posts.html"));

// Every other page (admin.html ...) is served by name: /admin, /posts
app.use(express.static(HTML_DIR, { index: false, extensions: ["html"] }));

// =====================================================================
// PUBLIC API
// =====================================================================

// Open http://localhost:3000/api/health to see at a glance whether the files and database are fine.
app.get(
  "/api/health",
  asyncHandler(async (req, res) => {
    const out = {
      server: "ok",
      files: {
        "public/html/index.html": fs.existsSync(path.join(HTML_DIR, "index.html")),
        "public/css/style.css": fs.existsSync(path.join(CSS_DIR, "style.css")),
        "public/css/home.css": fs.existsSync(path.join(CSS_DIR, "home.css")),
        "public/js/sava-ui.js": fs.existsSync(path.join(JS_DIR, "sava-ui.js")),
        "public/js/home.js": fs.existsSync(path.join(JS_DIR, "home.js"))
      },
      database: "unknown"
    };
    try {
      const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM posts`);
      out.database = "ok";
      out.posts = n;
    } catch (e) {
      out.database = IS_PROD ? "error" : `error: ${e.message}`;
    }
    res.json(out);
  })
);

app.get("/api/home", asyncHandler(async (req, res) => res.json(await getHomeData())));

app.get("/api/posts", asyncHandler(async (req, res) => res.json(await pagedPosts(req.query, true))));

app.get(
  "/api/posts/:slug",
  asyncHandler(async (req, res) => {
    // A draft reads as 404, same as a post that doesn't exist — the public
    // site must never confirm that an unpublished slug is real.
    const [rows] = await pool.query(`SELECT * FROM posts WHERE slug = ? AND status = 'published'`, [req.params.slug]);
    if (!rows.length) return res.status(404).json({ error: "Post not found." });
    const post = rows[0];

    // Fire-and-forget: a failed view counter must never fail the page load.
    pool.query(`UPDATE posts SET views = views + 1 WHERE id = ?`, [post.id]).catch(() => {});

    const [related] = await pool.query(
      `SELECT ${POST_LIST_COLS} FROM posts WHERE status = 'published' AND type = ? AND id <> ?
        ORDER BY post_date DESC LIMIT 6`,
      [post.type, post.id]
    );
    res.json({ post, related });
  })
);

app.post(
  "/api/subscribe",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 190) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    // INSERT IGNORE: subscribing twice is not an error, the reader just stays subscribed.
    await pool.query(`INSERT IGNORE INTO subscribers (email) VALUES (?)`, [email]);
    res.json({ success: true });
  })
);

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(`User-agent: *\nDisallow: /admin\nDisallow: /api/admin\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.get(
  "/sitemap.xml",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT slug, updated_at FROM posts WHERE status = 'published' ORDER BY id DESC LIMIT 5000`);
    const urls = [`<url><loc>${SITE_URL}/</loc></url>`].concat(
      rows.map((r) => `<url><loc>${SITE_URL}/post/${encodeURIComponent(r.slug)}</loc><lastmod>${String(r.updated_at).slice(0, 10)}</lastmod></url>`)
    );
    res.type("application/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`
    );
  })
);

// =====================================================================
// ADMIN AUTH
// =====================================================================

const attempts = new Map(); // ip -> { n, t }  (simple in-memory brute-force guard)

function loginGuard(req, res, next) {
  const rec = attempts.get(req.ip);
  if (rec && Date.now() - rec.t < 15 * 60_000 && rec.n >= 10) {
    return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
  }
  next();
}

function noteFailedLogin(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.t >= 15 * 60_000) attempts.set(ip, { n: 1, t: Date.now() });
  else rec.n++;
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: "Please sign in as admin." });
  next();
}

app.post(
  "/api/admin/login",
  loginGuard,
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

    const [rows] = await pool.query(`SELECT * FROM admins WHERE email = ?`, [email]);
    const admin = rows[0];
    const ok = admin && (await bcrypt.compare(password, admin.password));
    if (!ok) {
      noteFailedLogin(req.ip);
      return res.status(401).json({ error: "Invalid email or password." });
    }

    attempts.delete(req.ip);
    // A fresh session id on every login — never reuse the pre-login one.
    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Could not start a session. Please try again." });
      }
      req.session.adminId = admin.id;
      req.session.adminEmail = admin.email;
      req.session.save(() => res.json({ success: true }));
    });
  })
);

app.get("/api/admin/session", (req, res) =>
  res.json(req.session.adminId ? { loggedIn: true, email: req.session.adminEmail } : { loggedIn: false })
);

app.post("/api/admin/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// =====================================================================
// ADMIN: POSTS, UPLOADS, STATS
// =====================================================================
//
// One role only (admin), so there is no scope filter here like the one
// UPMS needs — requireAdmin is the single gate, applied to every route
// in this section. Every write calls bustHomeCache() so the public home
// page never shows stale content for a full minute after an edit.

app.get(
  "/api/admin/stats",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [[posts]] = await pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'published') AS published,
              SUM(status = 'draft') AS drafts,
              COALESCE(SUM(views), 0) AS views
         FROM posts`
    );
    const [[subs]] = await pool.query(`SELECT COUNT(*) AS n FROM subscribers`);
    res.json({ ...posts, subscribers: subs.n });
  })
);

app.get(
  "/api/admin/posts",
  requireAdmin,
  asyncHandler(async (req, res) => res.json(await pagedPosts(req.query, false)))
);

app.get(
  "/api/admin/posts/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM posts WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Post not found." });
    res.json(rows[0]);
  })
);

app.post(
  "/api/admin/posts",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data, error } = validatePost(req.body || {});
    if (error) return res.status(400).json({ error });

    const slug = await uniqueSlug(data.title);
    const cols = POST_EDITABLE_FIELDS;

    try {
      const [result] = await pool.query(
        `INSERT INTO posts (${cols.join(", ")}, slug) VALUES (${cols.map(() => "?").join(", ")}, ?)`,
        [...cols.map((c) => data[c]), slug]
      );
      bustHomeCache();
      res.status(201).json({ success: true, id: result.insertId, slug });
    } catch (err) {
      // Two admins saving the same title at the same instant can both pass uniqueSlug().
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "A post with this title was just created. Please try again." });
      }
      throw err;
    }
  })
);

// The slug stays the same on edit so published links never break.
app.put(
  "/api/admin/posts/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { data, error } = validatePost(req.body || {});
    if (error) return res.status(400).json({ error });

    const updates = [];
    const values = [];
    POST_EDITABLE_FIELDS.forEach((f) => { updates.push(`${f} = ?`); values.push(data[f]); });
    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const [result] = await pool.query(`UPDATE posts SET ${updates.join(", ")} WHERE id = ?`, values);
    if (!result.affectedRows) return res.status(404).json({ error: "Post not found." });
    bustHomeCache();
    res.json({ success: true });
  })
);

app.delete(
  "/api/admin/posts/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(`DELETE FROM posts WHERE id = ?`, [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Post not found." });
    bustHomeCache();
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------
// Upload — notification PDFs / images
// ---------------------------------------------------------------

const UPLOAD_TYPES = new Set([".pdf", ".jpg", ".jpeg", ".png"]);

const postUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    if (!UPLOAD_TYPES.has(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error("Only PDF, JPG or PNG files are allowed."));
    }
    cb(null, true);
  }
}).single("file");

// multer reports errors through its own callback, not a thrown rejection —
// asyncHandler can't catch that, so it gets its own small wrapper instead
// of the default Express HTML error page.
function handlePostUpload(req, res, next) {
  postUpload(req, res, (err) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? "File must be 10MB or smaller."
        : err.message || "Could not process the uploaded file.";
    res.status(400).json({ error: message });
  });
}

app.post("/api/admin/upload", requireAdmin, handlePostUpload, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a file to upload." });
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

// =====================================================================
// FALLBACKS
// =====================================================================

app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

// A real 404 (not index.html) so search engines don't index junk URLs.
app.use((req, res) => res.status(404).type("text").send("Page not found."));

// Last resort — catches what asyncHandler can't, e.g. a malformed JSON body.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? "Bad request." : "Unexpected server error." });
});

// =====================================================================
// START
// =====================================================================

// First-run admin login. It is only used when the `admins` table is empty,
// so after the first start you can change these two values (or sign in and
// change the password) — the seed never runs again.
const SEED_ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@sava.local";
const SEED_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ChangeMe@123";

/** Creates the first admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD if none exists. */
async function seedAdmin() {
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM admins`);
  if (n > 0) return;
  await pool.query(`INSERT INTO admins (email, password) VALUES (?, ?)`, [
    SEED_ADMIN_EMAIL.trim().toLowerCase(),
    await bcrypt.hash(SEED_ADMIN_PASSWORD, 12)
  ]);
  console.log(`First admin created: ${SEED_ADMIN_EMAIL}. Sign in and change the password.`);
}



// ---------------------------------------------------------------------
// Paste into app.js, in the ADMIN section after the /api/admin/logout route.
// Needed by the admin page: password change + subscriber export.
// ---------------------------------------------------------------------

app.get(
  "/api/admin/subscribers.csv",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT email FROM subscribers ORDER BY email`);
    res
      .type("text/csv")
      .set("Content-Disposition", 'attachment; filename="subscribers.csv"')
      .send("email\n" + rows.map((r) => r.email).join("\n"));
  })
);

app.post(
  "/api/admin/password",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const current = String(req.body?.current || "");
    const next = String(req.body?.next || "");
    if (next.length < 10) return res.status(400).json({ error: "New password must be at least 10 characters." });

    const [rows] = await pool.query(`SELECT password FROM admins WHERE id = ?`, [req.session.adminId]);
    if (!rows.length || !(await bcrypt.compare(current, rows[0].password))) {
      return res.status(400).json({ error: "Current password is wrong." });
    }
    await pool.query(`UPDATE admins SET password = ? WHERE id = ?`, [await bcrypt.hash(next, 12), req.session.adminId]);
    res.json({ success: true });
  })
);









seedAdmin()
  .then(() =>
    app.listen(PORT, () => {
      console.log(`SAVA server running → http://localhost:${PORT}`);
      for (const f of [
        path.join(HTML_DIR, "index.html"),
        path.join(CSS_DIR, "style.css"),
        path.join(CSS_DIR, "home.css"),
        path.join(JS_DIR, "sava-ui.js"),
        path.join(JS_DIR, "home.js")
      ]) {
        if (!fs.existsSync(f)) console.warn(`MISSING FILE: ${f}`);
      }
    })
  )
  .catch((err) => {
    console.error("Startup failed:", err.message, "\nHave you run schema.sql and set the DB password in app.js?");
    if (/gssapi|authentication plugin/i.test(err.message)) {
      console.error("This MariaDB user logs in with Windows authentication. Create a password user and set the DB user / password in app.js.");
    }
    process.exit(1);
  });