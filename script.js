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

/* ---------- 2а. Команда ---------- */
function renderTeam() {
  const list = getSettings().showTeam === "0" ? [] : getStaff();
  $("#team").hidden = !list.length;
  $("#navTeam").hidden = !list.length;
  $("#teamGrid").innerHTML = list.map((s) => {
    const img = safeImage(s.photo);
    const photo = img
      ? `<img class="member__photo" src="${escapeHTML(img)}" alt="${escapeHTML(s.name)}" loading="lazy" onerror="this.onerror=null;this.src=IMG_FALLBACK">`
      : `<div class="member__photo member__photo--empty" aria-hidden="true">${escapeHTML((s.name || "?").trim().charAt(0).toUpperCase())}</div>`;
    return `
      <article class="member">
        ${photo}
        <div class="member__body">
          <h3>${escapeHTML(s.name)}</h3>
          <p class="member__pos">${escapeHTML(s.position)}</p>
          ${s.about ? `<p class="member__about">${escapeHTML(s.about)}</p>` : ""}
        </div>
      </article>`;
  }).join("");
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
const DELIVERY_CITY = "Тараз";

// Открывает оформление заказа; если клиент вошёл — подставляет его имя и телефон
function openCheckout() {
  const s = getSession();
  if (s && s.role === "user") {
    if (!$("#coName").value && s.name) $("#coName").value = s.name;
    if (!$("#coPhone").value && s.phone) $("#coPhone").value = s.phone;
    if (!$("#coAddress").value && s.address) $("#coAddress").value = s.address;
  }
  openModal($("#checkoutModal"));
}

// Проверка карты (алгоритм Луна) и срока действия
function luhnOk(d) {
  if (!/^\d{13,19}$/.test(d)) return false;
  let s = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; }
  return s % 10 === 0;
}
function expOk(v) {
  const m = /^(\d{2})\/(\d{2})$/.exec(v.trim());
  if (!m) return false;
  const mo = +m[1], yr = 2000 + +m[2], now = new Date();
  return mo >= 1 && mo <= 12 && (yr > now.getFullYear() || (yr === now.getFullYear() && mo >= now.getMonth() + 1));
}

async function submitOrder(e) {
  e.preventDefault();
  const name = $("#coName").value.trim();
  const phone = $("#coPhone").value.trim();
  const comment = $("#coComment").value.trim();
  const address = $("#coAddress").value.trim();
  const err = $("#coError");
  const btn = $("#checkoutForm button[type=submit]");
  const cart = getValidCart();

  if (!cart.length) { err.textContent = "Корзина пуста."; return; }
  if (name.length < 2) { err.textContent = "Введите имя (минимум 2 символа)."; return; }
  if (!PHONE_RE.test(phone)) { err.textContent = "Введите корректный телефон."; return; }
  if (address.length < 5) { err.textContent = "Укажите адрес доставки в Таразе (улица, дом)."; return; }
  const byCard = $("#coPayCard").checked;
  let last4 = "";
  if (byCard) {
    const digits = $("#cardNum").value.replace(/\D/g, "");
    if (!luhnOk(digits)) { err.textContent = "Проверьте номер карты."; return; }
    if (!expOk($("#cardExp").value)) { err.textContent = "Проверьте срок действия карты."; return; }
    if (!/^\d{3,4}$/.test($("#cardCvc").value)) { err.textContent = "Введите CVC (3 цифры на обороте карты)."; return; }
    if ($("#cardHolder").value.trim().length < 3) { err.textContent = "Введите имя, как на карте."; return; }
    last4 = digits.slice(-4);
  }
  err.textContent = "";
  if (!navigator.onLine) { err.textContent = "Нет подключения к интернету."; return; }

  // «Снимок» состава: название и цена на момент заказа
  const products = getProducts();
  const items = cart.map((i) => {
    const p = products.find((x) => x.id === i.id);
    return { id: p.id, name: p.name, price: p.price, qty: i.qty };
  });

  btn.disabled = true; btn.textContent = byCard ? "Обрабатываем платёж…" : "Отправляем…";
  try {
    if (byCard) await new Promise((r) => setTimeout(r, 1400));
    // Номер карты никуда не отправляется и не сохраняется — в заказ попадает только отметка об оплате
    const payNote = byCard ? "Оплата: картой •••• " + last4 : "Оплата: наличными курьеру";
    const fullComment = (payNote + (comment ? "\n" + comment : "")).slice(0, 300);
    // Заказ уходит на сервер; цены и наличие сервер проверяет по своему каталогу
    const res = await createOrder({ name, phone, comment: fullComment, items, city: DELIVERY_CITY, address });
    // История заказов — только на этом устройстве (в личном кабинете)
    const sess = getSession();
    addHistory({ id: res.id, number: res.number, createdAt: new Date().toISOString(), items, total: res.total, city: DELIVERY_CITY, address, login: sess && sess.role === "user" ? sess.login : "" });
    saveCart([]);
    renderCart();
    $("#checkoutForm").reset();
    $("#cardBox").hidden = false;
    showInfo("Заказ № " + res.number + " оформлен",
      `<p>Спасибо, ${escapeHTML(name)}! Заказ на сумму <b>${formatPrice(res.total)}</b> принят.</p>
       <p>Адрес доставки: ${escapeHTML(DELIVERY_CITY)}, ${escapeHTML(address)}.</p>`);
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
      `<p>${escapeHTML(name)}, мы записали вас на ${escapeHTML(date)} в ${escapeHTML(time)} (гостей: ${guests}).</p>`);
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
  msg.textContent = "Спасибо!";
  $("#subscribeForm").reset();
}

