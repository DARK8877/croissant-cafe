/* ==========================================================
   login.js — вход администратора
   Логин и пароль проверяет СЕРВЕР (server.js), а не эта страница.
   В ответ сервер выдаёт токен; без него заказы прочитать нельзя.
   Пароль по умолчанию (для учебного запуска): admin / demo123.
   Для настоящего сайта задайте свой: ADMIN_PASSWORD=... node server.js
   ========================================================== */

// Если токен уже есть — сразу в панель (админка сама проверит, что он ещё действителен)
if (getToken()) window.location.replace("admin.html");

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const login = document.getElementById("login").value.trim();
  const password = document.getElementById("password").value;
  const err = document.getElementById("loginError");
  const btn = e.target.querySelector("button[type=submit]");

  if (!login || !password) { err.textContent = "Введите логин и пароль."; return; }
  err.textContent = "";
  btn.disabled = true;
  try {
    const res = await loginAdmin(login, password);
    setToken(res.token); // sessionStorage: исчезнет при закрытии вкладки
    window.location.href = "admin.html";
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
});
