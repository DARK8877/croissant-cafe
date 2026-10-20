/* ==========================================================
   admin.js — управление товарами, заказами, бронированиями и сайтом
   Всё, что меняется здесь, сохраняется НА СЕРВЕРЕ и через несколько
   секунд появляется на сайте у посетителей и в админке на других устройствах.
   ========================================================== */

/* ---------- Проверка входа ----------
   Настоящая проверка делается на сервере: без токена он ничего не отдаст.
   Эта строка лишь отправляет на страницу входа, если токена нет. */
if (!isAdminSession()) {
  window.location.replace("index.html");
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const POLL_MS = 10000;                 // как часто админка опрашивает сервер
const BASE_TITLE = document.title;

// Заказы и бронирования с сервера (хранятся в памяти страницы)
let ordersCache = [];
let bookingsCache = [];
let loading = false;                   // идёт загрузка с сервера
let firstLoad = true;                  // первая загрузка: уведомлять о «новых» рано
let unread = 0;                        // новые заказы/брони, пока вкладка была скрыта
let siteDirty = false;                 // пользователь печатает в форме «Редактирование сайта»
const knownOrders = new Set();
const knownBookings = new Set();
const highlight = new Set();           // id новых заказов (подсветка в таблице)

/* ---------- Уведомления, звук, индикатор связи ---------- */
function toast(text, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " toast--" + kind : "");
  el.textContent = text;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 7000 : 5000);
}

// Звук можно включить только после касания/клика на странице (правило браузеров)
let audioCtx = null;
document.addEventListener("pointerdown", () => {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) { /* звук недоступен */ }
});
function beep() {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + 0.55);
  } catch (e) { /* ничего страшного */ }
}

function setLive(ok) {
  const el = $("#liveStatus");
  if (ok) {
    el.className = "live live--ok";
    el.textContent = "● онлайн · " + new Date().toLocaleTimeString("ru-RU");
  } else {
    el.className = "live live--err";
    el.textContent = "● нет связи с сервером";
  }
}

function showServerMsg(text) {
  const el = $("#serverMsg");
  el.textContent = text || "";
  el.hidden = !text;
}

function goLogin() {
  clearToken();
  window.location.replace("index.html");
}

/* ---------- Загрузка данных с сервера ---------- */

// Замечаем новые заказы/брони и сообщаем о них (тост, звук, вибрация, счётчик во вкладке)
function detectNew() {
  const newO = ordersCache.filter((o) => !knownOrders.has(o.id));
  const newB = bookingsCache.filter((b) => !knownBookings.has(b.id));
  ordersCache.forEach((o) => knownOrders.add(o.id));
  bookingsCache.forEach((b) => knownBookings.add(b.id));
  if (firstLoad) { firstLoad = false; return; }
  if (!newO.length && !newB.length) return;

  newO.forEach((o) => { highlight.add(o.id); toast("Новый заказ № " + o.number + ": " + o.name + ", " + formatPrice(o.total), "accent"); });
  newB.forEach((b) => toast("Новая бронь: " + b.name + ", " + b.date + " " + b.time + ", гостей: " + b.guests, "accent"));
  beep();
  try { if (navigator.vibrate) navigator.vibrate([150, 80, 150]); } catch (e) { /* не поддерживается */ }
  if (document.hidden) {
    unread += newO.length + newB.length;
    document.title = "(" + unread + ") " + BASE_TITLE;
  }
}

// Загружает заказы, брони и свежую версию каталога. false — не удалось.
async function loadRemote() {
  try {
    const d = await fetchAdminData();
    ordersCache = Array.isArray(d.orders) ? d.orders : [];
    bookingsCache = Array.isArray(d.bookings) ? d.bookings : [];
    showServerMsg("");
    setLive(true);
    detectNew();
  } catch (ex) {
    if (ex.status === 401) { goLogin(); return false; }
    showServerMsg(ex.message);
    setLive(false);
    return false;
  }
  // Каталог и тексты: если их изменили с другого устройства — подтягиваем
  const changed = await syncSite();
  if (changed && !siteDirty) fillSiteForm();
  return true;
}

// Полное обновление: сразу рисуем из кэша, потом с сервера
async function refresh() {
  renderAll();
  if (loading) return;
  loading = true;
  try { await loadRemote(); } finally { loading = false; }
  renderAll();
}

