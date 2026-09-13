import { useEffect, useRef } from 'react';
import { currentOutletOf, useOrderActions, useStore } from '../store.jsx';
import { reviewData } from '../orderRules.js';
import { esc, fmtDateFull, fmtMoney, fmtMoneyShort, groupLabel } from '../utils.js';
import { IconClose } from '../icons.jsx';

export default function OrderReview() {
  const { state } = useStore();
  const { closeOrderReview, submitOrder } = useOrderActions();
  const titleRef = useRef(null);
  const panelRef = useRef(null);
  const data = reviewData(state, currentOutletOf(state));

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  function trapFocus(event) {
    if (event.key !== 'Tab') return;
    const focusable = [...panelRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function onBackdrop(event) {
    if (event.target === event.currentTarget) closeOrderReview();
  }

  return (
    <div className="review-back" onClick={onBackdrop}>
      <section ref={panelRef} className="review-panel" role="dialog" aria-modal="true" aria-labelledby="reviewTitle" onKeyDown={trapFocus}>
        <header className="review-panel__header">
          <h2 id="reviewTitle" ref={titleRef} tabIndex={-1}>Проверить заказ</h2>
          <button type="button" className="modal__close" aria-label="Вернуться к заказу" disabled={state.submittingOrder} onClick={closeOrderReview}>
            <IconClose />
          </button>
        </header>
        <div className="review-panel__body">
          <dl className="review-details">
            <dt>Получатель</dt><dd>{data.outlet ? esc(data.outlet.name) : '—'} · {data.outlet ? esc(data.outlet.code) : ''}</dd>
            <dt>Адрес</dt><dd>{data.outlet ? esc(data.outlet.address) : '—'}</dd>
            <dt>Дата поставки</dt><dd>{fmtDateFull(state.orderDate)}</dd>
            <dt>Группа</dt><dd>{groupLabel(state.orderGroup)}</dd>
          </dl>
          <h3 className="review-caption">Выбранные позиции · {data.items.length}</h3>
          <ul className="review-items">
            {data.items.map((item) => (
              <li className="review-item" key={item.p.id}>
                <div>
                  <strong>{esc(item.p.name)}</strong>
                  <span>Код {esc(item.p.code || item.p.id)} · {fmtMoney(item.p.price)} / шт.</span>
                  {item.error ? <span className="review-item__error">{item.error}</span> : null}
                </div>
                <div className="review-item__amount"><span>{item.qty} шт.</span><strong>{fmtMoney(item.sum)}</strong></div>
              </li>
            ))}
          </ul>
          {data.missing ? <p className="summary__error">До минимальной суммы не хватает {fmtMoneyShort(data.missing)}. Вернитесь к заказу и добавьте позиции.</p> : null}
          {state.reviewError ? <p className="summary__error" role="alert">{state.reviewError}</p> : null}
        </div>
        <div className="review-panel__footer" aria-busy={state.submittingOrder}>
          <div className="review-total"><span>Итого · {data.units} шт.</span><strong>{fmtMoney(data.total)}</strong></div>
          <div className="review-actions">
            <button type="button" className="btn btn--secondary" disabled={state.submittingOrder} onClick={closeOrderReview}>Вернуться к заказу</button>
            <button type="button" className="btn btn--primary" disabled={!data.canSubmit || state.submittingOrder} onClick={submitOrder}>
              {state.submittingOrder ? 'Отправляем…' : 'Отправить заказ'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