/* ---------- 8. Аккаунт: вход, регистрация, выход ---------- */
function refreshAccount() {
  const s = getSession();
  const btn = $("#accountBtn");
  btn.textContent = s ? (s.role === "admin" ? "ADMIN" : (s.name || s.login)) : "Войти";
  btn.classList.toggle("acc--in", !!s);
}

function openAccount() {
  const s = getSession();
  if (!s) {
    $("#alError").textContent = ""; $("#arError").textContent = "";
    return openModal($("#authModal"));
  }
  $("#accInfo").textContent = s.role === "admin"
    ? "Вы вошли как администратор."
    : "Вы вошли как " + (s.name || s.login) + " (" + s.login + ").";
  // Кнопки: «Личный кабинет» — обычному пользователю, «Открыть админку» — ТОЛЬКО администратору
  $("#cabinetLink").hidden = s.role !== "user";
  $("#adminLink").hidden = s.role !== "admin";
  openModal($("#accountModal"));
}

function setAuthTab(tab) {
  $$("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b.dataset.authTab === tab));
  $("#authLoginForm").hidden = tab !== "login";
  $("#authRegForm").hidden = tab !== "register";
}

async function submitAuthLogin(e) {
  e.preventDefault();
  const login = $("#alLogin").value.trim(), password = $("#alPass").value;
  const err = $("#alError"), btn = $("#authLoginForm button[type=submit]");
  if (!login || !password) { err.textContent = "Введите логин и пароль."; return; }
  err.textContent = ""; btn.disabled = true; btn.textContent = "Входим…";
  try {
    setSession(await loginUser(login, password));
    $("#authLoginForm").reset();
    refreshAccount();
    openAccount();
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false; btn.textContent = "Войти";
  }
}

async function submitAuthRegister(e) {
  e.preventDefault();
  const d = { login: $("#arLogin").value.trim(), password: $("#arPass").value, name: $("#arName").value.trim(), phone: $("#arPhone").value.trim() };
  const err = $("#arError"), btn = $("#authRegForm button[type=submit]");
  if (!/^[A-Za-z0-9_.\-]{3,30}$/.test(d.login)) { err.textContent = "Логин: 3–30 символов, латиница, цифры, точка, дефис или «_»."; return; }
  if (d.password.length < 6) { err.textContent = "Пароль: минимум 6 символов."; return; }
  if (d.name.length < 2) { err.textContent = "Введите имя."; return; }
  if (!PHONE_RE.test(d.phone)) { err.textContent = "Введите корректный телефон."; return; }
  err.textContent = ""; btn.disabled = true; btn.textContent = "Регистрируем…";
  try {
    setSession(await registerUser(d));
    $("#authRegForm").reset();
    refreshAccount();
    showInfo("Добро пожаловать!", "<p>Аккаунт создан, вы вошли. Имя и телефон теперь подставятся в заказ сами.</p>");
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false; btn.textContent = "Зарегистрироваться";
  }
}

function logout() {
  clearToken();
  refreshAccount();
  closeAll();
}

/* ---------- 9. Подключение событий ---------- */
function init() {
  applySettings();
  renderCatalog();
  renderTeam();
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
  $("#checkoutBtn").addEventListener("click", () => openCheckout());
  $("#deliveryOrder").addEventListener("click", () => {
    if (getValidCart().length) openCheckout();
    else { document.getElementById("menu").scrollIntoView({ behavior: "smooth" }); showInfo("Корзина пуста", "<p>Сначала добавьте товары из меню.</p>"); }
  });
  $("#chooseBeans").addEventListener("click", (e) => { e.preventDefault(); $("#gridBeans").scrollIntoView({ behavior: "smooth", block: "center" }); });

  // Аккаунт
  refreshAccount();
  $("#accountBtn").addEventListener("click", openAccount);
  $("#authLoginForm").addEventListener("submit", submitAuthLogin);
  $("#authRegForm").addEventListener("submit", submitAuthRegister);
  $("#logoutBtn").addEventListener("click", logout);
  $$("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => setAuthTab(b.dataset.authTab)));
  // Если токен истёк (прошло больше 6 часов) — выходим из аккаунта на этом устройстве
  if (getSession()) {
    fetchMe().then((me) => {
      // Имя/телефон/адрес могли измениться на другом устройстве
      if (me && me.role === "user") { updateSession({ name: me.name, phone: me.phone, address: me.address }); refreshAccount(); }
    }).catch((ex) => { if (ex.status === 401) { clearToken(); refreshAccount(); } });
  }

  // Поля оплаты: форматирование и переключение «карта / наличные»
  $("#cardNum").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(.{4})/g, "$1 ").trim(); });
  $("#cardExp").addEventListener("input", (e) => { let d = e.target.value.replace(/\D/g, "").slice(0, 4); e.target.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d; });
  $("#cardCvc").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
  $$("input[name=coPay]").forEach((r) => r.addEventListener("change", () => { $("#cardBox").hidden = !$("#coPayCard").checked; }));
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
  window.addEventListener("storage", () => { applySettings(); renderCatalog(); renderTeam(); renderCart(); });

  // Изменения из админки на другом устройстве: проверяем версию каталога на сервере
  // каждые 15 секунд (запрос лёгкий) и при возврате на вкладку.
  const pollSite = async () => {
    if (document.hidden) return;
    if (await syncSite()) { applySettings(); renderCatalog(); renderTeam(); renderCart(); }
  };
  pollSite();
  setInterval(pollSite, 15000);
  document.addEventListener("visibilitychange", pollSite);
  window.addEventListener("online", pollSite);

  // Ссылка из личного кабинета «Повторить заказ» открывает корзину
  if (location.hash === "#cart") { renderCart(); openModal($("#cartDrawer")); history.replaceState(null, "", location.pathname + location.search); }
}

init();