// Фоновый опрос. Не перерисовываем таблицы, пока открыт выпадающий список статуса.
async function poll() {
  if (document.hidden || loading) return;
  loading = true;
  try { await loadRemote(); } finally { loading = false; }
  const a = document.activeElement;
  if (!(a && a.matches && a.matches("td select"))) renderAll();
}

/* ---------- Сохранение каталога и настроек на сервер ----------
   Сначала подтягиваем свежую версию (чтобы не затереть правки с другого
   устройства), вносим изменение, отправляем. При ошибке — откат. */
async function mutateSite(fn) {
  await syncSite();
  const products = getProducts();
  const settings = getSettings();
  const prevP = localStorage.getItem(KEYS.products);
  const prevS = localStorage.getItem(KEYS.settings);

  const r = fn(products, settings) || {};          // fn может выбросить Error — это увидит вызывающий код
  const nextP = r.products || products;
  const nextS = r.settings || settings;

  const rollback = () => {
    try {
      if (prevP !== null) localStorage.setItem(KEYS.products, prevP);
      if (prevS !== null) localStorage.setItem(KEYS.settings, prevS);
    } catch (e) { /* ignore */ }
  };
  if (!writeJSON(KEYS.products, nextP) || !writeJSON(KEYS.settings, nextS)) { rollback(); return false; }

  try {
    const res = await pushSite(nextP, nextS);
    localStorage.setItem(SITE_VER_KEY, String(res.version));
    setLive(true);
    return true;
  } catch (ex) {
    rollback();
    if (ex.status === 401) { goLogin(); return false; }
    toast("Не сохранено на сервере: " + ex.message, "error");
    return false;
  }
}

const SECTION_TITLES = {
  dashboard: "Дашборд", products: "Товары", orders: "Заказы", bookings: "Бронирования",
  site: "Редактирование сайта", images: "Изображения", settings: "Настройки"
};

/* ---------- Переключение разделов ---------- */
function showSection(name) {
  $$(".sec").forEach((s) => (s.hidden = s.id !== "sec-" + name));
  $$("#menu button").forEach((b) => b.classList.toggle("active", b.dataset.section === name));
  $("#sectionTitle").textContent = SECTION_TITLES[name];
  $("#sidebar").classList.remove("open");
  refresh();
}

function renderAll() {
  renderDashboard();
  renderProducts();
  renderOrders();
  renderBookings();
  renderImages();
  renderSettingsInfo();
}

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Ссылка «позвонить»: на телефоне открывает набор номера
function phoneLink(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? `<a href="tel:${escapeHTML(digits)}">${escapeHTML(phone)}</a>` : escapeHTML(phone);
}

/* Выпадающий список статусов */
function statusSelect(attr, id, statuses, current) {
  return `<select ${attr}="${escapeHTML(id)}">` +
    statuses.map((s) => `<option ${s === current ? "selected" : ""}>${s}</option>`).join("") + "</select>";
}

/* ==========================================================
   1. Дашборд
   ========================================================== */
function renderDashboard() {
  const products = getProducts(), orders = ordersCache, bookings = bookingsCache;
  // Сумму считаем без отменённых заказов
  const sum = orders.filter((o) => o.status !== "Отменён").reduce((s, o) => s + (o.total || 0), 0);
  const cards = [
    ["Всего товаров", products.length],
    ["Доступных товаров", products.filter((p) => p.available).length],
    ["Заказов", orders.length],
    ["Новых заказов", orders.filter((o) => o.status === "Новый").length],
    ["Бронирований", bookings.length],
    ["Новых броней", bookings.filter((b) => b.status === "Новое").length],
    ["Сумма заказов (без отменённых)", formatPrice(sum), true]
  ];
  $("#stats").innerHTML = cards.map(([label, value, accent]) =>
    `<div class="stat ${accent ? "stat--accent" : ""}"><b>${value}</b><span>${label}</span></div>`).join("");

  const last = orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  $("#recentOrders").innerHTML = last.length
    ? last.map((o) => `<tr>
        <td data-label="№">${o.number}</td><td data-label="Клиент">${escapeHTML(o.name)}</td>
        <td data-label="Сумма">${formatPrice(o.total)}</td><td data-label="Дата">${fmtDate(o.createdAt)}</td>
        <td data-label="Статус"><span class="badge">${escapeHTML(o.status)}</span></td></tr>`).join("")
    : '<tr><td colspan="5" class="empty">Заказов пока нет. Оформите заказ на сайте.</td></tr>';
}

