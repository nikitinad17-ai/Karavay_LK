import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('');
  await page.getByRole('button', { name: /DEMO-B-01 · Демо-покупатель 01/ }).click();
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible();
}

async function openCatalog(page) {
  await page.getByRole('link', { name: /Оформить заказ/ }).click();
  await page.getByRole('button', { name: /Показать прайс-лист/ }).click();
  await expect(page.getByRole('heading', { name: /Каталог продукции/ })).toBeVisible();
}

test('проверка заказа открывается до отправки и сохраняет корзину', async ({ page }) => {
  await login(page);
  await openCatalog(page);
  const product = page.locator('.product').first();
  await product.locator('input').first().fill('100');
  const totalBefore = await product.locator('.qty__total').textContent();
  await page.locator('#sumSubmit').click();
  await expect(page.getByRole('dialog', { name: 'Проверить заказ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отправить заказ' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться к заказу' }).click();
  await expect(product.locator('.qty__total')).toHaveText(totalBefore);
});

test('двойное нажатие создаёт только один заказ', async ({ page }) => {
  await login(page);
  await openCatalog(page);
  const product = page.locator('.product').first();
  await product.locator('input').first().fill('100');
  await page.locator('#sumSubmit').click();
  const submit = page.getByRole('button', { name: 'Отправить заказ' });
  await submit.evaluate((button) => { button.click(); button.click(); });
  await expect(page.getByRole('heading', { name: 'История заказов' })).toBeVisible();
  await expect(page.getByText(/Заказ №\d+ принят/)).toBeVisible();
});

test('несохранённые правки требуют явного подтверждения отмены', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'История заказов' }).click();
  await page.locator('.orders-history__table tbody tr').first().click();
  const dialog = page.getByRole('dialog', { name: 'Карточка заказа' });
  await expect(dialog).toBeVisible();
  await dialog.locator('button[aria-label="+"]').first().click();
  await dialog.getByRole('button', { name: 'Отменить правки' }).click();
  await expect(page.getByText('Отменить несохранённые правки?')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить редактирование' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Отменить правки' }).click();
  await page.getByRole('button', { name: 'Отменить правки' }).last().click();
  await expect(dialog).toBeHidden();
});

test('на мобильном экране видна закреплённая панель проверки', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'));
  await login(page);
  await page.getByRole('button', { name: 'Меню' }).click();
  await page.getByRole('link', { name: /Оформить заказ/ }).click();
  await page.getByRole('button', { name: /Показать прайс-лист/ }).click();
  await expect(page.locator('.mobile-review')).toBeVisible();
});
