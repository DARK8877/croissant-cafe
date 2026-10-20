/* ==========================================================
   storage.js — общая логика хранения данных
   Подключается и на сайте (index.html), и в админ-панели
   (admin.html), и на странице входа (login.html).
   Все данные лежат в localStorage под ключами ниже.
   ========================================================== */

const KEYS = {
  products: "kit_products",
  settings: "kit_settings",
  cart: "kit_cart",
  token: "kit_admin_token"   // токен администратора (sessionStorage), выдаётся сервером
};

const CATEGORIES = {
  coffee: "Кофе",
  drinks: "Другие напитки",
  croissants: "Круассаны",
  desserts: "Десерты",
  pastry: "Выпечка",
  beans: "Кофейные зёрна"
};

const ORDER_STATUSES = ["Новый", "Готовится", "Готов", "Выполнен", "Отменён"];
const BOOKING_STATUSES = ["Новое", "Подтверждено", "Завершено", "Отменено"];

/* Фотографии: учебная версия берёт их с Unsplash по ссылке.
   Если ссылка не открылась, подставится запасное изображение (см. imgFallback). */
const U = (id) => "https://images.unsplash.com/" + id + "?auto=format&fit=crop&w=800&q=70";

const DEFAULT_PRODUCTS = [
  { id: "p1", name: "Латте", category: "coffee", price: 1200, available: true, image: U("photo-1561882468-9110e03e0f78"), description: "Нежный эспрессо с бархатной молочной пенкой и латте-артом." },
  { id: "p2", name: "Капучино", category: "coffee", price: 1100, available: true, image: U("photo-1572442388796-11668a67e53d"), description: "Классика: эспрессо, тёплое молоко и плотная пенка." },
  { id: "p3", name: "Американо", category: "coffee", price: 900, available: true, image: U("photo-1514432324607-a09d9b4aefdd"), description: "Чистый вкус эспрессо с горячей водой." },
  { id: "p4", name: "Матча латте", category: "drinks", price: 1400, available: true, image: U("photo-1515823064-d6e0c04616a7"), description: "Японский зелёный чай матча с молоком." },
  { id: "p5", name: "Айс-кофе", category: "coffee", price: 1300, available: true, image: U("photo-1517701604599-bb29b565090c"), description: "Освежающий холодный кофе со льдом." },
  { id: "p6", name: "Раф-кофе", category: "coffee", price: 1500, available: true, image: U("photo-1534778101976-62847782c213"), description: "Сливочный кофе с ванильным ароматом." },
  { id: "p7", name: "Классический круассан", category: "croissants", price: 800, available: true, image: U("photo-1555507036-ab1f4038808a"), description: "Хрустящий снаружи и воздушный внутри." },
  { id: "p8", name: "Круассан с миндалём", category: "croissants", price: 1100, available: true, image: U("photo-1623334044303-241021148842"), description: "С миндальным кремом и лепестками миндаля." },
  { id: "p9", name: "Круассан с шоколадом", category: "croissants", price: 1000, available: true, image: U("photo-1549903072-7e6e0bedb7fb"), description: "С тёплой шоколадной начинкой." },
  { id: "p10", name: "Чизкейк с ягодами", category: "desserts", price: 1500, available: true, image: U("photo-1533134242443-d4fd215305ad"), description: "Нежный сливочный чизкейк с ягодным соусом." },
  { id: "p11", name: "Печенье с шоколадом", category: "pastry", price: 700, available: true, image: U("photo-1499636136210-6f4ee915583e"), description: "Мягкое печенье с кусочками шоколада." },
  { id: "p12", name: "Тирамису", category: "desserts", price: 1600, available: true, image: U("photo-1571877227200-a0d98ea607e9"), description: "Итальянский десерт с маскарпоне и кофе." },
  { id: "p13", name: "Синнабон", category: "pastry", price: 950, available: true, image: U("photo-1509365390695-33aee754301f"), description: "Булочка с корицей и сливочным кремом." },
  { id: "p14", name: "Брауни", category: "desserts", price: 900, available: true, image: U("photo-1606313564200-e75d5e30476c"), description: "Плотный шоколадный брауни." },
  { id: "p15", name: "Эфиопия, 250 г", category: "beans", price: 4500, available: true, image: U("photo-1559056199-641a0ac8b55e"), description: "Цветочные и ягодные ноты." },
  { id: "p16", name: "Бразилия, 250 г", category: "beans", price: 3800, available: true, image: U("photo-1447933601403-0c6688de566e"), description: "Ореховый вкус и шоколадное послевкусие." },
  { id: "p17", name: "Колумбия, 250 г", category: "beans", price: 4200, available: true, image: U("photo-1497935586351-b67a49e012bf"), description: "Сбалансированный вкус с карамельной сладостью." }
];

