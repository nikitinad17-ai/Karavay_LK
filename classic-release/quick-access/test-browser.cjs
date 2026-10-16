// Only the isolated PB started by test-quick.py is used here.
const {chromium} = require('playwright');
const {pathToFileURL} = require('node:url');
(async () => {
  const [file, serialized, base] = process.argv.slice(2);
  const accounts = JSON.parse(serialized);
  const browser = await chromium.launch({executablePath: process.env.QUICK_CHROME, headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const requests = [];
    page.on('request', r => requests.push({url: r.url(), method: r.method()}));
    await page.goto(pathToFileURL(file).href);
    await page.getByRole('button', {name: accounts[0].name, exact: false}).click();
    await page.getByText('Добро пожаловать, ' + accounts[0].name, {exact: true}).waitFor();
    await page.waitForFunction(() => document.querySelector('select[aria-label="Получатель"]')?.value === '700202');
    if (await page.getByLabel('Получатель', {exact: true}).locator('option').count() !== 2) throw Error('Expected placeholder and single client');
    const before = requests.length;
    await page.reload();
    await page.getByText('Добро пожаловать, ' + accounts[0].name, {exact: true}).waitFor();
    if (!requests.slice(before).some(r => r.url.endsWith('/auth-refresh'))) throw Error('Refresh not used');
    await page.locator('.quick-access summary').click();
    page.once('dialog', d => d.accept());
    await page.getByRole('button', {name: accounts[1].name, exact: false}).click();
    await page.getByText('Добро пожаловать, ' + accounts[1].name, {exact: true}).waitFor();
    await page.waitForFunction(() => document.querySelectorAll('select[aria-label="Получатель"] option').length === 3);
    await page.getByRole('button', {name: 'Выйти', exact: true}).click();
    await page.getByLabel('Email', {exact: true}).waitFor();
    await page.locator('.quick-access summary').click();
    await page.getByRole('button', {name: accounts[2].name, exact: false}).click();
    await page.getByText('Добро пожаловать, ' + accounts[2].name, {exact: true}).waitFor();
    const buyerCount = await page.locator('.classic-context select').first().locator('option').count();
    if (buyerCount !== 3) throw Error('Expected placeholder and two buyers, got ' + buyerCount);
    await page.setViewportSize({width: 390, height: 844});
    await page.locator('.quick-access summary').click();
    const box = await page.locator('.quick-access').boundingBox();
    if (!box || box.x < 0 || box.x + box.width > 391) throw Error('Panel overflows mobile viewport');
    if (errors.length) throw Error(errors.join('\n'));
    if (requests.some(r => r.url.includes('/api/v1') || (r.method === 'POST' && r.url.startsWith(base + '/service/orders')))) throw Error('Unexpected KIS access or order write');
    console.log('PASS: real Chromium file://: 3 passwordless buttons, CORS, normal auth-refresh/F5, exact point/all/multi UI, logout, switching, mobile panel; no order writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
