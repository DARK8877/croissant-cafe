/* ==========================================================
   server.js — локальный сервер (Node.js 18+, без библиотек)
   Раздаёт сайт, принимает заказы и брони, хранит каталог и
   настройки сайта. Данные лежат в папке data/*.json.
   Запуск: node server.js   →   http://localhost:3000
   Пароль админа: ADMIN_PASSWORD (по умолчанию demo123), логин: ADMIN_LOGIN (admin)
   ========================================================== */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || "ADMIN";
const DELIVERY_CITY = "Тараз";
const LOGIN_RE = /^[A-Za-z0-9_.\-]{3,30}$/;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "demo123";
const TOKEN_TTL = 6 * 60 * 60 * 1000;

const ORDER_STATUSES = ["Новый", "Готовится", "Готов", "Выполнен", "Отменён"];
const BOOKING_STATUSES = ["Новое", "Подтверждено", "Завершено", "Отменено"];
const CATEGORIES = ["coffee", "drinks", "croissants", "desserts", "pastry", "beans"];
const SETTING_KEYS = ["name", "tagline", "heroTitle", "heroText", "address", "phone", "hours", "about", "instagram", "telegram", "whatsapp", "showTeam"];
const PHONE_RE = /^\+?[0-9\s\-()]{10,18}$/;

fs.mkdirSync(DATA, { recursive: true });

/* ---------- Файловое хранилище (запись атомарная: temp → rename) ---------- */
function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch (e) { return fallback; }
}
function writeJson(name, value) {
  const file = path.join(DATA, name), tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/* ---------- Токены администратора ---------- */
const tokens = new Map(); // token -> { exp, role, login, name }
function newSession(role, login, name) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, { exp: Date.now() + TOKEN_TTL, role, login, name });
  return { token, role, login, name };
}
function getSession(req) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : "";
  const s = tokens.get(t);
  if (!s) return null;
  if (s.exp < Date.now()) { tokens.delete(t); return null; }
  return s;
}
function isAuthed(req) { const s = getSession(req); return !!s && s.role === "admin"; }

