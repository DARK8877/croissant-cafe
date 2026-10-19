/* ==========================================================
   script.js — логика основного сайта
   Данные берутся из storage.js (общий для сайта и админки).
   ========================================================== */

/* ---------- Короткие помощники ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- 1. Настройки сайта (тексты, контакты, соцсети) ---------- */
function applySettings() {
  const s = getSettings();
  // Все элементы с атрибутом data-setting="ключ" получают текст из настроек.
  // Используем textContent — так пользовательский текст не может внедрить HTML.
  $$("[data-setting]").forEach((el) => {
    const key = el.dataset.setting;
    if (s[key] !== undefined) el.textContent = s[key];
  });
  $("#linkInstagram").href = safeUrl(s.instagram);
  $("#linkTelegram").href = safeUrl(s.telegram);
  $("#linkWhatsapp").href = safeUrl(s.whatsapp);
  document.title = s.name + " — кофейня";
}

/* ---------- 2. Каталог ---------- */
function productCard(p) {
  const img = safeImage(p.image) || IMG_FALLBACK;
  const btn = p.available
    ? `<button class="btn btn--primary" data-add="${escapeHTML(p.id)}">В корзину</button>`
    : `<button class="btn" disabled>Нет в наличии</button>`;
  return `
    <article class="card">
      <img src="${escapeHTML(img)}" alt="${escapeHTML(p.name)}" loading="lazy" onerror="this.onerror=null;this.src=IMG_FALLBACK">
      <div class="card__body">
        <h3 class="card__title">${escapeHTML(p.name)}</h3>
        <p class="card__desc">${escapeHTML(p.description)}</p>
        <div class="card__foot">
          <span class="card__price">${formatPrice(p.price)}</span>
          ${btn}
        </div>
      </div>
    </article>`;
}

function renderCatalog() {
  const products = getProducts();
  const drinks = products.filter((p) => p.category === "coffee" || p.category === "drinks");
  const food = products.filter((p) => ["croissants", "desserts", "pastry"].includes(p.category));
  const beans = products.filter((p) => p.category === "beans");

  $("#gridDrinks").innerHTML = drinks.length ? drinks.map(productCard).join("") : '<p class="empty">Напитков пока нет.</p>';
  $("#gridFood").innerHTML = food.length ? food.map(productCard).join("") : '<p class="empty">Выпечки пока нет.</p>';

  $("#gridBeans").innerHTML = beans.length
    ? beans.map((p) => `
        <div class="bean-row">
          <span>${escapeHTML(p.name)}</span>
          <strong>${formatPrice(p.price)}</strong>
          ${p.available
            ? `<button class="btn btn--accent" data-add="${escapeHTML(p.id)}">В корзину</button>`
            : `<button class="btn" disabled>Нет в наличии</button>`}
        </div>`).join("")
    : '<p>Зёрен пока нет в наличии.</p>';
}

/* ---------- 3. Корзина ---------- */

// Возвращает корзину, очищенную от удалённых и недоступных товаров
function getValidCart() {
  const products = getProducts();
  const cart = getCart();
  const valid = cart.filter((item) => {
    const p = products.find((x) => x.id === item.id);
    return p && p.available && Number.isInteger(item.qty) && item.qty > 0;
  });
  if (valid.length !== cart.length) saveCart(valid);
  return valid;
}

function addToCart(id) {
  const p = getProducts().find((x) => x.id === id);
  if (!p || !p.available) { showInfo("Товар недоступен", "<p>Этот товар сейчас нельзя добавить в корзину.</p>"); renderCatalog(); return; }
  const cart = getValidCart();
  const item = cart.find((i) => i.id === id);
  if (item) item.qty = Math.min(item.qty + 1, 99); else cart.push({ id, qty: 1 });
  saveCart(cart);
  renderCart();
}

function changeQty(id, delta) {
  let cart = getValidCart();
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter((i) => i.id !== id);
  if (item.qty > 0) item.qty = Math.min(item.qty, 99);
  saveCart(cart);
  renderCart();
}

function removeFromCart(id) {
  saveCart(getValidCart().filter((i) => i.id !== id));
  renderCart();
}

function cartTotal(cart) {
  const products = getProducts();
  return cart.reduce((sum, i) => {
    const p = products.find((x) => x.id === i.id);
    return sum + (p ? p.price * i.qty : 0);
  }, 0);
}