/* ==========================================================
   2. Товары
   ========================================================== */
let editingId = null;      // id редактируемого товара (null — создаём новый)
let pendingImage = "";     // изображение, выбранное в форме

function fillCategorySelects() {
  const opts = Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("#prodFilter").innerHTML = '<option value="all">Все категории</option>' + opts;
  $("#pf_cat").innerHTML = opts;
}

function renderProducts() {
  const filter = $("#prodFilter").value || "all";
  const list = getProducts().filter((p) => filter === "all" || p.category === filter);
  $("#prodTable").innerHTML = list.length
    ? list.map((p) => `
      <tr>
        <td data-label="Фото"><img src="${escapeHTML(safeImage(p.image) || IMG_FALLBACK)}" alt="" onerror="this.onerror=null;this.src=IMG_FALLBACK"></td>
        <td data-label="Название"><div><b>${escapeHTML(p.name)}</b><div class="items">${escapeHTML(p.description)}</div></div></td>
        <td data-label="Категория">${escapeHTML(CATEGORIES[p.category] || "—")}</td>
        <td data-label="Цена">${formatPrice(p.price)}</td>
        <td data-label="Доступен"><button class="btn btn--sm ${p.available ? "" : "btn--ghost"}" data-toggle="${escapeHTML(p.id)}">${p.available ? "Да" : "Нет"}</button></td>
        <td data-label="Действия">
          <span>
            <button class="btn btn--sm btn--ghost" data-edit="${escapeHTML(p.id)}">Изменить</button>
            <button class="btn btn--sm btn--danger" data-del="${escapeHTML(p.id)}">Удалить</button>
          </span>
        </td>
      </tr>`).join("")
    : '<tr><td colspan="6" class="empty">Товаров нет.</td></tr>';
}

function openProductForm(id) {
  editingId = id || null;
  const p = id ? getProducts().find((x) => x.id === id) : null;
  $("#productModalTitle").textContent = p ? "Редактирование товара" : "Новый товар";
  $("#pf_name").value = p ? p.name : "";
  $("#pf_desc").value = p ? p.description : "";
  $("#pf_price").value = p ? p.price : "";
  $("#pf_cat").value = p ? p.category : "coffee";
  $("#pf_avail").checked = p ? p.available : true;
  $("#pf_file").value = "";
  $("#pf_url").value = p && /^https?:/i.test(p.image) ? p.image : "";
  pendingImage = p ? p.image : "";
  $("#pf_err").textContent = "";
  updatePreview();
  $("#productModal").hidden = false;
}

function updatePreview() {
  const img = $("#pf_preview");
  if (pendingImage) { img.src = pendingImage; img.hidden = false; } else img.hidden = true;
}

/* Уменьшаем фото через canvas: так оно быстро грузится и помещается на сервер */
function compressImage(file, maxSide = 480, quality = 0.6) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Выберите файл-изображение."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Не удалось открыть изображение (поддерживаются JPG, PNG, WebP)."));
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); // фон для прозрачных PNG
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function onProductFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingImage = await compressImage(file);
    $("#pf_url").value = "";
    updatePreview();
  } catch (err) { $("#pf_err").textContent = err.message; }
}