/* ---------- Пользователи (пароль — scrypt с индивидуальной солью) ---------- */
function hashPass(salt, pass) { return crypto.scryptSync(String(pass), salt, 32).toString("hex"); }
function findUser(login) {
  return readJson("users.json", []).find((u) => u.login.toLowerCase() === String(login).toLowerCase());
}
// Не более 5 неудачных входов подряд на логин: блокировка на 15 минут
const fails = new Map();
function checkLock(login) {
  const f = fails.get(String(login).toLowerCase());
  if (f && f.n >= 5 && f.until > Date.now()) throw new HttpError(429, "Слишком много попыток. Подождите 15 минут.");
}
function noteFail(login) {
  const k = String(login).toLowerCase(), f = fails.get(k);
  fails.set(k, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
}
async function failLogin(login) {
  noteFail(login);
  await new Promise((r) => setTimeout(r, 800));
  throw new HttpError(401, "Неверный логин или пароль.");
}
async function loginUser(b) {
  const login = str(b.login, 30), password = String(b.password == null ? "" : b.password);
  if (!login || !password) throw new HttpError(400, "Введите логин и пароль.");
  checkLock(login);
  if (login.toLowerCase() === ADMIN_LOGIN.toLowerCase()) {
    if (!safeEqual(password, ADMIN_PASSWORD)) await failLogin(login);
    return newSession("admin", ADMIN_LOGIN, "Администратор");
  }
  const u = findUser(login);
  if (!u || !safeEqual(hashPass(u.salt, password), u.hash)) await failLogin(login);
  return Object.assign(newSession("user", u.login, u.name), { phone: u.phone, address: u.address || "" });
}
function registerUser(b) {
  const login = str(b.login, 30), password = String(b.password == null ? "" : b.password);
  const name = str(b.name, 60), phone = str(b.phone, 30);
  if (!LOGIN_RE.test(login)) throw new HttpError(400, "Логин: 3–30 символов, латиница, цифры, точка, дефис или «_».");
  if (login.toLowerCase() === ADMIN_LOGIN.toLowerCase()) throw new HttpError(400, "Этот логин занят.");
  if (password.length < 6 || password.length > 100) throw new HttpError(400, "Пароль: минимум 6 символов.");
  if (name.length < 2) throw new HttpError(400, "Введите имя (минимум 2 символа).");
  if (!PHONE_RE.test(phone)) throw new HttpError(400, "Введите корректный телефон.");
  if (findUser(login)) throw new HttpError(409, "Этот логин уже занят.");
  const salt = crypto.randomBytes(16).toString("hex");
  const users = readJson("users.json", []);
  users.push({ login, salt, hash: hashPass(salt, password), name, phone, address: "", createdAt: new Date().toISOString() });
  writeJson("users.json", users);
  return Object.assign(newSession("user", login, name), { phone, address: "" });
}

/* ---------- Личный кабинет: профиль и пароль ---------- */
function requireUser(sess) {
  if (!sess) throw new HttpError(401, "Сессия истекла. Войдите снова.");
  if (sess.role !== "user") throw new HttpError(403, "Это действие доступно только для обычных аккаунтов.");
  return sess;
}
function updateProfile(b, sess) {
  requireUser(sess);
  const name = str(b.name, 60), phone = str(b.phone, 30), address = str(b.address, 150);
  if (name.length < 2) throw new HttpError(400, "Введите имя (минимум 2 символа).");
  if (!PHONE_RE.test(phone)) throw new HttpError(400, "Введите корректный телефон.");
  if (address && address.length < 5) throw new HttpError(400, "Адрес слишком короткий (улица, дом).");
  const users = readJson("users.json", []);
  const u = users.find((x) => x.login.toLowerCase() === sess.login.toLowerCase());
  if (!u) throw new HttpError(404, "Аккаунт не найден.");
  u.name = name; u.phone = phone; u.address = address;
  writeJson("users.json", users);
  sess.name = name;
  return { name, phone, address };
}
async function changePassword(b, sess) {
  requireUser(sess);
  const current = String(b.current == null ? "" : b.current), password = String(b.password == null ? "" : b.password);
  if (password.length < 6 || password.length > 100) throw new HttpError(400, "Новый пароль: минимум 6 символов.");
  checkLock(sess.login);
  const users = readJson("users.json", []);
  const u = users.find((x) => x.login.toLowerCase() === sess.login.toLowerCase());
  if (!u) throw new HttpError(404, "Аккаунт не найден.");
  if (!safeEqual(hashPass(u.salt, current), u.hash)) {
    noteFail(sess.login);
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(403, "Текущий пароль неверный.");
  }
  u.salt = crypto.randomBytes(16).toString("hex");
  u.hash = hashPass(u.salt, password);
  writeJson("users.json", users);
  return { ok: true };
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ---------- Помощники ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS"
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, "Слишком большой запрос.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(new HttpError(400, "Некорректный JSON.")); }
    });
    req.on("error", reject);
  });
}

/* ---------- Каталог и настройки ---------- */
function readSite() {
  const s = readJson("site.json", null);
  return s && s.products && s.settings ? s : { version: 0, products: null, settings: null };
}

function cleanProducts(list) {
  if (!Array.isArray(list) || list.length > 300) throw new HttpError(400, "Некорректный каталог.");
  const seen = new Set();
  return list.map((p) => {
    p = p || {};
    const id = str(p.id, 40);
    if (!id || seen.has(id)) throw new HttpError(400, "Некорректный или повторяющийся id товара.");
    seen.add(id);
    const price = Math.round(Number(p.price));
    if (!Number.isFinite(price) || price < 0 || price > 10000000) throw new HttpError(400, "Некорректная цена: " + str(p.name, 30));
    let image = String(p.image || "");
    if (image && !/^(https?:\/\/|data:image\/)/i.test(image)) image = "";
    if (image.length > 400000) throw new HttpError(400, "Слишком большое изображение: " + str(p.name, 30));
    return {
      id, name: str(p.name, 60), description: str(p.description, 300),
      category: CATEGORIES.includes(p.category) ? p.category : "coffee",
      price, available: !!p.available, image
    };
  });
}

