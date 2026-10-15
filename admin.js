/* ==========================================================
   admin.js — управление товарами, заказами, бронированиями и сайтом
   Использует общие функции из storage.js.
   ========================================================== */

/* ---------- Проверка входа ----------
   Настоящая проверка делается на сервере: без токена он не отдаст заказы.
   Эта строка лишь отправляет на страницу входа, если токена нет. */
if (!getToken()) {
  window.location.replace("login.html");
}

// Заказы и бронирования загружаются с сервера и держатся здесь, в памяти страницы
let ordersCache = [];
let bookingsCache = [];

function showServerMsg(text) {
  const el = $("#serverMsg");
  el.textContent = text || "";
  el.hidden = !text;
}

// Загружает заказы и брони с сервера. Если токен недействителен — на страницу входа.
async function loadRemote() {
  try {
    const [o, b] = await Promise.all([fetchOrders(), fetchBookings()]);
    ordersCache = o; bookingsCache = b;
    showServerMsg("");
  } catch (ex) {
    if (ex.status === 401) { clearToken(); window.location.replace("login.html"); return; }
    showServerMsg(ex.message);
  }
}

// Перерисовать сразу из кэша, затем обновить с сервера и перерисовать ещё раз
async function refresh() {
  renderAll();
  await loadRemote();
  renderAll();
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

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
    ["Сумма заказов (без отменённых)", formatPrice(sum), true]
  ];
  $("#stats").innerHTML = cards.map(([label, value, accent]) =>
    `<div class="stat ${accent ? "stat--accent" : ""}"><b>${value}</b><span>${label}</span></div>`).join("");

  const last = orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
  $("#recentOrders").innerHTML = last.length
    ? last.map((o) => `<tr><td>${o.number}</td><td>${escapeHTML(o.name)}</td><td>${formatPrice(o.total)}</td><td>${fmtDate(o.createdAt)}</td><td><span class="badge">${escapeHTML(o.status)}</span></td></tr>`).join("")
    : '<tr><td colspan="5" class="empty">Заказов пока нет. Оформите заказ на сайте.</td></tr>';
}

/* ==========================================================
   2. Товары
   ========================================================== */
let editingId = null;      // id редактируемого товара (null — создаём новый)
let pendingImage = "";     // изображение, выбранное в форме

// Заполняем списки категорий
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
        <td><img src="${escapeHTML(safeImage(p.image) || IMG_FALLBACK)}" alt="" onerror="this.onerror=null;this.src=IMG_FALLBACK"></td>
        <td><b>${escapeHTML(p.name)}</b><div class="items">${escapeHTML(p.description)}</div></td>
        <td>${escapeHTML(CATEGORIES[p.category] || "—")}</td>
        <td>${formatPrice(p.price)}</td>
        <td><button class="btn btn--sm ${p.available ? "" : "btn--ghost"}" data-toggle="${escapeHTML(p.id)}">${p.available ? "Да" : "Нет"}</button></td>
        <td>
          <button class="btn btn--sm btn--ghost" data-edit="${escapeHTML(p.id)}">Изменить</button>
          <button class="btn btn--sm btn--danger" data-del="${escapeHTML(p.id)}">Удалить</button>
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

/* Уменьшаем фото через canvas, чтобы оно занимало мало места в localStorage */
function compressImage(file, maxSide = 600, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Выберите файл-изображение."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Файл не является изображением."));
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
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