const DEFAULT_SETTINGS = {
  name: "Круасан и точка",
  tagline: "Кофе, круассаны и хорошее настроение",
  heroTitle: "Хороший кофе. Свежий круассан. И точка",
  heroText: "Ароматный кофе, свежая выпечка и уютная атмосфера — всё, что нужно для хорошего дня",
  address: "г. Тараз, ул. Толе би, 42",
  phone: "+7 (700) 000-00-00",
  hours: "ежедневно с 08:00 до 22:00",
  about: "«Круасан и точка» — небольшая кофейня, где каждый день пекут свежие круассаны и варят кофе из тщательно подобранных зёрен. Мы верим, что хороший день начинается с ароматной чашки и тёплой выпечки. Наши бариста уделяют внимание каждой детали, а уютное пространство подходит и для отдыха, и для встреч с друзьями.",
  instagram: "https://instagram.com/",
  telegram: "https://t.me/",
  whatsapp: "https://wa.me/"
};

/* ---------- Безопасное чтение / запись ---------- */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const data = JSON.parse(raw);
    // Проверяем тип: если ждали массив, а пришло другое — данные повреждены
    if (Array.isArray(fallback) && !Array.isArray(data)) throw new Error("not array");
    return data;
  } catch (e) {
    console.warn("Данные «" + key + "» повреждены, используются значения по умолчанию.", e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    // Чаще всего — переполнение localStorage (лимит около 5 МБ)
    alert("Не удалось сохранить данные. Возможно, закончилось место в хранилище (например, из-за больших изображений).");
    return false;
  }
}

/* ---------- Инициализация демо-данных (только если данных нет) ---------- */

function initStorage() {
  if (localStorage.getItem(KEYS.products) === null) writeJSON(KEYS.products, DEFAULT_PRODUCTS);
  if (localStorage.getItem(KEYS.settings) === null) writeJSON(KEYS.settings, DEFAULT_SETTINGS);
  if (localStorage.getItem(KEYS.cart) === null) writeJSON(KEYS.cart, []);
}

/* ---------- Каталог ---------- */
const getProducts = () => readJSON(KEYS.products, DEFAULT_PRODUCTS);
const saveProducts = (list) => writeJSON(KEYS.products, list);

/* ---------- Настройки ---------- */
function getSettings() {
  const s = readJSON(KEYS.settings, DEFAULT_SETTINGS);
  // Объединяем с настройками по умолчанию — вдруг каких-то полей нет
  return Object.assign({}, DEFAULT_SETTINGS, s && typeof s === "object" ? s : {});
}
const saveSettings = (s) => writeJSON(KEYS.settings, s);

/* ---------- Корзина: [{id, qty}] ---------- */
const getCart = () => readJSON(KEYS.cart, []);
const saveCart = (c) => writeJSON(KEYS.cart, c);

/* ==========================================================
   Заказы и бронирования хранятся НЕ в браузере, а на сервере:
   • локально — server.js → файлы data/orders.json и data/bookings.json;
   • на GitHub Pages — Google Apps Script → Google Таблица (config.js).
   Здесь — функции для обращения к серверу (API).
   ========================================================== */

// Адрес сервера. Если страница открыта через Live Server (порт 55xx),
// обращаемся к серверу на порту 3000. Если сайт открыт самим server.js —
// адрес пустой (тот же сайт). Свой адрес можно задать так: window.API_BASE = "https://..."
const API_BASE = window.API_BASE !== undefined ? window.API_BASE
  : (/^55\d\d$/.test(location.port) ? "http://localhost:3000" : "");

