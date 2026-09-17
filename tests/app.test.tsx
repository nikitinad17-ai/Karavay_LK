import { describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '../src/mockApi';
import { StoreProvider } from '../src/store';
import App from '../src/App';

async function renderLoggedIn() {
  const user = userEvent.setup();
  render(<StoreProvider><App /></StoreProvider>);
  await user.click(await screen.findByRole('button', { name: /DEMO-B-01 · Демо-покупатель 01/ }));
  await user.click(screen.getByRole('button', { name: 'Войти' }));
  await screen.findByRole('heading', { name: 'Обзор' });
  return user;
}

async function openCatalog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('link', { name: /Оформить заказ/ }));
  await user.click(screen.getByRole('button', { name: /Показать прайс-лист/ }));
  await screen.findByRole('heading', { name: /Каталог продукции/ });
}

describe('React 3.6 TypeScript', () => {
  test('открывает проверку заказа и возвращается без потери корзины', async () => {
    const user = await renderLoggedIn();
    await openCatalog(user);
    const product = document.querySelector<HTMLElement>('.product')!;
    const plus = product.querySelector<HTMLButtonElement>('button[aria-label="+"]')!;
    await user.click(plus);
    const totalBefore = product.querySelector<HTMLElement>('.qty__total')!.textContent || '';
    await user.click(document.querySelector<HTMLButtonElement>('#sumSubmit')!);
    expect(await screen.findByRole('dialog', { name: 'Проверить заказ' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Вернуться к заказу' }).at(-1)!);
    expect(product.querySelector('.qty__total')).toHaveTextContent(totalBefore);
  });

  test('показывает мобильную панель после открытия каталога', async () => {
    const user = await renderLoggedIn();
    await openCatalog(user);
    expect(document.querySelector('.mobile-review')).toBeInTheDocument();
    expect(document.querySelector('.mobile-review button')).toHaveTextContent('Проверить заказ');
  });

  test('не закрывает изменённый заказ без подтверждения', async () => {
    const user = await renderLoggedIn();
    await user.click(screen.getByRole('link', { name: 'История заказов' }));
    const firstRow = await waitFor(() => {
      const row = document.querySelector<HTMLTableRowElement>('.orders-history__table tbody tr');
      expect(row).toBeTruthy();
      if (!row) throw new Error('Строка заказа не найдена');
      return row;
    });
    await user.click(firstRow);
    const dialog = await screen.findByRole('dialog', { name: 'Карточка заказа' });
    await waitFor(() => expect(dialog.querySelector('button[aria-label="+"]')).toBeTruthy());
    await user.click(dialog.querySelector<HTMLButtonElement>('button[aria-label="+"]')!);
    await user.click(screen.getByRole('button', { name: 'Отменить правки' }));
    expect(await screen.findByText('Отменить несохранённые правки?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Продолжить редактирование' }));
    expect(screen.getByRole('dialog', { name: 'Карточка заказа' })).toBeInTheDocument();
  });
});
