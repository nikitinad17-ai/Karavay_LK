"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const assert = require("assert/strict");
const { JSDOM, VirtualConsole } = require("jsdom");

const workspace = path.resolve(__dirname, "..");
const htmlPath = path.join(workspace, "artifacts", "Karavay-LK-v3.6.4-Demo-Showcase.html");
const basePath = path.join(workspace, "base", "Karavay-LK-v3.6.3-Rights-List-Fields-Fix.html");
const html = fs.readFileSync(htmlPath, "utf8");

const payerRecords = {
  payerdemo00001: {
    id: "payerdemo00001",
    id_pay: 991100,
    kod_pay: "DEMO-P100",
    name_pay: "ООО «Северная торговая сеть»",
    phone: "+7 (000) 000-01-00",
    contact_email: "finance.p100@example.invalid",
    active: true,
  },
  payerdemo00002: {
    id: "payerdemo00002",
    id_pay: 991200,
    kod_pay: "DEMO-P200",
    name_pay: "ООО «Городские кафе»",
    phone: "+7 (000) 000-02-00",
    contact_email: "finance.p200@example.invalid",
    active: true,
  },
};

const clientRecords = {
  payerdemo00001: [
    { id: "clientdemo00101", id_clt: 991101, payer: "payerdemo00001", kod_clt: "DEMO-C101", name_clt: "Магазин «Северный» · Невский", active: true },
    { id: "clientdemo00102", id_clt: 991102, payer: "payerdemo00001", kod_clt: "DEMO-C102", name_clt: "Магазин «Северный» · Парнас", active: true },
  ],
  payerdemo00002: [
    { id: "clientdemo00201", id_clt: 991201, payer: "payerdemo00002", kod_clt: "DEMO-C201", name_clt: "Кафе «Маяк» · Московский", active: true },
    { id: "clientdemo00202", id_clt: 991202, payer: "payerdemo00002", kod_clt: "DEMO-C202", name_clt: "Кафе «Маяк» · Купчино", active: true },
  ],
};

const users = {
  "tanushkova@gmail.com": {
    id: "userdemo000001",
    login: "tanushkova",
    email: "tanushkova@gmail.com",
    name: "Татьяна Ушкова",
    role: "roledemomanager1",
    active: true,
    must_change_password: false,
  },
  "mashuliaz@gmail.com": {
    id: "userdemo000002",
    login: "mashuliaz",
    email: "mashuliaz@gmail.com",
    name: "Мария Ульянова",
    role: "roledemoviewer01",
    active: true,
    must_change_password: false,
  },
};