// Адрес Google Apps Script (если задан в config.js) — тогда заказы идут в Google Таблицу
const APPS_URL = window.APPS_SCRIPT_URL || "";

const NO_SERVER_MSG = APPS_URL
  ? "Не удалось связаться с сервером заказов. Проверьте интернет и адрес в config.js."
  : (location.hostname.endsWith("github.io")
      ? "Приём заказов не подключён: укажите адрес Google Apps Script в config.js (см. README)."
      : "Сервер заказов недоступен. Запустите его командой «node server.js» и откройте сайт по адресу http://localhost:3000");

/* Сессия входа: { token, role: "user" | "admin", login, name, phone }.
   Администратор — в sessionStorage (закрыл вкладку — вышел),
   обычный пользователь — в localStorage (остаётся на этом устройстве). */
const SESSION_KEY = "kit_session";
function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.token ? s : null;
  } catch (e) { return null; }
}
function setSession(s) {
  clearToken();
  try { (s.role === "admin" ? sessionStorage : localStorage).setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}
const getToken = () => (getSession() || {}).token || "";
const isAdminSession = () => (getSession() || {}).role === "admin";
function clearToken() {
  try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

// Запрос к собственному серверу (node server.js). Бросает Error с понятным текстом.
async function api(method, path, body, withAuth) {
  const headers = { "Content-Type": "application/json" };
  if (withAuth) headers.Authorization = "Bearer " + getToken();
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw Object.assign(new Error(NO_SERVER_MSG), { network: true });
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* ответ не JSON */ }
  if (!res.ok || data === null) {
    // 404/405 от Live Server или GitHub Pages означает, что нашего сервера там нет
    if (data === null) throw Object.assign(new Error(NO_SERVER_MSG), { network: true });
    throw Object.assign(new Error(data.error || "Ошибка сервера"), { status: res.status });
  }
  return data;
}

// Запрос к Google Apps Script. Тип «text/plain» выбран специально: так браузер
// не делает предварительный запрос (preflight), который Apps Script не поддерживает.
async function gas(action, payload, withAuth) {
  let res;
  try {
    res = await fetch(APPS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action }, payload || {}, withAuth ? { token: getToken() } : {}))
    });
  } catch (e) {
    throw Object.assign(new Error(NO_SERVER_MSG), { network: true });
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* не JSON */ }
  if (data === null) throw Object.assign(new Error(NO_SERVER_MSG), { network: true });
  if (data.error) throw Object.assign(new Error(data.error), { status: data.status || 500 });
  return data;
}

// Единый набор функций: сайт и админка не знают, куда именно отправляются данные
// Заказ уходит с токеном (если клиент вошёл), чтобы привязаться к аккаунту
const createOrder = (o) => APPS_URL ? gas("createOrder", o, true) : api("POST", "/api/orders", o, true);
const createBooking = (b) => APPS_URL ? gas("createBooking", b) : api("POST", "/api/bookings", b);
// Вход: и для клиентов, и для администратора (ответ содержит role)
const loginUser = (login, password) => APPS_URL ? gas("login", { login, password }) : api("POST", "/api/login", { login, password });
const registerUser = (d) => APPS_URL ? gas("register", d) : api("POST", "/api/register", d);
const loginAdmin = loginUser;
// Проверка, что сохранённая сессия ещё действует (401 — токен истёк)
const fetchMe = () => APPS_URL ? gas("me", {}, true) : api("GET", "/api/me", undefined, true);
const fetchOrders = () => APPS_URL ? gas("listOrders", {}, true).then((r) => r.data) : api("GET", "/api/orders", undefined, true);
const fetchBookings = () => APPS_URL ? gas("listBookings", {}, true).then((r) => r.data) : api("GET", "/api/bookings", undefined, true);
// Заказы и брони одним запросом (для Apps Script это вдвое меньше нагрузки на квоты)
const fetchAdminData = () => APPS_URL
  ? gas("listAll", {}, true)
  : Promise.all([api("GET", "/api/orders", undefined, true), api("GET", "/api/bookings", undefined, true)])
      .then(([orders, bookings]) => ({ orders, bookings }));
