/* ==========================================================
   Code.gs — серверная часть для Google Apps Script
   Хранит в Google Таблице: заказы (Orders), брони (Bookings),
   каталог и настройки сайта (Site).
   Свойства скрипта: ADMIN_PASSWORD (обязательно), ADMIN_LOGIN (по умолчанию admin).
   ========================================================== */

var ORDER_HEAD = ['id', 'number', 'createdAt', 'name', 'phone', 'comment', 'items', 'total', 'status'];
var BOOKING_HEAD = ['id', 'createdAt', 'name', 'phone', 'date', 'time', 'guests', 'status'];
var ORDER_STATUSES = ['Новый', 'Готовится', 'Готов', 'Выполнен', 'Отменён'];
var BOOKING_STATUSES = ['Новое', 'Подтверждено', 'Завершено', 'Отменено'];
var CATEGORIES = ['coffee', 'drinks', 'croissants', 'desserts', 'pastry', 'beans'];
var SETTING_KEYS = ['name', 'tagline', 'heroTitle', 'heroText', 'address', 'phone', 'hours', 'about', 'instagram', 'telegram', 'whatsapp'];
var PHONE_RE = /^\+?[0-9\s\-()]{10,18}$/;
var TOKEN_TTL = 21600; // 6 часов (максимум для CacheService)

/* ---------- Вход в API ---------- */

// Публичное чтение: версия данных и сам каталог (GET — без предварительного запроса браузера)
function doGet(e) {
  var a = (e && e.parameter && e.parameter.action) || '';
  try {
    if (a === 'siteVersion') return json_({ version: getVersion_() });
    if (a === 'site') return json_(readSite_());
    return json_({ ok: true });
  } catch (err) {
    return json_({ error: String(err.message || err), status: 500 });
  }
}

function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      // --- доступно всем ---
      case 'createOrder': return json_(createOrder_(req));
      case 'createBooking': return json_(createBooking_(req));
      case 'login': return json_(login_(req));
      case 'getSite': return json_(readSite_());
      // --- только администратору ---
      default:
        requireAuth_(req.token);
        switch (req.action) {
          case 'listAll': return json_({ orders: readRows_('Orders', ORDER_HEAD), bookings: readRows_('Bookings', BOOKING_HEAD) });
          case 'listOrders': return json_({ data: readRows_('Orders', ORDER_HEAD) });
          case 'listBookings': return json_({ data: readRows_('Bookings', BOOKING_HEAD) });
          case 'setOrderStatus': return json_(setStatus_('Orders', ORDER_HEAD, req.id, req.status, ORDER_STATUSES));
          case 'setBookingStatus': return json_(setStatus_('Bookings', BOOKING_HEAD, req.id, req.status, BOOKING_STATUSES));
          case 'saveSite': return json_(saveSite_(req));
          default: throw httpError_(400, 'Неизвестное действие');
        }
    }
  } catch (err) {
    return json_({ error: String(err.message || err), status: err.status || 500 });
  }
}

/* ---------- Помощники ---------- */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function httpError_(status, msg) {
  var e = new Error(msg); e.status = status; return e;
}
function props_() { return PropertiesService.getScriptProperties(); }

// Лист создаётся сам; все ячейки — текстовые, чтобы Google не превращал даты и телефоны
function sheet_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (head) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    sh.getRange(1, 1, sh.getMaxRows(), Math.max(head ? head.length : 2, 2)).setNumberFormat('@');
  }
  return sh;
}

function readRows_(name, head) {
  var sh = sheet_(name, head);
  var values = sh.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    var o = {};
    for (var j = 0; j < head.length; j++) o[head[j]] = values[i][j];
    if ('number' in o) o.number = Number(o.number);
    if ('total' in o) o.total = Number(o.total);
    if ('guests' in o) o.guests = Number(o.guests);
    if ('items' in o) { try { o.items = JSON.parse(o.items); } catch (e) { o.items = []; } }
    rows.push(o);
  }
  return rows;
}

function setStatus_(name, head, id, status, allowed) {
  if (allowed.indexOf(status) < 0) throw httpError_(400, 'Недопустимый статус');
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = sheet_(name, head);
    var ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (var i = 1; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sh.getRange(i + 1, head.indexOf('status') + 1).setValue(status);
        return { ok: true };
      }
    }
    throw httpError_(404, 'Запись не найдена');
  } finally { lock.releaseLock(); }
}

function str_(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }

/* ---------- Авторизация ---------- */

function login_(req) {
  var login = props_().getProperty('ADMIN_LOGIN') || 'admin';
  var pass = props_().getProperty('ADMIN_PASSWORD');
  if (!pass) throw httpError_(500, 'На сервере не задан ADMIN_PASSWORD (Свойства скрипта).');
  if (String(req.login) !== login || String(req.password) !== pass) {
    Utilities.sleep(800); // замедляем подбор пароля
    throw httpError_(401, 'Неверный логин или пароль.');
  }
  var token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('t_' + token, '1', TOKEN_TTL);
  return { token: token };
}

function requireAuth_(token) {
  if (!token || !CacheService.getScriptCache().get('t_' + token)) {
    throw httpError_(401, 'Сессия истекла. Войдите снова.');
  }
}

/* ---------- Общий каталог и настройки сайта ---------- */

function getVersion_() { return Number(props_().getProperty('SITE_VERSION') || 0); }

