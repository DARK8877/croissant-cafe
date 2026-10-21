/* ==========================================================
   account.js — личный кабинет
   Профиль и пароль меняются на сервере (нужен вход).
   История заказов хранится ТОЛЬКО в браузере этого устройства.
   ========================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const PHONE_RE = /^\+?[0-9\s\-()]{10,18}$/;

function toast(text, kind) {
  const t = $("#toast");
  t.textContent = text;
  t.className = "toast show" + (kind ? " toast--" + kind : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = "toast"; }, 4000);
}

function setMsg(sel, text, isError) {
  const el = $(sel);
  el.textContent = text || "";
  el.className = "msg" + (isError ? " msg--error" : "");
}

function show(which) {
  ["guestBox", "adminBox", "cabinet"].forEach((id) => { $("#" + id).hidden = id !== which; });
  $("#logout").hidden = which === "guestBox";
}

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function logout() {
  clearToken();
  window.location.href = "index.html";
}

function sessionExpired() {
  clearToken();
  $("#guestText").textContent = "Сессия истекла. Войдите снова: кнопка «Войти» в шапке сайта.";
  show("guestBox");
}

/* ---------- Профиль ---------- */
function fillProfile() {
  const s = getSession() || {};
  $("#pName").textContent = s.name || s.login || "—";
  $("#pLogin").textContent = s.login ? "@" + s.login : "";
  $("#pPhone").textContent = s.phone || "Телефон не указан";
  $("#avatar").textContent = (s.name || s.login || "?").trim().charAt(0).toUpperCase();
  $("#fLogin").value = s.login || "";
  $("#fName").value = s.name || "";
  $("#fPhone").value = s.phone || "";
  $("#fAddress").value = s.address || "";
}

async function submitProfile(e) {
  e.preventDefault();
  const name = $("#fName").value.trim(), phone = $("#fPhone").value.trim(), address = $("#fAddress").value.trim();
  if (name.length < 2) return setMsg("#profMsg", "Введите имя (минимум 2 символа).", true);
  if (!PHONE_RE.test(phone)) return setMsg("#profMsg", "Введите корректный телефон.", true);
  if (address && address.length < 5) return setMsg("#profMsg", "Адрес слишком короткий (улица, дом).", true);
  setMsg("#profMsg", "Сохраняем…");
  const btn = $("#profileForm button[type=submit]");
  btn.disabled = true;
  try {
    const r = await saveProfile({ name, phone, address });
    updateSession({ name: r.name, phone: r.phone, address: r.address });
    fillProfile();
    setMsg("#profMsg", "");
    toast("Профиль сохранён");
  } catch (ex) {
    if (ex.status === 401) return sessionExpired();
    setMsg("#profMsg", ex.message, true);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Пароль ---------- */
async function submitPassword(e) {
  e.preventDefault();
  const cur = $("#pCur").value, next = $("#pNew").value, next2 = $("#pNew2").value;
  if (!cur) return setMsg("#passMsg", "Введите текущий пароль.", true);
  if (next.length < 6) return setMsg("#passMsg", "Новый пароль: минимум 6 символов.", true);
  if (next !== next2) return setMsg("#passMsg", "Новые пароли не совпадают.", true);
  if (next === cur) return setMsg("#passMsg", "Новый пароль совпадает с текущим.", true);
  setMsg("#passMsg", "Меняем…");
  const btn = $("#passForm button[type=submit]");
  btn.disabled = true;
  try {
    await changePassword(cur, next);
    $("#passForm").reset();
    setMsg("#passMsg", "");
    toast("Пароль изменён");
  } catch (ex) {
    if (ex.status === 401) return sessionExpired();
    setMsg("#passMsg", ex.message, true);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- История заказов (только на этом устройстве) ---------- */
function myOrders() {
  const s = getSession();
  return getHistory().filter((h) => s && h.login === s.login);
}

function renderOrders() {
  const list = myOrders();
  $("#ordCount").textContent = list.length;
  $("#ordSum").textContent = formatPrice(list.reduce((sum, o) => sum + (Number(o.total) || 0), 0));
  $("#clearHistory").hidden = !list.length;
  $("#ordList").innerHTML = list.length
    ? list.map((o) => `
      <article class="order">
        <header><b>Заказ № ${escapeHTML(o.number)}</b><span class="muted">${fmtDate(o.createdAt)}</span></header>
        <ul>${(o.items || []).map((i) => `<li><span>${escapeHTML(i.name)} × ${Number(i.qty) || 0}</span><span>${formatPrice((Number(i.price) || 0) * (Number(i.qty) || 0))}</span></li>`).join("")}</ul>
        <p class="muted">Доставка: ${escapeHTML(o.city || "")}, ${escapeHTML(o.address || "")}</p>
        <footer><b>${formatPrice(o.total)}</b><button type="button" class="btn btn--ghost btn--sm" data-repeat="${escapeHTML(o.id)}">Повторить заказ</button></footer>
      </article>`).join("")
    : '<div class="empty-state"><p>Заказов на этом устройстве пока нет.</p><a class="btn btn--primary btn--sm" href="index.html#menu">Перейти в меню</a></div>';
}

function repeatOrder(id) {
  const o = myOrders().find((x) => String(x.id) === String(id));
  if (!o) return;
  const products = getProducts();
  const cart = getCart();
  let added = 0;
  (o.items || []).forEach((i) => {
    const p = products.find((x) => x.id === i.id);
    if (!p || !p.available) return; // товар удалили или его нет в наличии
    const qty = Math.min(99, Math.max(1, Number(i.qty) || 1));
    const ex = cart.find((c) => c.id === i.id);
    if (ex) ex.qty = Math.min(99, ex.qty + qty); else cart.push({ id: i.id, qty });
    added++;
  });
  if (!added) return toast("Эти товары сейчас недоступны.", "error");
  saveCart(cart);
  window.location.href = "index.html#cart";
}

/* ---------- Вкладки ---------- */
function showTab(name) {
  if (!["profile", "orders", "password"].includes(name)) name = "profile";
  $$(".tab").forEach((b) => { b.classList.toggle("active", b.dataset.tab === name); b.setAttribute("aria-selected", b.dataset.tab === name); });
  $$(".panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
  if (name === "orders") renderOrders();
  history.replaceState(null, "", "#" + name);
}

/* ---------- Старт ---------- */
function init() {
  $("#logout").addEventListener("click", logout);
  $("#logout2").addEventListener("click", logout);

  const s = getSession();
  if (!s) return show("guestBox");
  if (s.role === "admin") return show("adminBox");

  show("cabinet");
  fillProfile();
  showTab(location.hash.slice(1));

  $$(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("#profileForm").addEventListener("submit", submitProfile);
  $("#passForm").addEventListener("submit", submitPassword);
  $("#ordList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-repeat]");
    if (b) repeatOrder(b.dataset.repeat);
  });
  $("#clearHistory").addEventListener("click", () => {
    if (!confirm("Очистить историю заказов на этом устройстве? Сами заказы у кофейни сохранятся.")) return;
    clearHistory(getSession().login);
    renderOrders();
    toast("История очищена");
  });

  // Свежие данные с сервера (могли измениться на другом устройстве)
  fetchMe().then((me) => {
    if (me && me.role === "user") {
      const editing = document.activeElement && document.activeElement.closest("#profileForm");
      updateSession({ name: me.name, phone: me.phone, address: me.address });
      if (!editing) fillProfile(); else { $("#pName").textContent = me.name; $("#pPhone").textContent = me.phone || "Телефон не указан"; }
    }
  }).catch((ex) => { if (ex.status === 401) sessionExpired(); });
}

init();