async function saveProduct(e) {
  e.preventDefault();
  const name = $("#pf_name").value.trim();
  const price = Number($("#pf_price").value);
  const url = $("#pf_url").value.trim();
  const err = $("#pf_err");

  if (name.length < 2) { err.textContent = "Введите название (минимум 2 символа)."; return; }
  if (!Number.isFinite(price) || price < 0 || price > 10000000 || $("#pf_price").value === "") { err.textContent = "Введите корректную цену."; return; }
  // Если указана ссылка и не выбран файл — берём ссылку
  let image = pendingImage;
  if (url) {
    if (!/^https?:\/\//i.test(url)) { err.textContent = "Ссылка должна начинаться с http:// или https://"; return; }
    if (!$("#pf_file").value) image = url;
  }
  err.textContent = "";

  const data = {
    name, description: $("#pf_desc").value.trim(), price: Math.round(price),
    category: $("#pf_cat").value, available: $("#pf_avail").checked, image
  };
  const btn = $("#productForm button[type=submit]");
  btn.disabled = true;
  try {
    const ok = await mutateSite((products) => {
      if (editingId) {
        const i = products.findIndex((p) => p.id === editingId);
        if (i < 0) throw new Error("Этот товар уже удалён с другого устройства.");
        products[i] = Object.assign({}, products[i], data);
      } else {
        products.push(Object.assign({ id: genId("p") }, data));
      }
    });
    if (ok) {
      $("#productModal").hidden = true;
      renderAll();
      toast("Товар сохранён. На сайте он появится в течение 15 секунд.");
    }
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
}

async function deleteProduct(id) {
  const p = getProducts().find((x) => x.id === id);
  if (!p || !confirm("Удалить товар «" + p.name + "»?")) return;
  if (await mutateSite((products) => ({ products: products.filter((x) => x.id !== id) }))) {
    saveCart(getCart().filter((i) => i.id !== id)); // убираем из корзины на этом браузере
    renderAll();
    toast("Товар удалён.");
  }
}

async function toggleProduct(id) {
  let state = null;
  const ok = await mutateSite((products) => {
    const p = products.find((x) => x.id === id);
    if (!p) throw new Error("Товар не найден.");
    p.available = !p.available;
    state = p.available;
  }).catch((ex) => { toast(ex.message, "error"); return false; });
  if (ok) { renderAll(); toast(state ? "Товар доступен для заказа." : "Товар скрыт: «Нет в наличии»."); }
}

/* ==========================================================
   3. Заказы
   ========================================================== */
function fillStatusFilters() {
  $("#orderFilter").innerHTML = '<option value="all">Все статусы</option>' + ORDER_STATUSES.map((s) => `<option>${s}</option>`).join("");
  $("#bookingFilter").innerHTML = '<option value="all">Все статусы</option>' + BOOKING_STATUSES.map((s) => `<option>${s}</option>`).join("");
}

function renderOrders() {
  const q = $("#orderSearch").value.trim().toLowerCase();
  const st = $("#orderFilter").value || "all";
  const list = ordersCache.slice()
    .filter((o) => st === "all" || o.status === st)
    .filter((o) => !q || String(o.number).includes(q) || String(o.name).toLowerCase().includes(q) || String(o.phone).toLowerCase().includes(q))
    .sort((a, b) => b.number - a.number);

  $("#orderTable").innerHTML = list.length
    ? list.map((o) => `
      <tr class="${highlight.has(o.id) && o.status === "Новый" ? "is-new" : ""}">
        <td data-label="№"><b>${o.number}</b></td>
        <td data-label="Клиент">${escapeHTML(o.name)}${o.address ? `<div class="items">${escapeHTML(o.city || "")}, ${escapeHTML(o.address)}</div>` : ""}${o.userLogin ? `<div class="items">аккаунт: ${escapeHTML(o.userLogin)}</div>` : ""}</td>
        <td data-label="Телефон">${phoneLink(o.phone)}</td>
        <td data-label="Состав" class="items">${(o.items || []).map((i) => escapeHTML(i.name) + " ×" + i.qty).join(", ")}</td>
        <td data-label="Сумма">${formatPrice(o.total)}</td>
        <td data-label="Дата">${fmtDate(o.createdAt)}</td>
        <td data-label="Статус">${statusSelect("data-order-status", o.id, ORDER_STATUSES, o.status)}</td>
        <td data-label=""><button class="btn btn--sm btn--ghost" data-view-order="${escapeHTML(o.id)}">Открыть</button></td>
      </tr>`).join("")
    : '<tr><td colspan="8" class="empty">Заказов не найдено.</td></tr>';
}

function viewOrder(id) {
  const o = ordersCache.find((x) => x.id === id);
  if (!o) return;
  $("#orderModalTitle").textContent = "Заказ № " + o.number;
  $("#orderModalBody").innerHTML = `
    <p><b>Клиент:</b> ${escapeHTML(o.name)}<br><b>Телефон:</b> ${phoneLink(o.phone)}<br>
    <b>Адрес доставки:</b> ${escapeHTML(o.city || "")}, ${escapeHTML(o.address || "—")}<br>
    ${o.userLogin ? `<b>Аккаунт:</b> ${escapeHTML(o.userLogin)}<br>` : ""}
    <b>Создан:</b> ${fmtDate(o.createdAt)}<br><b>Статус:</b> ${escapeHTML(o.status)}</p>
    <p><b>Комментарий:</b> ${escapeHTML(o.comment || "—")}</p>
    <div class="table-wrap"><table style="min-width:0"><thead><tr><th>Товар</th><th>Цена</th><th>Кол-во</th><th>Сумма</th></tr></thead><tbody>
    ${(o.items || []).map((i) => `<tr><td>${escapeHTML(i.name)}</td><td>${formatPrice(i.price)}</td><td>${i.qty}</td><td>${formatPrice(i.price * i.qty)}</td></tr>`).join("")}
    </tbody></table></div>
    <p><b>Итого: ${formatPrice(o.total)}</b></p>`;
  $("#orderModal").hidden = false;
}

/* ==========================================================
   4. Бронирования
   ========================================================== */
function renderBookings() {
  const st = $("#bookingFilter").value || "all";
  const list = bookingsCache.slice()
    .filter((b) => st === "all" || b.status === st)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  $("#bookingTable").innerHTML = list.length
    ? list.map((b) => `
      <tr>
        <td data-label="Клиент">${escapeHTML(b.name)}</td><td data-label="Телефон">${phoneLink(b.phone)}</td>
        <td data-label="Дата">${escapeHTML(b.date)}</td><td data-label="Время">${escapeHTML(b.time)}</td><td data-label="Гостей">${b.guests}</td>
        <td data-label="Статус">${statusSelect("data-booking-status", b.id, BOOKING_STATUSES, b.status)}</td>
      </tr>`).join("")
    : '<tr><td colspan="6" class="empty">Заявок на бронирование не найдено.</td></tr>';
}

/* ==========================================================
   5. Редактирование сайта
   ========================================================== */
const SITE_FIELDS = ["name", "tagline", "heroTitle", "heroText", "address", "phone", "hours", "about", "instagram", "telegram", "whatsapp"];

function fillSiteForm() {
  const s = getSettings();
  SITE_FIELDS.forEach((k) => ($("#s_" + k).value = s[k] || ""));
}

async function saveSite(e) {
  e.preventDefault();
  const msg = $("#siteMsg");
  const s = {};
  SITE_FIELDS.forEach((k) => (s[k] = $("#s_" + k).value.trim()));
  if (!s.name) { msg.textContent = "Название не может быть пустым."; msg.className = "msg msg--error"; return; }
  if (!s.heroTitle) { msg.textContent = "Заголовок не может быть пустым."; msg.className = "msg msg--error"; return; }
  for (const k of ["instagram", "telegram", "whatsapp"]) {
    if (s[k] && !/^https?:\/\//i.test(s[k])) { msg.textContent = "Ссылки должны начинаться с http:// или https://"; msg.className = "msg msg--error"; return; }
  }
  const btn = $("#siteForm button[type=submit]");
  btn.disabled = true; msg.textContent = "Сохраняем…"; msg.className = "msg";
  try {
    if (await mutateSite((products, settings) => ({ settings: Object.assign({}, settings, s) }))) {
      siteDirty = false;
      msg.textContent = "Сохранено на сервере. На сайте изменения появятся в течение 15 секунд.";
      renderAll();
    } else {
      msg.textContent = "Не удалось сохранить. Проверьте соединение и попробуйте ещё раз."; msg.className = "msg msg--error";
    }
  } catch (ex) {
    msg.textContent = ex.message; msg.className = "msg msg--error";
  } finally {
    btn.disabled = false;
  }
}

/* ==========================================================
   6. Изображения
   ========================================================== */
function renderImages() {
  // Не перерисовываем сетку, пока пользователь выбирает файл на телефоне
  const a = document.activeElement;
  if (!(a && a.matches && a.matches("input[type=file]"))) {
    $("#imgGrid").innerHTML = getProducts().map((p) => `
      <div class="img-card">
        <img src="${escapeHTML(safeImage(p.image) || IMG_FALLBACK)}" alt="" onerror="this.onerror=null;this.src=IMG_FALLBACK">
        <div><b>${escapeHTML(p.name)}</b><br><input type="file" accept="image/*" data-img-for="${escapeHTML(p.id)}"></div>
      </div>`).join("");
  }
  let chars = 0;
  Object.values(KEYS).forEach((k) => { chars += (localStorage.getItem(k) || "").length; });
  $("#storageUsed").textContent = ((chars * 2) / (1024 * 1024)).toFixed(2) + " МБ из ~5 МБ";
}

async function replaceImage(id, file) {
  try {
    const data = await compressImage(file);
    const ok = await mutateSite((products) => {
      const p = products.find((x) => x.id === id);
      if (!p) throw new Error("Товар не найден.");
      p.image = data;
    });
    if (ok) { renderAll(); toast("Фото обновлено и отправлено на сайт."); }
  } catch (err) { toast(err.message, "error"); }
}

/* ==========================================================
   7. Настройки
   ========================================================== */
function renderSettingsInfo() {
  const s = getSettings();
  $("#settingsInfo").innerHTML = [
    ["Название", s.name], ["Телефон", s.phone], ["Адрес", s.address], ["Время работы", s.hours],
    ["Товаров", getProducts().length], ["Заказов (на сервере)", ordersCache.length], ["Бронирований (на сервере)", bookingsCache.length]
  ].map(([k, v]) => `<li><b>${k}:</b> ${escapeHTML(v)}</li>`).join("");
}

async function resetDemo() {
  if (!confirm("Каталог и тексты сайта на сервере будут заменены демонстрационными (у всех посетителей). Заказы и бронирования не удаляются. Продолжить?")) return;
  const ok = await mutateSite(() => ({
    products: DEFAULT_PRODUCTS.map((p) => Object.assign({}, p)),
    settings: Object.assign({}, DEFAULT_SETTINGS)
  }));
  if (ok) { saveCart([]); fillSiteForm(); renderAll(); toast("Демонстрационные данные восстановлены."); }
}

/* ==========================================================
   Подключение событий
   ========================================================== */
function init() {
  fillCategorySelects();
  fillStatusFilters();
  fillSiteForm();

  $("#menu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-section]");
    if (b) showSection(b.dataset.section);
  });
  $("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#logout").addEventListener("click", () => { clearToken(); window.location.href = "index.html"; });

  $("#prodFilter").addEventListener("change", renderProducts);
  $("#addProduct").addEventListener("click", () => openProductForm(null));
  $("#productForm").addEventListener("submit", saveProduct);
  $("#pf_file").addEventListener("change", onProductFile);
  $("#pf_url").addEventListener("input", () => {
    const v = $("#pf_url").value.trim();
    if (/^https?:\/\//i.test(v)) { pendingImage = v; $("#pf_file").value = ""; updatePreview(); }
  });

  $("#prodTable").addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.edit) openProductForm(t.dataset.edit);
    if (t.dataset.del) deleteProduct(t.dataset.del);
    if (t.dataset.toggle) { t.disabled = true; toggleProduct(t.dataset.toggle); }
  });

  $("#orderSearch").addEventListener("input", renderOrders);
  $("#orderFilter").addEventListener("change", renderOrders);
  $("#bookingFilter").addEventListener("change", renderBookings);
  $("#orderTable").addEventListener("click", (e) => {
    const t = e.target.closest("button[data-view-order]");
    if (t) viewOrder(t.dataset.viewOrder);
  });

  // Смена статуса заказа/брони и выбор нового фото
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.imgFor) {
      if (t.files[0]) await replaceImage(t.dataset.imgFor, t.files[0]);
      return;
    }
    try {
      if (t.dataset.orderStatus && ORDER_STATUSES.includes(t.value)) {
        t.disabled = true;
        await setOrderStatus(t.dataset.orderStatus, t.value);
        highlight.delete(t.dataset.orderStatus);
        await refresh();
      } else if (t.dataset.bookingStatus && BOOKING_STATUSES.includes(t.value)) {
        t.disabled = true;
        await setBookingStatus(t.dataset.bookingStatus, t.value);
        await refresh();
      }
    } catch (ex) {
      if (ex.status === 401) return goLogin();
      toast(ex.message, "error");
      refresh(); // вернуть в списке реальный статус
    }
  });

  $("#siteForm").addEventListener("input", () => { siteDirty = true; });
  $("#siteForm").addEventListener("submit", saveSite);
  $("#resetDemo").addEventListener("click", resetDemo);

  // Закрытие окон
  document.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close") || e.target.classList.contains("modal")) $$(".modal").forEach((m) => (m.hidden = true));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal").forEach((m) => (m.hidden = true)); });

  // Возврат на вкладку / восстановление сети — сразу обновляем
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { unread = 0; document.title = BASE_TITLE; poll(); }
  });
  window.addEventListener("online", poll);
  window.addEventListener("offline", () => setLive(false));

  refresh();
  setInterval(poll, POLL_MS);
}

init();