function cleanSettings(s) {
  if (!s || typeof s !== "object") throw new HttpError(400, "Некорректные настройки.");
  const out = {};
  for (const k of SETTING_KEYS) {
    let v = str(s[k], k === "about" ? 1500 : 300);
    if (["instagram", "telegram", "whatsapp"].includes(k) && v && !/^https?:\/\//i.test(v)) v = "";
    out[k] = v;
  }
  if (!out.name || !out.heroTitle) throw new HttpError(400, "Название и заголовок не могут быть пустыми.");
  return out;
}

/* ---------- Сотрудники ---------- */
// Публично отдаём только имя, должность, фото и описание (телефон и график — только админу)
function publicStaff(list) {
  return list.filter((s) => s.active && s.showOnSite)
    .map((s) => ({ id: s.id, name: s.name, position: s.position, photo: s.photo || "", about: s.about || "" }));
}

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
// График: { days: [1..7], from: "HH:MM", to: "HH:MM" } (1 = понедельник); текст строит сервер
function cleanSched(sc) {
  if (!sc || typeof sc !== "object" || !Array.isArray(sc.days)) return null;
  const days = [...new Set(sc.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
  if (!days.length) return null;
  const t = (v) => { const m = /^(\d{2}):(\d{2})$/.exec(String(v || "")); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[0] : ""; };
  let from = t(sc.from), to = t(sc.to);
  if (!from || !to) { from = ""; to = ""; }
  return { days, from, to };
}
function schedText(sc) {
  if (!sc) return "";
  const d = sc.days; let text;
  if (d.length === 7) text = "Ежедневно";
  else {
    const parts = []; let i = 0;
    while (i < d.length) {
      let j = i;
      while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
      parts.push(j > i ? DAY_NAMES[d[i] - 1] + "–" + DAY_NAMES[d[j] - 1] : DAY_NAMES[d[i] - 1]);
      i = j + 1;
    }
    text = parts.join(", ");
  }
  return sc.from ? text + ", " + sc.from + "–" + sc.to : text;
}

function cleanStaff(s) {
  s = s || {};
  const id = str(s.id, 40);
  if (!/^[A-Za-z0-9_\-]{1,40}$/.test(id)) throw new HttpError(400, "Некорректный id сотрудника.");
  const name = str(s.name, 60), position = str(s.position, 60), phone = str(s.phone, 30);
  if (name.length < 2) throw new HttpError(400, "Введите имя сотрудника (минимум 2 символа).");
  if (position.length < 2) throw new HttpError(400, "Укажите должность.");
  if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, "Введите корректный телефон сотрудника.");
  let photo = String(s.photo || "");
  if (photo && !/^(https?:\/\/|data:image\/)/i.test(photo)) photo = "";
  if (photo.length > 400000) throw new HttpError(400, "Слишком большое фото.");
  const sched = cleanSched(s.sched);
  return { id, name, position, phone, sched, schedule: sched ? schedText(sched) : str(s.schedule, 100), about: str(s.about, 500), photo, active: !!s.active, showOnSite: !!s.showOnSite };
}

// Версия сайта общая: сайт подтянет новую команду тем же опросом, что и каталог
function bumpStaffVersion() { const v = Date.now(); writeJson("staffver.json", { v }); return v; }
function siteVersion() { return Math.max(readSite().version || 0, (readJson("staffver.json", {}) || {}).v || 0); }

/* ---------- Заказы и брони ---------- */
function createOrder(b, sess) {
  const name = str(b.name, 60), phone = str(b.phone, 30), comment = str(b.comment, 300);
  if (name.length < 2) throw new HttpError(400, "Введите имя (минимум 2 символа).");
  if (!PHONE_RE.test(phone)) throw new HttpError(400, "Введите корректный телефон.");
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) throw new HttpError(400, "Корзина пуста.");
  // Доставка — только по Таразу
  const city = str(b.city, 40), address = str(b.address, 150);
  if (city.toLowerCase() !== DELIVERY_CITY.toLowerCase()) throw new HttpError(400, "Доставка только по городу " + DELIVERY_CITY + ".");
  if (address.length < 5) throw new HttpError(400, "Укажите адрес доставки в Таразе (улица, дом).");
  const userLogin = sess && sess.role === "user" ? sess.login : "";

  // Цены и названия берём из каталога на сервере, а не от браузера
  const site = readSite();
  const catalog = new Map((site.products || []).map((p) => [p.id, p]));
  const items = []; let total = 0;
  for (const it of b.items) {
    const qty = Number(it && it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new HttpError(400, "Некорректное количество.");
    let n, price;
    if (site.products) {
      const p = catalog.get(String(it.id));
      if (!p || !p.available) throw new HttpError(409, "Товар «" + str(it.name, 40) + "» сейчас недоступен. Обновите страницу.");
      n = p.name; price = p.price;
    } else {
      n = str(it.name, 60); price = Math.round(Number(it.price));
      if (!n || !Number.isFinite(price) || price < 0 || price > 10000000) throw new HttpError(400, "Некорректный товар.");
    }
    items.push({ id: str(it.id, 40), name: n, price, qty });
    total += price * qty;
  }
  const orders = readJson("orders.json", []);
  const number = orders.reduce((m, o) => Math.max(m, o.number || 0), 0) + 1;
  const order = { id: crypto.randomUUID(), number, createdAt: new Date().toISOString(), name, phone, comment, items, total, status: "Новый", city: DELIVERY_CITY, address, userLogin };
  orders.push(order);
  writeJson("orders.json", orders);
  return { id: order.id, number, total };
}

function createBooking(b) {
  const name = str(b.name, 60), phone = str(b.phone, 30), date = str(b.date, 10), time = str(b.time, 5), guests = Number(b.guests);
  if (name.length < 2) throw new HttpError(400, "Введите имя.");
  if (!PHONE_RE.test(phone)) throw new HttpError(400, "Введите корректный телефон.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Некорректная дата.");
  if (!/^\d{2}:\d{2}$/.test(time)) throw new HttpError(400, "Некорректное время.");
  if (!Number.isInteger(guests) || guests < 1 || guests > 20) throw new HttpError(400, "Гостей может быть от 1 до 20.");
  const list = readJson("bookings.json", []);
  const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), name, phone, date, time, guests, status: "Новое" };
  list.push(item);
  writeJson("bookings.json", list);
  return { id: item.id };
}

