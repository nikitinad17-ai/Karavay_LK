const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'dist');
const html = fs.readFileSync(path.join(root, 'Karavay-Manager-Demo-v0.3.html'), 'utf8');

test('Автономный HTML содержит все ресурсы и выполняет код после создания интерфейса', () => {
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+rel="stylesheet"/);
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const assets = [...markup.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  assert.ok(assets.every(url => url.startsWith('data:') || url.startsWith('#')));
  assert.match(html, /<style>[\s\S]*\.access-editor/);
  assert.match(html, /src="data:image\/svg\+xml;base64,/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  assert.ok(scripts[0].index > html.indexOf('<dialog id="dialog"'));
  const modelSource = fs.readFileSync(path.join(root, 'model.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.equal(scripts[0][1].trim(), modelSource.trim());
  assert.equal(scripts[1][1].trim(), appSource.trim());
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script[1]));
});

test('Сайт ссылается на существующие локальные ресурсы и скачиваемое демо', () => {
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, asset] of page.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (asset.startsWith('#')) continue;
    assert.doesNotMatch(asset, /^(?:https?:)?\/\//);
    assert.ok(fs.existsSync(path.join(root, asset)), asset);
  }
});
