"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const workspace = path.resolve(__dirname, "..");
const repository = path.resolve(workspace, "..");
const basePath = path.join(workspace, "base", "Karavay-LK-v3.6.3-Rights-List-Fields-Fix.html");
const templatePath = path.join(workspace, "src", "demo-showcase-adapter.template.js");
const productsPath = path.join(repository, "src", "products.ts");
const outputDir = path.join(workspace, "artifacts");
const outputPath = path.join(outputDir, "Karavay-LK-v3.6.4-Demo-Showcase.html");
const expectedBaseSha256 = "1c2f5683864f6d1c2def517ddffa47879b186f6e818ebb8da2a5dae0169e2311";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  const last = source.lastIndexOf(before);
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one match, got ${first < 0 ? 0 : "more than one"}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function wrapReturnedObject(source, functionMarker, nextFunctionMarker, helperName) {
  const start = source.indexOf(functionMarker);
  const end = source.indexOf(nextFunctionMarker, start + functionMarker.length);
  if (start < 0 || end < 0) throw new Error(`Cannot locate ${functionMarker}`);
  let segment = source.slice(start, end);
  const returnAt = segment.indexOf("return{");
  if (returnAt < 0) throw new Error(`Cannot wrap return object in ${functionMarker}`);
  segment = segment.slice(0, returnAt) + `return globalThis.${helperName}({` + segment.slice(returnAt + "return{".length);
  const functionClose = segment.lastIndexOf("}");
  if (functionClose < returnAt) throw new Error(`Cannot close wrapped return object in ${functionMarker}`);
  segment = segment.slice(0, functionClose) + ")" + segment.slice(functionClose);
  return source.slice(0, start) + segment + source.slice(end);
}

const base = fs.readFileSync(basePath, "utf8");
if (sha256(base) !== expectedBaseSha256) throw new Error("Base v3.6.3 SHA-256 does not match the approved file");

const productsSource = fs.readFileSync(productsPath, "utf8");
const productsMatch = productsSource.match(/export const PRODUCTS: Product\[\] = (\[[\s\S]*\]);\s*$/);
if (!productsMatch) throw new Error("Cannot extract PRODUCTS from products.ts");
const products = JSON.parse(productsMatch[1]);
if (!Array.isArray(products) || products.length < 50) throw new Error("Product catalog is unexpectedly small");

let adapter = fs.readFileSync(templatePath, "utf8");
adapter = replaceExactlyOnce(adapter, "__KARAVAY_PRODUCTS_JSON__", JSON.stringify(products), "products placeholder");

let html = base;
html = replaceExactlyOnce(html,
  "<!-- КАРАВАЙ · Личный кабинет 3.6.3 · PocketBase email auth + rights access -->",
  "<!-- КАРАВАЙ · Личный кабинет 3.6.4 Demo Showcase · PocketBase auth + local demo business data -->",
  "version comment");
html = replaceExactlyOnce(html,
  "<title>ОАО «КАРАВАЙ» · Личный кабинет клиента</title>",
  "<title>ОАО «КАРАВАЙ» · Личный кабинет · Демо</title>",
  "document title");
html = replaceExactlyOnce(html,
  "  <script data-karavay-app>",
  `  <script data-karavay-demo-showcase>\n${adapter}\n  </script>\n  <script data-karavay-app>`,
  "adapter injection");
html = replaceExactlyOnce(html,
  "qe=()=>Ge.dataMode===`directory`",
  "qe=()=>Ge.dataMode===`directory`&&!globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__",
  "dynamic data mode");
html = replaceExactlyOnce(html,
  "{loadBuyerData:o}=bn(),s=(0,c.useCallback)",
  "{loadBuyerData:o}=bn(),demoBusinessLoader=o,s=(0,c.useCallback)",
  "business loader alias");
html = replaceExactlyOnce(html,
  "payerSwitching:!1,payerSwitchError:``}),!0)}catch",
  "payerSwitching:!1,payerSwitchError:``}),globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__=String(r.payer.code||``).startsWith(`DEMO-`),globalThis.__KARAVAY_DEMO_SHOWCASE_CONTEXT__=globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__?{payerId:r.payer.Id_pay,clientIds:(r.clients||[]).map(e=>e.id_clt),role:r.role.codeRole}:null,globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__&&setTimeout(demoBusinessLoader,0),!0)}catch",
  "selected payer demo activation");
html = replaceExactlyOnce(html,
  "f=(0,c.useCallback)(()=>{i(`selectedPayer`),l(),bt(),e(un())}",
  "f=(0,c.useCallback)(()=>{i(`selectedPayer`),l(),bt(),globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__=!1,globalThis.__KARAVAY_DEMO_SHOWCASE_CONTEXT__=null,e(un())}",
  "logout demo reset");
html = replaceExactlyOnce(html,
  "_=(0,c.useCallback)(()=>{i(`selectedPayer`),l(),bt(),je();",
  "_=(0,c.useCallback)(()=>{i(`selectedPayer`),l(),bt(),globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__=!1,globalThis.__KARAVAY_DEMO_SHOWCASE_CONTEXT__=null,je();",
  "explicit logout demo reset");
html = wrapReturnedObject(html, "function N(e){", "function Yt(e,t){", "__KARAVAY_DEMO_ENRICH_PAYER__");
html = wrapReturnedObject(html, "function Yt(e,t){", "function Xt(e,t,n){", "__KARAVAY_DEMO_ENRICH_CLIENT__");
html = replaceExactlyOnce(html,
  "children:[(0,P.jsx)(Un,{}),u?",
  "children:[(0,P.jsx)(Un,{}),globalThis.__KARAVAY_DEMO_SHOWCASE_ACTIVE__?(0,P.jsx)(`div`,{className:`banner banner--info karavay-demo-banner`,role:`status`,children:(0,P.jsxs)(`div`,{children:[(0,P.jsx)(`strong`,{children:`Демонстрационный режим.`}),` Ассортимент, цены, заказы и документы учебные; данные не передаются в КИС.`]})}):null,globalThis.__KARAVAY_DEMO_SHOWCASE_CONTEXT__?.role===`viewer`?(0,P.jsx)(`div`,{className:`banner banner--info karavay-demo-readonly`,role:`status`,children:(0,P.jsxs)(`div`,{children:[(0,P.jsx)(`strong`,{children:`Режим просмотра.`}),` Создание, изменение и отмена демо-заказов недоступны для этой роли.`]})}):null,u?",
  "demo banner");

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, html, "utf8");

console.log(JSON.stringify({
  outputPath,
  baseSha256: expectedBaseSha256,
  outputSha256: sha256(html),
  sizeBytes: Buffer.byteLength(html),
  productCount: products.length
}, null, 2));