function setStatus(file, id, status, allowed) {
  if (!allowed.includes(status)) throw new HttpError(400, "Недопустимый статус.");
  const list = readJson(file, []);
  const item = list.find((x) => x.id === id);
  if (!item) throw new HttpError(404, "Запись не найдена.");
  item.status = status;
  writeJson(file, list);
  return { ok: true };
}

/* ---------- Маршруты API ---------- */
async function handleApi(req, res, url) {
  const m = req.method, p = url.pathname;
  if (m === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS" }); return res.end(); }

  // --- публичные ---
  if (m === "GET" && p === "/api/site/version") return send(res, 200, { version: siteVersion() });
  if (m === "GET" && p === "/api/site") return send(res, 200, Object.assign({}, readSite(), { version: siteVersion() }));
  if (m === "GET" && p === "/api/staff") return send(res, 200, { staff: publicStaff(readJson("staff.json", [])) });
  if (m === "POST" && p === "/api/orders") return send(res, 201, createOrder(await readBody(req, 100 * 1024), getSession(req)));
  if (m === "POST" && p === "/api/bookings") return send(res, 201, createBooking(await readBody(req, 20 * 1024)));
  if (m === "POST" && p === "/api/login") return send(res, 200, await loginUser(await readBody(req, 10 * 1024)));
  if (m === "POST" && p === "/api/register") return send(res, 201, registerUser(await readBody(req, 10 * 1024)));
  if (m === "POST" && p === "/api/profile") return send(res, 200, updateProfile(await readBody(req, 10 * 1024), getSession(req)));
  if (m === "POST" && p === "/api/password") return send(res, 200, await changePassword(await readBody(req, 10 * 1024), getSession(req)));
  if (m === "GET" && p === "/api/me") {
    const s = getSession(req);
    if (!s) throw new HttpError(401, "Сессия истекла. Войдите снова.");
    if (s.role === "user") {
      const u = findUser(s.login); // свежие данные (могли измениться с другого устройства)
      if (!u) throw new HttpError(401, "Аккаунт не найден. Войдите снова.");
      return send(res, 200, { role: "user", login: u.login, name: u.name, phone: u.phone, address: u.address || "" });
    }
    return send(res, 200, { role: s.role, login: s.login, name: s.name });
  }

  // --- только администратор ---
  const sess = getSession(req);
  if (!sess) throw new HttpError(401, "Сессия истекла. Войдите снова.");
  if (sess.role !== "admin") throw new HttpError(403, "Нет доступа.");
  if (m === "GET" && p === "/api/orders") return send(res, 200, readJson("orders.json", []));
  if (m === "GET" && p === "/api/bookings") return send(res, 200, readJson("bookings.json", []));
  if (m === "GET" && p === "/api/staff/all") return send(res, 200, { data: readJson("staff.json", []) });
  if (m === "POST" && p === "/api/staff") {
    const item = cleanStaff((await readBody(req, 600 * 1024)).staff);
    const list = readJson("staff.json", []);
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else {
      if (list.length >= 100) throw new HttpError(400, "Слишком много сотрудников (максимум 100).");
      list.push(item);
    }
    writeJson("staff.json", list);
    return send(res, 200, { ok: true, staff: item, version: bumpStaffVersion() });
  }
  if (m === "POST" && p === "/api/staff/delete") {
    const id = str((await readBody(req, 10 * 1024)).id, 40);
    const list = readJson("staff.json", []);
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) throw new HttpError(404, "Сотрудник не найден.");
    writeJson("staff.json", next);
    bumpStaffVersion();
    return send(res, 200, { ok: true });
  }
  let mm;
  if (m === "PATCH" && (mm = p.match(/^\/api\/orders\/([^/]+)$/))) {
    const b = await readBody(req, 10 * 1024);
    return send(res, 200, setStatus("orders.json", decodeURIComponent(mm[1]), b.status, ORDER_STATUSES));
  }
  if (m === "PATCH" && (mm = p.match(/^\/api\/bookings\/([^/]+)$/))) {
    const b = await readBody(req, 10 * 1024);
    return send(res, 200, setStatus("bookings.json", decodeURIComponent(mm[1]), b.status, BOOKING_STATUSES));
  }
  if (m === "PUT" && p === "/api/site") {
    const b = await readBody(req, 12 * 1024 * 1024);
    const site = { version: Date.now(), products: cleanProducts(b.products), settings: cleanSettings(b.settings) };
    writeJson("site.json", site);
    return send(res, 200, { ok: true, version: site.version });
  }
  throw new HttpError(404, "Не найдено.");
}

/* ---------- Раздача файлов сайта ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp"
};
const PUBLIC_FILES = new Set(["index.html", "admin.html", "login.html", "account.html", "style.css", "admin.css", "login.css", "account.css", "script.js", "admin.js", "login.js", "account.js", "storage.js", "config.js"]);

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const isImage = /^images\/[\w.\-]+$/.test(rel);
  if (!PUBLIC_FILES.has(rel) && !isImage) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Не найдено"); }
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Не найдено"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") serveStatic(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    send(res, 500, { error: "Внутренняя ошибка сервера." });
  }
});

server.listen(PORT, () => {
  console.log("Сайт:    http://localhost:" + PORT);
  console.log("Админка: http://localhost:" + PORT + "/login.html  (логин " + ADMIN_LOGIN + (process.env.ADMIN_PASSWORD ? "" : ", пароль demo123 — смените через ADMIN_PASSWORD") + ")");
});
