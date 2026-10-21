/* ==========================================================
   login.js — запасная страница входа (на сайте она нигде не показана).
   Обычный вход и регистрация — в окне «Войти» на главной странице.
   Здесь можно войти по прямой ссылке /login.html (логин ADMIN).
   Логин и пароль проверяет СЕРВЕР, пароль в коде не хранится.
   ========================================================== */

// Если администратор уже вошёл — сразу в панель
if (isAdminSession()) window.location.replace("admin.html");

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
    const res = await loginUser(login, password);
    setSession(res);
    window.location.href = res.role === "admin" ? "admin.html" : "index.html";
  } catch (ex) {
    err.textContent = ex.message;
  } finally {
    btn.disabled = false;
  }
});