function renderCart() {
  const cart = getValidCart();
  const products = getProducts();
  const box = $("#cartItems");

  $("#cartCount").textContent = cart.reduce((n, i) => n + i.qty, 0);
  $("#cartTotal").textContent = formatPrice(cartTotal(cart));
  $("#checkoutBtn").disabled = cart.length === 0;

  if (!cart.length) {
    box.innerHTML = '<p class="cart-empty">Корзина пуста. Добавьте что-нибудь вкусное из меню!</p>';
    return;
  }
  box.innerHTML = cart.map((i) => {
    const p = products.find((x) => x.id === i.id);
    return `
      <div class="cart-item">
        <img src="${escapeHTML(safeImage(p.image) || IMG_FALLBACK)}" alt="" onerror="this.onerror=null;this.src=IMG_FALLBACK">
        <div>
          <div class="cart-item__name">${escapeHTML(p.name)}</div>
          <div class="cart-item__price">${formatPrice(p.price)} × ${i.qty} = <b>${formatPrice(p.price * i.qty)}</b></div>
          <div class="qty">
            <button data-minus="${escapeHTML(p.id)}" aria-label="Уменьшить">−</button>
            <span>${i.qty}</span>
            <button data-plus="${escapeHTML(p.id)}" aria-label="Увеличить">+</button>
          </div>
        </div>
        <button class="cart-item__remove" data-remove="${escapeHTML(p.id)}">Удалить</button>
      </div>`;
  }).join("");
}

