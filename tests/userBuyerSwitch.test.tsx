import { useEffect } from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfirmModal from '../src/components/ConfirmModal';
import App from '../src/App';
import { StoreProvider, buyerBusinessReset, useAuth, useStore } from '../src/store';
import { adaptPayer } from '../src/utils';
import type { Buyer, BuyerMembership, UserDirectory } from '../src/types';

function makeBuyer(recordId: string, kisId: number, code: string, name: string): Buyer {
  return {
    ...adaptPayer({ lk_id: kisId, Id_pay: kisId, KodPay: code, NamePay: name, Adres: name, Clients: [] }),
    recordId,
  };
}

const user = {
  id: 'userrecord00001', login: 'ivan.petrov', name: 'Иван Петров', active: true, mustChangePassword: false,
};
const buyerA = makeBuyer('buyerrecord001', 1001, 'A001', 'Покупатель А');
const buyerB = makeBuyer('buyerrecord002', 1002, 'B001', 'Покупатель Б');

function membership(id: string, buyerId: string): BuyerMembership {
  return { id, userId: user.id, buyerId, role: 'manager', active: true };
}

const membershipA = membership('membership0001', buyerA.recordId!);
const membershipB = membership('membership0002', buyerB.recordId!);
const directory: UserDirectory = {
  user,
  accesses: [
    { membership: membershipA, buyer: buyerA },
    { membership: membershipB, buyer: buyerB },
  ],
};

function SwitchHarness() {
  const { state, patch } = useStore();
  const { switchBuyer } = useAuth();
  useEffect(() => {
    patch({
      authenticatedUser: user,
      userDirectory: directory,
      selectedBuyerContext: {
        userId: user.id,
        buyerId: buyerA.recordId!,
        membership: membershipA,
        buyer: buyerA,
        outlets: [],
      },
      buyer: buyerA,
      role: 'buyer',
      route: 'dashboard',
      cart: { 101: 12 },
    });
  }, [patch]);
  return (
    <>
      <div data-testid="current-buyer">{state.selectedBuyerContext?.buyerId || ''}</div>
      <button type="button" onClick={() => { void switchBuyer(buyerB.recordId!); }}>Сменить покупателя</button>
      <ConfirmModal />
    </>
  );
}

function BuyerSelectionHarness() {
  const { patch } = useStore();
  useEffect(() => {
    patch({
      authenticatedUser: user,
      userDirectory: directory,
      buyerSelectionRequired: true,
      route: 'buyer-select',
    });
  }, [patch]);
  return <App />;
}

describe('переключение юрлица', () => {
  test('пользователь с несколькими покупателями видит отдельный экран выбора', async () => {
    render(<StoreProvider><BuyerSelectionHarness /></StoreProvider>);
    expect(await screen.findByRole('heading', { name: 'Выберите юридическое лицо' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Покупатель А/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Покупатель Б/ })).toBeInTheDocument();
  });

  test('переключение с несохранённой корзиной требует подтверждения', async () => {
    const browserUser = userEvent.setup();
    render(<StoreProvider><SwitchHarness /></StoreProvider>);
    await browserUser.click(await screen.findByRole('button', { name: 'Сменить покупателя' }));
    expect(await screen.findByText('Сменить юрлицо?')).toBeInTheDocument();
    expect(screen.getByText(/Корзина или несохранённые корректировки/)).toBeInTheDocument();
    expect(screen.getByTestId('current-buyer')).toHaveTextContent(buyerA.recordId!);
    await browserUser.click(screen.getByRole('button', { name: 'Остаться' }));
    expect(screen.queryByText('Сменить юрлицо?')).not.toBeInTheDocument();
  });

  test('сброс покупателя очищает корзину, заказы, правки и кэши', () => {
    const reset = buyerBusinessReset();
    expect(reset.cart).toEqual({});
    expect(reset.ordersAll).toEqual([]);
    expect(reset.documents).toEqual([]);
    expect(reset.detailsCache).toEqual({});
    expect(reset.modalOrder).toBeNull();
    expect(reset.editSnapshot).toBeNull();
    expect(reset.buyer).toBeNull();
    expect(reset.outlets).toEqual([]);
  });
});