// JSON каталога режется на куски по 40 000 символов (лимит ячейки — 50 000)
function readSite_() {
  var sh = sheet_('Site', null);
  var last = sh.getLastRow();
  if (last < 1) return { version: getVersion_(), products: null, settings: null };
  var parts = sh.getRange(1, 1, last, 1).getValues().map(function (r) { return r[0]; });
  try {
    var d = JSON.parse(parts.join(''));
    return { version: getVersion_(), products: d.products, settings: d.settings };
  } catch (e) {
    return { version: getVersion_(), products: null, settings: null };
  }
}

function cleanProducts_(list) {
  if (!Array.isArray(list) || list.length > 300) throw httpError_(400, 'Некорректный каталог.');
  var seen = {};
  return list.map(function (p) {
    var id = str_(p.id, 40);
    if (!id || seen[id]) throw httpError_(400, 'Некорректный или повторяющийся id товара.');
    seen[id] = true;
    var price = Math.round(Number(p.price));
    if (!isFinite(price) || price < 0 || price > 10000000) throw httpError_(400, 'Некорректная цена: ' + str_(p.name, 30));
    var image = String(p.image || '');
    if (image && !/^(https?:\/\/|data:image\/)/i.test(image)) image = '';
    if (image.length > 200000) throw httpError_(400, 'Слишком большое изображение: ' + str_(p.name, 30));
    return {
      id: id, name: str_(p.name, 60), description: str_(p.description, 300),
      category: CATEGORIES.indexOf(p.category) >= 0 ? p.category : 'coffee',
      price: price, available: !!p.available, image: image
    };
  });
}

function cleanSettings_(s) {
  if (!s || typeof s !== 'object') throw httpError_(400, 'Некорректные настройки.');
  var out = {};
  SETTING_KEYS.forEach(function (k) {
    var v = str_(s[k], k === 'about' ? 1500 : 300);
    if ((k === 'instagram' || k === 'telegram' || k === 'whatsapp') && v && !/^https?:\/\//i.test(v)) v = '';
    out[k] = v;
  });
  if (!out.name || !out.heroTitle) throw httpError_(400, 'Название и заголовок не могут быть пустыми.');
  return out;
}

function saveSite_(req) {
  var data = { products: cleanProducts_(req.products), settings: cleanSettings_(req.settings) };
  var text = JSON.stringify(data);
  if (text.length > 4000000) throw httpError_(400, 'Каталог слишком большой (уменьшите изображения).');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet_('Site', null);
    sh.clearContents();
    var rows = [];
    for (var i = 0; i < text.length; i += 40000) rows.push([text.slice(i, i + 40000)]);
    if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
    sh.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
    var v = Date.now();
    props_().setProperty('SITE_VERSION', String(v));
    return { ok: true, version: v };
  } finally { lock.releaseLock(); }
}

/* ---------- Заказы и бронирования ---------- */

function createOrder_(req) {
  var name = str_(req.name, 60), phone = str_(req.phone, 30), comment = str_(req.comment, 300);
  if (name.length < 2) throw httpError_(400, 'Введите имя (минимум 2 символа).');
  if (!PHONE_RE.test(phone)) throw httpError_(400, 'Введите корректный телефон.');
  if (!Array.isArray(req.items) || !req.items.length || req.items.length > 50) throw httpError_(400, 'Корзина пуста.');

  // Цены и названия берём из каталога на сервере, а не от браузера
  var site = readSite_();
  var catalog = {};
  if (site.products) site.products.forEach(function (p) { catalog[p.id] = p; });
  var hasCatalog = !!site.products;

  var items = [], total = 0;
  req.items.forEach(function (it) {
    var qty = Number(it.qty);
    if (!(qty >= 1 && qty <= 99) || Math.floor(qty) !== qty) throw httpError_(400, 'Некорректное количество.');
    var name_, price;
    if (hasCatalog) {
      var p = catalog[String(it.id)];
      if (!p || !p.available) throw httpError_(409, 'Товар «' + str_(it.name, 40) + '» сейчас недоступен. Обновите страницу.');
      name_ = p.name; price = p.price;
    } else {
      name_ = str_(it.name, 60); price = Math.round(Number(it.price));
      if (!name_ || !isFinite(price) || price < 0 || price > 10000000) throw httpError_(400, 'Некорректный товар.');
    }
    items.push({ id: str_(it.id, 40), name: name_, price: price, qty: qty });
    total += price * qty;
  });

  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet_('Orders', ORDER_HEAD);
    var last = sh.getLastRow(), max = 0;
    if (last > 1) {
      sh.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) { max = Math.max(max, Number(r[0]) || 0); });
    }
    var number = max + 1;
    var id = Utilities.getUuid();
    sh.appendRow([id, number, new Date().toISOString(), name, phone, comment, JSON.stringify(items), total, 'Новый']);
    return { id: id, number: number, total: total };
  } finally { lock.releaseLock(); }
}

function createBooking_(req) {
  var name = str_(req.name, 60), phone = str_(req.phone, 30);
  var date = str_(req.date, 10), time = str_(req.time, 5), guests = Number(req.guests);
  if (name.length < 2) throw httpError_(400, 'Введите имя.');
  if (!PHONE_RE.test(phone)) throw httpError_(400, 'Введите корректный телефон.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw httpError_(400, 'Некорректная дата.');
  if (!/^\d{2}:\d{2}$/.test(time)) throw httpError_(400, 'Некорректное время.');
  if (!(guests >= 1 && guests <= 20) || Math.floor(guests) !== guests) throw httpError_(400, 'Гостей может быть от 1 до 20.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var id = Utilities.getUuid();
    sheet_('Bookings', BOOKING_HEAD).appendRow([id, new Date().toISOString(), name, phone, date, time, guests, 'Новое']);
    return { id: id };
  } finally { lock.releaseLock(); }
}