const setOrderStatus = (id, status) => APPS_URL ? gas("setOrderStatus", { id, status }, true) : api("PATCH", "/api/orders/" + encodeURIComponent(id), { status }, true);
const setBookingStatus = (id, status) => APPS_URL ? gas("setBookingStatus", { id, status }, true) : api("PATCH", "/api/bookings/" + encodeURIComponent(id), { status }, true);

/* ==========================================================
   Общий каталог и настройки сайта (хранятся на сервере).
   localStorage служит только быстрым кэшем: сайт рисуется сразу из него,
   а затем подтягивает свежую версию с сервера.
   ========================================================== */
const SITE_VER_KEY = "kit_site_version";

// Публичное чтение каталога. Для Apps Script — обычный GET (без preflight)
async function readPublic(kind) {
  if (APPS_URL) {
    let res;
    try { res = await fetch(APPS_URL + "?action=" + kind + "&t=" + Date.now()); }
    catch (e) { throw Object.assign(new Error(NO_SERVER_MSG), { network: true }); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* не JSON */ }
    if (data === null) throw Object.assign(new Error(NO_SERVER_MSG), { network: true });
    if (data.error) throw Object.assign(new Error(data.error), { status: data.status || 500 });
    return data;
  }
  return api("GET", kind === "site" ? "/api/site" : "/api/site/version");
}
const fetchSiteVersion = () => readPublic("siteVersion");
const fetchSite = () => readPublic("site");
const pushSite = (products, settings) => APPS_URL
  ? gas("saveSite", { products, settings }, true)
  : api("PUT", "/api/site", { products, settings }, true);

// Сверяет версию на сервере с локальной. Если есть новая — обновляет кэш.
// Возвращает true, если данные изменились. Ошибки сети не бросает (сайт работает из кэша).
let syncing = false;
async function syncSite(force) {
  if (syncing) return false;
  syncing = true;
  try {
    const { version } = await fetchSiteVersion();
    const local = Number(localStorage.getItem(SITE_VER_KEY) || 0);
    if (!force && version === local) return false;
    const s = await fetchSite();
    if (s.products && s.settings) {
      const changed = JSON.stringify(s.products) !== localStorage.getItem(KEYS.products) ||
                      JSON.stringify(s.settings) !== localStorage.getItem(KEYS.settings);
      writeJSON(KEYS.products, s.products);
      writeJSON(KEYS.settings, s.settings);
      localStorage.setItem(SITE_VER_KEY, String(s.version));
      return changed;
    }
    return false; // на сервере каталога ещё нет — остаются демо-данные
  } catch (e) {
    return false;
  } finally {
    syncing = false;
  }
}

/* ---------- Сброс демо-данных (вызывается только после подтверждения) ---------- */
// Сбрасывает каталог, настройки и корзину в этом браузере.
// Заказы и бронирования лежат на сервере и этой кнопкой НЕ удаляются.
function resetDemoData() {
  writeJSON(KEYS.products, DEFAULT_PRODUCTS);
  writeJSON(KEYS.settings, DEFAULT_SETTINGS);
  writeJSON(KEYS.cart, []);
}

/* ---------- Вспомогательные функции ---------- */

// Форматирует число как «1 200 ₸»
function formatPrice(n) {
  return Number(n || 0).toLocaleString("ru-RU").replace(/\u00a0/g, " ") + " ₸";
}

// Защита от внедрения HTML: всегда экранируем пользовательский текст
function escapeHTML(str) {
  return String(str == null ? "" : str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

// Разрешаем только безопасные ссылки (http/https) и картинки (http/https/data:image)
function safeUrl(url) {
  const u = String(url || "").trim();
  return /^https?:\/\//i.test(u) ? u : "#";
}
function safeImage(src) {
  const s = String(src || "").trim();
  return /^(https?:\/\/|data:image\/|images\/)/i.test(s) ? s : "";
}

// Запасная картинка (SVG), если фото не загрузилось
const IMG_FALLBACK = "data:image/svg+xml;utf8," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='600'><rect width='100%' height='100%' fill='#A9C0AD'/><text x='50%' y='50%' fill='#496B55' font-size='36' font-family='sans-serif' text-anchor='middle'>Фото недоступно</text></svg>"
);

function genId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

initStorage();
