import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const argument = (name, fallback) => {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
};
const variant = argument('variant', 'demo');
const distDir = path.join(projectRoot, argument('dist', 'standalone-dist'));
const assetsDir = path.join(distDir, 'assets');
const outputDir = path.join(projectRoot, 'artifacts');
const outputPath = path.join(outputDir, argument('output', 'Karavay-LK-v3.6.html'));

let html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script type="module" crossorigin src="\.\/assets\/([^"]+)"><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet" crossorigin href="\.\/assets\/([^"]+)">/);

if (!scriptMatch || !styleMatch) {
  throw new Error('Не удалось найти ресурсы Vite в standalone-dist/index.html');
}

let javascript = fs.readFileSync(path.join(assetsDir, scriptMatch[1]), 'utf8');
const css = fs.readFileSync(path.join(assetsDir, styleMatch[1]), 'utf8');
const logo = fs.readFileSync(path.join(projectRoot, 'public', 'logo-official.svg')).toString('base64');
const favicon = fs.readFileSync(path.join(projectRoot, 'public', 'favicon.svg')).toString('base64');
const mockChunkName = fs.readdirSync(assetsDir)
  .find((name) => name.startsWith('mockApi-') && name.endsWith('.js'));

if (variant === 'demo' && !mockChunkName) {
  throw new Error('Не найден demo-модуль mockApi в standalone-dist/assets');
}

if (mockChunkName) {
  const pdf = fs.readFileSync(
    path.join(projectRoot, 'public', 'docs', 'Reestr-deklaratsii-sootvetstviia.pdf'),
  ).toString('base64');
  let mockJavascript = fs.readFileSync(path.join(assetsDir, mockChunkName), 'utf8');
  mockJavascript = mockJavascript.replaceAll(
    'docs/Reestr-deklaratsii-sootvetstviia.pdf',
    `data:application/pdf;base64,${pdf}`,
  );
  const mockDataUrl = `data:text/javascript;base64,${Buffer.from(mockJavascript).toString('base64')}`;
  javascript = javascript.replaceAll(`./${mockChunkName}`, mockDataUrl);
}

javascript = javascript
  .replaceAll('./logo-official.svg', `data:image/svg+xml;base64,${logo}`)
  .replaceAll('</script', '<\\/script');

html = html
  .replace(scriptMatch[0], () => `<script type="module">${javascript}</script>`)
  .replace(styleMatch[0], () => `<style>${css.replaceAll('</style', '<\\/style')}</style>`)
  .replace('./favicon.svg', `data:image/svg+xml;base64,${favicon}`)
  .replace(/\s*<link rel="preconnect"[^>]+>\s*/g, '\n  ')
  .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^"]+"[^>]+>\s*/g, '\n  ')
  .replace('<head>', `<head>\n  <!-- КАРАВАЙ · Личный кабинет 3.6 · ${variant === 'demo' ? 'демо' : 'PocketBase user access'} -->`);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, html);
console.log(outputPath);