/* ---------- 4. Окна (модальные, корзина) ---------- */
function openModal(el) {
  closeAll();
  $("#overlay").hidden = false;
  el.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeAll() {
  $$(".modal, .drawer").forEach((m) => (m.hidden = true));
  $("#overlay").hidden = true;
  document.body.style.overflow = "";
}
function showInfo(title, html) {
  $("#infoTitle").textContent = title;
  $("#infoText").innerHTML = html; // html формируем сами, пользовательские данные экранируем
  openModal($("#infoModal"));
}

/* ---------- 5. Оформление заказа ---------- */
const PHONE_RE = /^\+?[0-9\s\-()]{10,18}$/;

async function submitOrder(e) {
  e.preventDefault();
  const name = $("#coName").value.trim();
  const phone = $("#coPhone").value.trim();
  const comment = $("#coComment").value.trim();
  const err = $("#coError");
  const btn = $("#checkoutForm button[type=submit]");
  const cart = getValidCart();

  if (!cart.length) { err.textContent = "Корзина пуста."; return; }
  if (name.length < 2) { err.textContent = "Введите имя (минимум 2 символа)."; return; }
  if (!PHONE_RE.test(phone)) { err.textContent = "Введите корректный телефон."; return; }
  err.textContent = "";
  if (!navigator.onLine) { err.textContent = "Нет подключения к интернету."; return; }

  // «Снимок» состава: название и цена на момент заказа
  const products = getProducts();
  const items = cart.map((i) => {
    const p = products.find((x) => x.id === i.id);
    return { id: p.id, name: p.name, price: p.price, qty: i.qty };
  });

  btn.disabled = true; btn.textContent = "Отправляем…";
  try {
    // Заказ уходит на сервер; цены и наличие сервер проверяет по своему каталогу
    const res = await createOrder({ name, phone, comment, items });
    saveCart([]);
    renderCart();
    $("#checkoutForm").reset();
    showInfo("Заказ № " + res.number + " оформлен",
      `<p>Спасибо, ${escapeHTML(name)}! Заказ на сумму <b>${formatPrice(res.total)}</b> принят и сохранён на сервере.</p>
       <p class="note">Это учебный сайт: службы доставки нет, заказ не исполняется.</p>`);
  } catch (ex) {
    // Корзину не очищаем: заказ не сохранён
    err.textContent = ex.message;
    // 409: товар стал недоступен или цена изменилась — подтягиваем свежий каталог
    if (ex.status === 409 && (await syncSite(true))) { renderCatalog(); renderCart(); }
  } finally {
    btn.disabled = false; btn.textContent = "Подтвердить заказ";
  }
}

/* ---------- 6. Бронирование столика ---------- */
async function submitBooking(e) {
  e.preventDefault();
  const name = $("#bkName").value.trim();
  const phone = $("#bkPhone").value.trim();
  const date = $("#bkDate").value;
  const time = $("#bkTime").value;
  const guests = parseInt($("#bkGuests").value, 10);
  const err = $("#bkError");
  const btn = $("#bookingForm button[type=submit]");

  if (name.length < 2) { err.textContent = "Введите имя."; return; }
  if (!PHONE_RE.test(phone)) { err.textContent = "Введите корректный телефон."; return; }
  if (!date) { err.textContent = "Выберите дату."; return; }
  if (date < todayStr()) { err.textContent = "Дата не может быть в прошлом."; return; }
  if (!time) { err.textContent = "Выберите время."; return; }
  if (!(guests >= 1 && guests <= 20)) { err.textContent = "Гостей может быть от 1 до 20."; return; }
  err.textContent = "";

  btn.disabled = true; btn.textContent = "Отправляем…";
  try {
    await createBooking({ name, phone, date, time, guests }); // сохраняется в data/bookings.json
    $("#bookingForm").reset();
    $("#bkGuests").value = 2;
    showInfo("Заявка создана",
      `<p>${escapeHTML(name)}, мы записали вас на ${escapeHTML(date)} в ${escapeHTML(time)} (гостей: ${guests}).</p>
       <p class="note">Заявка сохранена на сервере. Это учебный сайт.</p>`);
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false; btn.textContent = "Отправить заявку";
  }
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

/* ---------- 7. Подписка ---------- */
function submitSubscribe(e) {
  e.preventDefault();
  const email = $("#subEmail").value.trim();
  const msg = $("#subMsg");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msg.style.color = "#e8836d"; msg.textContent = "Введите корректный e-mail."; return;
  }
  msg.style.color = "var(--sage)";
  msg.textContent = "Спасибо! (Демо: адрес нигде не сохраняется.)";
  $("#subscribeForm").reset();
}

/* ---------- 8. Подключение событий ---------- */
function init() {
  applySettings();
  renderCatalog();
  renderCart();

  // Дата бронирования — не раньше сегодняшнего дня
  $("#bkDate").min = todayStr();

  // Один обработчик кликов на весь документ («делегирование событий»)
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;

    if (t.dataset.add) return addToCart(t.dataset.add);
    if (t.dataset.plus) return changeQty(t.dataset.plus, 1);
    if (t.dataset.minus) return changeQty(t.dataset.minus, -1);
    if (t.dataset.remove) return removeFromCart(t.dataset.remove);
    if (t.hasAttribute("data-close")) return closeAll();
    if (t.dataset.modal) { e.preventDefault(); return openModal($("#" + t.dataset.modal)); }
  });

  $("#overlay").addEventListener("click", closeAll);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  $("#openCart").addEventListener("click", () => { renderCart(); openModal($("#cartDrawer")); });
  $("#openBooking").addEventListener("click", () => openModal($("#bookingModal")));
  $("#openBookingMobile").addEventListener("click", () => { $("#nav").classList.remove("open"); openModal($("#bookingModal")); });
  $("#checkoutBtn").addEventListener("click", () => openModal($("#checkoutModal")));
  $("#deliveryOrder").addEventListener("click", () => {
    if (getValidCart().length) openModal($("#checkoutModal"));
    else { document.getElementById("menu").scrollIntoView({ behavior: "smooth" }); showInfo("Корзина пуста", "<p>Сначала добавьте товары из меню.</p>"); }
  });
  $("#chooseBeans").addEventListener("click", (e) => { e.preventDefault(); $("#gridBeans").scrollIntoView({ behavior: "smooth", block: "center" }); });

  $("#checkoutForm").addEventListener("submit", submitOrder);
  $("#bookingForm").addEventListener("submit", submitBooking);
  $("#subscribeForm").addEventListener("submit", submitSubscribe);

  // Мобильное меню
  const burger = $("#burger"), nav = $("#nav");
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    burger.setAttribute("aria-expanded", open);
  });
  $$("#nav a").forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));

  // Если админ изменил данные в другой вкладке этого же браузера — обновляем сайт
  window.addEventListener("storage", () => { applySettings(); renderCatalog(); renderCart(); });

  // Изменения из админки на другом устройстве: проверяем версию каталога на сервере
  // каждые 15 секунд (запрос лёгкий) и при возврате на вкладку.
  const pollSite = async () => {
    if (document.hidden) return;
    if (await syncSite()) { applySettings(); renderCatalog(); renderCart(); }
  };
  pollSite();
  setInterval(pollSite, 15000);
  document.addEventListener("visibilitychange", pollSite);
  window.addEventListener("online", pollSite);
}

init();