const roles = {
  roledemomanager1: { id: "roledemomanager1", code_role: "manager", name_role: "Менеджер", active: true },
  roledemoviewer01: { id: "roledemoviewer01", code_role: "viewer", name_role: "Просмотр", active: true },
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function list(items) {
  return { page: 1, perPage: 200, totalItems: items.length, totalPages: 1, items };
}

function json(value, status = 200) {
  return new global.Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function mockPocketBase(requests) {
  return async function fetchMock(input, init = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, "http://demo.test");
    const method = String(init.method || (input && input.method) || "GET").toUpperCase();
    requests.push({ method, url: url.href });

    if (url.pathname === "/api/health") return json({ message: "API is healthy.", code: 200, data: {} });

    if (url.pathname === "/api/collections/users/auth-with-password" && method === "POST") {
      const body = JSON.parse(init.body || "{}");
      const record = users[String(body.identity || "").toLowerCase()];
      return record ? json({ token: `test-token-${record.id}`, record }) : json({ message: "Failed to authenticate." }, 400);
    }

    if (url.pathname === "/api/collections/users/auth-refresh" && method === "POST") {
      const token = new global.Headers(init.headers || {}).get("authorization") || "";
      const record = Object.values(users).find((user) => token.endsWith(user.id));
      return record ? json({ token, record }) : json({ message: "Invalid token" }, 401);
    }

    const roleMatch = url.pathname.match(/^\/api\/collections\/roles\/records\/([A-Za-z0-9]+)$/);
    if (roleMatch) return roles[roleMatch[1]] ? json(roles[roleMatch[1]]) : json({ message: "Not found" }, 404);

    if (url.pathname === "/api/collections/rights/records") {
      const filter = url.searchParams.get("filter") || "";
      if (filter.includes("userdemo000001")) {
        return json(list([
          { id: "rightdemo000001", user: "userdemo000001", payer: "payerdemo00001", client: "", active: true, expand: { payer: payerRecords.payerdemo00001 } },
          { id: "rightdemo000002", user: "userdemo000001", payer: "payerdemo00002", client: "", active: true, expand: { payer: payerRecords.payerdemo00002 } },
        ]));
      }
      if (filter.includes("userdemo000002")) {
        return json(list([
          { id: "rightdemo000003", user: "userdemo000002", payer: "payerdemo00002", client: "clientdemo00201", active: true, expand: { payer: payerRecords.payerdemo00002, client: clientRecords.payerdemo00002[0] } },
        ]));
      }
      return json(list([]));
    }

    if (url.pathname === "/api/collections/clients/records") {
      const filter = url.searchParams.get("filter") || "";
      const payerId = Object.keys(clientRecords).find((id) => filter.includes(id));
      return json(list(payerId ? clientRecords[payerId] : []));
    }

    throw new Error(`Unexpected external fetch: ${method} ${url.href}`);
  };
}

function setInput(window, input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function setSelect(window, select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, value);
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function compactText(element) {
  return element.textContent.replace(/\s+/g, " ").trim();
}

async function waitFor(check, label, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timeout: ${label}`);
}

async function createApp() {
  const requests = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(`jsdomError: ${error.message}`));
  virtualConsole.on("error", (...args) => errors.push(`console.error: ${args.join(" ")}`));

  const dom = new JSDOM(html, {
    url: "http://demo.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.Response = global.Response;
      window.Request = global.Request;
      window.Headers = global.Headers;
      window.AbortController = global.AbortController;
      window.fetch = mockPocketBase(requests);
      window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });

  const root = dom.window.document.getElementById("root");
  await waitFor(() => root.querySelector('input[type="email"]'), "login screen");
  return { dom, window: dom.window, document: dom.window.document, root, requests, errors };
}

async function login(app, email) {
  const emailInput = app.root.querySelector('input[type="email"]');
  const passwordInput = app.root.querySelector('input[type="password"]');
  assert(emailInput && passwordInput, "Login inputs are missing");
  setInput(app.window, emailInput, email);
  setInput(app.window, passwordInput, "DemoPassword1!");
  const loginButton = [...app.root.querySelectorAll("button")].find((button) => compactText(button) === "Войти");
  assert(loginButton, "Login button is missing");
  loginButton.click();
  await waitFor(
    () => app.root.textContent.includes("Выберите юридическое лицо") || app.root.textContent.includes("Демонстрационный режим."),
    `login ${email}`
  );
}

async function selectPayer(app, payerName) {
  const button = [...app.root.querySelectorAll(".buyer-select-option")].find((item) => item.textContent.includes(payerName));
  assert(button, `Payer option not found: ${payerName}`);
  button.click();
  await waitFor(() => app.root.textContent.includes("Демонстрационный режим."), `dashboard ${payerName}`);
}

async function navigate(app, route, title) {
  const link = app.root.querySelector(`a[data-route="${route}"]`);
  assert(link, `Navigation route is missing: ${route}`);
  link.click();
  await waitFor(() => {
    const heading = app.root.querySelector(".topbar__title");
    return heading && compactText(heading) === title;
  }, `route ${route}`);
}

async function api(app, url, init) {
  const response = await app.window.fetch(url, init);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function assertNoBusinessRequestEscaped(app) {
  const escaped = app.requests.filter((request) => {
    const pathname = new URL(request.url).pathname;
    return pathname.startsWith("/api/v1/");
  });
  assert.deepEqual(escaped, [], `Business requests escaped demo adapter: ${JSON.stringify(escaped)}`);
}

function assertNoConsoleErrors(app) {
  assert.deepEqual(app.errors, [], app.errors.join("\n"));
}

function staticChecks() {
  const base = fs.readFileSync(basePath, "utf8");
  assert.equal(sha256(base), "1c2f5683864f6d1c2def517ddffa47879b186f6e818ebb8da2a5dae0169e2311");
  assert.equal((html.match(/data-karavay-demo-showcase/g) || []).length, 1);
  assert.equal((html.match(/data-karavay-app/g) || []).length, 1);
  assert(html.includes("3.6.4 Demo Showcase"));
  assert(html.includes("Демонстрационный режим."));
  assert(html.includes("Режим просмотра."));
  assert(html.length > base.length);
  return { baseSha256: sha256(base), outputSha256: sha256(html), outputBytes: Buffer.byteLength(html) };
}

async function managerScenario() {
  const app = await createApp();
  const testApi = app.window.__KARAVAY_DEMO_SHOWCASE_TEST__;
  assert(testApi, "Demo test API is missing");
  assert.equal(testApi.version, "3.6.4");
  assert.equal(testApi.productCount, 111);
  assert.equal(testApi.orderCount, 24);
  assert(testApi.matrixCount(991101, 1) > 50);
  assert(testApi.matrixCount(991101, 0) > 10);

  await login(app, "tanushkova@gmail.com");
  const selectionText = compactText(app.root);
  assert(selectionText.includes("ООО «Северная торговая сеть»"));
  assert(selectionText.includes("ООО «Городские кафе»"));
  assert.equal(app.root.querySelectorAll(".buyer-select-option").length, 2);

  await selectPayer(app, "Северная торговая сеть");
  await waitFor(() => testApi.context() && testApi.context().payerId === 991100, "manager demo context");
  await waitFor(() => compactText(app.root).includes("Активных заказов6"), "manager business data");
  assert.deepEqual(Array.from(testApi.context().clientIds), [991101, 991102]);
  assert.equal(testApi.context().role, "manager");
  let text = compactText(app.root);
  assert(text.includes("2 получателя"));
  assert(text.includes("Анна Смирнова"));
  assert(text.includes("Активных заказов6"));

  let result = await api(app, "/api/v1/payers/991100/orders");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.Orders.length, 12);
  result = await api(app, "/api/v1/payers/991200/orders");
  assert.equal(result.response.status, 403);

  await navigate(app, "outlets", "Получатели");
  text = compactText(app.root);
  assert(text.includes("Магазин «Северный» · Невский"));
  assert(text.includes("Магазин «Северный» · Парнас"));
  assert(!text.includes("Кафе «Маяк»"));

  await navigate(app, "documents", "Документы");
  text = compactText(app.root);
  assert(text.includes("Договор поставки (демонстрационный документ)"));
  assert(text.includes("Счёт-фактура по последней поставке"));
  assert(text.includes("Реестр деклараций соответствия"));
  assert(text.includes("Индивидуальный прайс-лист"));

  await navigate(app, "profile", "Профиль плательщика");
  text = compactText(app.root);
  assert(text.includes("ДЕМО-100/26"));
  assert(text.includes("7800000100"));
  assert(text.includes("Анна Смирнова"));

  await navigate(app, "orders", "История заказов");
  await waitFor(() => app.root.querySelectorAll(".orders-history__table tbody tr").length === 12, "manager order history");
  assert.equal(app.root.querySelectorAll(".orders-history__table tbody tr").length, 12);

  await navigate(app, "order", "Оформить заказ");
  const showPrice = await waitFor(
    () => [...app.root.querySelectorAll("button")].find((button) => compactText(button).startsWith("Показать прайс-лист")),
    "show price list"
  );
  showPrice.click();
  await waitFor(() => app.root.querySelectorAll(".product-list .product").length > 0, "HBI catalog");
  assert.equal(app.root.querySelectorAll(".product-list .product").length, testApi.matrixCount(991101, 1));
  assert(compactText(app.root).includes(`Каталог продукции · ${testApi.matrixCount(991101, 1)}`));

  const firstProduct = app.root.querySelector(".product-list .product");
  const addLot = [...firstProduct.querySelectorAll("button")].find((button) => button.getAttribute("aria-label") === "+");
  assert(addLot, "Add-lot button is missing");
  for (const expected of [15, 30, 45, 60]) {
    addLot.click();
    await waitFor(() => app.root.querySelector("#sumUnits") && Number(app.root.querySelector("#sumUnits").textContent) === expected, `cart units ${expected}`);
  }
  const reviewButton = app.root.querySelector("#sumSubmit");
  assert(reviewButton && !reviewButton.disabled, "Review button must be enabled");
  reviewButton.click();
  const sendButton = await waitFor(
    () => [...app.root.querySelectorAll("button")].find((button) => compactText(button) === "Отправить заказ"),
    "order review"
  );
  assert(!sendButton.disabled, "Send button must be enabled");
  sendButton.click();
  await waitFor(() => app.root.querySelector(".topbar__title") && compactText(app.root.querySelector(".topbar__title")) === "История заказов", "created order history");
  await waitFor(() => app.root.querySelectorAll(".orders-history__table tbody tr").length === 13, "created order row");

  result = await api(app, "/api/v1/payers/991100/orders");
  assert.equal(result.body.Orders.length, 13);
  const created = result.body.Orders.find((order) => order.Id_ord >= 9960001);
  assert(created, "Created demo order is missing");
  let details = await api(app, `/api/v1/orders/${created.Id_ord}`);
  assert.equal(details.response.status, 200);
  assert.equal(details.body.Product.length, 1);
  const changedQuantity = details.body.Product[0].Kolsht + details.body.Product[0].lk_KolUkl;
  result = await api(app, `/api/v1/orders/${created.Id_ord}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Product: [{ Id_prd: details.body.Product[0].id_prd, KolSht: changedQuantity }] }),
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.KolSht, changedQuantity);
  result = await api(app, `/api/v1/orders/${created.Id_ord}`, { method: "DELETE" });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.State, "Удален");

  await navigate(app, "dashboard", "Обзор");
  await navigate(app, "order", "Оформить заказ");
  const freeze = await waitFor(() => app.root.querySelector("#setupFreezeChk"), "freeze toggle");
  freeze.click();
  await waitFor(() => app.root.textContent.includes("Да — замороженная продукция (ЗПФ)"), "frozen setup");
  const showFrozen = [...app.root.querySelectorAll("button")].find((button) => compactText(button).startsWith("Показать прайс-лист"));
  showFrozen.click();
  await waitFor(() => app.root.querySelectorAll(".product-list .product").length === testApi.matrixCount(991101, 0), "frozen catalog");
  assert(testApi.matrixCount(991101, 0) > 0);

  const payerSelect = app.root.querySelector('select[aria-label="Текущее юридическое лицо"]');
  assert(payerSelect, "Payer switcher is missing");
  setSelect(app.window, payerSelect, "payerdemo00002");
  await waitFor(() => testApi.context() && testApi.context().payerId === 991200, "switch to second payer");
  await waitFor(() => compactText(app.root).includes("Михаил Орлов"), "second payer UI");
  assert.deepEqual(Array.from(testApi.context().clientIds), [991201, 991202]);
  result = await api(app, "/api/v1/payers/991200/clients");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.Clients.length, 2);

  const logoutButton = [...app.root.querySelectorAll("aside button")].find((button) => compactText(button) === "Выйти");
  assert(logoutButton, "Logout button is missing");
  logoutButton.click();
  await waitFor(() => app.root.querySelector('input[type="email"]'), "logout");
  await waitFor(() => app.window.__KARAVAY_DEMO_SHOWCASE_ACTIVE__ === false, "demo context reset");
  assert.equal(app.window.__KARAVAY_DEMO_SHOWCASE_CONTEXT__, null);

  assertNoBusinessRequestEscaped(app);
  assertNoConsoleErrors(app);
  const requestCount = app.requests.length;
  app.dom.window.close();
  return { requestCount, createdOrderId: created.Id_ord };
}

