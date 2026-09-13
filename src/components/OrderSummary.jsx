import { useStore, currentOutletOf, useOrderActions } from '../store.jsx';
import { esc, fmtMoney, fmtMoneyShort, fmtDateFull, groupLabel, outletMinSum } from '../utils.js';
import { ShipmentPill, BalancePill, EdiPill } from './Pills.jsx';

function showsBalance(role) { return role === 'buyer'; }

export default function OrderSummary({ cartItems, totalUnits, totalSum, belowMin, minSum }) {
  const { state, patch } = useStore();
  const { openOrderReview } = useOrderActions();
  const ol = currentOutletOf(state);
  const b = state.buyer;

  function onClearCart() {
    if (!Object.keys(state.cart || {}).length) return;
    patch({
      confirm: {
        title: 'Очистить корзину?',
        body: 'Все добавленные позиции будут удалены.',
        okText: 'Очистить', cancelText: 'Отмена', danger: true,
        onOk: () => patch({ cart: {}, cartDetails: {} }),
      },
    });
  }

  return (
    <div className="summary-col">
      <div className="card summary">
        <h3 className="card__title">В заказе</h3>
        <div className="summary__ship">
          <div><strong>Точка:</strong> {ol ? esc(ol.name) : '—'} <span style={{ color: 'var(--gray-600)' }}>· {ol ? esc(ol.code) : ''}</span></div>
          {ol && ol.address ? <div className="summary__addr">{esc(ol.address)}</div> : null}
          <div className="summary__min-line">Минимальная сумма: <strong>{fmtMoneyShort(minSum)}</strong></div>
          {showsBalance(state.role) ? (
            <div style={{ marginTop: 6 }}>
              <ShipmentPill buyer={b} /> <BalancePill buyer={b} /> <EdiPill buyer={b} />
            </div>
          ) : null}
        </div>
        {cartItems.length ? (
          <div className="summary__totals" id="sumTotals">
            <div className="summary__total"><span>Итого · <span id="sumUnits">{totalUnits}</span> шт.</span><span id="sumSum">{fmtMoney(totalSum)}</span></div>
            {belowMin ? <div className="summary__error" id="sumError">До минимальной суммы не хватает {fmtMoneyShort(minSum - totalSum)}.</div> : null}
          </div>
        ) : (
          <div className="summary__empty" id="sumEmpty">Добавьте позиции из каталога.</div>
        )}
        <div>
          <div className="summary__note summary__note--info">
            Поставка <strong>{fmtDateFull(state.orderDate)}</strong>, группа <strong>{groupLabel(state.orderGroup)}</strong>. ЗПФ и ХБИ оформляются разными заказами.
          </div>
          <button
            className="btn btn--primary" type="button" id="sumSubmit"
            style={{ width: '100%', justifyContent: 'center', height: 48 }}
            disabled={!cartItems.length || state.matrixLoading || Boolean(state.matrixError)}
            onClick={openOrderReview}
          >
            Проверить заказ
          </button>
          {cartItems.length ? (
            <button className="btn btn--secondary btn--sm" type="button" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={onClearCart}>
              Очистить корзину
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
