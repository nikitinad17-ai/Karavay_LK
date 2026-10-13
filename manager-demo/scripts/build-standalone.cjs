const fs = require('node:fs');
const path = require('node:path');
const moduleRoot = path.join(__dirname, '..');
const sourceRoot = path.join(moduleRoot, 'src');
const root = path.join(moduleRoot, 'dist');
const standaloneRoot = path.join(moduleRoot, 'standalone');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(standaloneRoot, { recursive: true });
for (const name of ['index.html', 'styles.css', 'model.js', 'app.js', 'logo-official.svg']) {
  fs.copyFileSync(path.join(sourceRoot, name), path.join(root, name));
}
fs.copyFileSync(path.join(__dirname, 'Collect-Karavay-Manager-Source.ps1'), path.join(root, 'Collect-Karavay-Manager-Source.ps1'));
const read = name => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const css = read('styles.css');
const model = read('model.js');
const app = read('app.js');
if (/<\/style/i.test(css) || /<\/script/i.test(model + app)) throw new Error('Unexpected inline closing tag');
const logo = 'data:image/svg+xml;base64,' + Buffer.from(read('logo-official.svg')).toString('base64');
let html = read('index.html')
  .replace('href="logo-official.svg"', 'href="' + logo + '"')
  .replace('src="logo-official.svg"', 'src="' + logo + '"')
  .replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + css + '\n</style>')
  .replace('  <script defer src="model.js"></script>\n', '')
  .replace('  <script defer src="app.js"></script>\n', '')
  .replace('<a class="standalone-download" href="Karavay-Manager-Demo-v0.3.html" download>Скачать автономный HTML ↓</a>', '<span class="standalone-download">Автономное демо · версия 0.3</span>')
  // Inline classic scripts must run after the DOM: defer only affects external scripts.
  .replace('</body>', () => '<script>\n' + model + '\n</script>\n<script>\n' + app + '\n</script>\n</body>');
const output = path.join(root, 'Karavay-Manager-Demo-v0.3.html');
fs.writeFileSync(output, html);
fs.writeFileSync(path.join(standaloneRoot, 'Karavay-Manager-Demo-v0.3.html'), html);
console.log(output);