async function viewerScenario() {
  const app = await createApp();
  const testApi = app.window.__KARAVAY_DEMO_SHOWCASE_TEST__;
  await login(app, "mashuliaz@gmail.com");
  await waitFor(() => testApi.context() && testApi.context().role === "viewer", "viewer context");
  await waitFor(() => app.root.querySelectorAll(".table tbody tr").length > 0, "viewer business data");
  const context = testApi.context();
  assert.equal(context.payerId, 991200);
  assert.deepEqual(Array.from(context.clientIds), [991201]);
  let text = compactText(app.root);
  assert(text.includes("Режим просмотра."));
  assert(text.includes("1 получатель"));
  assert(text.includes("Кафе «Маяк» · Московский"));
  assert(!text.includes("Кафе «Маяк» · Купчино"));

  const clientDirectoryRequests = app.requests.filter((request) => new URL(request.url).pathname === "/api/collections/clients/records");
  assert.equal(clientDirectoryRequests.length, 0, "Explicit client right must not fetch all payer clients");

  let result = await api(app, "/api/v1/payers/991200/clients");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.Clients.length, 1);
  assert.equal(result.body.Clients[0].id_clt, 991201);
  result = await api(app, "/api/v1/payers/991200/orders");
  assert.equal(result.response.status, 200);
  assert.equal(result.body.Orders.length, 6);
  assert(result.body.Orders.every((order) => order.id_clt === 991201));
  result = await api(app, "/api/v1/clients/991202/matrix?DateOrd=1893456000&Group=1");
  assert.equal(result.response.status, 403);
  result = await api(app, "/api/v1/payers/991100/orders");
  assert.equal(result.response.status, 403);

  await navigate(app, "outlets", "Получатели");
  text = compactText(app.root);
  assert(text.includes("Кафе «Маяк» · Московский"));
  assert(!text.includes("Кафе «Маяк» · Купчино"));

  await navigate(app, "orders", "История заказов");
  await waitFor(() => app.root.querySelectorAll(".orders-history__table tbody tr").length === 6, "viewer order history");
  text = compactText(app.root);
  assert(!text.includes("DEMO-C202"));

  result = await api(app, "/api/v1/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Id_clt: 991201, DateOrd: 1893456000, Product: [{ Id_prd: 700001, KolSht: 100 }] }),
  });
  assert.equal(result.response.status, 403);
  assert.equal(result.body.detail, "Роль пользователя разрешает только просмотр");

  assertNoBusinessRequestEscaped(app);
  assertNoConsoleErrors(app);
  const requestCount = app.requests.length;
  app.dom.window.close();
  return { requestCount };
}

async function main() {
  const staticResult = staticChecks();
  const manager = await managerScenario();
  const viewer = await viewerScenario();
  console.log(JSON.stringify({
    status: "PASS",
    static: staticResult,
    manager,
    viewer,
    checks: [
      "real PocketBase auth/role/rights flow mocked at boundary",
      "two-payer manager scope",
      "single-client viewer scope",
      "111-product catalog with HBI and frozen groups",
      "dashboard, recipients, orders, documents and profile",
      "order create/update/cancel demo lifecycle",
      "viewer mutation denial",
      "no /api/v1 request escaped to KIS",
      "logout clears demo context",
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