function saveProduct(e) {
  e.preventDefault();
  const name = $("#pf_name").value.trim();
  const price = Number($("#pf_price").value);
  const url = $("#pf_url").value.trim();
  const err = $("#pf_err");

  if (name.length < 2) { err.textContent = "Введите название (минимум 2 символа)."; return; }
  if (!Number.isFinite(price) || price < 0 || $("#pf_price").value === "") { err.textContent = "Введите корректную цену."; return; }
  // Если указана ссылка и не выбран файл — берём ссылку
  let image = pendingImage;
  if (url) {
    if (!/^https?:\/\//i.test(url)) { err.textContent = "Ссылка должна начинаться с http:// или https://"; return; }
    if (!$("#pf_file").value) image = url;
  }

  const products = getProducts();
  const data = {
    name, description: $("#pf_desc").value.trim(), price: Math.round(price),
    category: $("#pf_cat").value, available: $("#pf_avail").checked, image
  };
  if (editingId) {
    const i = products.findIndex((p) => p.id === editingId);
    if (i >= 0) products[i] = Object.assign({}, products[i], data);
  } else {
    products.push(Object.assign({ id: genId("p") }, data));
  }
  if (!saveProducts(products)) return;
  $("#productModal").hidden = true;
  renderAll();
}

function deleteProduct(id) {
  const p = getProducts().find((x) => x.id === id);
  if (!p || !confirm("Удалить товар «" + p.name + "»?")) return;
  saveProducts(getProducts().filter((x) => x.id !== id));
  // Убираем удалённый товар из корзины на этом браузере
  saveCart(getCart().filter((i) => i.id !== id));
  renderAll();
}

function toggleProduct(id) {
  const products = getProducts();
  const p = products.find((x) => x.id === id);
  if (p) { p.available = !p.available; saveProducts(products); renderAll(); }
}

/* ==========================================================
   3. Заказы
   ========================================================== */
function renderOrders() {
  const q = $("#orderSearch").value.trim().toLowerCase();
  const list = ordersCache.slice()
    .filter((o) => !q || String(o.number).includes(q) || String(o.name).toLowerCase().includes(q))
    .sort((a, b) => b.number - a.number);

  $("#orderTable").innerHTML = list.length
    ? list.map((o) => `
      <tr>
        <td><b>${o.number}</b></td>
        <td>${escapeHTML(o.name)}</td>
        <td>${escapeHTML(o.phone)}</td>
        <td class="items">${(o.items || []).map((i) => escapeHTML(i.name) + " ×" + i.qty).join(", ")}</td>
        <td>${formatPrice(o.total)}</td>
        <td>${fmtDate(o.createdAt)}</td>
        <td>${statusSelect("data-order-status", o.id, ORDER_STATUSES, o.status)}</td>
        <td><button class="btn btn--sm btn--ghost" data-view-order="${escapeHTML(o.id)}">Открыть</button></td>
      </tr>`).join("")
    : '<tr><td colspan="8" class="empty">Заказов не найдено.</td></tr>';
}

function viewOrder(id) {
  const o = ordersCache.find((x) => x.id === id);
  if (!o) return;
  $("#orderModalTitle").textContent = "Заказ № " + o.number;
  $("#orderModalBody").innerHTML = `
    <p><b>Клиент:</b> ${escapeHTML(o.name)}<br><b>Телефон:</b> ${escapeHTML(o.phone)}<br>
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
  const list = bookingsCache.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  $("#bookingTable").innerHTML = list.length
    ? list.map((b) => `
      <tr>
        <td>${escapeHTML(b.name)}</td><td>${escapeHTML(b.phone)}</td>
        <td>${escapeHTML(b.date)}</td><td>${escapeHTML(b.time)}</td><td>${b.guests}</td>
        <td>${statusSelect("data-booking-status", b.id, BOOKING_STATUSES, b.status)}</td>
      </tr>`).join("")
    : '<tr><td colspan="6" class="empty">Заявок на бронирование пока нет.</td></tr>';
}

/* ==========================================================
   5. Редактирование сайта
   ========================================================== */
const SITE_FIELDS = ["name", "tagline", "heroTitle", "heroText", "address", "phone", "hours", "about", "instagram", "telegram", "whatsapp"];

function fillSiteForm() {
  const s = getSettings();
  SITE_FIELDS.forEach((k) => ($("#s_" + k).value = s[k] || ""));
}

function saveSite(e) {
  e.preventDefault();
  const msg = $("#siteMsg");
  const s = {};
  SITE_FIELDS.forEach((k) => (s[k] = $("#s_" + k).value.trim()));
  if (!s.name) { msg.textContent = "Название не может быть пустым."; msg.className = "msg msg--error"; return; }
  if (!s.heroTitle) { msg.textContent = "Заголовок не может быть пустым."; msg.className = "msg msg--error"; return; }
  for (const k of ["instagram", "telegram", "whatsapp"]) {
    if (s[k] && !/^https?:\/\//i.test(s[k])) { msg.textContent = "Ссылки должны начинаться с http:// или https://"; msg.className = "msg msg--error"; return; }
  }
  if (saveSettings(s)) { msg.textContent = "Сохранено! Обновите страницу сайта, чтобы увидеть изменения."; msg.className = "msg"; }
}

/* ==========================================================
   6. Изображения
   ========================================================== */
function renderImages() {
  $("#imgGrid").innerHTML = getProducts().map((p) => `
    <div class="img-card">
      <img src="${escapeHTML(safeImage(p.image) || IMG_FALLBACK)}" alt="" onerror="this.onerror=null;this.src=IMG_FALLBACK">
      <div><b>${escapeHTML(p.name)}</b><br><input type="file" accept="image/*" data-img-for="${escapeHTML(p.id)}"></div>
    </div>`).join("");

  // Оценка занятого места (в символах ≈ байтах×2 в браузере)
  let chars = 0;
  Object.values(KEYS).forEach((k) => { chars += (localStorage.getItem(k) || "").length; });
  const mb = (chars * 2) / (1024 * 1024);
  $("#storageUsed").textContent = mb.toFixed(2) + " МБ из ~5 МБ";
}

async function replaceImage(id, file) {
  try {
    const data = await compressImage(file);
    const products = getProducts();
    const p = products.find((x) => x.id === id);
    if (p) { p.image = data; if (saveProducts(products)) renderAll(); }
  } catch (err) { alert(err.message); }
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

function resetDemo() {
  // Спрашиваем подтверждение — данные автоматически не удаляются никогда
  if (!confirm("Каталог и настройки сайта в этом браузере будут заменены демонстрационными. Заказы и бронирования на сервере не удаляются. Продолжить?")) return;
  resetDemoData();
  fillSiteForm();
  renderAll();
  alert("Демонстрационные данные восстановлены.");
}

/* ==========================================================
   Подключение событий
   ========================================================== */
function init() {
  fillCategorySelects();
  fillSiteForm();

  $("#menu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-section]");
    if (b) showSection(b.dataset.section);
  });
  $("#menuToggle").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#logout").addEventListener("click", () => { clearToken(); window.location.href = "login.html"; });

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
    if (t.dataset.toggle) toggleProduct(t.dataset.toggle);
  });

  $("#orderSearch").addEventListener("input", renderOrders);
  $("#orderTable").addEventListener("click", (e) => {
    const t = e.target.closest("button[data-view-order]");
    if (t) viewOrder(t.dataset.viewOrder);
  });
  // Смена статуса заказа/брони: отправляем на сервер, потом перезагружаем список
  document.addEventListener("change", async (e) => {
    const t = e.target;
    try {
      if (t.dataset.orderStatus && ORDER_STATUSES.includes(t.value)) {
        await setOrderStatus(t.dataset.orderStatus, t.value);
        await refresh();
      }
      if (t.dataset.bookingStatus && BOOKING_STATUSES.includes(t.value)) {
        await setBookingStatus(t.dataset.bookingStatus, t.value);
        await refresh();
      }
    } catch (ex) {
      if (ex.status === 401) { clearToken(); window.location.replace("login.html"); return; }
      alert(ex.message);
      refresh(); // вернуть в списке реальный статус
    }
    if (t.dataset.imgFor && t.files[0]) replaceImage(t.dataset.imgFor, t.files[0]);
  });

  $("#siteForm").addEventListener("submit", saveSite);
  $("#resetDemo").addEventListener("click", resetDemo);

  // Закрытие окон
  document.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close") || e.target.classList.contains("modal")) $$(".modal").forEach((m) => (m.hidden = true));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal").forEach((m) => (m.hidden = true)); });

  refresh();
  // Подтягиваем новые заказы каждые 30 секунд
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
}

init();
